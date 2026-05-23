# VerseLink — AI Bible Study Companion

Ask what Scripture says about anything. Get semantically relevant verses and Matthew Henry's commentary — not keyword matches.

**Live:** [verselink-two.vercel.app](https://verselink-two.vercel.app)

---

## What it does

- **Semantic search** across 31,098 WEB Bible verses via Gemini embeddings + pgvector
- **Hybrid RAG** — retrieves top verses and Matthew Henry's Commentary (16,671 chunks) simultaneously, feeds both to Claude for grounded, citation-backed answers
- **Voice devotionals** — "Call Me Now" triggers a Vapi outbound call with a `searchScripture` tool; daily 6am cron via Vercel
- **50 AEO topic pages** (`/topics/anxiety`, `/topics/grief`, …) with FAQPage JSON-LD, ISR cached for 24h
- **Eval dashboard** (`/evals`) — Recall@5, Recall@10, MRR across retrieval experiments

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript + Tailwind |
| Vector DB | Supabase Postgres + pgvector (HNSW index) |
| Embeddings | Google Gemini `gemini-embedding-001` — 768 dims (Matryoshka truncation) |
| LLM | Anthropic Claude `claude-sonnet-4-6` — structured output via tool_use |
| Voice | Vapi outbound calls + server-side tool webhook |
| Cron | Vercel Cron Jobs |
| Deploy | Vercel |

---

## ML concepts covered

**Embeddings + vector search** — Every verse and commentary chunk is stored as a 768-dimensional vector. Queries are embedded with the same model and compared via cosine similarity. Similar meaning → similar vector direction.

**RAG (Retrieve → Augment → Generate)** — Rather than asking Claude to recall Scripture from training data (hallucinations), we embed the question, retrieve the most relevant passages, and feed only those passages as grounded context. Claude cites only what it was given.

**HNSW approximate nearest-neighbour index** — pgvector's HNSW index organises vectors as a navigable graph. Search walks the graph keeping a candidate list of size `ef_search`. We measure the recall vs. speed trade-off in `/evals`.

**Chunking with overlap** — Matthew Henry's commentary chapters are split into ~500-token windows with 50-token overlap. Overlap prevents answers that straddle two chunk boundaries from being missed.

**Eval design (Recall@k, MRR)** — A 30-question test set with expected verse references measures retrieval quality independently of generation. Recall@5 = 0.278 baseline; ef_search=100 raises it to 0.289.

---

## Running locally

```bash
git clone https://github.com/ashdean22/verselink.git
cd verselink
npm install
# Add env vars to .env.local (see env.example)
npm run dev
```

---

## 90-second Loom demo script

**[0:00 – 0:10] Hook**
> "I built a RAG-powered Bible study app in a week to learn embeddings, vector search, and eval design from scratch. Let me show you what's under the hood."

**[0:10 – 0:30] /ask page**
> Type: *"What does Scripture say about anxiety?"*
> While it loads: "The question gets embedded with Google Gemini — that turns the text into a 768-number vector. Supabase runs a cosine similarity search across 31,000 Bible verses AND 16,000 chunks from Matthew Henry's 1708 commentary. Both happen in one round-trip."
> Point to the answer and citations: "Claude only sees the retrieved passages — it can't invent references it wasn't given."

**[0:30 – 0:45] /evals page**
> "This is the part that matters most on a resume. I built a 30-question test set, defined expected verses for each question, and measured Recall@5 and MRR. Then I ran a tuning experiment — changing the HNSW ef_search parameter from 40 to 100. You can see the exact delta here."

**[0:45 – 1:00] /topics/anxiety**
> "These 50 topic pages are AEO-optimised — Answer Engine Optimization. They have FAQPage JSON-LD schema markup, so they're structured for AI crawlers like Perplexity and Google AI Overviews, not just humans."

**[1:00 – 1:15] Home page — Call Me Now**
> "There's also a voice mode. Clicking this triggers a Vapi outbound call to my phone. The Vapi assistant has a searchScripture tool that POSTs back to this app's webhook, runs the same hybrid search, and reads the results aloud. A Vercel Cron job does this automatically at 6am every day."

**[1:15 – 1:30] Close**
> "Full stack: Next.js, Supabase pgvector, Gemini embeddings, Claude, Vapi, Vercel. All the ML concepts — embeddings, RAG, chunking, evals — are documented in code comments throughout the repo. Link in the description."

---

## Resume bullet

> Built and shipped VerseLink, a RAG-powered Bible study companion indexing 31,000+ Bible verses and 16,000+ commentary chunks (Matthew Henry, 1708) in Supabase pgvector using Google Gemini embeddings. Hybrid retrieval searches both corpora in parallel; Claude generates citation-backed answers via tool_use with strict anti-hallucination prompting. Includes a Vapi voice mode with a live searchScripture tool, Vercel Cron daily devotional, an automated evaluation pipeline (Recall@k, MRR, HNSW tuning experiment), and 50 AEO-optimised topic pages with FAQPage JSON-LD schema markup.
