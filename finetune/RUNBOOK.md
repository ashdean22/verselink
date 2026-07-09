# VerseLink Fine-Tuning Runbook

Step-by-step guide for SSH'd into a fresh GPU box. Assumes no prior ML infrastructure.

---

## What to Expect

| | Estimate |
|---|---|
| **GPU** | RTX A6000 48 GB |
| **Peak VRAM** | ~22 GB (4-bit base + QLoRA adapters + optimizer + activations) |
| **Training time** | 1.5 – 2.5 hours (751 pairs × 3 epochs, ~240 optimizer steps) |
| **Disk space needed** | ~160 GB total: base model download (55 GB) + LoRA output (400 MB) + merged 16-bit model (55 GB) + OS/Python overhead |
| **Internet required** | Yes, for initial Hugging Face model download. The 27B model is ~55 GB. |

If disk is tight (< 150 GB free), pass `--skip-merge` to the training script and skip writing the merged model. You can always merge later on a machine with more space.

---

## Step 0 — Prerequisites (do this on your local machine)

You need:
- SSH access to the GPU box (IP address + key or password)
- The VerseLink repo checked out locally

### Accept the Gemma 3 license on Hugging Face

Gemma 3 is a gated model. You must accept the terms **before** training, or the download will fail.

1. Go to: https://huggingface.co/google/gemma-3-27b-it
2. Click **"Agree and access repository"**
3. Create a Hugging Face access token at: https://huggingface.co/settings/tokens
4. Keep the token handy — you'll need it in Step 3.

---

## Step 1 — Copy the repo to the GPU box

**Option A — git clone (recommended if the box has internet access):**
```bash
ssh your-user@YOUR_BOX_IP
git clone https://github.com/YOUR_USERNAME/verselink.git
cd verselink
```

**Option B — scp from your local machine:**
```bash
# Run this on your LOCAL machine (not the GPU box)
scp -r /Users/ashdean/verselink your-user@YOUR_BOX_IP:~/verselink
```

Then SSH in:
```bash
ssh your-user@YOUR_BOX_IP
cd ~/verselink
```

### Verify the training data is present

```bash
wc -l data/training/verselink-sft-train.jsonl
wc -l data/training/verselink-sft-val.jsonl
```

**Expected output:**
```
638 data/training/verselink-sft-train.jsonl
 75 data/training/verselink-sft-val.jsonl
```

If those files are missing, the training data generation didn't complete — see the project README.

---

## Step 2 — Run environment setup

```bash
bash finetune/setup.sh
```

This script (5–10 minutes):
- Checks Python 3.10+, pip, and GPU drivers
- Reports your GPU model and VRAM
- Creates a Python venv at `finetune/.venv`
- Installs PyTorch with the correct CUDA wheel (auto-detected)
- Installs all other dependencies from `requirements.txt`
- Runs a smoke test

### What success looks like

```
════════════════════════════════════════════════════════════
 Setup complete.
...
  ✓ Smoke test passed
```

The smoke test will also print:
```
  GPU:              NVIDIA RTX A6000
  VRAM:             48.7 GB
  BF16 supported:   True
```

### If setup fails

| Error | Fix |
|-------|-----|
| `python3 not found` | `sudo apt install python3 python3-venv python3-pip` |
| `nvidia-smi not found` | GPU drivers not installed. Contact your box provider. |
| `torch.cuda.is_available() = False` | Driver/CUDA mismatch. Re-run after updating drivers. |
| Exact unsloth version unavailable | setup.sh auto-falls back to latest stable — proceed normally. |

---

## Step 3 — Log in to Hugging Face

The Gemma 3 model is gated — the download will fail without authentication.

```bash
source finetune/.venv/bin/activate
huggingface-cli login
```

Paste the token you created in Step 0 when prompted. Press Enter.

**Success looks like:**
```
Login successful
Your token has been saved to /home/your-user/.cache/huggingface/token
```

---

## Step 4 — Start training

