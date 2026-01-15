# Runbook: Qwen2.5-7B (local) — QLoRA -> Ollama

This runbook targets:

- Base model: `Qwen/Qwen2.5-7B-Instruct`
- Fine-tune method: QLoRA (Axolotl)
- Goal: keep everything local for inference via **Ollama**

Important:

- Fine-tuning requires an NVIDIA GPU (Linux/Windows). macOS (Apple Silicon) is not a great target for QLoRA training today.
- You *can* still keep the app local on macOS, but do the training on a GPU machine.

Also important:

- When we say “fine-tune Qwen2.5-7B”, we mean fine-tuning the **Hugging Face base weights** `Qwen/Qwen2.5-7B-Instruct` (HF format).
- Your local Ollama model is usually a **GGUF** file; you generally don’t fine-tune GGUF directly. The usual flow is: HF fine-tune -> merge -> convert/quantize -> import into Ollama.

## Recommended hardware (7B)

- Training (QLoRA): 1× NVIDIA GPU (12–24GB VRAM is a good starting point). If you only have 8–12GB, reduce `sequence_len` to 2048.
- Inference via Ollama (GGUF): depends on quantization (Q4/Q5/Q6/Q8) and your RAM.

### If you only have ~6GB VRAM (Windows/NVIDIA)

It can work, but expect tighter limits.

- Use a shorter context: `sequence_len: 1024` or `2048`.
- Keep LoRA small: `lora_r: 8` or `16`.
- Keep `micro_batch_size: 1` and increase `gradient_accumulation_steps`.
- Prefer a small, clean dataset first (a few hundred to a few thousand examples) to validate.

This repo includes a low-VRAM Axolotl template you can start from:

- `training/axolotl/qwen2.5-7b-qlora-lowvram.yaml`

## 0) Export + prepare data (from this repo)

From the repo root:

- `npm run data:finetune`
- `npm run data:finetune:prepare`

This produces:

- `training_data/optilens_chat.jsonl`
- `training_data/prepared/train.jsonl`
- `training_data/prepared/val.jsonl`

Copy these files to your training machine.

## 1) Train QLoRA with Axolotl

On your NVIDIA GPU machine:

1) Create a Python env, install Axolotl.

Example:

- `python -m venv .venv && source .venv/bin/activate`
- `pip install -U pip`
- `pip install axolotl`

### Troubleshooting (if you ran this on macOS)

If you run `axolotl train ...` on macOS, you may hit errors like:

- `ModuleNotFoundError: No module named 'torch._inductor.kernel.flex_attention'`
- `ModuleNotFoundError: Could not import module 'PreTrainedModel'`

This is usually caused by an incompatible PyTorch/Transformers/TorchAO stack on macOS (and even when it imports, QLoRA training is not practical on a Mac).

Recommended: do the Axolotl training step on **Windows/Linux with an NVIDIA GPU**.

### Windows/NVIDIA quick install (example)

On the Windows/NVIDIA machine, prefer an isolated env:

- `python -m venv .venv`
- Activate it
- `pip install -U pip`

Install CUDA-enabled PyTorch (example for CUDA 12.1):

- `pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121`

Then install Axolotl:

- `pip install axolotl`

1) Use the template config:

- `training/axolotl/qwen2.5-7b-qlora.yaml`

If you have low VRAM (e.g. 6GB), start with:

- `training/axolotl/qwen2.5-7b-qlora-lowvram.yaml`

Recommended edit:

- Point `datasets[0].path` to `training_data/prepared/train.jsonl`
- Optionally reduce `sequence_len` to `2048` if you hit OOM

Train:

- `axolotl train training/axolotl/qwen2.5-7b-qlora.yaml`

The adapter output will go into:

- `training/outputs/qwen2.5-7b-qlora`

## 2) Merge adapter -> merged model

Use the merge script in this repo:

- `training/merge/merge_lora.py`

Example:

- `python training/merge/merge_lora.py \
    --base Qwen/Qwen2.5-7B-Instruct \
    --adapter training/outputs/qwen2.5-7b-qlora \
    --out /path/to/merged-model`

## 3) Convert + quantize to GGUF (for Ollama)

Ollama typically runs GGUF models. Common path:

1) Clone llama.cpp on the machine you will build/quantize on.
2) Convert the merged HF model to GGUF (script name may vary by llama.cpp version):

- `python convert_hf_to_gguf.py /path/to/merged-model --outfile optilens-qwen2.5-7b.gguf`

1) Quantize (example Q4_K_M):

- `./llama-quantize optilens-qwen2.5-7b.gguf optilens-qwen2.5-7b.Q4_K_M.gguf Q4_K_M`

If you prefer, you can keep higher precision (Q5/Q6/Q8) for better quality at the cost of RAM.

## 4) Create an Ollama model

Create a `Modelfile` (example):

- `FROM ./optilens-qwen2.5-7b.Q4_K_M.gguf`
- `PARAMETER temperature 0.2`

Then:

- `ollama create optilens-qwen2.5-7b -f Modelfile`

## 5) Point the app to your fine-tuned Ollama model

In `.env`:

- `LLM_PROVIDER=ollama`
- `OLLAMA_MODEL=optilens-qwen2.5-7b`
- `OLLAMA_BASE_URL=http://127.0.0.1:11434` (or your remote Ollama)

Validate:

- `npx tsx scripts/smokeChatStream.ts`

Optional sanity checks:

- In the app UI, ask the same prompt in French and Arabic and verify language adherence.
- Run a small eval sample (if you host an OpenAI-compatible endpoint later): `npm run eval:language -- --limit 200 --concurrency 8`
