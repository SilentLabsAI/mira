
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import { brain } from '../../packages/mira-core/src/lib/cog/brain.js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const openai = new OpenAI();

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
    console.log(`  [Ingestion] User ${userId} starting...`);

    // Create thread first
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

    for (let i = 0; i < rows.length; i += 100) {
        await supabase.from('messages').insert(rows.slice(i, i + 100));
    }

    const sessionTexts: { text: string, date: string }[] = [];
    for (let i = 1; i <= 35; i++) {
        const session = conversation[`session_${i}`];
        if (!session) continue;
        const date = conversation[`session_${i}_date_time`] || '';
        const text = session.map((t: Turn) => `${t.speaker}: ${t.text}${t.blip_caption ? ` [Image: ${t.blip_caption}]` : ''}`).join('\n');
        sessionTexts.push({ text, date });
    }

    for (let i = 0; i < sessionTexts.length; i += 3) {
        const batch = sessionTexts.slice(i, i + 3);
        await Promise.all(batch.map(async (s) => {
            await brain.extractFacts(threadId, s.text, userId, s.date);
            const entities = await brain.extractEntities(s.text);
            await brain.saveEntities(userId, entities);
        }));
        process.stdout.write(`\r      Progress: ${Math.min(i + 3, sessionTexts.length)}/${sessionTexts.length}`);
    }
    console.log(`  [Ingestion] User ${userId} Done.`);
}

async function masterIngest() {
    const dataPath = process.env.LOCOMO_DATA_PATH || path.join(process.cwd(), 'data/locomo10.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    console.log(`Starting Master Ingestion of ${data.length} conversations...`);

    for (let i = 0; i < data.length; i++) {
        const uuidSuffix = `0000000${i}0201`.slice(-12);
        const userId = `00000000-0000-0000-0000-${uuidSuffix}`;
        const threadId = `00000000-0000-0000-0001-${uuidSuffix}`;

        // Check if exists
        const { count } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('user_id', userId);
        if (count && count > 0) {
            console.log(`Conv ${i} already ingested (${count} messages). Skipping.`);
            continue;
        }

        await ingestConversation(userId, threadId, data[i].conversation);
    }

    console.log('Master Ingestion Complete!');
}

masterIngest().catch(console.error);
