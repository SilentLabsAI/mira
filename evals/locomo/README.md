# MIRA LOCOMO Evaluation

This folder contains the MIRA LOCOMO evaluation harness and curated evidence for the published 90.6% run.

## Result

MIRA scores **90.6%** on LOCOMO categories 1-4.

| Category | Score |
|---|---:|
| Overall | **90.6%** |
| Temporal | 87.5% |
| Single-hop | 87.6% |
| Multi-hop | 79.2% |
| Open-domain | 94.2% |

## Methodology

- Dataset: `locomo10.json`
- Included categories: 1-4
- Excluded category: 5 (`adversarial`)
- Generation model: `gpt-5-mini`
- Judge model: `gpt-5-mini`
- Ingestion path: `master_ingest.ts` and the ingestion flow inside `locomo_eval_full.ts`
- Answer-generation prompt: `packages/mira-core/src/lib/cog/eval_utils.ts` in `buildAugmentedPrompt(...)`
- Judge prompt: `packages/mira-core/src/lib/cog/eval_utils.ts` in `computeSemanticMatch(...)`

## Memory Reasoning Policy

The LOCOMO harness uses the same memory reasoning policy as the shared MIRA runtime prompt: resolved-date grounding, correction priority, exact-message recall, semantic continuity across sessions, entity/category resolution, list completeness, and synthesis across retrieved facts.

These rules are documented in the answer-generation prompt because long-term memory questions often require more than lexical lookup. The policy tells the generation model how to use retrieved memory; it does not add benchmark answers or dataset-specific examples.

## Curated Evidence

The published run evidence lives in:

```text
runs/90_6/
```

Included files:

- `report.md`: score summary, category breakdown, failed questions, and retrieved facts for failure analysis.
- `compressed_log.json`: per-question question/ground-truth/prediction/judge metadata without full prompts or retrieved context.

The npm package excludes `runs/`; it ships the harness and documentation only.

## Harness Files

| File | Purpose |
|---|---|
| `master_ingest.ts` | Ingests user-provided LOCOMO data into Supabase. |
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

Generated outputs are ignored because they can contain benchmark text, prompts, retrieved context, and model outputs.

For comparable reruns, record the dataset file, included categories, generation model, judge model, prompts, and ingestion setup.
