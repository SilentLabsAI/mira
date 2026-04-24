import { OpenAI } from 'openai';
import { requireEnv, resolveMiraUserId } from '../config.js';
import { supabaseAdmin } from '../supabase-admin.js';
import {
    FACT_EXTRACTION_PROMPT,
    QUERY_ANALYSIS_PROMPT,
    ENTITY_EXTRACTION_PROMPT,
    CORE_MEMORY_UPDATE_PROMPT,
    CORRECTION_DETECTION_PROMPT,
    COUNTING_STRATEGY_PROMPT
} from './prompts.js';
import { FACT_EXTRACTION_PROMPT_V2 } from './prompts_v2.js';

const openai = new OpenAI({
    apiKey: requireEnv('OPENAI_API_KEY'),
});

export type QueryDepth = 'surface' | 'deep' | 'global_deep' | 'conceptual' | 'counting' | 'frequency';

export interface Entity {
    name: string;
    type: 'project' | 'person' | 'concept' | 'preference' | 'event';
    description?: string;
}

export interface RetrievedMessage {
    content: string;
    role: string;
    created_at: string;
}

export interface CorrectionInfo {
    is_correction: boolean;
    old_value?: string;
    new_value?: string;
    entity_type?: string;
    summary?: string;
}

export interface CountingResult {
    count: number;
    searchTerm: string;
    items: string[];
    samples: { content: string; role: string; created_at: string }[];
}

interface CountingStrategy {
    target: 'messages' | 'facts';
    pattern: string;
    fact_type?: string;
    role?: 'user' | 'assistant' | 'all';
    semantic?: boolean;
}

export interface MemoryContext {
    depth: QueryDepth;
    coreMemory: string;
    facts: string[];
    entities: Entity[];
    timeline: string[];
    messages: RetrievedMessage[];
    documents: { title: string; content: string; summary: string | null }[];
    countingResult?: CountingResult;
    requiresInference?: boolean; // True for relational queries that need fact synthesis
}

export interface QueryAnalysis {
    depth: QueryDepth;
    searchQuery: string;
    isFollowUp?: boolean; // True if this query references previous turn
}

export class CogBrain {
    /**
     * Analyzes the query to determine retrieval strategy
     */
    async analyzeQueryDepth(query: string, history: { role: string; content: string }[] = []): Promise<QueryAnalysis> {
        console.log('[Brain] Analyzing query depth...');
        try {
            const historyText = history.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
            const response = await openai.chat.completions.create({
                model: 'gpt-5-mini',
                messages: [
                    { role: 'system', content: QUERY_ANALYSIS_PROMPT },
                    { role: 'user', content: `History:\n${historyText}\n\nCurrent Query: "${query}"` }
                ],
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0].message.content;
            if (!content) throw new Error('Empty analysis response');

            const result = JSON.parse(content);
            const depth = result.depth.toLowerCase() as QueryDepth;
            const searchQuery = result.searchQuery || query;
            const isFollowUp = result.isFollowUp === true;

            console.log(`[Brain] Depth: ${depth}, SearchQuery: "${searchQuery}", FollowUp: ${isFollowUp}`);

            return {
                depth: ['surface', 'deep', 'global_deep', 'conceptual', 'counting', 'frequency'].includes(depth) ? depth : 'surface',

                searchQuery,
                isFollowUp
            };
        } catch (error) {
            console.error('[Brain] Error analyzing query depth:', error);
            return { depth: 'surface', searchQuery: query };
        }
    }

    /**
     * Gets or creates the Core Memory for a user
     */
    async getCoreMemory(userId: string = resolveMiraUserId()): Promise<string> {
        console.log('[Brain] Fetching core memory...');

        const { data, error } = await supabaseAdmin
            .from('core_memory')
            .select('content')
            .eq('user_id', userId)
            .single();

        if (error || !data) {
            console.log('[Brain] No core memory found, returning default.');
            return `## User Profile
Not yet known.

## Active Projects
Not yet known.

## Key Preferences
Not yet known.

## Recent Timeline
No interactions recorded yet.`;
        }

        return data.content;
    }

    /**
     * Updates the Core Memory based on recent interactions
     */
    async updateCoreMemory(userId: string = resolveMiraUserId(), recentMessages: { role: string; content: string }[]): Promise<void> {
        console.log('[Brain] Updating core memory...');

        const currentMemory = await this.getCoreMemory(userId);
        const messagesText = recentMessages.map(m => `${m.role}: ${m.content}`).join('\n');

        const prompt = CORE_MEMORY_UPDATE_PROMPT
            .replace('{current_memory}', currentMemory)
            .replace('{messages}', messagesText);

        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-5-mini',
                messages: [
                    { role: 'user', content: prompt }
                ],
                max_completion_tokens: 600,
            });

            const newMemory = response.choices[0].message.content;
            if (!newMemory) return;

            await supabaseAdmin
                .from('core_memory')
                .upsert({
                    user_id: userId,
                    content: newMemory,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id' });

            console.log('[Brain] Core memory updated.');
        } catch (error) {
            console.error('[Brain] Error updating core memory:', error);
        }
    }

    /**
     * Extracts entities from a conversation turn
     */
    async extractEntities(text: string): Promise<Entity[]> {
        console.log('[Brain] Extracting entities...');

        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-5-mini',
                messages: [
                    { role: 'system', content: ENTITY_EXTRACTION_PROMPT },
                    { role: 'user', content: text }
                ],
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0].message.content;
            if (!content) return [];

            // Parse JSON - handle both array and object with array
            let entities: Entity[] = [];
            try {
                const parsed = JSON.parse(content);
                entities = Array.isArray(parsed) ? parsed : (parsed.entities || []);
            } catch {
                console.error('[Brain] Failed to parse entity JSON:', content);
                return [];
            }

