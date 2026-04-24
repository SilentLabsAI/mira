import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { OpenAI } from 'openai';

const requiredEnv = [
    'OPENAI_API_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const missing = requiredEnv.filter((key) => !process.env[key] || process.env[key]?.startsWith('your_'));

if (missing.length > 0) {
    console.error(`Missing local config: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill it with your own keys.');
    process.exit(1);
}

const userText = process.argv.slice(2).join(' ').trim() || 'Remember that I prefer concise answers.';
const userId = process.env.MIRA_USER_ID || '11111111-1111-1111-1111-111111111111';
const threadId = process.env.MIRA_THREAD_ID || randomUUID();
const chatModel = process.env.CHAT_MODEL || 'gpt-5-mini';

const { brain } = await import('../../packages/mira-core/src/lib/cog/brain.ts');
const { buildMiraPrompt } = await import('../../packages/mira-core/src/lib/cog/prompt_builder.ts');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const memory = await brain.retrieveContext(threadId, userText, [], userId);
const systemPrompt = buildMiraPrompt(memory);

const response = await openai.chat.completions.create({
    model: chatModel,
    messages: [
        {
            role: 'system',
            content: systemPrompt,
        },
        { role: 'user', content: userText },
    ],
});

const assistantText = response.choices[0]?.message?.content || '';

console.log('\nAssistant:\n');
console.log(assistantText || '(empty response)');

await brain.processTurn(threadId, userText, assistantText, userId);

console.log('\nMIRA memory update queued for this local turn.');
