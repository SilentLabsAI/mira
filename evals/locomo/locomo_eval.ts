import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import { brain } from '../../packages/mira-core/src/lib/cog/brain.js';
import { generateAnswer, computeSemanticMatch } from '../../packages/mira-core/src/lib/cog/eval_utils.js';
import * as fs from 'fs';
import * as path from 'path';

const originalLog = console.log;
console.log = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[Brain]')) {
        return;
    }
    originalLog(...args);
};

const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const TARGET_CONVS: "all" | number[] = "all";

const now = new Date();
const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
});
const parts = formatter.formatToParts(now);
const getPart = (type: string) => parts.find(p => p.type === type)?.value;
const TIMESTAMP = `${getPart('month')}-${getPart('day')}-${getPart('year')}-${getPart('hour')}-${getPart('minute')}`;

const BASE_LOGS_DIR = path.join(process.env.MIRA_EVAL_OUTPUT_DIR || path.join(process.cwd(), 'eval-outputs'), 'locomo/full_eval');
const LOGS_DIR = path.join(BASE_LOGS_DIR, `run_${TIMESTAMP}`);
const OUTPUT_FILE_FULL = path.join(LOGS_DIR, `full_log.json`);
const OUTPUT_FILE_COMPRESSED = path.join(LOGS_DIR, `compressed_log.json`);
const REPORT_FILE = path.join(LOGS_DIR, `report.md`);

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI();

interface QuestionResult {
    index: number;
    datasetIndex: number;
    convIndex: number;
    category: string;
    question: string;
    groundTruth: string;
    prediction: string;
    passed: boolean;
    valiationReasoning?: string;
    retrievedContext?: any;
}

