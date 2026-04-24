# MIRA - Memory Inference and Retrieval Architecture

**A memory system for AI.**

MIRA turns long-running conversations into durable, queryable memory: raw messages, dated facts, corrections, entities, core memory, and retrieval-ready context.

Built by **SilentLabs**.

## Why MIRA Exists

Memory is not just chat history plus vector search.

Real memory questions often depend on exact wording, resolved dates, corrections, entity identity, and multi-step synthesis:

- "When did this happen?"
- "What changed since last time?"
- "What did I correct you about?"
- "How many times did I mention this?"
- "What connects this person, project, and event?"

MIRA is built for that harder class of long-term conversational memory.

## What MIRA Does

- Stores raw user and assistant messages with embeddings.
- Extracts durable facts, preferences, corrections, entities, and temporal references.
- Maintains a compact core memory profile for always-available context.
- Retrieves context with semantic search, keyword search, exact-message recall, entity matching, document search, and counting-specific paths.
- Treats corrections as first-class memory facts and gives them priority in generation when retrieved.
- Runs on your OpenAI key and your Supabase/Postgres project.

## Benchmark Result

MIRA scores **90.6%** on LOCOMO categories 1-4.

| Category | Score |
|---|---:|
| Overall | **90.6%** |
| Temporal | 87.5% |
| Single-hop | 87.6% |
| Multi-hop | 79.2% |
| Open-domain | 94.2% |

Methodology is documented below. Curated run evidence is kept in the GitHub repository at `evals/locomo/runs/90_6/`; the npm package ships the harness and docs, not bulky run artifacts.

Run configuration:

- Dataset: `locomo10.json`
- Included categories: 1-4
- Excluded category: 5 (`adversarial`)
- Generation model: `gpt-5-mini`
- Judge model: `gpt-5-mini`
- Harness entrypoints: `npm run eval:locomo`, `npm run eval:locomo-full`
- Harness code: `evals/locomo/locomo_eval.ts`, `evals/locomo/locomo_eval_full.ts`
- Answer prompt and judge prompt: `packages/mira-core/src/lib/cog/eval_utils.ts`

## How It Works

```text
Ingest turn -> Extract memory -> Retrieve context -> Generate with memory -> Update memory
```

During ingestion, MIRA stores the raw conversation turn, extracts facts and entities, detects corrections, and updates core memory.

During retrieval, MIRA builds compact context from core memory, relevant facts, entities, exact messages, optional documents, and counting results.

## Install

```bash
npm install
cp .env.example .env
```

Fill `.env` with your own keys:

```text
OPENAI_API_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Apply the schema in Supabase SQL editor:

```text
packages/mira-supabase/schema/memory_schema.sql
```

Run a local smoke test:

```bash
npm run smoke
```

## Package Usage

```ts
import { createMiraSupabaseAdminClient } from '@silentlabs/mira-core';
import { brain } from '@silentlabs/mira-core/brain';
import { buildMiraPrompt } from '@silentlabs/mira-core/prompt';
```

`@silentlabs/mira-core/brain` requires server-side environment variables:

- `OPENAI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Keep the Supabase service-role key behind your backend boundary.

## Chatbot Integration

MIRA belongs in the backend chat route:

```ts
const context = await brain.retrieveContext(threadId, userText, messages, userId);
const systemPrompt = buildMiraPrompt(context);

const response = await openai.chat.completions.create({
  model: process.env.CHAT_MODEL || 'gpt-5-mini',
  messages: [
    { role: 'system', content: systemPrompt },
    ...messages
  ]
});

const assistantText = response.choices[0]?.message?.content || '';
await brain.processTurn(threadId, userText, assistantText, userId);
```

`processTurn(...)` persists raw user/assistant messages, extracts corrections/facts/entities, and updates core memory. Do not manually insert messages as well unless you intentionally bypass `processTurn(...)`.

See `examples/next-chat-route` for a production-style route adapted from the original internal server flow.

## Repository Map

| Area | Path |
|---|---|
| Memory engine | `packages/mira-core/src/lib/cog` |
| Public package entry | `packages/mira-core/src/index.ts` |
| Supabase client helper | `packages/mira-supabase/src/client.ts` |
| Supabase schema | `packages/mira-supabase/schema/memory_schema.sql` |
| Next.js chat route example | `examples/next-chat-route` |
| Local demo | `examples/local-chat` |
| Architecture notes | `docs/memory_architecture.md` |
| LOCOMO eval harness | `evals/locomo` |

## Current State

MIRA is currently available as a developer preview: the memory engine, schema, evaluation harness, and chatbot integration path are included for builders who want to run the system in their own stack.

Operational boundaries:

- Host apps control auth, user isolation, RLS, deployment, and product policy.
- The schema is a starter schema, not a full migration system.
- Relationship and timeline tables are present in the schema, but graph traversal and timeline writes are not active in the default turn flow yet.
- The npm package ships the harness and docs, not bulky run artifacts.

## Evaluation Artifacts

The benchmark dataset is not bundled.

Run artifacts for the published 90.6% result are available in the GitHub repository at `evals/locomo/runs/90_6/`.

## License

Apache-2.0. Copyright 2026 SilentLabs. See `LICENSE`.