Always use `tmux` or `nohup` so training survives an SSH disconnect. If the terminal closes mid-run without this, training stops.

### Option A — tmux (recommended, lets you re-attach later)

```bash
# Install tmux if needed
sudo apt install tmux -y

# Start a named session
tmux new-session -s verselink

# Inside tmux, activate the venv and start training
source finetune/.venv/bin/activate
python finetune/finetune-gemma.py 2>&1 | tee finetune/train.log
```

To detach from tmux without stopping training: press `Ctrl+B`, then `D`.

To re-attach later: `tmux attach -t verselink`

### Option B — nohup (simpler, no re-attach)

```bash
source finetune/.venv/bin/activate
nohup python finetune/finetune-gemma.py > finetune/train.log 2>&1 &
echo "Training PID: $!"
```

The `&` sends it to the background. You can now close your SSH terminal.

---

## Step 5 — Monitor training

### Watch the log

```bash
tail -f finetune/train.log
```

You'll see output like:
```
Loading google/gemma-3-27b-it in 4-bit...
Trainable params: 309,329,920 / 27,227,545,600 (1.14%)

Loading datasets...
  Train: 638 examples
  Val:   75 examples

Starting training...
{'loss': 1.4821, 'learning_rate': 1.8e-4, 'epoch': 0.25, 'step': 20}
{'loss': 1.2103, 'eval_loss': 1.1876, 'epoch': 0.31, 'step': 25}
```

Loss should decrease across epochs. A final val loss around 0.8–1.2 is good for this task.

### Watch GPU utilization

In a second terminal (or second tmux pane):
```bash
watch -n 5 nvidia-smi
```

You should see ~95–100% GPU-Util and ~20–26 GB VRAM used. If GPU-Util is near 0%, training has stalled or errored.

### Checkpoints saved as training runs

Every 25 steps, the trainer saves a checkpoint:
```
finetune/output/verselink-lora/checkpoint-25/
finetune/output/verselink-lora/checkpoint-50/
...
```

The best checkpoint (lowest val loss) is automatically restored at the end.

---

## Step 6 — Retrieve the trained model

Training produces two outputs:

| Path | Size | Use case |
|------|------|----------|
| `finetune/output/verselink-lora/` | ~400 MB | Deploy alongside base model (lower disk cost) |
| `finetune/output/verselink-gemma-merged/` | ~55 GB | Standalone deployment, GGUF conversion |

### Copy back to your local machine

```bash
# From your LOCAL machine:

# LoRA adapters only (small, fast)
scp -r your-user@YOUR_BOX_IP:~/verselink/finetune/output/verselink-lora ./finetune/output/

# Or the merged model (large)
scp -r your-user@YOUR_BOX_IP:~/verselink/finetune/output/verselink-gemma-merged ./finetune/output/
```

### Or push directly to Hugging Face

```bash
# Inside the GPU box, with venv activated:
python - <<'EOF'
from huggingface_hub import HfApi
api = HfApi()
api.create_repo("YOUR_HF_USERNAME/verselink-gemma-lora", exist_ok=True)
api.upload_folder(
    folder_path="finetune/output/verselink-lora",
    repo_id="YOUR_HF_USERNAME/verselink-gemma-lora",
)
print("Uploaded!")
EOF
```

---

## Step 7 — Verify the trained model

Quick sanity check before calling training done:

```bash
source finetune/.venv/bin/activate
python - <<'EOF'
from unsloth import FastLanguageModel

model, tokenizer = FastLanguageModel.from_pretrained(
    "finetune/output/verselink-lora",
    max_seq_length=512,
    load_in_4bit=True,
)
FastLanguageModel.for_inference(model)

messages = [
    {"role": "system", "content": "You are a Bible study assistant."},
    {"role": "user",   "content": "What does Scripture say about anxiety?"},
]
inputs = tokenizer.apply_chat_template(
    messages, tokenize=True, add_generation_prompt=True, return_tensors="pt"
).to("cuda")

outputs = model.generate(input_ids=inputs, max_new_tokens=200, temperature=0.7)
print(tokenizer.decode(outputs[0], skip_special_tokens=True))
EOF
```

