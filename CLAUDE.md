# CLAUDE.md — Standing Instructions for VerseLink

This file is read automatically by Claude Code every session. It defines who I am, what we're building, and how you (Claude Code) should work with me.

---

## Operating Mode: AUTONOMOUS

Execute each day's tasks end-to-end without pausing for confirmation between tasks. **Only stop when you need something from me:**

1. **An API key** — pause, tell me which key (e.g. `GEMINI_API_KEY`), and the exact line to add to `.env.local`. I'll paste and tell you to continue.
2. **An account signup** — pause, tell me which dashboard to visit and what to click. I'll do it and tell you to continue.
3. **Physical testing** — Day 6 voice calls require a real phone. Day 7 requires me to authorize the Vercel deploy in my browser.
4. **A destructive action** — never delete files, drop tables, or force-push without asking first.

For everything else: scaffold, write code, run scripts, install packages, run migrations, generate test data, run evals — just do it.

### End-of-Day Report

At the end of each day, give me a single summary message:
- What was built (1-3 bullet points)
- ML concepts introduced (2-3 sentence explainer per concept — this is the whole point of the project)
- Files changed
- Any decisions you made and why
- What's next (Day N+1 preview)
- A suggested commit message — then commit it after I say "go"

### Code Comments for ML Concepts

Whenever you write code that uses a new ML concept (cosine similarity, HNSW index, chunking with overlap, Recall@k, MRR), put a 2-3 line comment block above it explaining the concept in plain English. These comments are my learning material — they should still make sense when I re-read the code in a month.

---

## Who I Am

I'm Ashton — recent B.S. in IT (Web & Mobile Programming), currently working as an AI Solution Architect at Outlander Ventures. My day-to-day: Voice AI agents (Vapi), Go-to-Market engineering, and AEO (Answer Engine Optimization) for client websites.

I code a lot, but I'm an **early-career ML engineer**. VerseLink is the project I'm using to learn embeddings, RAG, evals, and chunking properly.

---

## What We're Building

**VerseLink** — an AI Bible study companion. Ask "what does Scripture say about burnout?" in plain English, get semantically relevant verses (not keyword matches), plus your own sermon notes blended in. RAG-powered, voice mode via Vapi, AEO-optimized topic pages for organic discovery.

Full day-by-day plan: see `PROJECT_PLAN.md`. Always read it at the start of a session.

**Learning goals (in order of importance):**
1. Embeddings + vector search (pgvector)
2. RAG architecture (retrieve → augment → generate)
3. Eval design (Recall@k, MRR) — the resume differentiator
4. Chunking strategy + hybrid retrieval
5. Voice agents calling backend tools (Vapi)

---

## Locked-In Tech Stack

Don't suggest alternatives unless I ask:

- **Frontend:** Next.js 14+ (App Router) + TypeScript + Tailwind CSS
- **Database / Vector store:** Supabase Postgres + pgvector extension
- **Embeddings:** Google Gemini `text-embedding-004` (768 dimensions)
- **Embedding SDK:** `@google/generative-ai` npm package
- **LLM:** Anthropic Claude API, model `claude-sonnet-4-20250514`
- **Voice:** Vapi
- **Scheduled jobs / webhooks:** Vercel Cron Jobs + Next.js Route Handlers (no n8n)
- **Bible text:** **World English Bible (WEB)** — public domain only
- **Deployment:** Vercel
- **Package manager:** npm

---

## Hard Rules

These exist because breaking them costs real money, breaks the law, or kills the project:

1. **NEVER use ESV, NIV, NLT, or any copyrighted Bible translation.** Public domain only: WEB, KJV, ASV.
2. **NEVER commit `.env.local`.** Verify `.gitignore` covers it before any `git add`.
3. **Server-side keys only.** `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `VAPI_*`, and `SUPABASE_SERVICE_ROLE_KEY` go in Route Handlers — NEVER `NEXT_PUBLIC_*`.
4. **Gemini embedding API does not support batch arrays.** Always loop one text at a time.
5. **Vector dimension is 768, not 1536.** Every pgvector column declared `vector(768)`.
6. **Cost guardrails on Vapi (Day 6).** Hard-cap at 5 calls per user per day — enforce in the Route Handler before calling Vapi.
7. **Eval before iterate.** Once Day 4 is done, any change to retrieval must be re-evaluated.
8. **Commit at end of each day** with a clear message like `Day 2: Gemini embeddings pipeline (Recall@5 = 0.81 baseline)`.
9. **Never paste an API key, secret, or `.env.local` contents into the terminal or a code file you're about to commit.** If you need to show me a key for verification, mask it.

---

## My Stretch Skills (Don't Over-Explain)

React, Tailwind, REST APIs, async/await, Vapi configuration, Git basics, SEO/AEO.

## My Weak Spots (Explain Patiently in Comments)

- Postgres-specific syntax (`vector(768)`, HNSW, RLS)
- TypeScript types beyond the basics
- Server vs client components in Next.js App Router
- Embedding math (cosine similarity, dot product)
- Eval metrics (Recall@k, MRR)
- Chunking strategies and tokenization
- `@google/generative-ai` SDK
- Vercel Cron Jobs configuration

---

*Last updated: Day 0. Update this file as preferences evolve.*
