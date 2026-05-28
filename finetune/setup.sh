#!/usr/bin/env bash
# finetune/setup.sh — bootstrap a fresh GPU box for VerseLink fine-tuning
#
# What it does:
#   1. Verifies Python 3.10+, pip, and nvidia-smi are present
#   2. Reports GPU model and VRAM
#   3. Creates a Python venv at finetune/.venv
#   4. Installs PyTorch with the correct CUDA wheel URL (auto-detected)
#   5. Installs Unsloth (detects torch version at install time)
#   6. Installs everything else from requirements.txt
#
# Run from the repo root:
#   bash finetune/setup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
REQUIREMENTS="$SCRIPT_DIR/requirements.txt"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }

echo ""
echo "════════════════════════════════════════════════════════════"
echo " VerseLink fine-tuning environment setup"
echo "════════════════════════════════════════════════════════════"
echo ""

# ── 1. Python ────────────────────────────────────────────────────────────────
echo "[ Python ]"
if ! command -v python3 &>/dev/null; then
    fail "python3 not found. Install Python 3.10+ and re-run."
fi

PY_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)

if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]; }; then
    fail "Python $PY_VERSION found, but 3.10+ is required. Install a newer Python."
fi
ok "Python $PY_VERSION"

# ── 2. pip ───────────────────────────────────────────────────────────────────
echo ""
echo "[ pip ]"
if ! python3 -m pip --version &>/dev/null; then
    fail "pip not found. Run: python3 -m ensurepip --upgrade"
fi
PIP_VERSION=$(python3 -m pip --version | awk '{print $2}')
ok "pip $PIP_VERSION"

# ── 3. GPU / CUDA ─────────────────────────────────────────────────────────────
echo ""
echo "[ GPU ]"
if ! command -v nvidia-smi &>/dev/null; then
    fail "nvidia-smi not found. No NVIDIA GPU detected or drivers not installed.
    Fine-tuning a 27B model requires a CUDA GPU with >= 24 GB VRAM."
fi

nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader \
    | while IFS=',' read -r name mem driver; do
        ok "GPU: $name | VRAM: $mem | Driver: $driver"
    done

# Extract CUDA version from nvidia-smi header
CUDA_VERSION=$(nvidia-smi | grep -oP "CUDA Version: \K[0-9]+\.[0-9]+" || echo "")
if [ -z "$CUDA_VERSION" ]; then
    fail "Could not detect CUDA version from nvidia-smi output."
fi

CUDA_MAJOR=$(echo "$CUDA_VERSION" | cut -d. -f1)
CUDA_MINOR=$(echo "$CUDA_VERSION" | cut -d. -f2)
ok "CUDA $CUDA_VERSION"

# Pick the matching PyTorch CUDA wheel tag
if   [ "$CUDA_MAJOR" -ge 12 ] && [ "$CUDA_MINOR" -ge 4 ]; then
    TORCH_CUDA_TAG="cu124"
elif [ "$CUDA_MAJOR" -ge 12 ] && [ "$CUDA_MINOR" -ge 1 ]; then
    TORCH_CUDA_TAG="cu121"
elif [ "$CUDA_MAJOR" -eq 11 ] && [ "$CUDA_MINOR" -ge 8 ]; then
    TORCH_CUDA_TAG="cu118"
else
    fail "CUDA $CUDA_VERSION is too old. Minimum supported: CUDA 11.8.
    Update your GPU drivers: https://developer.nvidia.com/cuda-downloads"
fi

TORCH_INDEX_URL="https://download.pytorch.org/whl/${TORCH_CUDA_TAG}"
ok "PyTorch wheel target: torch==2.4.1+${TORCH_CUDA_TAG}"

# ── 4. Create venv ────────────────────────────────────────────────────────────
echo ""
echo "[ Virtual environment ]"
if [ -d "$VENV_DIR" ]; then
    warn "Venv already exists at $VENV_DIR — skipping creation."
else
    python3 -m venv "$VENV_DIR"
    ok "Created venv: $VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
ok "Activated venv"

# Upgrade pip inside venv
python -m pip install --upgrade pip --quiet
ok "pip upgraded"

# ── 5. Install PyTorch (CUDA-specific wheel) ──────────────────────────────────
echo ""
echo "[ Installing PyTorch 2.4.1+${TORCH_CUDA_TAG} ]"
echo "  (downloading from $TORCH_INDEX_URL — may take several minutes)"

pip install \
    "torch==2.4.1" \
    "torchvision==0.19.1" \
    --index-url "$TORCH_INDEX_URL" \
    --quiet

# Confirm CUDA is visible to torch
TORCH_CUDA=$(python -c "import torch; print(torch.cuda.is_available())")
if [ "$TORCH_CUDA" != "True" ]; then
    fail "torch.cuda.is_available() returned False after install.
    This usually means the wrong wheel was installed or the driver is mismatched.
    Try: pip install torch --index-url $TORCH_INDEX_URL"
fi
ok "torch.cuda.is_available() = True"

# ── 6. Install Unsloth ────────────────────────────────────────────────────────
echo ""
echo "[ Installing Unsloth ]"
# Unsloth inspects the torch version already in the environment to choose the
# right CUDA kernel variant, so torch must be installed first.
pip install "unsloth==2025.5.1" --quiet \
    || { warn "Exact version 2025.5.1 unavailable — falling back to latest stable."
         pip install unsloth --quiet; }
ok "Unsloth installed"

# ── 7. Install remaining dependencies ────────────────────────────────────────
echo ""
echo "[ Installing remaining dependencies from requirements.txt ]"
# --upgrade ensures any package already installed gets pinned to the version
# in requirements.txt. torch is already installed so this will be a no-op for it.
pip install -r "$REQUIREMENTS" --upgrade --quiet
ok "All dependencies installed"

# ── 8. Smoke test ─────────────────────────────────────────────────────────────
echo ""
echo "[ Smoke test ]"
python - <<'EOF'
import torch
from unsloth import FastLanguageModel  # noqa: F401 — just checking import
from trl import SFTTrainer             # noqa: F401
print(f"  torch:            {torch.__version__}")
print(f"  cuda available:   {torch.cuda.is_available()}")
if torch.cuda.is_available():
    props = torch.cuda.get_device_properties(0)
    print(f"  GPU:              {props.name}")
    print(f"  VRAM:             {props.total_memory / 1e9:.1f} GB")
    print(f"  BF16 supported:   {torch.cuda.is_bf16_supported()}")
import transformers, trl, peft, bitsandbytes
print(f"  transformers:     {transformers.__version__}")
print(f"  trl:              {trl.__version__}")
print(f"  peft:             {peft.__version__}")
print(f"  bitsandbytes:     {bitsandbytes.__version__}")
EOF

ok "Smoke test passed"

echo ""
echo "════════════════════════════════════════════════════════════"
echo " Setup complete."
echo ""
echo " Next steps:"
echo "   1. Activate the venv:    source finetune/.venv/bin/activate"
echo "   2. Log in to HuggingFace (required for gated Gemma 3 model):"
echo "      huggingface-cli login"
echo "   3. Start training:       See finetune/RUNBOOK.md"
echo "════════════════════════════════════════════════════════════"
echo ""
