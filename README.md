# VerseLink

AI Bible study companion. RAG over the World English Bible + your personal sermon notes, with a Vapi voice mode for hands-free devotionals.

**Status:** Day 0 — pre-kickoff.

---

## Quickstart (Autonomous Mode)

You have Claude Code installed. From this folder, run:

```bash
claude
```

Then paste this as your first message:

> Read CLAUDE.md and PROJECT_PLAN.md before doing anything else. Operate in autonomous mode as defined in CLAUDE.md: execute each day end-to-end without pausing between tasks. Only stop when you need an API key, an account signup, or physical testing (phone call, Vercel auth). When you stop, tell me exactly what I need to provide and the precise format. At the end of each day, post the End-of-Day Report (also defined in CLAUDE.md) and a suggested commit message. Start with Day 1.

That's the whole interaction model. Claude Code will pause when it needs you and run on its own otherwise.

---

## Accounts You'll Need (Sign Up Before Day 1)

Claude Code will tell you exactly when each is needed, but signing up now saves time:

1. **Supabase** — https://supabase.com (free tier, needed Day 1)
2. **Google AI Studio** — https://aistudio.google.com (you already have this — needed Day 2)
3. **Anthropic API** — https://console.anthropic.com (add ~$5 credit — needed Day 3)
4. **Vapi** — https://vapi.ai (free trial, ~$0.05/min after — needed Day 6)
5. **Vercel** — https://vercel.com (free tier, GitHub login — needed Day 6/7)

**No n8n needed** — Vercel Cron Jobs replaces it.

---

## How You Hand Over API Keys

Never paste keys into the Claude Code chat. When it asks for one, it'll give you a line like:

```
Add this to .env.local:
GEMINI_API_KEY=your_key_here
```

You open `.env.local`, paste your real key over `your_key_here`, save the file, and reply "done" in the Claude Code chat. Keys stay on your machine.

---

## Project Structure (after Day 1)

```
verselink/
├── CLAUDE.md              ← Standing instructions (auto-loaded every session)
├── PROJECT_PLAN.md        ← The 7-day plan
├── README.md              ← You are here
├── .env.example           ← Template for API keys
├── .env.local             ← Your actual keys (NEVER commit this)
├── .gitignore
├── scripts/               ← Bible loader, embeddings job, eval runner
├── evals/                 ← Test set + result snapshots
├── vercel.json            ← Vercel Cron Jobs config (Day 6)
└── app/                   ← Next.js App Router
```

---

## Tech Stack

- **Frontend:** Next.js 14+ (App Router) + TypeScript + Tailwind CSS
- **Database:** Supabase (Postgres + pgvector)
- **Embeddings:** Google Gemini `text-embedding-004` (768 dims) — free
- **LLM:** Anthropic Claude (`claude-sonnet-4-20250514`)
- **Voice:** Vapi
- **Scheduled jobs:** Vercel Cron Jobs (replaces n8n)
- **Bible text:** World English Bible (WEB, public domain)
- **Deploy:** Vercel

---

## Resume Bullet (after Day 7)

> Built and shipped VerseLink, a RAG-powered Bible study companion indexing 31,000+ verses plus user-uploaded sermon notes in Supabase pgvector using Google Gemini embeddings. Generates citation-backed answers through Claude with strict anti-hallucination prompting, and offers a Vapi-powered voice devotional mode triggered by Vercel Cron Jobs. Includes an automated Recall@k / MRR evaluation pipeline with HNSW tuning experiments.
