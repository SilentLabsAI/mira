import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import { brain } from '../../packages/mira-core/src/lib/cog/brain.js';
import { generateAnswer, computeSemanticMatch } from '../../packages/mira-core/src/lib/cog/eval_utils.js';
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const openai = new OpenAI();

const MAX_CONCURRENT_CONVERSATIONS = 3;
const DELAY_BETWEEN_QUESTIONS_MS = 100;
const MAX_RETRIES = 3;
const EVAL_OUTPUT_DIR = process.env.MIRA_EVAL_OUTPUT_DIR || path.join(process.cwd(), 'eval-outputs', 'locomo');
const RESULTS_FILE = path.join(EVAL_OUTPUT_DIR, `locomo_full_results_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

interface Turn { speaker: string; text: string; dia_id: string; blip_caption?: string; }

async function getBatchEmbeddings(texts: string[]): Promise<number[][]> {
    const BATCH_SIZE = 500;
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const response = await openai.embeddings.create({ model: 'text-embedding-3-large', input: batch });
        allEmbeddings.push(...response.data.map(d => d.embedding));
    }
    return allEmbeddings;
}

async function ingestConversation(userId: string, threadId: string, conversation: any): Promise<void> {
    console.log(`  [Ingestion] Starting...`);

    await supabase.from('threads').upsert({
        id: threadId,
        user_id: userId,
        title: 'LOCOMO Conversation',
        metadata: { benchmark: true }
    });

    const parseDateTime = (dateStr: string) => {
        try {
            const match = dateStr.match(/(\d+):(\d+)\s*(am|pm)\s*on\s*(\d+)\s*(\w+),?\s*(\d+)/i);
            if (match) {
                const months: any = { 'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5, 'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11 };
                let h = parseInt(match[1]);
                if (match[3].toLowerCase() == 'pm' && h < 12) h += 12;
                if (match[3].toLowerCase() == 'am' && h == 12) h = 0;
                return new Date(parseInt(match[6]), months[match[5].toLowerCase()] || 0, parseInt(match[4]), h, parseInt(match[2]));
            }
        } catch (e) { }
        return new Date();
    };

    const allTurns: { turn: Turn; sessionDate: Date; turnIndex: number }[] = [];
    let globalTurnIndex = 0;

    for (let i = 1; i <= 35; i++) {
        const session = conversation[`session_${i}`];
        if (!session) continue;
        const sessionDate = parseDateTime(conversation[`session_${i}_date_time`] || '');
        for (const turn of session) {
            allTurns.push({ turn, sessionDate, turnIndex: globalTurnIndex++ });
        }
    }

    const texts = allTurns.map(t => {
        const baseText = t.turn.text;
        const captionText = t.turn.blip_caption ? ` [Image: ${t.turn.blip_caption}]` : '';
        return baseText + captionText;
    });
    const embeddings = await getBatchEmbeddings(texts);

    const rows = allTurns.map((t, idx) => {
        const baseText = t.turn.text;
        const captionText = t.turn.blip_caption ? ` [Image: ${t.turn.blip_caption}]` : '';
        return {
            thread_id: threadId,
            user_id: userId,
            role: t.turn.speaker === conversation.speaker_a ? 'user' : 'assistant',
            content: baseText + captionText,
            embedding: embeddings[idx],
            created_at: new Date(t.sessionDate.getTime() + t.turnIndex * 60000).toISOString(),
            metadata: { dia_id: t.turn.dia_id, speaker: t.turn.speaker }
        };
    });

    console.log(`  [Ingestion] Inserting ${rows.length} messages...`);
    for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabase.from('messages').insert(rows.slice(i, i + 100));
        if (error) console.error('  [Ingestion] Insert error:', error);
    }

    const sessionTexts: { text: string, date: string }[] = [];
    for (let i = 1; i <= 35; i++) {
        const session = conversation[`session_${i}`];
        if (!session) continue;
        const date = conversation[`session_${i}_date_time`] || '';
        const text = session.map((t: Turn) => {
            const baseText = `${t.speaker}: ${t.text}`;
            const captionText = t.blip_caption ? ` [Image: ${t.blip_caption}]` : '';
            return baseText + captionText;
        }).join('\n');
        sessionTexts.push({ text, date });
    }

    for (let i = 0; i < sessionTexts.length; i += 3) {
        const batch = sessionTexts.slice(i, i + 3);
        await Promise.all(batch.map(async (s) => {
            try {
                await brain.extractFacts(threadId, s.text, userId, s.date);
                const entities = await brain.extractEntities(s.text);
                await brain.saveEntities(userId, entities);
            } catch (e) { }
        }));
    }

    console.log(`  [Ingestion] Done.`);
}

async function cleanupData(userId: string) {
    await supabase.from('messages').delete().eq('user_id', userId);
    await supabase.from('facts').delete().eq('user_id', userId);
    await supabase.from('entities').delete().eq('user_id', userId);
    await supabase.from('threads').delete().eq('user_id', userId);
}
async function withRetry<T>(fn: () => Promise<T>, maxRetries = MAX_RETRIES): Promise<T> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            const isRateLimit = error?.status === 429 || error?.code === 'rate_limit_exceeded';
            if (attempt === maxRetries - 1) throw error;
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
            console.log(`    [Retry] Attempt ${attempt + 1} failed${isRateLimit ? ' (rate limit)' : ''}, waiting ${Math.round(delay)}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw new Error('Max retries exceeded');
}

