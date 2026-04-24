import { createClient } from '@supabase/supabase-js';

export interface MiraSupabaseAdminConfig {
    url: string;
    serviceRoleKey: string;
}

export function createMiraSupabaseAdminClient(config: MiraSupabaseAdminConfig) {
    const url = config.url.trim();
    const serviceRoleKey = config.serviceRoleKey.trim();

    if (!url) {
        throw new Error('[MIRA Supabase] Missing Supabase URL.');
    }

    if (!serviceRoleKey) {
        throw new Error('[MIRA Supabase] Missing Supabase service role key.');
    }

    return createClient(url, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
}