async function runFullEvaluation() {
    console.log('='.repeat(60));
    console.log(`LOCOMO Full Evaluation - All Questions`);
    console.log(`(Filtering out Adversarial Questions)`);
    console.log('='.repeat(60));

    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    const dataPath = process.env.LOCOMO_DATA_PATH || path.join(process.cwd(), 'data/locomo10.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    const CATEGORY_NAMES: { [key: number]: string } = {
        1: 'single-hop',
        2: 'temporal',
        3: 'multi-hop',
        4: 'open-domain',
        5: 'adversarial'
    };

    const results: QuestionResult[] = [];
    let passed = 0;

    const allWorkItems: any[] = [];

    const indices = TARGET_CONVS === "all"
        ? Array.from({ length: data.length }, (_, i) => i)
        : TARGET_CONVS;

    for (const convIndex of indices) {
        const sample = data[convIndex];
        if (!sample) continue;

        const uuidSuffix = `0000000${convIndex}0201`.slice(-12);
        const userId = `00000000-0000-0000-0000-${uuidSuffix}`;
        const threadId = `00000000-0000-0000-0001-${uuidSuffix}`;

        let simulatedDate = 'August 19, 2023';
        for (let i = 35; i >= 1; i--) {
            const dateStr = sample.conversation[`session_${i}_date_time`];
            if (dateStr) {
                const match = dateStr.match(/(\d+)\s+(\w+),?\s*(\d+)/);
                if (match) {
                    simulatedDate = `${match[2]} ${match[1]}, ${match[3]}`;
                    break;
                }
            }
        }

        const allQuestions = sample.qa.map((q: any, idx: number) => ({ ...q, originalIndex: idx }));
        const validQuestions = allQuestions.filter((q: any) => q.category !== 5);
        for (const q of validQuestions) {
            allWorkItems.push({
                qa: q,
                convIndex,
                userId,
                threadId,
                simulatedDate
            });
        }
    }

    const totalQuestions = allWorkItems.length;
    console.log(`Total Questions Found: ${totalQuestions}`);

    for (let i = 0; i < allWorkItems.length; i += BATCH_SIZE) {
        const batch = allWorkItems.slice(i, i + BATCH_SIZE);
        console.log(`\n--- Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} questions) ---`);

        for (let j = 0; j < batch.length; j++) console.log('');

        await Promise.all(batch.map(async (item, batchIdx) => {
            const globalIdx = i + batchIdx + 1;
            const { qa, convIndex, userId, threadId, simulatedDate } = item;
            const categoryName = CATEGORY_NAMES[qa.category] || 'unknown';

            const updateStatus = (status: string) => {
                const linesUp = batch.length - batchIdx;
                process.stdout.write(`\x1b[${linesUp}A`);
                process.stdout.write(`\r\x1b[K${status} [${globalIdx}/${totalQuestions}] [Conv ${convIndex}] [Q${qa.originalIndex}] ${qa.question.slice(0, 50)}...`);
                process.stdout.write(`\x1b[${linesUp}B`);
            };

            updateStatus('[START]');

            let lastError: any = null;
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const { answer, context } = await generateAnswer(
                        qa.question,
                        simulatedDate,
                        threadId,
                        userId,
                        false
                    );

                    const { passed: isMatch, reasoning } = await computeSemanticMatch(
                        qa.question,
                        answer,
                        qa.answer
                    );

                    if (isMatch) passed++;

                    results.push({
                        index: globalIdx,
                        datasetIndex: qa.originalIndex,
                        convIndex: convIndex,
                        category: categoryName,
                        question: qa.question,
                        groundTruth: qa.answer,
                        prediction: answer,
                        passed: isMatch,
                        valiationReasoning: reasoning,
                        retrievedContext: {
                            depth: context.depth,
                            factsCount: context.facts?.length || 0,
                            messagesCount: context.messages?.length || 0,
                            entitiesCount: context.entities?.length || 0,
                            facts: context.facts || [],
                            messages: context.messages || [],
                            entities: context.entities || []
                        }
                    });

                    updateStatus(isMatch ? '✅ PASS' : '❌ FAIL');
                    return;

                } catch (error: any) {
                    lastError = error;
                    if (attempt < MAX_RETRIES) {
                        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                        updateStatus(`⚠️ RETRY ${attempt}/${MAX_RETRIES}`);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
            }

            updateStatus('❌ ERROR');
            results.push({
                index: globalIdx,
                datasetIndex: qa.originalIndex,
                convIndex: convIndex,
                category: categoryName,
                question: qa.question,
                groundTruth: qa.answer,
                prediction: `ERROR after ${MAX_RETRIES} retries: ${lastError?.message}`,
                passed: false,
                valiationReasoning: 'Error during evaluation (all retries exhausted)',
                retrievedContext: {}
            });
        }));

        if (i + BATCH_SIZE < totalQuestions) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    const score = (passed / totalQuestions) * 100;

    const categoryStats: any = {};
    const categories = [...new Set(results.map(r => r.category))];
    for (const cat of categories) {
        const catResults = results.filter(r => r.category === cat);
        const catPassed = catResults.filter(r => r.passed).length;
        categoryStats[cat] = {
            total: catResults.length,
            passed: catPassed,
            rate: `${((catPassed / catResults.length) * 100).toFixed(1)}%`
        };
    }

    console.log('\n' + '='.repeat(60));
    console.log(`RESULTS: ${passed}/${totalQuestions} (${score.toFixed(1)}%)`);
    console.log('Category breakdown:');
    console.log(JSON.stringify(categoryStats, null, 2));
    console.log('='.repeat(60));

    const fullLog = {
        description: "Full Log - All questions (No Adversarial)",
        config: {
            totalQuestions,
            filterAdversarial: true
        },
        summary: {
            score: `${score.toFixed(1)}%`,
            passed,
            total: totalQuestions,
            categoryStats
        },
        timestamp: new Date().toISOString(),
        results
    };
    fs.writeFileSync(OUTPUT_FILE_FULL, JSON.stringify(fullLog, null, 2));
    console.log(`\nFull Log saved: ${OUTPUT_FILE_FULL}`);

    const compressedResults = results.map(({ retrievedContext, ...rest }) => rest);
    const compressedLog = {
        description: "Compressed Log - Metadata Only (No Adversarial)",
        config: {
            totalQuestions,
            filterAdversarial: true
        },
        summary: {
            score: `${score.toFixed(1)}%`,
            passed,
            total: totalQuestions,
            categoryStats
        },
        timestamp: new Date().toISOString(),
        results: compressedResults
    };
    fs.writeFileSync(OUTPUT_FILE_COMPRESSED, JSON.stringify(compressedLog, null, 2));
    console.log(`Compressed Log saved: ${OUTPUT_FILE_COMPRESSED}`);

    let report = `# LOCOMO Full Evaluation Report\n\n`;
    report += `**Score:** ${passed}/${totalQuestions} (${score.toFixed(1)}%)\n`;
    report += `**Timestamp:** ${new Date().toISOString()}\n\n`;

    report += `## Category Breakdown\n\n`;
    report += `| Category | Passed | Total | Rate |\n`;
    report += `| :--- | :--- | :--- | :--- |\n`;
    for (const cat of categories) {
        const stats = categoryStats[cat];
        report += `| ${cat} | ${stats.passed} | ${stats.total} | ${stats.rate} |\n`;
    }
    report += `\n\n`;

    report += `## Failed Questions\n\n`;
    const failures = results.filter(r => !r.passed);

    if (failures.length === 0) {
        report += `*No failures!*\n\n`;
    } else {
        for (const f of failures) {
            report += `### [Conv ${f.convIndex}] [${f.category}] ${f.question}\n\n`;
            report += `- **Dataset Index:** ${f.datasetIndex}\n`;
            report += `- **Ground Truth:** ${f.groundTruth}\n`;
            report += `- **Prediction:** ${f.prediction}\n`;
            report += `- **Judge Reasoning:** ${f.valiationReasoning}\n`;
            report += `- **Context:** ${f.retrievedContext.factsCount} facts, ${f.retrievedContext.messagesCount} messages, ${f.retrievedContext.entitiesCount} entities\n`;
            report += `\n<details>\n<summary>Retrieved Facts</summary>\n\n`;
            if (f.retrievedContext.facts?.length > 0) {
                for (const fact of f.retrievedContext.facts) {
                    report += `- ${fact}\n`;
                }
            } else {
                report += `*No facts retrieved*\n`;
            }
            report += `\n</details>\n\n---\n\n`;
        }
    }

    report += `## Notes\n\n`;
    report += `Generated outputs are intentionally written under an ignored eval-output directory. Do not commit raw logs unless you have reviewed them for dataset, prompt, and user-data exposure.\n`;
    fs.writeFileSync(REPORT_FILE, report);
    console.log(`Report saved: ${REPORT_FILE}`);
}

runFullEvaluation().catch(console.error);
