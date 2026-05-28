#!/usr/bin/env python3
"""
finetune/finetune-gemma.py — VerseLink SFT: Gemma 3 27B + QLoRA via Unsloth

What this script teaches (ML concepts embedded below):
  - QLoRA: fine-tune a frozen 4-bit model by training only tiny low-rank adapter
    matrices. You get 95%+ of full fine-tune quality at ~15% of the VRAM cost.
  - Completion-only loss: only backpropagate through the assistant's answer tokens,
    not the system prompt or user question. The model learns to respond, not regurgitate.
  - Chat template: the exact token sequence the model was pre-trained on (e.g.
    <start_of_turn>user\n...<end_of_turn>\n<start_of_turn>model\n...) — deviating
    from it during SFT causes the model to ignore the template at inference.

Run from the repo root:
    python finetune/finetune-gemma.py
Or with nohup to survive SSH disconnect:
    nohup python finetune/finetune-gemma.py > finetune/train.log 2>&1 &
"""

import os
import sys
import torch
from pathlib import Path
from datasets import load_dataset
from transformers import TrainingArguments
from trl import SFTTrainer, SFTConfig
from unsloth import FastLanguageModel
from unsloth.chat_templates import train_on_responses_only

# ── Paths ─────────────────────────────────────────────────────────────────────
REPO_ROOT  = Path(__file__).parent.parent
DATA_DIR   = REPO_ROOT / "data" / "training"
TRAIN_FILE = str(DATA_DIR / "verselink-sft-train.jsonl")
VAL_FILE   = str(DATA_DIR / "verselink-sft-val.jsonl")

OUTPUT_DIR = Path(__file__).parent / "output" / "verselink-lora"
MERGED_DIR = Path(__file__).parent / "output" / "verselink-gemma-merged"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
MERGED_DIR.mkdir(parents=True, exist_ok=True)

# ── Model config ──────────────────────────────────────────────────────────────
MODEL_ID      = "google/gemma-3-27b-it"
MAX_SEQ_LEN   = 4096
LOAD_IN_4BIT  = True    # QLoRA — quantize base model to 4-bit, train adapters only

# ── QLoRA config ──────────────────────────────────────────────────────────────
# Low-rank decomposition: each weight matrix W is approximated as W + A·B where
# A is (d × r) and B is (r × d) with r=16. Only A and B are trained.
# alpha=32 is the scaling factor (effectively sets initial LR for adapter layers).
# Rule of thumb: alpha = 2 × r is a safe default.
LORA_R       = 16
LORA_ALPHA   = 32
# Target all attention projections and MLP projections — covering every linear
# layer that transforms representations. Leaving any out reduces adapter coverage.
LORA_TARGETS = [
    "q_proj", "k_proj", "v_proj", "o_proj",   # attention
    "gate_proj", "up_proj", "down_proj",        # MLP / feed-forward
]

# ── Training hyperparameters ──────────────────────────────────────────────────
EPOCHS          = 3
PER_DEVICE_BS   = 2
GRAD_ACCUM      = 4       # effective batch size = 2 × 4 = 8
LEARNING_RATE   = 2e-4
WARMUP_RATIO    = 0.03
EVAL_STEPS      = 25
SAVE_STEPS      = 25
SEED            = 42

# ── Step 1: Load model in 4-bit ───────────────────────────────────────────────
print(f"\n{'─'*60}")
print(f"Loading {MODEL_ID} in 4-bit...")
print(f"{'─'*60}\n")

# FastLanguageModel wraps Hugging Face's from_pretrained + applies bitsandbytes
# 4-bit NF4 quantization automatically. It also patches attention to use FlashAttention-2
# when available, and adds Unsloth's custom CUDA kernels for faster backward passes.
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_ID,
    max_seq_length=MAX_SEQ_LEN,
    dtype=None,          # auto: BF16 on Ampere+, FP16 on older GPUs
    load_in_4bit=LOAD_IN_4BIT,
)

# ── Step 2: Attach QLoRA adapters ────────────────────────────────────────────
# This freezes all base model weights and injects trainable A/B matrices into
# each of the target linear layers. VRAM for the base model stays at ~13.5 GB;
# only the ~300 MB of adapter parameters are trained.
model = FastLanguageModel.get_peft_model(
    model,
    r=LORA_R,
    lora_alpha=LORA_ALPHA,
    target_modules=LORA_TARGETS,
    lora_dropout=0,          # 0 dropout for QLoRA is standard (Dettmers et al.)
    bias="none",
    use_gradient_checkpointing="unsloth",  # Unsloth's gradient checkpointing
    random_state=SEED,
)

adapter_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
total_params   = sum(p.numel() for p in model.parameters())
print(f"Trainable params: {adapter_params:,} / {total_params:,} "
      f"({100 * adapter_params / total_params:.2f}%)\n")

# ── Step 3: Load and format datasets ─────────────────────────────────────────
print("Loading datasets...")

train_ds = load_dataset("json", data_files=TRAIN_FILE, split="train")
val_ds   = load_dataset("json", data_files=VAL_FILE,   split="train")
print(f"  Train: {len(train_ds)} examples")
print(f"  Val:   {len(val_ds)} examples\n")

