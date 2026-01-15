# Fine-tuning (GPU cloud)

This repo uses Ollama for inference (`/api/chat`). If you want a fine-tuned model, the simplest production path is:

1) Export a chat dataset from the app database (JSONL)
2) Fine-tune with QLoRA on a GPU cloud runner
3) Merge + quantize to GGUF
4) Serve the model on a Linux server (GPU or CPU), then point the app to it via `OLLAMA_BASE_URL`

## 1) Export dataset

From the repo root:

- Export chat examples:
  - `npx tsx scripts/exportFinetuneDataset.ts --out training_data/optilens_chat.jsonl`

Optional knobs:
- `--maxChats 1000`
- `--maxExamples 20000`
- `--maxMessagesPerExample 20`

The output format is OpenAI-style chat JSONL:

- `{ "messages": [{"role":"system","content":"..."}, {"role":"user","content":"..."}, {"role":"assistant","content":"..."}] }`

## 2) Fine-tune (recommended: QLoRA)

Recommended stacks (pick one):
- Unsloth + TRL (fast + simple)
- Axolotl (config-driven)

Base model suggestion (matches current default): `Qwen/Qwen2.5-7B-Instruct`

Goal suggestions for OptiLens:
- Always answer in the same language as the last user message
- Consistent Markdown formatting (headings + bullet lists)
- Optics-domain dialog patterns (ask for SPH/CYL/AXE if missing, etc.)

## 3) Deploy for all operating systems

If your goal is "works on all OS", host the model behind an HTTP API on Linux (cloud). Users on Windows/macOS/Linux just use the web app.

Two common serving options:
- vLLM (GPU) -> OpenAI-compatible endpoint
- llama.cpp / Ollama (GGUF) -> simple local/remote serving

This app already supports remote Ollama via `OLLAMA_BASE_URL`.

## Notes

- Don’t put raw production conversations into training without reviewing for sensitive data.
- Prefer RAG for knowledge (catalog/stock/prices). Use fine-tuning for style/format/behavior.