interface ConversationResult {
    sampleId: string;
    convIndex: number;
    standardCorrect: number;
    standardTotal: number;
    adversarialCorrect: number;
    adversarialTotal: number;
    standardScore: number;
    questions: Array<{
        question: string;
        prediction: string;
        groundTruth: string;
        passed: boolean;
        isAdversarial: boolean;
        category: string;
        contextUsed: string;
    }>;
    completed: boolean;
    startTime: string;
    endTime?: string;
}

async function evaluateConversation(sample: any, convIndex: number): Promise<ConversationResult> {
    const startTime = new Date().toISOString();
    const sampleId = sample.sample_id || `conv-${convIndex}`;

    const uuidSuffix = `0000000${convIndex}0201`.slice(-12);
    const userId = `00000000-0000-0000-0000-${uuidSuffix}`;
    const threadId = `00000000-0000-0000-0001-${uuidSuffix}`;

    console.log(`\n[${'='.repeat(20)} CONV ${convIndex}: ${sampleId} ${'='.repeat(20)}]`);

    const { count } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('user_id', userId);

    if (!count || count === 0) {
        console.log(`  [Conv ${convIndex}] Data missing. Ingesting...`);
        await cleanupData(userId);
        await ingestConversation(userId, threadId, sample.conversation);
    } else {
        console.log(`  [Conv ${convIndex}] Data found (${count} messages). Skipping ingestion.`);
    }

    const questions = sample.qa;
    const lastSessionDate = sample.conversation.session_35_date_time || sample.conversation.session_34_date_time || 'September 2023';

    const standardQuestions = questions.filter((q: any) => String(q.answer).toLowerCase() !== 'undefined');
    const adversarialQuestions = questions.filter((q: any) => String(q.answer).toLowerCase() === 'undefined');

    console.log(`  [Conv ${convIndex}] Evaluating ${questions.length} questions (${standardQuestions.length} std, ${adversarialQuestions.length} adv)`);

    let correctStandard = 0;
    let correctAdversarial = 0;

    const questionResults = [];
    for (let q = 0; q < questions.length; q++) {
        const qa = questions[q];
        const isAdversarial = String(qa.answer).toLowerCase() === 'undefined';

        if (q > 0) await new Promise(r => setTimeout(r, DELAY_BETWEEN_QUESTIONS_MS));

        try {
            const { answer, context } = await withRetry<Awaited<ReturnType<typeof generateAnswer>>>(() => generateAnswer(qa.question, lastSessionDate, threadId, userId));
            const { passed } = await withRetry<Awaited<ReturnType<typeof computeSemanticMatch>>>(() => computeSemanticMatch(qa.question, answer, String(qa.answer)));

            const augmentedPrompt = JSON.stringify(context);

            if (passed) {
                if (isAdversarial) correctAdversarial++;
                else correctStandard++;
            }

            questionResults.push({
                question: qa.question,
                prediction: answer,
                groundTruth: String(qa.answer),
                passed,
                isAdversarial,
                category: qa.category || 'unknown',
                contextUsed: augmentedPrompt
            });

            if ((q + 1) % 10 === 0) {
                console.log(`  [Conv ${convIndex}] Progress: ${q + 1}/${questions.length}`);
            }
        } catch (error) {
            console.error(`  [Conv ${convIndex}] Q${q + 1} failed:`, error);
        }
    }

    const standardScore = standardQuestions.length > 0 ? (correctStandard / standardQuestions.length * 100) : 0;

    console.log(`  [Conv ${convIndex}] DONE: ${correctStandard}/${standardQuestions.length} (${standardScore.toFixed(1)}%)`);

    return {
        sampleId,
        convIndex,
        standardCorrect: correctStandard,
        standardTotal: standardQuestions.length,
        adversarialCorrect: correctAdversarial,
        adversarialTotal: adversarialQuestions.length,
        standardScore,
        questions: questionResults,
        completed: true,
        startTime,
        endTime: new Date().toISOString()
    };
}

