# Evaluation (large prompt set)

This repo includes an evaluation workflow focused on **language adherence** (answer in the same language as the user).

## 1) Generate a large prompt set

- `npm run eval:prompts`

This writes:
- `training_data/eval/prompts.jsonl`

You can scale it up:
- `npm run eval:prompts -- --total 100000`

That yields 100k prompts split across FR/EN/AR/DZ.

You can also use `--perLang` (4x total):
- `npm run eval:prompts -- --perLang 25000`  # => 100k prompts

## 2) Run language adherence eval against vLLM

Set env vars (see [.env.example](.env.example)):
- `LLM_PROVIDER=openai-compat`
- `OPENAI_COMPAT_BASE_URL=http://YOUR_GPU_HOST:8000`
- `OPENAI_COMPAT_MODEL=Qwen/Qwen2.5-7B-Instruct`

Run:
- `npm run eval:language -- --limit 2000 --concurrency 16`

Notes:
- Evaluating all 100k prompts will take time and money. Start with a sample (2k–10k), then scale.

Outputs:
- `training_data/eval/results.json`

## 3) Compare base vs fine-tuned

Run the eval once with base model, save results.
Then deploy your merged fine-tuned model in vLLM and run again.
Compare pass rates (overall + by language).

Note: language detection here is heuristic (fast). For deeper eval, add LLM-judge or a proper language ID model.
