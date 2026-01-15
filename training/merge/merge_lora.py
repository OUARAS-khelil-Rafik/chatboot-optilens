import argparse
import os

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--base", required=True, help="Base model name or path (e.g., Qwen/Qwen2.5-7B-Instruct)")
    p.add_argument("--adapter", required=True, help="LoRA adapter directory")
    p.add_argument("--out", required=True, help="Output directory for merged model")
    p.add_argument("--dtype", default="bfloat16", choices=["float16", "bfloat16", "float32"])
    args = p.parse_args()

    dtype_map = {
        "float16": torch.float16,
        "bfloat16": torch.bfloat16,
        "float32": torch.float32,
    }
    torch_dtype = dtype_map[args.dtype]

    os.makedirs(args.out, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)

    model = AutoModelForCausalLM.from_pretrained(
        args.base,
        torch_dtype=torch_dtype,
        device_map="auto",
        trust_remote_code=True,
    )

    model = PeftModel.from_pretrained(model, args.adapter)

    merged = model.merge_and_unload()

    merged.save_pretrained(args.out, safe_serialization=True)
    tokenizer.save_pretrained(args.out)

    print(f"Merged model written to: {args.out}")


if __name__ == "__main__":
    main()
