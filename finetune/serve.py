#!/usr/bin/env python3
"""
finetune/serve.py — OpenAI-compatible inference server for the fine-tuned Gemma.

Serves the QLoRA model produced by finetune-gemma.py behind a single endpoint,
`POST /v1/chat/completions`, that mimics enough of the OpenAI Chat Completions
API for the VerseLink `/api/ask` route to talk to it (it reads
`choices[0].message.content` for non-stream, and `choices[0].delta.content`
for stream). Point `SELFHOST_URL` at `http://THIS_BOX:8000/v1/chat/completions`.

What this teaches (ML concepts):
  - Token streaming: an autoregressive LLM produces one token at a time. Instead
    of waiting for the whole sequence, we hand each token to the client the
    instant it's decoded. `TextIteratorStreamer` runs `model.generate()` on a
    background thread and yields decoded text as it appears — so time-to-first-
    token (TTFT) is ~one forward pass, not the full generation.
  - Server-Sent Events (SSE): a dead-simple one-way stream over plain HTTP. Each
    message is `data: <json>\n\n`; the stream ends with the sentinel
    `data: [DONE]\n\n`. This is exactly the wire format OpenAI uses for
    `stream: true`, which is why the browser and the Next.js route can reuse the
    same parser.

Run on the GPU box (inside the training venv, model already trained):
    source finetune/.venv/bin/activate
    SELFHOST_API_KEY=your-shared-secret python finetune/serve.py

Env vars:
    SELFHOST_MODEL_DIR  path to the LoRA (or merged) model dir
                        (default: finetune/output/verselink-lora)
    SELFHOST_API_KEY    if set, requests must send `Authorization: Bearer <it>`
    HOST                bind host (default: 0.0.0.0)
    PORT                bind port (default: 8000)
    MAX_SEQ_LEN         tokenizer/model max sequence length (default: 4096)
"""

import json
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import torch
from unsloth import FastLanguageModel
from transformers import TextIteratorStreamer

# ── Config ────────────────────────────────────────────────────────────────────
REPO_ROOT   = Path(__file__).parent.parent
MODEL_DIR   = os.environ.get("SELFHOST_MODEL_DIR", str(Path(__file__).parent / "output" / "verselink-lora"))
API_KEY     = os.environ.get("SELFHOST_API_KEY")  # optional shared secret
HOST        = os.environ.get("HOST", "0.0.0.0")
PORT        = int(os.environ.get("PORT", "8000"))
MAX_SEQ_LEN = int(os.environ.get("MAX_SEQ_LEN", "4096"))

DEFAULT_MAX_NEW_TOKENS = 400   # matches the self-host cap in app/api/ask/route.ts
DEFAULT_TEMPERATURE    = 0.7

# ── Load the model once at startup (not per request) ──────────────────────────
print(f"Loading model from {MODEL_DIR} (4-bit)…", flush=True)
model, tokenizer = FastLanguageModel.from_pretrained(
    MODEL_DIR,
    max_seq_length=MAX_SEQ_LEN,
    load_in_4bit=True,
)
FastLanguageModel.for_inference(model)   # 2x faster inference path in Unsloth
print("Model ready.", flush=True)


def build_inputs(messages):
    """Turn OpenAI-style messages into model input ids using the chat template.

    The chat template is the exact token layout the model was trained on
    (<start_of_turn>user … <end_of_turn> …). `add_generation_prompt=True` appends
    the opening <start_of_turn>model marker so the model knows to start answering.
    """
    return tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
    ).to(model.device)