            console.log('[Brain] Extracted entities:', entities.length);
            return entities;
        } catch (error) {
            console.error('[Brain] Error extracting entities:', error);
            return [];
        }
    }

    /**
     * Saves extracted entities to the database
     */
    async saveEntities(userId: string = resolveMiraUserId(), entities: Entity[]): Promise<void> {
        console.log('[Brain] Saving entities:', entities.length);

        if (entities.length === 0) return;

        try {
            // Prepare entity texts for batch embedding
            const entityTexts = entities.map(e => `${e.name}: ${e.description || ''}`);
            const entitiesToUpsert: Array<{
                user_id: string;
                entity_type: string;
                name: string;
                description: string | null;
                embedding: number[];
                last_mentioned: string;
            }> = [];

            // Batch get embeddings for all entities
            const BATCH_SIZE = 500;
            const allEmbeddings: number[][] = [];
            for (let i = 0; i < entityTexts.length; i += BATCH_SIZE) {
                const batch = entityTexts.slice(i, i + BATCH_SIZE);
                const embeddingResponse = await openai.embeddings.create({
                    model: 'text-embedding-3-large',
                    input: batch,
                });
                allEmbeddings.push(...embeddingResponse.data.map(d => d.embedding));
            }

            // Prepare entities with embeddings
            entities.forEach((entity, idx) => {
                entitiesToUpsert.push({
                    user_id: userId,
                    entity_type: entity.type,
                    name: entity.name.toLowerCase(),
                    description: entity.description || null,
                    embedding: allEmbeddings[idx],
                    last_mentioned: new Date().toISOString(),
                });
            });

            // Batch upsert entities (Supabase supports batch upsert)
            const { error } = await supabaseAdmin
                .from('entities')
                .upsert(entitiesToUpsert, {
                    onConflict: 'user_id,entity_type,name',
                });

            if (error) {
                console.error('[Brain] Error batch upserting entities:', error);
            }
        } catch (error) {
            console.error('[Brain] Error saving entities:', error);
        }
    }

    private async ensureThreadExists(threadId: string, userId: string): Promise<void> {
        try {
            const { data: existingThread, error: lookupError } = await supabaseAdmin
                .from('threads')
                .select('user_id')
                .eq('id', threadId)
                .maybeSingle();

            if (lookupError) {
                throw lookupError;
            }

            if (existingThread) {
                if (existingThread.user_id !== userId) {
                    throw new Error('Thread belongs to a different user.');
                }

                const { error: updateError } = await supabaseAdmin
                    .from('threads')
                    .update({ updated_at: new Date().toISOString() })
                    .eq('id', threadId)
                    .eq('user_id', userId);

                if (updateError) {
                    throw updateError;
                }
                return;
            }

            const { error: insertError } = await supabaseAdmin
                .from('threads')
                .insert({
                    id: threadId,
                    user_id: userId,
                    updated_at: new Date().toISOString()
                });

            if (insertError) {
                throw insertError;
            }
        } catch (error) {
            console.error('[Brain] Error ensuring thread exists:', error);
            throw error;
        }
    }

    private async persistMessages(
        threadId: string,
        userId: string,
        messages: Array<{ role: 'user' | 'assistant'; content: string }>
    ): Promise<void> {
        const messagesToPersist = messages.filter(message => message.content.trim().length > 0);
        if (messagesToPersist.length === 0) return;

        try {
            const embeddingResponse = await openai.embeddings.create({
                model: 'text-embedding-3-large',
                input: messagesToPersist.map(message => message.content),
            });

            const embeddings = embeddingResponse.data.map(item => item.embedding);
            if (embeddings.length !== messagesToPersist.length) {
                throw new Error('Embedding count mismatch while persisting messages.');
            }

            const baseTimestamp = Date.now() - 1000;
            const rows = messagesToPersist.map((message, index) => ({
                thread_id: threadId,
                user_id: userId,
                role: message.role,
                content: message.content,
                embedding: embeddings[index],
                created_at: new Date(baseTimestamp + index).toISOString()
            }));

            const { error } = await supabaseAdmin.from('messages').insert(rows);
            if (error) {
                throw error;
            }
        } catch (error) {
            console.error('[Brain] Error persisting raw messages:', error);
        }
    }

    /**
     * Retrieves contextual memory from Supabase based on query analysis
     */
    async retrieveContext(threadId: string, query: string, history: { role: string; content: string }[] = [], userId: string = resolveMiraUserId()): Promise<MemoryContext> {
        console.log('[Brain] Starting retrieveContext for query:', query);
        await this.ensureThreadExists(threadId, userId);

        let depthToUse: QueryDepth = 'deep';
        let searchQuery = query;
        let isFollowUp = false;

        const isCountingQuery = /(?:how many\s+(?!years|months|weeks|days|hours|minutes|seconds|time$)|count of|total number)/i.test(query);

        const relationIndicators = [
            /\b(both|together|and|or|with|for|between|among|share|joint)\b.*\b(both|together|and|or|with|for|between|among|share|joint)\b/i,
            /\b([A-Z][a-z]+)\b.*\b([A-Z][a-z]+)\b/,
            /\b(would|could|should|might|may|can)\b.*\b(if|when|because|since)\b/i,
            /\b(benefit from|open to|willing to|likely|potentially|probably)\b/i,
            /\b(before|after|when.*happened|since|during)\b/i,
            /\b(no longer|still|yet|already)\b/i,
            /\b(which.*might|what.*could|who.*would)\b/i,
            /\b(common|shared|similar|different|compare|besides|other than)\b/i,
            /\b(summer|winter|spring|fall|autumn)\s+\d{4}\b/i,
            /\b\d{4}\b/i,
            /\b(enjoy|play|like|prefer).*\b(on|with|using)\b/i,
        ];

        const isRelationalQuery = relationIndicators.some(pattern => pattern.test(query));
        const isDirectQuestion = /who|what|where|when|why|how|which|tell me|remind|exactly/i.test(query);

        let relationData: { entities: string[]; relationship_topic: string; cross_reference_keywords: string[] } | null = null;

        if (isCountingQuery) {
            depthToUse = 'counting';
            const analysis = await this.analyzeQueryDepth(query, history);
            searchQuery = analysis.searchQuery;
            isFollowUp = analysis.isFollowUp || false;
        } else if (isRelationalQuery || !isDirectQuestion) {
            console.log('[Brain] Analyzing query depth...');
            const analysis = await this.analyzeQueryDepth(query, history);
            depthToUse = analysis.depth;
            searchQuery = analysis.searchQuery;
            isFollowUp = analysis.isFollowUp || false;

            if (isRelationalQuery) {
                console.log('[Brain] Relational query detected, extracting entities for targeted retrieval...');
                relationData = await this.extractRelationEntities(query);
            }
        } else {
            console.log('[Brain] Fast-Path: Bypassing query analysis for simple direct question.');
        }

        const coreMemory = await this.getCoreMemory(userId);

        const context: MemoryContext = {
            depth: depthToUse,
            coreMemory,
            facts: [],
            entities: [],
            timeline: [],
            messages: [],
            documents: [],
            requiresInference: isRelationalQuery
        };

        if (depthToUse === 'surface') {
            console.log('[Brain] Surface query, using core memory only.');
            return context;
        }

        if (depthToUse === 'counting') {
            console.log('[Brain] Counting query detected, using semantic counting...');
            context.countingResult = await this.executeCountingQuery(threadId, userId, searchQuery, query);
            console.log('[Brain] Counting result:', context.countingResult.count, 'matches');
        }

        console.log('[Brain] Getting embedding for search query...');
        const queryEmbedding = await this.getEmbedding(searchQuery);
        console.log('[Brain] Embedding obtained.');

        const cachedResults = await this.getRecentCache(threadId);
        if (cachedResults && cachedResults.result_ids && cachedResults.result_ids.length > 0) {
            console.log('[Brain] Found cached results, using them for follow-up...');
            context.messages = await this.getMessagesByIds(cachedResults.result_ids.slice(0, 5));
            console.log('[Brain] Retrieved', context.messages.length, 'cached messages.');
        }

        let ftsKeywords: { subject: string; keywords: string[] } | undefined;
        if (depthToUse === 'deep' || depthToUse === 'global_deep') {
            const expansion = await this.expandQueryKeywords(query);
            if (expansion.subject || expansion.topic_keywords.length > 0) {
                ftsKeywords = { subject: expansion.subject, keywords: expansion.topic_keywords };
                console.log(`[Brain] Keyword expansion: subject="${expansion.subject}", topics=${expansion.topic_keywords.slice(0, 3).join(', ')}...`);
            }
        }

        const isTemporal = /when|date|time|year|month|day|how long|ago|since|during|schedule|calendar|january|february|march|april|may|june|july|august|september|october|november|december|\b20\d{2}\b/i.test(query);

        if (context.messages.length === 0 && !isTemporal && (depthToUse === 'deep' || depthToUse === 'global_deep')) {
            console.log('[Brain] Searching messages for exact wording...');
            context.messages = await this.searchMessages(userId, searchQuery, 15, ftsKeywords);
            console.log('[Brain] Found messages:', context.messages.length);
        } else if (isTemporal) {
            console.log('[Brain] Temporal query detected - SKIPPING message search to enforce fact-based date resolution.');
        }

        if (depthToUse === 'deep' || depthToUse === 'global_deep' || depthToUse === 'frequency') {
            console.log('[Brain] Deep retrieval: searching facts...');

            const searchPromises: Promise<any>[] = [];

            searchPromises.push(supabaseAdmin.rpc('match_facts', {
                query_embedding: queryEmbedding,
                match_threshold: 0.05,
                match_count: 25,
                filter_user_id: userId
            }) as any);

            if (isTemporal) {
                console.log('[Brain] Temporal/Broad query detected. Calculating original embedding...');
                const originalEmbeddingPromise = this.getEmbedding(query).then(emb =>
                    supabaseAdmin.rpc('match_facts', {
                        query_embedding: emb,
                        match_threshold: 0.1,
                        match_count: 25,
                        filter_user_id: userId
                    })
                );
                searchPromises.push(originalEmbeddingPromise);
            }

            const ftsPromise = (supabaseAdmin
                .from('facts')
                .select('content')
                .eq('user_id', userId)
                .textSearch('content', searchQuery, {
                    type: 'websearch',
                    config: 'english'
                })
                .limit(10) as any);

            searchPromises.push(ftsPromise);

            const keywordExpansionPromise = (ftsKeywords && ftsKeywords.keywords.length > 0) ? (async () => {
                const temporalTokens: string[] = [];
                const yearMatches = query.match(/\b(19|20)\d{2}\b/g);
                if (yearMatches) temporalTokens.push(...yearMatches);
                const seasonMatches = query.match(/\b(spring|summer|fall|autumn|winter)\b/gi);
                if (seasonMatches) temporalTokens.push(...seasonMatches.map(s => s.toLowerCase()));
                const monthMatches = query.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi);
                if (monthMatches) temporalTokens.push(...monthMatches.map(m => m.toLowerCase()));

                const allKeywords = [...ftsKeywords.keywords];
                if (temporalTokens.length > 0) {
                    console.log(`[Brain] Temporal tokens extracted: ${temporalTokens.join(', ')}`);
                    temporalTokens.forEach(t => {
                        if (!allKeywords.includes(t)) allKeywords.push(t);
                    });
                }

                const filteredKeywords = allKeywords.slice(0, 20);
                const searchPromisesKw = filteredKeywords.flatMap((keyword: string) => {
                    const searches = [];

                    if (ftsKeywords.subject) {
                        searches.push(supabaseAdmin
                            .from('facts')
                            .select('content')
                            .eq('user_id', userId)
                            .textSearch('content', `${ftsKeywords.subject} ${keyword}`, {
                                type: 'websearch',
                                config: 'english'
                            })
                            .limit(2) as any);
                    }

                    searches.push(supabaseAdmin
                        .from('facts')
                        .select('content')
                        .eq('user_id', userId)
                        .textSearch('content', keyword, {
                            type: 'websearch',
                            config: 'english'
                        })
                        .limit(2) as any);

                    return searches;
                });

                const resultsBatches = await Promise.all(searchPromisesKw);
                const allMatches = resultsBatches.flatMap(r => r.data || []);

                console.log(`[Brain] Keyword expansion found ${allMatches.length} facts`);
                return { data: allMatches.slice(0, 25) };
            })() : Promise.resolve({ data: [] });

            searchPromises.push(keywordExpansionPromise);

            if (relationData && relationData.entities.length >= 1) {
                const entitySearchPromise = this.searchFactsPerEntity(
                    userId,
                    relationData.entities,
                    relationData.relationship_topic,
                    relationData.cross_reference_keywords
                ).then(facts => ({ data: facts.map(f => ({ content: f })) }));
                searchPromises.push(entitySearchPromise);
            }

            const results = await Promise.all(searchPromises);

            const uniqueContent = new Set<string>();
            const mergedFacts: string[] = [];

            const addFact = (content: string, source: string) => {
                if (content && !uniqueContent.has(content)) {
                    uniqueContent.add(content);
                    mergedFacts.push(content);
                }
            };

            const entitySearchIdx = searchPromises.length - 1;
            if (relationData && relationData.entities.length >= 1) {
                const entitySearchResult = results[entitySearchIdx];
                if (entitySearchResult?.data) {
                    entitySearchResult.data.forEach((f: any) => addFact(f.content, 'EntitySearch'));
                }
            }

            const ftsIdx = isTemporal ? 2 : 1;
            const ftsResult = results[ftsIdx];
            if (ftsResult?.data) ftsResult.data.forEach((f: any) => addFact(f.content, 'FTS'));

            const vectorResults = results.slice(0, ftsIdx);
            vectorResults.forEach((res, idx) => {
                if (res?.data) res.data.forEach((f: any) => addFact(f.content, idx === 0 ? 'Refined' : 'Original'));
            });

            const keywordExpansionResult = results.find((_, i) => i === searchPromises.indexOf(keywordExpansionPromise));
            if (keywordExpansionResult?.data) {
                keywordExpansionResult.data.forEach((f: any) => addFact(f.content, 'KeywordExpansion'));
            }

            context.facts = mergedFacts.slice(0, 50);
            console.log(`[Brain] Multi-Angle Retrieval: Merged ${context.facts.length} unique facts (IsTemporal: ${isTemporal})`);
        }

        // Search for relevant entities
        if (depthToUse === 'deep' || depthToUse === 'global_deep' || depthToUse === 'conceptual') {
            console.log('[Brain] Searching entities...');
            const { data: matchedEntities, error: entitiesError } = await supabaseAdmin.rpc('match_entities', {
                query_embedding: queryEmbedding,
                match_threshold: 0.05,
                match_count: 10,
                filter_user_id: userId
            });

            if (entitiesError) {
                console.error('[Brain] Entities search error:', entitiesError);
            } else {
                context.entities = matchedEntities?.map((e: { name: string; entity_type: string; description: string }) => ({
                    name: e.name,
                    type: e.entity_type as Entity['type'],
                    description: e.description
                })) || [];
            }
        }

        // Search for relevant documents
        if (depthToUse === 'deep' || depthToUse === 'global_deep' || depthToUse === 'frequency') {
            const documentQueryEmbedding = await this.getDocumentEmbedding(searchQuery);
            const { data: matchedDocs, error: docsError } = await supabaseAdmin.rpc('match_documents', {
                query_embedding: documentQueryEmbedding,
                match_threshold: 0.1,
                match_count: 3,
                filter_user_id: userId
            });

            if (docsError && docsError.code !== 'PGRST202') {
                console.error('[Brain] Documents search error:', docsError);
            } else if (matchedDocs && matchedDocs.length > 0) {
                context.documents = matchedDocs.map((d: any) => ({
                    title: d.title,
                    content: d.content.slice(0, 1000),
                    summary: d.summary
                }));
            }
        }

        console.log('[Brain] Context retrieval complete.');
        return context;
    }

    /**
     * Searches messages table for relevant past messages using VECTOR SEARCH + FTS
     * If ftsKeywords are provided, uses OR-joined keyword search for better recall
     */
    async searchMessages(userId: string, query: string, limit = 5, ftsKeywords?: { subject: string; keywords: string[] }): Promise<RetrievedMessage[]> {
        console.log('[Brain] Searching messages (Hybrid: Vector + FTS)...');

        try {
            // 1. Prepare parallel searches
            const embeddingPromise = this.getEmbedding(query).then(embedding =>
                supabaseAdmin.rpc('match_messages', {
                    query_embedding: embedding,
                    match_threshold: 0.05, // Slightly stricter for efficiency
                    match_count: limit, // Use the requested limit
                    filter_user_id: userId
                })
            );

            // FTS: Use OR-joined keywords if provided, otherwise use subject only
            let ftsQuery: string;
            if (ftsKeywords && (ftsKeywords.subject || ftsKeywords.keywords.length > 0)) {
                // Build OR-joined query: "subject OR keyword1 OR keyword2 OR ..."
                const terms = ftsKeywords.subject ? [ftsKeywords.subject] : [];
                terms.push(...ftsKeywords.keywords.slice(0, 5)); // Top 5 keywords
                ftsQuery = terms.join(' OR ');
                console.log(`[Brain] Message FTS using keywords: ${ftsQuery}`);
            } else {
                // Fallback: extract first word as potential subject
                ftsQuery = query.split(' ').slice(0, 3).join(' ');
            }

            const ftsPromise = supabaseAdmin
                .from('messages')
                .select('content, role, created_at')
                .eq('user_id', userId)
                .textSearch('content', ftsQuery, {
                    type: 'websearch',
                    config: 'english'
                })
                .limit(10);

            // 2. Execute in parallel
            const [vectorRes, ftsRes] = await Promise.all([embeddingPromise, ftsPromise]);

            if (vectorRes.error) console.error('[Brain] Vector search error:', vectorRes.error);
            if (ftsRes.error) console.error('[Brain] FTS search error:', ftsRes.error);

            // 3. Merge and Deduplicate
            const uniqueContent = new Set<string>();
            const mergedMessages: RetrievedMessage[] = [];

            const addMessage = (m: any, source: string) => {
                if (m && m.content && !uniqueContent.has(m.content)) {
                    uniqueContent.add(m.content);
                    mergedMessages.push({
                        content: m.content,
                        role: m.role,
                        created_at: m.created_at
                    });
                }
            };

            (vectorRes.data || []).forEach((m: any) => addMessage(m, 'vector'));
            (ftsRes.data || []).forEach((m: any) => addMessage(m, 'fts'));

            console.log(`[Brain] Hybrid Message Search: Merged ${mergedMessages.length} unique messages (Vector: ${vectorRes.data?.length || 0}, FTS: ${ftsRes.data?.length || 0})`);

            // Sort by date (ascending - oldest first) to provide a logical timeline to the LLM
            return mergedMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        } catch (err) {
            console.error('[Brain] Error searching messages:', err);
            return [];
        }
    }

    /**
     * Expands a query into subject and topic keywords for FTS fallback
     * Used when vector search returns sparse results
     */
    async expandQueryKeywords(query: string): Promise<{ subject: string; topic_keywords: string[] }> {
        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0,
                messages: [
                    {
                        role: 'system',
                        content: `Extract search keywords from a user query for searching a personal memory database.

1. SUBJECT: The person being asked about (just the name).

2. TOPIC_KEYWORDS: Generate 20 specific terms categorized into three conceptual tiers:
   - ATOMIC: Direct synonyms and specific entities from the query. If an ordinal (e.g. "first", "second", "third") or cardinal number is mentioned, you MUST extract it as a standalone single-word keyword to ensure instance-based retrieval.
   - TAXONOMIC: Broad categories, themes, or parent classes the query belongs to.
   - SEQUENTIAL: Actions, environments, or temporal contexts likely associated with the query topic.

Return JSON only: { "subject": "string", "topic_keywords": ["string", "string"] }`
                    },
                    { role: 'user', content: query }
                ],
                response_format: { type: 'json_object' }
            });

            const content = response.choices[0].message.content;
            if (!content) return { subject: '', topic_keywords: [] };

            const result = JSON.parse(content);
            return {
                subject: result.subject || '',
                topic_keywords: result.topic_keywords || []
            };
        } catch (err) {
            console.error('[Brain] Error expanding query keywords:', err);
            return { subject: '', topic_keywords: [] };
        }
    }

    /**
     * Extracts entities and relationship topic from relational queries
     * Used to perform per-entity retrieval and cross-reference results
     */
    async extractRelationEntities(query: string): Promise<{ entities: string[]; relationship_topic: string; cross_reference_keywords: string[] }> {
        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0,
                messages: [
                    {
                        role: 'system',
                        content: `Extract entities and relationship topics from a relational query.

Relational queries ask about relationships between entities or require cross-referencing information.

1. ENTITIES: List ALL person names or significant named entities mentioned in the query.
   - Include names even if they appear in possessive form.
   - Do NOT include generic terms like "both", "user", or pronouns.

2. RELATIONSHIP_TOPIC: The core relationship/action being asked about.
   - Extract the verb or relationship type from the question.
   - Keep it simple and direct.

3. CROSS_REFERENCE_KEYWORDS: Terms that would indicate SHARED or OVERLAPPING information between entities.
   - Include location words if asking about places.
   - Include action words if asking about activities.

Return JSON only: { "entities": ["string", "string"], "relationship_topic": "string", "cross_reference_keywords": ["string", "string"] }`
                    },
                    { role: 'user', content: query }
                ],
                response_format: { type: 'json_object' }
            });

            const content = response.choices[0].message.content;
            if (!content) return { entities: [], relationship_topic: '', cross_reference_keywords: [] };

            const result = JSON.parse(content);
            console.log(`[Brain] Relational entities extracted: ${result.entities?.join(', ')} | topic: ${result.relationship_topic}`);
            return {
                entities: result.entities || [],
                relationship_topic: result.relationship_topic || '',
                cross_reference_keywords: result.cross_reference_keywords || []
            };
        } catch (err) {
            console.error('[Brain] Error extracting multi-hop entities:', err);
            return { entities: [], relationship_topic: '', cross_reference_keywords: [] };
        }
    }

    /**
     * Performs per-entity search for multi-hop queries
     * Returns facts with cross-reference priority (facts mentioning multiple entities ranked higher)
     */
    async searchFactsPerEntity(userId: string, entities: string[], topic: string, keywords: string[]): Promise<string[]> {
        if (entities.length === 0) return [];

        console.log(`[Brain] Per-entity retrieval: searching ${entities.length} entities with topic "${topic}"`);

        const allFacts: Map<string, { content: string; entityMatches: number }> = new Map();

        // Search for each entity + topic combination in parallel
        const entitySearchPromises = entities.map(async (entity) => {
            const searchTerms = [
                `${entity} ${topic}`,
                ...keywords.slice(0, 5).map(kw => `${entity} ${kw}`)
            ];

            const searchPromises = searchTerms.slice(0, 15).map(term =>
                supabaseAdmin
                    .from('facts')
                    .select('content')
                    .eq('user_id', userId)
                    .textSearch('content', term, {
                        type: 'websearch',
                        config: 'english'
                    })
                    .limit(10)
            );

            const results = await Promise.all(searchPromises);
            const entityFacts = results.flatMap(r => r.data || []);

            return { entity, facts: entityFacts };
        });

        const entityResults = await Promise.all(entitySearchPromises);

        // Merge and track entity coverage
        for (const { entity, facts } of entityResults) {
            for (const fact of facts) {
                if (!fact.content) continue;
                const existing = allFacts.get(fact.content);
                if (existing) {
                    // Fact already found for another entity - boost priority
                    existing.entityMatches++;
                } else {
                    allFacts.set(fact.content, { content: fact.content, entityMatches: 1 });
                }
            }
        }

        // Sort by entity coverage (facts mentioning multiple entities first)
        const sortedFacts = Array.from(allFacts.values())
            .sort((a, b) => b.entityMatches - a.entityMatches)
            .map(f => f.content);

        const multiEntityFacts = sortedFacts.filter(f => {
            const entry = allFacts.get(f);
            return entry && entry.entityMatches > 1;
        });

        console.log(`[Brain] Per-entity retrieval: found ${sortedFacts.length} total facts, ${multiEntityFacts.length} cross-entity`);

        return sortedFacts.slice(0, 30);
    }

    /**
     * Executes a counting query using semantic search + LLM aggregation
     * Facts-only approach: trusts the distilled memory layer for accurate counting
     */
    async executeCountingQuery(threadId: string, userId: string, query: string, originalQuery?: string): Promise<CountingResult> {
        console.log('[Brain] Executing counting query:', query);

        try {
            // Step 1: Broad Retrieval - Get embeddings for both refined and original queries
            const queriesToSearch = [query];
            if (originalQuery && originalQuery !== query) {
                queriesToSearch.push(originalQuery);
            }

            const embeddings = await Promise.all(queriesToSearch.map(q => this.getEmbedding(q)));

            // Step 2: Parallel search for maximum recall
            const searchPromises = embeddings.map((emb, idx) =>
                supabaseAdmin.rpc('match_facts', {
                    query_embedding: emb,
                    match_threshold: idx === 0 ? 0.05 : 0.1, // Balanced: refined query strict, raw query lenient
                    match_count: 80,
                    filter_user_id: userId
                })
            );

            const searchResults = await Promise.all(searchPromises);

            const uniqueFactsMap = new Map();
            searchResults.forEach(res => {
                if (res.data) {
                    res.data.forEach((f: any) => uniqueFactsMap.set(f.id, f));
                }
            });
            console.log(`[Brain] Broad retrieval vector found ${Array.from(uniqueFactsMap.values()).length} unique facts from ${queriesToSearch.length} search variants`);

            const ftsPromise = supabaseAdmin
                .from('facts')
                .select('content, id, created_at')
                .eq('user_id', userId)
                .textSearch('content', query, {
                    type: 'websearch',
                    config: 'english'
                })
                .limit(20);

            const keywordExpansionPromise = this.expandQueryKeywords(query).then(async (expansion) => {
                if (!expansion.subject && expansion.topic_keywords.length === 0) {
                    return { data: [] };
                }
                console.log(`[Brain] Counting Keyword expansion: subject="${expansion.subject}", topics=${expansion.topic_keywords.slice(0, 3).join(', ')}...`);

                const searchPromisesKw = expansion.topic_keywords.slice(0, 15).map(async (keyword: string) => {
                    const searchTerm = expansion.subject
                        ? `${expansion.subject} ${keyword}`
                        : keyword;

                    const { data: matches } = await supabaseAdmin
                        .from('facts')
                        .select('content, id, created_at')
                        .eq('user_id', userId)
                        .textSearch('content', searchTerm, {
                            type: 'websearch',
                            config: 'english'
                        })
                        .limit(5);

                    return matches || [];
                });

                const resultsKw = await Promise.all(searchPromisesKw);
                const allMatches = resultsKw.flat();
                console.log(`[Brain] Counting Keyword expansion found ${allMatches.length} facts`);
                return { data: allMatches.slice(0, 40) };
            });

            const [ftsResult, kwResult] = await Promise.all([ftsPromise, keywordExpansionPromise]);

            if (ftsResult.data) {
                ftsResult.data.forEach((f: any) => uniqueFactsMap.set(f.id, f));
            }

            if (kwResult.data) {
                kwResult.data.forEach((f: any) => uniqueFactsMap.set(f.id, f));
            }

            const relevantFacts = Array.from(uniqueFactsMap.values());
            console.log(`[Brain] Total Counting Retrieval: ${relevantFacts.length} unique facts (Vector + FTS + Keywords)`);

            console.log('[Brain] Counting: Retrieving messages for verification...');
            const relevantMessages = await this.searchMessages(userId, query, 15);
            const messageContext = relevantMessages
                .map(m => `[${new Date(m.created_at).toISOString().split('T')[0]}] [${m.role}] ${m.content}`)
                .join('\n');

            if (relevantFacts.length > 0) {
                const contextForCounting = relevantFacts
                    .map((f: any) => `[FACT ${f.created_at || 'unknown'}] ${f.content}`)
                    .join('\n');

                const countResponse = await openai.chat.completions.create({
                    model: 'gpt-5-mini',
                    reasoning_effort: 'low',
                    messages: [
                        {
                            role: 'system',
                            content: `You are an expert in reading the provided history and following the context across multiple threads. You will be presented with a question, and the context, and the RULES for answering. You must adhere fully and precisely to the STRICT PROTOCOL. In some cases, the STRICT PROTOCOL provides a general rule, and in some it will invite you to reason.

STRICT PROTOCOL:
1. IDENTIFICATION: Identify the specific subject requested. WHAT EXACTLY should be counted, whether those are events, items, or other entities, and WHAT STATUS should be used to filter them (past, present, future).
2. IDENTITY MERGING:
   - ENTITIES (Objects/Subjects): Assume PERSISTENCE. References to the same entity type with matching descriptive attributes refer to the SAME single entity persisting over time, even if mentioned on different dates. Only split if there are DISTINCT names, mutually exclusive attributes, or explicit quantifiers indicating an additional instance.
     - Narrative Consistency: If an entity is mentioned in different narrative contexts with compatible attributes, assume they refer to the same entity in a single narrative arc, unless explicitly distinguished.
   - OCCURRENCES (Actions/Events): Default to DISTINCTNESS. Events happening on different dates are separate instances unless the text explicitly links them as the same event using anaphora or direct reference.
     - Report vs Commentary: Distinguish between REPORTS of an event and COMMENTARY on an event. Only count the REPORTS.
   - CONTINUOUS PROCESSES: Use TIME-GAP MERGING. Merge mentions within a short timeframe referring to the same ongoing topic.
   - DEDUPLICATION: If multiple facts describe the EXACT SAME event/entity on the SAME date, merge them.
   - VERIFICATION WITH MESSAGES: You are provided with raw MESSAGES to validate the FACTS. A Fact is a summary interpretation that may be FLAWED or extracted incorrectly.
     - Correction Protocol: In some cases, the FACT might have incorrectly assumed a COMPLETION or a NEW INSTANCE instead of a reference to a previous instance. Trust the MESSAGES over FACTS. The Messages contain the real "map" of what was said, when, and how. If the Message context contradicts a Fact's isolation, override the Fact to match the message narrative. ANOTHER VERY IMPORTANT RULE HERE is that when presented with messages, you must see the TIMELINE continuity and LENGTH of the topics / entities being discussed. If a topic or an entity replaces the previous topic or entity (for example, user has had their previous hobby for a long time, like 5 years, then they got a new hobby which they wrote about in the message, and then in a few months they reference to that Hobby 2 as the "new hobby" - that is still the SAME NEW HOBBY from the few months ago, it's just for the user, compared to having the old hobby for 5 years, this current hobby is still new)
3. STATUS FILTER: DEFAULT to counting only events in PAST TENSE that have EXPLICITLY COMPLETED.
   - EXCEPTION for PROCESSES: If the question phrasing implies a PROCESS, count ongoing occurrences.
   - EXCEPTION for PLANS: If the user explicitly asks for plans or intentions, count them.
4. EXPLICIT EVIDENCE ONLY: Only count items if the SPECIFIC NOUN/VERB requested is explicitly present OR the text uses a direct synonym.
   - CONTEXTUAL IDENTITY: When a subject has a known defining relationship with an entity, assume generic references to that entity class in the same context refer to the known entity unless explicitly stated otherwise.
   - STRICT EXCLUSION OF DESCRIPTIONS: Do NOT count atmospheric descriptions of an event as the event noun itself. The specific classification noun must be present or clearly synonymous.
5. REFERENCE DETECTION: Distinguish between a NEW occurrence being reported and a REFERENCE/REMINISCENCE of a past one. 
   - Watch for linguistic markers of storytelling, retrospective reflection, or temporal shifts to the distant past.
   - BACKGROUND HISTORY: If an event is described as part of the person's antecedent history or childhood/distant past, do NOT count it as a life event reported in the current conversational timeline.
6. NO META-COUNTING: If a fact mentions an aggregate statement or cumulative total, do NOT count the statement itself as an event. It is a reference to previous ones.

CRITICAL VERIFICATION:
Before adding any item to the list, you MUST verify:
- "Is this item exactly the noun/verb asked for?"
- "Is there explicit past-tense evidence of completion?"
- "Is this a new event, not a repeat or a retrospective mention?" - in other words, does it actually look like a unique instance, or is it more of a description of a previous instance? Think good. Assume there is always a telling detail in the provided MESSAGES. And remember, in some cases the FACT got it wrong and the MESSAGE is actually the source of truth. 

Respond with JSON: 
{ 
  "interpretation": "...", 
  "items": [
    { "name": "...", "summary": "...", "reasoning": "Why this qualifies as a distinct, completed, and explicit occurrence per the rules." }
  ], 
  "count": N 
}`
                        },
                        {
                            role: 'user',
                            content: `Question: ${query}\n\nRelevant facts: \n${contextForCounting.slice(0, 32000)}\n\nRelevant Messages (Use for Verification map): \n${messageContext.slice(0, 16000)}`
                        }
                    ],
                    response_format: { type: 'json_object' }
                });

                const countResult = JSON.parse(countResponse.choices[0].message.content || '{"count": 0}');
                console.log('[Brain] LLM counting result:', countResult);

                return {
                    count: countResult.count || 0,
                    searchTerm: query,
                    items: (countResult.items || []).map((item: any) =>
                        typeof item === 'string' ? item : `${item.name} — ${item.summary}${item.reasoning ? ` (Reason: ${item.reasoning})` : ''}`
                    ),
                    samples: relevantFacts.slice(0, 3).map((f: any) => ({
                        content: f.content,
                        role: 'system',
                        created_at: f.created_at
                    }))
                };
            }

            // Fallback: no matches found
            console.log('[Brain] No facts found for counting query');
            return { count: 0, searchTerm: query, items: [], samples: [] };

        } catch (err) {
            console.error('[Brain] Error executing counting query:', err);
            return { count: 0, searchTerm: query, items: [], samples: [] };
        }
    }

    /**
     * Uses LLM to determine the best counting strategy
     */
    private async getCountingStrategy(query: string): Promise<CountingStrategy> {
        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-5-mini',
                messages: [
                    { role: 'system', content: COUNTING_STRATEGY_PROMPT },
                    { role: 'user', content: `Query: "${query}"` }
                ],
                response_format: { type: 'json_object' }
            });

            const content = response.choices[0].message.content || '{}';
            return JSON.parse(content) as CountingStrategy;
        } catch (err) {
            console.error('[Brain] Error getting counting strategy:', err);
            // Fallback to simple message search
            return { target: 'messages', pattern: query, role: 'all' };
        }
    }

    /**
     * Caches search results for follow-up queries
     */
    async cacheSearchResults(
        threadId: string,
        userId: string,
        cacheKey: string,
        resultIds: string[],
        resultPreview: any[],
        queryText: string
    ): Promise<void> {
        try {
            await supabaseAdmin
                .from('working_memory')
                .upsert({
                    thread_id: threadId,
                    user_id: userId,
                    cache_key: cacheKey,
                    result_ids: resultIds,
                    result_preview: resultPreview,
                    query_text: queryText,
                    created_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
                }, { onConflict: 'thread_id,cache_key' });

            console.log(`[Brain] Cached ${resultIds.length} results under key: ${cacheKey}`);
        } catch (err) {
            console.error('[Brain] Error caching search results:', err);
        }
    }

    /**
     * Gets recent cached results for a thread
     */
    async getRecentCache(threadId: string, cacheKey?: string): Promise<{
        result_ids: string[];
        result_preview: any[];
        query_text: string;
    } | null> {
        try {
            console.log(`[Brain] Checking cache for thread: ${threadId} `);

            let query = supabaseAdmin
                .from('working_memory')
                .select('result_ids, result_preview, query_text, thread_id, cache_key')
                .eq('thread_id', threadId)
                .gt('expires_at', new Date().toISOString());

            if (cacheKey) {
                query = query.eq('cache_key', cacheKey);
            }

            const { data, error } = await query
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (error) {
                console.log(`[Brain] Cache lookup result: no cache found(${error.code})`);
                return null;
            }

            if (!data) {
                console.log('[Brain] Cache lookup result: no data');
                return null;
            }

            console.log(`[Brain] Cache HIT! Found ${data.result_ids?.length || 0} IDs from key: ${data.cache_key} `);
            return data;
        } catch (err) {
            return null;
        }
    }

    /**
     * Retrieves messages by their IDs (for cached results)
     */
    async getMessagesByIds(messageIds: string[]): Promise<RetrievedMessage[]> {
        if (!messageIds || messageIds.length === 0) return [];

        try {
            const { data, error } = await supabaseAdmin
                .from('messages')
                .select('content, role, created_at')
                .in('id', messageIds)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('[Brain] Error fetching messages by IDs:', err);
            return [];
        }
    }

    /**
     * Extracts relationships between entities from text
     */
    async extractRelationships(text: string, entities: Entity[]): Promise<{ source: string; target: string; relationship: string }[]> {
        if (entities.length < 2) return [];

        try {
            const entityList = entities.map(e => e.name).join(', ');
            const response = await openai.chat.completions.create({
                model: 'gpt-5-mini',
                messages: [
                    { role: 'system', content: `Extract relationships between these entities: ${entityList} \nReturn JSON: { "relationships": [{ "source": "entity1", "target": "entity2", "relationship": "relates-to|causes|supports|contradicts" }] } ` },
                    { role: 'user', content: text }
                ],
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0].message.content;
            if (!content) return [];

            const parsed = JSON.parse(content);
            return parsed.relationships || [];
        } catch (err) {
            console.error('[Brain] Error extracting relationships:', err);
            return [];
        }
    }

    /**
     * Traverses the knowledge graph to find related entities
     */
    async traverseGraph(userId: string, startEntityName: string): Promise<Entity[]> {
        try {
            const { data: startEntity } = await supabaseAdmin
                .from('entities')
                .select('id, name, entity_type, description')
                .eq('user_id', userId)
                .ilike('name', `% ${startEntityName}% `)
                .limit(1)
                .single();

            if (!startEntity) return [];

            const { data: relationships } = await supabaseAdmin
                .from('relationships')
                .select('target_id')
                .eq('source_id', startEntity.id)
                .limit(10);

            if (!relationships || relationships.length === 0) {
                return [{
                    name: startEntity.name,
                    type: startEntity.entity_type as Entity['type'],
                    description: startEntity.description
                }];
            }

            const targetIds = relationships.map(r => r.target_id);
            const { data: relatedEntities } = await supabaseAdmin
                .from('entities')
                .select('name, entity_type, description')
                .in('id', targetIds);

            const result: Entity[] = [{
                name: startEntity.name,
                type: startEntity.entity_type as Entity['type'],
                description: startEntity.description
            }];

            for (const e of (relatedEntities || [])) {
                result.push({
                    name: e.name,
                    type: e.entity_type as Entity['type'],
                    description: e.description
                });
            }

            return result;
        } catch (err) {
            console.error('[Brain] Error traversing graph:', err);
            return [];
        }
    }

    /**
     * Tags a message with its related topics/entities
     */
    async tagMessageWithTopics(messageId: string, entities: Entity[], userId: string = resolveMiraUserId()): Promise<void> {
        try {
            for (const entity of entities) {
                const { data: entityRecord } = await supabaseAdmin
                    .from('entities')
                    .select('id')
                    .eq('user_id', userId)
                    .eq('name', entity.name.toLowerCase())
                    .single();

                if (entityRecord) {
                    await supabaseAdmin
                        .from('message_topics')
                        .upsert({
                            message_id: messageId,
                            entity_id: entityRecord.id,
                            relevance: 1.0
                        }, { onConflict: 'message_id,entity_id' });
                }
            }
        } catch (err) {
            console.error('[Brain] Error tagging message with topics:', err);
        }
    }

    /**
     * Background maintenance: Updates memory layers after a turn
     */
    async processTurn(threadId: string, userText: string, assistantText: string, userId: string = resolveMiraUserId()): Promise<void> {
        console.log('[Brain] Processing turn for memory updates...');
        await this.ensureThreadExists(threadId, userId);
        await this.persistMessages(threadId, userId, [
            { role: 'user', content: userText },
            { role: 'assistant', content: assistantText }
        ]);

        // Combine user and assistant text for entity extraction
        const fullText = `User: ${userText} \nAssistant: ${assistantText} `;

        // Run all background tasks in parallel
        await Promise.allSettled([
            // Detect and save corrections
            this.detectAndSaveCorrection(userText, userId),

            // Extract and save entities
            this.extractEntities(fullText).then(entities => {
                if (entities.length > 0) {
                    return this.saveEntities(userId, entities);
                }
            }),

            // Extract facts (using existing method)
            this.extractFacts(threadId, userText, userId),

            // Update core memory with recent messages
            this.updateCoreMemory(userId, [
                { role: 'user', content: userText },
                { role: 'assistant', content: assistantText }
            ])
        ]);

        console.log('[Brain] Turn processing complete.');
    }

    /**
     * Detects if user is making a correction and saves it with audit trail
     */
    async detectAndSaveCorrection(userText: string, userId: string = resolveMiraUserId()): Promise<void> {
        console.log('[Brain] Checking for corrections...');

        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-5-mini',
                messages: [
                    { role: 'system', content: CORRECTION_DETECTION_PROMPT },
                    { role: 'user', content: userText }
                ],
                response_format: { type: 'json_object' },
            });

            const content = response.choices[0].message.content;
            if (!content) return;

            const correction: CorrectionInfo = JSON.parse(content);

            if (!correction.is_correction) {
                console.log('[Brain] No correction detected.');
                return;
            }

            console.log('[Brain] Correction detected:', correction.summary);

            // Save the correction as a fact with type 'correction'
            const embedding = await this.getEmbedding(correction.summary || `${correction.old_value} -> ${correction.new_value} `);

            await supabaseAdmin.from('facts').insert({
                user_id: userId,
                content: `CORRECTION: Changed "${correction.old_value}" to "${correction.new_value}".${correction.summary || ''} `,
                fact_type: 'correction',
                embedding,
                relevance_score: 1.0,
                metadata: {
                    old_value: correction.old_value,
                    new_value: correction.new_value,
                    entity_type: correction.entity_type,
                    corrected_at: new Date().toISOString()
                }
            });

            console.log('[Brain] Correction saved to facts table.');
        } catch (error) {
            console.error('[Brain] Error detecting correction:', error);
        }
    }

    public async extractFacts(threadId: string, text: string, userId: string = resolveMiraUserId(), simulatedDate?: string): Promise<void> {
        try {
            let dateToUse = simulatedDate || new Date().toISOString();
            let promptDate = simulatedDate || dateToUse;

            // If it's a raw LOCOMO date string, parse it to ISO for DB queries but keep original for prompt
            if (simulatedDate && simulatedDate.includes(' on ')) {
                try {
                    const match = simulatedDate.match(/(\d+):(\d+)\s*(am|pm)\s*on\s*(\d+)\s*(\w+),?\s*(\d+)/i);
                    if (match) {
                        const months: any = { 'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5, 'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11 };
                        let h = parseInt(match[1]);
                        if (match[3].toLowerCase() == 'pm' && h < 12) h += 12;
                        if (match[3].toLowerCase() == 'am' && h == 12) h = 0;
                        dateToUse = new Date(parseInt(match[6]), months[match[5].toLowerCase()] || 0, parseInt(match[4]), h, parseInt(match[2])).toISOString();
                    }
                } catch (e) { }
            }

            // 1. Fetch relevant context (last 10 messages within this thread, before current session)
            const { data: contextMsgs } = await supabaseAdmin
                .from('messages')
                .select('role, content')
                .eq('thread_id', threadId)
                .lt('created_at', dateToUse)
                .order('created_at', { ascending: false })
                .limit(10);

            const conversationContext = contextMsgs && contextMsgs.length > 0
                ? contextMsgs.reverse().map(m => m.content).join('\n')
                : "No previous context.";

            const response = await openai.chat.completions.create({
                model: 'gpt-5-mini',
                reasoning_effort: 'low',
                messages: [
                    {
                        role: 'system',
                        content: `${FACT_EXTRACTION_PROMPT_V2} \n\nIMPORTANT: CURRENT DATE IS ${promptDate}. Resolve all relative dates(yesterday, last week, next month) based on this date.`
                    },
                    {
                        role: 'user',
                        content: `CONVERSATION CONTEXT (for pronoun and topic resolution):\n${conversationContext}\n\nCURRENT SESSION TO EXTRACT FROM:\n${text}`
                    }
                ]
            });

            const factsRaw = response.choices[0].message.content;
            if (!factsRaw || factsRaw === 'NONE') return;

            // Parse facts (V2 Format: [FACT] or [CORRECTION] followed by content)
            // Example: [FACT] [Jan 15, 2026] [USER] is working on their Atlas project.
            const lines = factsRaw.split('\n').filter(l => l.trim().startsWith('[FACT]') || l.trim().startsWith('[CORRECTION]'));
            const factsToInsert: Array<{
                user_id: string;
                content: string;
                fact_type: string;
                source_message_id: null;
                embedding: number[];
                relevance_score: number;
            }> = [];
            const factTexts: string[] = [];

            for (const line of lines) {
                const trimmedLine = line.trim();

                // Determine type and extract content
                let type: string;
                let content: string;

                if (trimmedLine.startsWith('[FACT]')) {
                    type = 'fact';
                    content = trimmedLine.substring(6).trim(); // Remove '[FACT]' prefix
                } else if (trimmedLine.startsWith('[CORRECTION]')) {
                    type = 'correction';
                    content = trimmedLine.substring(12).trim(); // Remove '[CORRECTION]' prefix
                } else {
                    continue; // Skip lines that don't match expected format
                }

                if (!content) continue;

                let cleanContent = content;
                let relevance = 1.0;

                if (cleanContent.includes('[CRITICAL]')) {
                    relevance = 2.0;
                    cleanContent = cleanContent.replace('[CRITICAL]', '').trim();
                }

                factTexts.push(cleanContent);
                factsToInsert.push({
                    user_id: userId,
                    content: cleanContent,
                    fact_type: type,
                    source_message_id: null,
                    embedding: [], // Will be filled after batch embedding
                    relevance_score: relevance
                });
            }

            if (factTexts.length === 0) return;

            // Batch get embeddings for all facts
            const BATCH_SIZE = 500;
            const allEmbeddings: number[][] = [];
            for (let i = 0; i < factTexts.length; i += BATCH_SIZE) {
                const batch = factTexts.slice(i, i + BATCH_SIZE);
                const embeddingResponse = await openai.embeddings.create({
                    model: 'text-embedding-3-large',
                    input: batch,
                });
                allEmbeddings.push(...embeddingResponse.data.map(d => d.embedding));
            }

            // Assign embeddings to facts
            factsToInsert.forEach((fact, idx) => {
                fact.embedding = allEmbeddings[idx];
            });

            // Batch insert all facts
            for (let i = 0; i < factsToInsert.length; i += 100) {
                const batch = factsToInsert.slice(i, i + 100);
                const { error } = await supabaseAdmin.from('facts').insert(batch);
                if (error) {
                    console.error('[Brain] Error batch inserting facts:', error);
                }
            }
        } catch (error) {
            console.error('[Brain] Error extracting facts:', error);
        }
    }

    public async getEmbedding(text: string): Promise<number[]> {
        const response = await openai.embeddings.create({
            model: process.env.EMBEDDING_MODEL || 'text-embedding-3-large',
            input: text,
        });
        return response.data[0].embedding;
    }

    public async getDocumentEmbedding(text: string): Promise<number[]> {
        const response = await openai.embeddings.create({
            model: process.env.DOCUMENT_EMBEDDING_MODEL || 'text-embedding-3-small',
            input: text,
        });
        return response.data[0].embedding;
    }
}

export const brain = new CogBrain();