// ============ CONCURRENCY LIMITER ============

async function runWithConcurrencyLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
    const results: T[] = [];
    const executing = new Set<Promise<void>>();

    for (const task of tasks) {
        const p: Promise<void> = task().then(result => {
            results.push(result);
        }).finally(() => {
            executing.delete(p);
        });
        executing.add(p);

        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }

    await Promise.all([...executing]);
    return results;
}

// ============ MAIN RUNNER ============

async function runFullEvaluation(dataPath: string): Promise<void> {
    fs.mkdirSync(EVAL_OUTPUT_DIR, { recursive: true });

    console.log('='.repeat(70));
    console.log('LOCOMO FULL BENCHMARK - ALL 10 CONVERSATIONS');
    console.log(`Max Concurrency: ${MAX_CONCURRENT_CONVERSATIONS}`);
    console.log(`Delay between questions: ${DELAY_BETWEEN_QUESTIONS_MS}ms`);
    console.log('='.repeat(70));

    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`Loaded ${data.length} conversations`);

    // Create tasks for each conversation.
    const tasks = data
        .map((sample: any, index: number) => ({ sample, index }))
        .map((item: any) => () => evaluateConversation(item.sample, item.index));

    // Run with controlled concurrency
    const results = await runWithConcurrencyLimit<ConversationResult>(tasks, MAX_CONCURRENT_CONVERSATIONS);

    // Save results to file
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to: ${RESULTS_FILE}`);

    // Calculate overall scores
    const totalStandardCorrect = results.reduce((sum, r) => sum + r.standardCorrect, 0);
    const totalStandardQuestions = results.reduce((sum, r) => sum + r.standardTotal, 0);
    const totalAdversarialCorrect = results.reduce((sum, r) => sum + r.adversarialCorrect, 0);
    const totalAdversarialQuestions = results.reduce((sum, r) => sum + r.adversarialTotal, 0);

    const overallStandardScore = (totalStandardCorrect / totalStandardQuestions * 100).toFixed(1);
    const overallCombinedScore = ((totalStandardCorrect + totalAdversarialCorrect) / (totalStandardQuestions + totalAdversarialQuestions) * 100).toFixed(1);

    console.log('\n' + '='.repeat(70));
    console.log('FINAL RESULTS - LOCOMO FULL BENCHMARK');
    console.log('='.repeat(70));
    console.log('\nPer-Conversation Breakdown:');
    results.sort((a, b) => a.convIndex - b.convIndex).forEach(r => {
        console.log(`  Conv ${r.convIndex} (${r.sampleId}): ${r.standardCorrect}/${r.standardTotal} (${r.standardScore.toFixed(1)}%)`);
    });
    console.log('\n' + '-'.repeat(70));
    console.log(`STANDARD SCORE (categories 1-4): ${totalStandardCorrect}/${totalStandardQuestions} (${overallStandardScore}%)`);
    console.log(`Adversarial (informational): ${totalAdversarialCorrect}/${totalAdversarialQuestions}`);
    console.log(`Combined (all questions): ${totalStandardCorrect + totalAdversarialCorrect}/${totalStandardQuestions + totalAdversarialQuestions} (${overallCombinedScore}%)`);
    console.log('='.repeat(70));
}

const args = process.argv.slice(2);
const defaultPath = process.env.LOCOMO_DATA_PATH || path.join(process.cwd(), 'data/locomo10.json');
runFullEvaluation(args[0] || defaultPath).catch(console.error);
