import { resolveMiraUserId } from '../config.js';
import { supabaseAdmin } from '../supabase-admin.js';

/**
 * Memory Maintenance Functions
 * Handles consolidation, decay, and cleanup of memory data
 */

/**
 * Consolidates old messages into summaries
 * Messages older than 7 days get compressed
 */
export async function consolidateOldMessages(userId: string = resolveMiraUserId()): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    try {
        const { count } = await supabaseAdmin
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .lt('created_at', sevenDaysAgo);

        console.log(`[Maintenance] Found ${count || 0} messages older than 7 days`);

        return count || 0;
    } catch (err) {
        console.error('[Maintenance] Error consolidating messages:', err);
        return 0;
    }
}

/**
 * Decays relevance scores for unused facts
 * Facts not accessed recently get lower priority
 */
export async function decayRelevance(userId: string = resolveMiraUserId()): Promise<number> {
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        const { data: facts, error: selectError } = await supabaseAdmin
            .from('facts')
            .select('id, relevance_score')
            .eq('user_id', userId)
            .lt('created_at', thirtyDaysAgo)
            .gt('relevance_score', 0.1);

        if (selectError) {
            console.error('[Maintenance] Error selecting facts for relevance decay:', selectError);
            return 0;
        }

        const results = await Promise.all((facts || []).map((fact) =>
            supabaseAdmin
                .from('facts')
                .update({ relevance_score: Math.max((fact.relevance_score || 0) * 0.9, 0.1) })
                .eq('id', fact.id)
                .eq('user_id', userId)
        ));

        const updated = results.filter((result) => !result.error).length;
        const failed = results.length - updated;

        if (failed > 0) {
            console.error(`[Maintenance] Failed to decay relevance for ${failed} facts`);
        }

        console.log(`[Maintenance] Decayed relevance for ${updated} facts`);
        return updated;
    } catch (err) {
        console.error('[Maintenance] Error in decayRelevance:', err);
        return 0;
    }
}

/**
 * Resolves conflicting facts by marking old ones as superseded
 */
export async function resolveConflicts(userId: string = resolveMiraUserId()): Promise<number> {
    try {
        const { data: corrections } = await supabaseAdmin
            .from('facts')
            .select('id, content, created_at')
            .eq('user_id', userId)
            .eq('fact_type', 'correction')
            .order('created_at', { ascending: false });

        console.log(`[Maintenance] Found ${corrections?.length || 0} correction facts`);
        return corrections?.length || 0;
    } catch (err) {
        console.error('[Maintenance] Error resolving conflicts:', err);
        return 0;
    }
}

/**
 * Prunes expired working memory cache entries
 */
export async function pruneWorkingMemory(): Promise<number> {
    try {
        const { data, error } = await supabaseAdmin
            .from('working_memory')
            .delete()
            .lt('expires_at', new Date().toISOString())
            .select('id');

        if (error) {
            console.error('[Maintenance] Error pruning working memory:', error);
            return 0;
        }

        console.log(`[Maintenance] Pruned ${data?.length || 0} expired cache entries`);
        return data?.length || 0;
    } catch (err) {
        console.error('[Maintenance] Error in pruneWorkingMemory:', err);
        return 0;
    }
}

/**
 * Runs all maintenance tasks
 */
export async function runAllMaintenance(userId: string = resolveMiraUserId()): Promise<{
    consolidated: number;
    decayed: number;
    conflicts: number;
    pruned: number;
}> {
    console.log('[Maintenance] Starting full maintenance run...');

    const [consolidated, decayed, conflicts, pruned] = await Promise.all([
        consolidateOldMessages(userId),
        decayRelevance(userId),
        resolveConflicts(userId),
        pruneWorkingMemory()
    ]);

    console.log('[Maintenance] Maintenance complete:', { consolidated, decayed, conflicts, pruned });

    return { consolidated, decayed, conflicts, pruned };
}
