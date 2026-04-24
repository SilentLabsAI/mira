# MIRA - Memory Inference and Retrieval Architecture

## Memory Architecture

MIRA is a memory system for AI. It stores conversation-derived memory in Supabase/Postgres and retrieves compact context before a model responds.

The system is optimized for long-term conversational memory: exact-message recall, dated facts, corrections, entity-aware retrieval, counting queries, and compact always-available core memory.

## Architecture

| Layer | Purpose | Storage |
|---|---|---|
| Threads/messages | Raw conversation store for exact wording, retrieval fallback, and eval ingestion. | `threads`, `messages` |
| Core memory | Compact always-available profile of durable context. | `core_memory` |
| Facts | Extracted durable facts, preferences, corrections, and temporal statements. | `facts` |
| Entities | People, projects, concepts, preferences, and events. | `entities` |
| Documents | Optional structured long-form context. | `documents` |
| Working memory | Short-lived retrieval cache schema for follow-up turns. | `working_memory` |
| Relationships | Schema for entity links; not active in the default turn flow yet. | `relationships` |
| Timeline | Schema for time-indexed records; temporal behavior currently relies on dated facts/messages. | `timeline` |

## Turn Flow

Before generation:

1. Analyze the user query.
2. Retrieve core memory.
3. Retrieve relevant facts, entities, documents, and exact messages.
4. Build a compact prompt with `buildMiraPrompt(...)`.

After generation:

1. Ensure the thread exists.
2. Store raw user and assistant messages with embeddings.
3. Detect explicit corrections.
4. Extract durable facts and preferences.
5. Extract entities.
6. Update core memory.

## Retrieval Paths

| Query class | Retrieval focus |
|---|---|
| Recent / exact wording | Raw messages and dated facts. |
| Historical recall | Facts, messages, core memory, entities. |
| Temporal questions | Dated facts and exact message context. |
| Corrections | Correction facts and core-memory clarifications. |
| Counting | Counting-specific fact/message scans and aggregation. |
| Relational / synthesis | Entity-aware fact retrieval and generated synthesis. |

## Memory Reasoning Policy

MIRA treats retrieval and reasoning as a single memory loop. Retrieved context is interpreted with a shared runtime policy for resolved dates, correction priority, exact-message recall, semantic continuity, entity/category resolution, list completeness, and synthesis across facts.

This policy is part of the default generation prompt and is mirrored in the LOCOMO evaluation harness so the generation model uses retrieved memory consistently. It is not a benchmark answer key; it is the reasoning layer that turns stored memory into usable context.

## Correction Handling

Corrections are first-class memory records:

- Explicit corrections are detected during `processTurn(...)`.
- Correction facts are stored with `fact_type = 'correction'`.
- Retrieved correction facts are marked in the prompt and treated as newer guidance over older conflicting summaries.
- The schema includes `superseded_by`, but automatic supersession of old facts is not active yet.

## Embeddings

The public schema expects `pgvector` support and stores embeddings with two dimensions:

- 3072 dimensions for facts, entities, and messages.
- 1536 dimensions for documents.

## Integration Boundary

MIRA runs server-side. Host applications should pass explicit `userId` and `threadId` values from their own auth boundary when calling the memory engine.

All MIRA calls that use Supabase must run with the service-role key on the server. Do not expose service-role credentials to browsers or mobile clients.

## Current State

The memory engine, schema, chatbot integration path, and LOCOMO evaluation harness are included.

Host apps own:

- Auth and tenancy.
- RLS policy design.
- Deployment and secret management.
- Product-specific UX and consent flows.
- Migrations beyond the starter schema.

Generated eval logs and bulky run artifacts are excluded from the npm package. Curated benchmark evidence may be kept in the GitHub repo when it supports a public result.
