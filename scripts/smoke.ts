import 'dotenv/config';

import assert from 'node:assert/strict';
import { OpenAI } from 'openai';
import { resolveMiraUserId } from '../packages/mira-core/src/lib/config.js';
import { createMiraSupabaseAdminClient } from '../packages/mira-supabase/src/client.js';

const mode = process.argv.includes('--live') ? 'live' : 'offline';

const requiredLiveEnv = [
    'OPENAI_API_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
] as const;

function isPlaceholder(value: string | undefined): boolean {
    if (!value) return true;
    return value.startsWith('your_') || value.includes('your-project') || value.startsWith('offline_smoke_');
}

function requireLiveEnv(): void {
    const missing = requiredLiveEnv.filter((key) => isPlaceholder(process.env[key]));
    if (missing.length > 0) {
        throw new Error(`Missing live smoke config: ${missing.join(', ')}. Copy .env.example to .env and fill your own keys.`);
    }
}

function seedOfflineEnv(): void {
    process.env.OPENAI_API_KEY ||= 'offline_smoke_openai_key';
    process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'offline_smoke_supabase_key';
    process.env.MIRA_USER_ID ||= '11111111-1111-1111-1111-111111111111';
}

async function runOfflineSmoke(): Promise<void> {
    seedOfflineEnv();

    const { brain } = await import('../packages/mira-core/src/lib/cog/brain.js');
    const supabase = createMiraSupabaseAdminClient({
        url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    });

    assert.equal(resolveMiraUserId(), process.env.MIRA_USER_ID);
    assert.ok(brain, 'brain export should load');
    assert.ok(supabase, 'supabase client should initialize');

    console.log('Offline smoke PASS: modules load, env resolution works, clients initialize.');
}

async function runLiveSmoke(): Promise<void> {
    requireLiveEnv();

    const supabase = createMiraSupabaseAdminClient({
        url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const { error } = await supabase.from('core_memory').select('user_id').limit(1);
    if (error) {
        throw new Error(`Supabase smoke failed: ${error.message}`);
    }

    await openai.models.retrieve(process.env.CHAT_MODEL || 'gpt-5-mini');

    console.log('Live smoke PASS: Supabase schema reachable and OpenAI key/model reachable.');
}

if (mode === 'live') {
    await runLiveSmoke();
} else {
    await runOfflineSmoke();
}
