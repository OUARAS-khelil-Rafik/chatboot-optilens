# Merge LoRA adapter -> merged model

After QLoRA training you typically have:
- Base model: `Qwen/Qwen2.5-7B-Instruct` (or your chosen base)
- LoRA adapter directory (output from your trainer)

This folder provides a small Python script to merge the adapter into the base model.

## Files
- `merge_lora.py`
- `requirements.txt`

## Usage

On your GPU machine:

1) Create env and install deps:
- `python -m venv .venv && source .venv/bin/activate`
- `pip install -r training/merge/requirements.txt`

2) Merge:
- `python training/merge/merge_lora.py \
    --base Qwen/Qwen2.5-7B-Instruct \
    --adapter /path/to/lora-adapter \
    --out /path/to/merged-model`

Notes:
- Merging requires loading the base weights. Do this on a machine with enough disk and (ideally) GPU.
- If you serve via vLLM, use the merged directory for `--model`.
