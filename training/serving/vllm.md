# Serving with vLLM (OpenAI-compatible)

If you want to use an OpenAI-compatible endpoint, the usual approach is:
- Host the model on a Linux GPU server (cloud)
- Expose an OpenAI-compatible HTTP endpoint
- Your Next.js app calls it (users are just a browser -> Windows/macOS/Linux OK)

## Model

This repo is centered around Qwen2.5-7B:

- `Qwen/Qwen2.5-7B-Instruct` (or your merged fine-tuned directory)

## vLLM run (example)

This is an example; pick tensor parallel based on your GPU count.

- 1 GPU (tensor parallel 1):
  - `python -m vllm.entrypoints.openai.api_server --model Qwen/Qwen2.5-7B-Instruct --tensor-parallel-size 1 --dtype float16 --max-model-len 4096 --port 8000`

## Hook the app

This repo now supports switching between Ollama and a vLLM OpenAI-compatible endpoint via env vars.

To use vLLM (OpenAI-compatible):
- Set `LLM_PROVIDER=openai-compat`
- Set `OPENAI_COMPAT_BASE_URL=http://YOUR_GPU_HOST:8000`
- Set `OPENAI_COMPAT_MODEL=Qwen/Qwen2.5-7B-Instruct`

To keep Ollama (local or remote):
- Set `LLM_PROVIDER=ollama`
- Set `OLLAMA_BASE_URL` and `OLLAMA_MODEL`

## Important (macOS / CPU)

If you are trying to run vLLM on a Mac (CPU), it will be slow/unreliable; prefer a Linux GPU host.

For best results you should run vLLM on a **Linux GPU** machine.

If you still want to test the OpenAI-compatible wiring locally, use a **small model** (e.g. 7B) and reduce swap space:
- `python -m vllm.entrypoints.openai.api_server --model Qwen/Qwen2.5-7B-Instruct --tensor-parallel-size 1 --dtype float16 --max-model-len 4096 --port 8000 --swap-space 2`

If you see an error like:
- `Too large swap space ... out of total CPU memory`

Lower `--swap-space` (in GiB) and/or set CPU KV cache space, e.g.:
- `export VLLM_CPU_KVCACHE_SPACE=2`

## GPU sizing (rule of thumb)

- 7B runs on a single modest GPU; increase VRAM for longer context / higher throughput.

## Safety note

Never fine-tune on raw production conversations without removing personal/sensitive data.
