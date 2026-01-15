# Axolotl (QLoRA) quickstart (templates)

This folder contains TEMPLATE configs for QLoRA fine-tuning (Qwen2.5-7B).

## Prereqs

- Linux GPU runner (cloud)
- Access to the base model weights (Hugging Face)
- `training_data/optilens_chat.jsonl` exported from this repo

Note:

- macOS (Apple Silicon) is fine for running this Next.js app, but QLoRA training with Axolotl is intended for **NVIDIA GPUs** (Windows/Linux/Cloud).
- If you are on macOS, generate the config + dataset here, then copy them to the GPU machine to run `axolotl train`.

## Export dataset (from this repo)

- `npm run data:finetune`

This writes: `training_data/optilens_chat.jsonl`

Copy that file to your GPU training machine.

## Train (high-level)

On the GPU machine (example):

- `axolotl train training/axolotl/qwen2.5-7b-qlora.yaml`

Low VRAM (example ~6GB):

- `axolotl train training/axolotl/qwen2.5-7b-qlora-lowvram.yaml`

## Generate a config that adapts to your GPU

Axolotl configs are static YAML files (they do not auto-detect VRAM). To make this easier across many machines, this repo includes a small generator.

From the repo root:

- `npm run axolotl:config -- --vram 6`

This writes a per-VRAM config into:

- `training/axolotl/generated/qwen2.5-7b-qlora-6gb.yaml`

Then train with:

- `axolotl train training/axolotl/generated/qwen2.5-7b-qlora-6gb.yaml`

Optional overrides:

- `npm run axolotl:config -- --vram 6 --sequenceLen 1024`
- `npm run axolotl:config -- --vram 12 --sequenceLen 2048`

You will likely run Axolotl via accelerate/deepspeed for multi-GPU.

## Output

Adapters/checkpoints go into:

- `training/outputs/...` (ignored by git)

## After training

- Merge adapter -> produce a deployable checkpoint
- Optionally quantize (AWQ/GPTQ/GGUF)
- Serve with vLLM or llama.cpp/Ollama
