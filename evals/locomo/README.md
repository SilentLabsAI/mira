# MIRA LoCoMo Evaluation

This folder contains the MIRA LoCoMo evaluation harness and curated evidence for the published 90.6% LoCoMo QA categories 1-4 run.

## Result

MIRA scores 90.6% on LoCoMo QA categories 1-4.

Score denominator: 1,396 / 1,540.

| Category | Score |
|---|---:|
| Overall | **90.6%** |
| Temporal | 87.5% |
| Single-hop | 87.6% |
| Multi-hop | 79.2% |
| Open-domain | 94.2% |

## Scope

This score covers LoCoMo QA categories 1-4. Category 5/adversarial is excluded. This is not a full or all-category LoCoMo score.

Public LoCoMo protocols vary across organizations, including category scope, judge model, answerer model, input surfaces, retry policy, and reporting detail.

## Methodology

- Dataset: `locomo10.json`
- Included categories: 1-4
- Excluded category: 5 (`adversarial`)
- Generation model: `gpt-5-mini`
- Judge model: `gpt-5-mini`
- Ingestion path: `master_ingest.ts` and the ingestion flow inside `locomo_eval_full.ts`
- Answer-generation prompt: `packages/mira-core/src/lib/cog/eval_utils.ts` in `buildAugmentedPrompt(...)`
- Judge prompt: `packages/mira-core/src/lib/cog/eval_utils.ts` in `computeSemanticMatch(...)`

## Runtime Input Boundary

Allowed runtime inputs are conversation sessions, timestamps, speaker names, turn text, source IDs for provenance, and declared image/caption fields only if the protocol uses them.

At answer time, MIRA receives the question text only. Question text must not be pre-ingested into memory before the question is asked.

Scoring-only artifacts must not be available to MIRA during ingestion, retrieval, route selection, prompt construction, answer generation, cache population, document indexing, synthetic-data generation, or runtime memory writes. This includes GT answers, gold evidence, category labels, judge outputs, failed-question reports, curated evidence, compressed logs, previous predictions, and previous failed-run state.

## Benchmark Integrity

The scored run was runtime-clean: ground-truth answers, gold evidence annotations, category labels, judge outputs, failed-question analyses, curated evidence, compressed logs, prior predictions, previous failed-run state, and score files were not available to MIRA during ingestion, retrieval, route selection, prompt construction, or answer generation.

LoCoMo was used as a diagnostic benchmark during MIRA development to identify general long-term-memory failure modes. Resulting changes were implemented as benchmark-agnostic architecture and retrieval improvements rather than benchmark-specific examples, branches, or answer patterns. The published run should be interpreted as runtime-clean and LoCoMo-informed, not as a claim that LoCoMo was an untouched private holdout.

## Memory Reasoning Policy

The LoCoMo harness uses the same memory reasoning policy as the shared MIRA runtime prompt: resolved-date grounding, correction priority, exact-message recall, semantic continuity across sessions, entity/topic resolution, list completeness, and synthesis across retrieved facts.

These rules are documented in the answer-generation prompt because long-term memory questions often require more than lexical lookup. The policy tells the generation model how to use retrieved memory; it does not add benchmark answers or dataset-specific examples.

## Curated Evidence

The published run evidence lives in:

```text
runs/90_6/
```

Included files:

- `report.md`: score summary, category breakdown, failed questions, and retrieved facts for post-run analysis. It must not be ingested into MIRA prompts, documents, caches, synthetic data, final-scoring regression fixtures, or runtime memory stores.
- `compressed_log.json`: question/GT/prediction/judge metadata without full prompts or retrieved context. It is audit/development material, not runtime input.

The npm package excludes `runs/`; it ships the harness and documentation only.

## Regression vs Scoring

Failed-only reruns and samples of previously passed questions are regression checks, not reportable benchmark scores.

Reportable benchmark scores must come from full reruns over the declared category set with frozen code, prompts, model stack, judge, category scope, retrieval configuration, retry policy, and fresh runtime namespaces.

## Harness Files

| File | Purpose |
|---|---|
| `master_ingest.ts` | Ingests user-provided LoCoMo data into Supabase. |
| `locomo_eval.ts` | Runs category 1-4 QA evaluation. |
| `locomo_eval_full.ts` | Runs the full multi-conversation evaluation flow. |
| `packages/mira-core/src/lib/cog/eval_utils.ts` | Builds the answer prompt and runs the LLM judge. |

## Running

The LOCOMO dataset is not bundled. Download it from the official benchmark source and point the harness to it:

```bash
LOCOMO_DATA_PATH=/path/to/locomo10.json npm run eval:locomo
```

Available commands:

```bash
npm run eval:locomo
npm run eval:locomo-full
```

Generated local outputs should go under:

```text
eval-outputs/
```

Generated outputs are ignored because they can contain benchmark text, prompts, retrieved context, model outputs, GT, judge metadata, failure-analysis material, and scores.

For comparable reruns, record:

- Dataset file and hash
- Included categories, excluded categories, and category counts
- Answerer model and judge model
- Answer prompt hash and judge prompt hash
- Ingestion setup
- Runtime input surfaces
- Retrieval configuration
- Memory reset policy
- Cache policy
- Retry policy
- Runtime-clean status
- Generated artifacts
- Exclusions and invalid-run rules