def openai_chunk(completion_id, model_id, delta=None, finish_reason=None):
    """One `chat.completion.chunk` object in OpenAI's streaming shape."""
    return {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model_id,
        "choices": [{
            "index": 0,
            "delta": delta or {},
            "finish_reason": finish_reason,
        }],
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # Quieter logs: one line per request, no default noisy formatting.
    def log_message(self, fmt, *args):
        print(f"[serve] {self.address_string()} {fmt % args}", flush=True)

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        if not API_KEY:
            return True
        auth = self.headers.get("Authorization", "")
        return auth == f"Bearer {API_KEY}"

    def do_GET(self):
        # Lightweight readiness probe for load balancers / manual curl.
        if self.path == "/health":
            self._json(200, {"status": "ok", "model_dir": MODEL_DIR})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/v1/chat/completions":
            self._json(404, {"error": "not found"})
            return
        if not self._authorized():
            self._json(401, {"error": "unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._json(400, {"error": "invalid JSON"})
            return

        messages = body.get("messages")
        if not messages:
            self._json(400, {"error": "messages is required"})
            return

        model_id    = body.get("model", "verselink-gemma")
        max_tokens  = int(body.get("max_tokens") or DEFAULT_MAX_NEW_TOKENS)
        temperature = float(body.get("temperature", DEFAULT_TEMPERATURE))
        stream      = bool(body.get("stream", False))

        try:
            input_ids = build_inputs(messages)
        except Exception as e:  # bad message shape, template error, etc.
            self._json(400, {"error": f"could not build prompt: {e}"})
            return

        gen_kwargs = dict(
            input_ids=input_ids,
            max_new_tokens=max_tokens,
            temperature=temperature,
            do_sample=temperature > 0,
            use_cache=True,
        )

        if stream:
            self._handle_stream(model_id, gen_kwargs)
        else:
            self._handle_blocking(model_id, gen_kwargs, input_ids)

    # ── Non-streaming: generate fully, return one JSON completion ──────────────
    def _handle_blocking(self, model_id, gen_kwargs, input_ids):
        try:
            with torch.no_grad():
                output_ids = model.generate(**gen_kwargs)
            # Only decode the newly generated tokens, not the echoed prompt.
            new_tokens = output_ids[0][input_ids.shape[-1]:]
            text = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
        except Exception as e:
            self._json(500, {"error": f"generation failed: {e}"})
            return

        self._json(200, {
            "id": f"chatcmpl-{uuid.uuid4().hex}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model_id,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }],
            "usage": {
                "prompt_tokens": int(input_ids.shape[-1]),
                "completion_tokens": int(new_tokens.shape[-1]),
                "total_tokens": int(input_ids.shape[-1] + new_tokens.shape[-1]),
            },
        })

    # ── Streaming: emit OpenAI-style SSE chunks as tokens are decoded ──────────
    def _handle_stream(self, model_id, gen_kwargs):
        completion_id = f"chatcmpl-{uuid.uuid4().hex}"

        # No Content-Length: the body ends when we close the connection. SSE with
        # `Connection: close` is the simplest reliable framing for a stdlib server.
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        def send(obj):
            self.wfile.write(f"data: {json.dumps(obj)}\n\n".encode("utf-8"))
            self.wfile.flush()

        # skip_prompt=True → the streamer yields only the model's answer tokens.
        streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
        gen_kwargs = dict(gen_kwargs, streamer=streamer)

        def run_generation():
            with torch.no_grad():
                model.generate(**gen_kwargs)

        thread = Thread(target=run_generation, daemon=True)
        thread.start()

        try:
            # First chunk carries the role, per the OpenAI streaming convention.
            send(openai_chunk(completion_id, model_id, delta={"role": "assistant"}))
            for piece in streamer:
                if piece:
                    send(openai_chunk(completion_id, model_id, delta={"content": piece}))
            # Terminal chunk + SSE sentinel.
            send(openai_chunk(completion_id, model_id, delta={}, finish_reason="stop"))
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            # Client (the /api/ask route) hung up mid-stream — stop quietly.
            print("[serve] client disconnected mid-stream", flush=True)
        finally:
            thread.join(timeout=1.0)


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Serving on http://{HOST}:{PORT}  (POST /v1/chat/completions, GET /health)", flush=True)
    if API_KEY:
        print("Auth: Bearer token required (SELFHOST_API_KEY is set).", flush=True)
    else:
        print("Auth: OPEN — set SELFHOST_API_KEY to require a bearer token.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.", flush=True)
        server.shutdown()


if __name__ == "__main__":
    main()