# Apply the Gemma 3 chat template to convert the messages list into a single
# string the tokenizer can process. Gemma 3's template produces:
#   <bos><start_of_turn>system\n{sys}<end_of_turn>\n
#         <start_of_turn>user\n{user}<end_of_turn>\n
#         <start_of_turn>model\n{assistant}<end_of_turn>\n
#
# add_generation_prompt=False because this is training data — we include the
# full assistant response. At inference time, set it to True so the model
# knows it should generate after <start_of_turn>model\n.
def apply_template(batch):
    texts = []
    for messages in batch["messages"]:
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
        texts.append(text)
    return {"text": texts}

train_ds = train_ds.map(apply_template, batched=True)
val_ds   = val_ds.map(apply_template,   batched=True)

# ── Step 4: Configure trainer ─────────────────────────────────────────────────
print("Configuring trainer...")

# Steps per epoch (for reference in logs):
steps_per_epoch = len(train_ds) // (PER_DEVICE_BS * GRAD_ACCUM)
total_steps     = steps_per_epoch * EPOCHS
print(f"  Steps/epoch: ~{steps_per_epoch}  |  Total steps: ~{total_steps}\n")

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=train_ds,
    eval_dataset=val_ds,
    args=SFTConfig(
        dataset_text_field="text",
        max_seq_length=MAX_SEQ_LEN,
        packing=False,            # don't pack multiple short examples into one sequence
        dataset_num_proc=2,       # parallel tokenization workers
        per_device_train_batch_size=PER_DEVICE_BS,
        gradient_accumulation_steps=GRAD_ACCUM,
        num_train_epochs=EPOCHS,
        learning_rate=LEARNING_RATE,
        warmup_ratio=WARMUP_RATIO,
        # Use BF16 on Ampere+ (A6000 supports it); fall back to FP16
        bf16=torch.cuda.is_bf16_supported(),
        fp16=not torch.cuda.is_bf16_supported(),
        logging_steps=10,
        eval_strategy="steps",
        eval_steps=EVAL_STEPS,
        save_strategy="steps",
        save_steps=SAVE_STEPS,
        save_total_limit=3,
        load_best_model_at_end=True,   # restore best checkpoint by eval_loss
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        output_dir=str(OUTPUT_DIR),
        optim="adamw_8bit",        # 8-bit AdamW keeps optimizer states in 8-bit → saves ~6 GB
        weight_decay=0.01,
        lr_scheduler_type="linear",
        seed=SEED,
        report_to="none",          # disable W&B / TensorBoard unless you add them
    ),
)

# ── Step 5: Completion-only loss ──────────────────────────────────────────────
# Mask all token positions except the model's response so the loss is only
# computed on what we want the model to learn to produce. Without this, the
# model wastes capacity learning to copy the system prompt verbatim.
trainer = train_on_responses_only(
    trainer,
    instruction_part="<start_of_turn>user\n",    # mask everything up to here
    response_part="<start_of_turn>model\n",       # compute loss from here onward
)

# ── Step 6: Train ─────────────────────────────────────────────────────────────
print(f"\n{'═'*60}")
print("Starting training...")
print(f"{'═'*60}\n")

trainer.train()

# ── Step 7: Loss summary ──────────────────────────────────────────────────────
print(f"\n{'─'*60}")
print("Per-epoch loss summary")
print(f"{'─'*60}")

epoch_train: dict[int, float] = {}
epoch_eval:  dict[int, float] = {}
for log in trainer.state.log_history:
    ep = int(log.get("epoch", 0))
    if "loss" in log:
        epoch_train[ep] = log["loss"]
    if "eval_loss" in log:
        epoch_eval[ep] = log["eval_loss"]

print(f"  {'Epoch':<8} {'Train loss':<14} {'Val loss'}")
for ep in sorted(epoch_train):
    train_l = f"{epoch_train[ep]:.4f}"
    eval_l  = f"{epoch_eval[ep]:.4f}" if ep in epoch_eval else "—"
    print(f"  {ep:<8} {train_l:<14} {eval_l}")

# ── Step 8: Save LoRA adapters ────────────────────────────────────────────────
print(f"\nSaving LoRA adapters → {OUTPUT_DIR}")
model.save_pretrained(str(OUTPUT_DIR))
tokenizer.save_pretrained(str(OUTPUT_DIR))
print("  Done.")

# ── Step 9: Merge and save full 16-bit model ──────────────────────────────────
# Merges the LoRA adapters back into the base weights and saves as BF16 safetensors.
# This is ~55 GB on disk and is what you deploy to an inference server.
# Skip with --skip-merge if disk space is tight; load base + LoRA at inference instead.
if "--skip-merge" not in sys.argv:
    print(f"\nMerging adapters into 16-bit model → {MERGED_DIR}")
    print("  (this may take 10–15 minutes and ~55 GB disk space)")
    model.save_pretrained_merged(
        str(MERGED_DIR),
        tokenizer,
        save_method="merged_16bit",
    )
    print("  Done.")
else:
    print("\nSkipped merge (--skip-merge flag). Deploy with base model + LoRA adapters.")

# ── Step 10: VRAM report ──────────────────────────────────────────────────────
if torch.cuda.is_available():
    used_gb  = torch.cuda.max_memory_allocated() / 1e9
    total_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
    print(f"\nVRAM peak: {used_gb:.1f} GB used / {total_gb:.1f} GB total "
          f"({100 * used_gb / total_gb:.0f}%)")

print(f"\n{'═'*60}")
print("Training complete.")
print(f"  LoRA adapters : {OUTPUT_DIR}")
if "--skip-merge" not in sys.argv:
    print(f"  Merged model  : {MERGED_DIR}")
print(f"{'═'*60}\n")
