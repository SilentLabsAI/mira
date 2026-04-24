import { createMiraSupabaseAdminClient } from '../../../mira-supabase/src/client.js';
import { requireAnyEnv, requireEnv } from './config.js';

const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']);
const supabaseServiceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

// Server-side admin client.
export const supabaseAdmin = createMiraSupabaseAdminClient({
    url: supabaseUrl,
    serviceRoleKey: supabaseServiceRoleKey
});
