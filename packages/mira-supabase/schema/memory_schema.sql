-- Memory Architecture Schema v1.0
-- Run this in Supabase SQL Editor

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- Threads and Messages: raw conversation store
-- ============================================
CREATE TABLE IF NOT EXISTS threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID REFERENCES threads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    embedding VECTOR(3072),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_threads_user_updated ON threads(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user_time ON messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread_time ON messages(thread_id, created_at ASC);

-- ============================================
-- Core Memory: Compressed context always loaded
-- ============================================
CREATE TABLE IF NOT EXISTS core_memory (
    user_id UUID PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Knowledge Graph: Entities
-- ============================================
CREATE TABLE IF NOT EXISTS entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'person', 'concept', 'preference', 'event')),
    name TEXT NOT NULL,
    description TEXT,
    embedding VECTOR(3072),
    first_mentioned TIMESTAMPTZ DEFAULT now(),
    last_mentioned TIMESTAMPTZ DEFAULT now(),
    mention_count INT DEFAULT 1,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, entity_type, name)
);

-- ============================================
-- Knowledge Graph: Relationships
-- ============================================
CREATE TABLE IF NOT EXISTS relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    source_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    target_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,
    weight FLOAT DEFAULT 1.0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Facts: Extracted truths with attribution
-- ============================================
CREATE TABLE IF NOT EXISTS facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    content TEXT NOT NULL,
    fact_type TEXT NOT NULL CHECK (fact_type IN ('fact', 'correction', 'preference')),
    source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    superseded_by UUID REFERENCES facts(id),
    embedding VECTOR(3072),
    relevance_score FLOAT DEFAULT 1.0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Timeline: Temporal index for time queries
-- ============================================
CREATE TABLE IF NOT EXISTS timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    thread_id UUID REFERENCES threads(id) ON DELETE SET NULL,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes for Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_entities_user_type ON entities(user_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(user_id, name);
CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id);
CREATE INDEX IF NOT EXISTS idx_timeline_user_time ON timeline(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);

-- ============================================
-- RPC: Search entities by embedding similarity
-- ============================================
CREATE OR REPLACE FUNCTION match_entities(
    query_embedding VECTOR(3072),
    match_threshold FLOAT DEFAULT 0.5,
    match_count INT DEFAULT 10,
    filter_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    entity_type TEXT,
    description TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.id,
        e.name,
        e.entity_type,
        e.description,
        1 - (e.embedding <=> query_embedding) AS similarity
    FROM entities e
    WHERE 
        (filter_user_id IS NULL OR e.user_id = filter_user_id)
        AND e.embedding IS NOT NULL
        AND 1 - (e.embedding <=> query_embedding) > match_threshold
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================
-- RPC: Search facts by embedding similarity
-- ============================================
CREATE OR REPLACE FUNCTION match_facts(
    query_embedding VECTOR(3072),
    match_threshold FLOAT DEFAULT 0.5,
    match_count INT DEFAULT 10,
    filter_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    fact_type TEXT,
    relevance_score FLOAT,
    similarity FLOAT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.content,
        f.fact_type,
        f.relevance_score,
        1 - (f.embedding <=> query_embedding) AS similarity,
        f.created_at
    FROM facts f
    WHERE 
        (filter_user_id IS NULL OR f.user_id = filter_user_id)
        AND f.embedding IS NOT NULL
        AND f.superseded_by IS NULL  -- Only non-superseded facts
        AND 1 - (f.embedding <=> query_embedding) > match_threshold
    ORDER BY f.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================
-- RPC: Search messages by embedding similarity
-- ============================================
CREATE OR REPLACE FUNCTION match_messages(
    query_embedding VECTOR(3072),
    match_threshold FLOAT DEFAULT 0.5,
    match_count INT DEFAULT 10,
    filter_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    role TEXT,
    similarity FLOAT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.content,
        m.role,
        1 - (m.embedding <=> query_embedding) AS similarity,
        m.created_at
    FROM messages m
    WHERE 
        (filter_user_id IS NULL OR m.user_id = filter_user_id)
        AND m.embedding IS NOT NULL
        AND 1 - (m.embedding <=> query_embedding) > match_threshold
    ORDER BY m.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================
-- Safety: Add metadata column to facts if it doesn't exist
-- ============================================
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='facts' AND column_name='metadata') THEN
        ALTER TABLE facts ADD COLUMN metadata JSONB DEFAULT '{}';
    END IF;
END $$;

-- ============================================
-- Working Memory: Cache recent search results
-- ============================================
CREATE TABLE IF NOT EXISTS working_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    cache_key TEXT NOT NULL,
    result_ids UUID[],
    result_preview JSONB,
    query_text TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ DEFAULT now() + interval '1 hour',
    UNIQUE(thread_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_working_memory_thread ON working_memory(thread_id);
CREATE INDEX IF NOT EXISTS idx_working_memory_expires ON working_memory(expires_at);

-- ============================================
-- Message Topics: Links messages to entities
-- ============================================
CREATE TABLE IF NOT EXISTS message_topics (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relevance FLOAT DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (message_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_message_topics_entity ON message_topics(entity_id);

-- ============================================
-- Documents: Structured memory storage
-- ============================================
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled',
    content TEXT NOT NULL DEFAULT '',
    summary TEXT,
    embedding VECTOR(1536),
    tags TEXT[] DEFAULT '{}',
    is_pinned BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at DESC);

-- Function to search documents by semantic similarity
CREATE OR REPLACE FUNCTION match_documents(
    query_embedding VECTOR(1536),
    match_threshold FLOAT,
    match_count INT,
    filter_user_id UUID
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    content TEXT,
    summary TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.title,
        d.content,
        d.summary,
        1 - (d.embedding <=> query_embedding) AS similarity
    FROM documents d
    WHERE d.user_id = filter_user_id
        AND d.embedding IS NOT NULL
        AND 1 - (d.embedding <=> query_embedding) > match_threshold
    ORDER BY d.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