**Success:** The model returns a warm, grounded answer citing specific verses — not generic text.

---

## Step 8 — Serve the model with streaming (`serve.py`)

`finetune/serve.py` is an OpenAI-compatible inference server with **SSE token
streaming**. It exposes `POST /v1/chat/completions` (and `GET /health`), which
is exactly what the VerseLink `/api/ask` route talks to.

```bash
source finetune/.venv/bin/activate

# Require a bearer token (recommended if the box is internet-reachable):
SELFHOST_API_KEY=some-long-random-secret python finetune/serve.py
```

It loads the LoRA from `finetune/output/verselink-lora` by default; override with
`SELFHOST_MODEL_DIR` (e.g. point at `verselink-gemma-merged`). Bind host/port via
`HOST`/`PORT` (defaults `0.0.0.0:8000`).

### Smoke-test streaming

```bash
# Non-streaming (one JSON blob):
curl -s http://localhost:8000/v1/chat/completions \
  -H 'Authorization: Bearer some-long-random-secret' \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"What does Scripture say about anxiety?"}]}'

# Streaming (watch tokens arrive as `data:` lines, ending with data: [DONE]):
curl -N http://localhost:8000/v1/chat/completions \
  -H 'Authorization: Bearer some-long-random-secret' \
  -H 'Content-Type: application/json' \
  -d '{"stream":true,"messages":[{"role":"user","content":"What does Scripture say about anxiety?"}]}'
```

### Point the app at it

In `.env.local` (see `env.example`):

```bash
GENERATION_MODEL=selfhost:verselink-gemma
SELFHOST_URL=http://YOUR-GPU-BOX:8000/v1/chat/completions
SELFHOST_API_KEY=some-long-random-secret
```

With those set, the `/ask` page renders the answer **token-by-token** as the
fine-tune generates it (the route forwards the stream as SSE). If the self-host
call fails, `/api/ask` falls back to Claude and returns the answer as one chunk.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `CUDA out of memory` | Batch too large or seq_len too long | Reduce `PER_DEVICE_BS` to 1 in `finetune-gemma.py` |
| `OSError: google/gemma-3-27b-it is not a local folder and is not a valid model identifier` | Not logged in to HF, or license not accepted | Redo Step 3 |
| `ValueError: ... tool_calls` or JSON errors at start | Wrong data format | Verify `data/training/verselink-sft-train.jsonl` has `messages` field |
| Loss stays flat at 2.0+ | Completion-only masking issue | Check that `<start_of_turn>model\n` tokens appear in your formatted examples |
| `ImportError: cannot import name 'train_on_responses_only'` | Unsloth version too old | `pip install --upgrade unsloth` |
| Training stops after re-SSH | Used `&` without nohup, or tmux session died | Use tmux; restart from latest checkpoint (auto-detected) |
| Merged model save fails with OOM | Not enough CPU RAM for CPU-offloaded merge | Add `--skip-merge` flag; merge separately |

---

## What's next after training

1. **Convert to GGUF** for efficient CPU/low-VRAM inference:
   ```bash
   pip install llama-cpp-python
   # or use: https://github.com/ggerganov/llama.cpp convert scripts
   ```

2. **Deploy the LoRA on DeepInfra** — upload the merged model to HF, then point DeepInfra at your HF model ID. Update `DEEPINFRA_API_KEY` routing in `app/api/ask/route.ts`.

3. **Run the eval** to measure improvement vs. the base Gemma 3 27B:
   ```bash
   # From the VerseLink repo root, with dev server running:
   BENCHMARK_MODEL="deepinfra:YOUR_HF_USERNAME/verselink-gemma-merged" \
   BENCHMARK_OUT="evals/results/finetuned-gemma.json" \
   npx tsx scripts/baseline-benchmark.ts
   ```

4. **Compare**: quality, faithfulness, latency vs. `evals/results/gemma-hot.json` (base model).
