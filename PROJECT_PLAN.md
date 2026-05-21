# VerseLink — AI Bible Study Companion

**1-Week Build Plan** — Web + Voice | Embeddings • RAG • Evals • Vapi • Claude

---

## Project Overview

VerseLink is an AI-powered Bible study companion. Ask real questions in plain English — "What does Scripture say about burnout?", "How should I think about waiting?" — and get semantically relevant passages, not keyword matches. It indexes the full Bible plus your own sermon notes and devotionals, retrieves the most relevant verses via vector search, and uses Claude to compose grounded, citation-backed answers. A voice mode powered by Vapi turns the same engine into a hands-free morning devotional.

This project is the cleanest path to learning real ML engineering: embeddings, vector search, RAG, evaluation design, and chunking strategy.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS |
| Vector DB | Supabase Postgres + pgvector extension |
| Embeddings | Google Gemini `text-embedding-004` (768 dimensions) |
| Embedding SDK | `@google/generative-ai` npm package |
| LLM / RAG | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| Voice Agent | Vapi |
| Scheduled jobs / webhooks | Vercel Cron Jobs + Next.js Route Handlers |
| Bible Text | World English Bible (WEB) — public domain |
| Deployment | Vercel (free tier) |

---

## Core Features

- Natural-language semantic search across the entire Bible (~31,000 verses)
- Upload sermon notes, devotionals, and journal entries to a personal index
- Hybrid retrieval — search canonical Scripture and personal corpus together
- Claude-generated answers with verifiable verse citations
- Voice mode via Vapi — hands-free devotionals
- Scheduled daily devotional call via Vercel Cron
- Built-in eval dashboard — Recall@k, MRR, HNSW tuning comparison
- AEO-optimized public topic pages for organic discovery

---

## Week at a Glance

| Day | Focus | Key Deliverable |
|---|---|---|
| 1 | Setup & Bible Ingestion | Full Bible loaded into Postgres with browseable UI |
| 2 | Embeddings Pipeline | All ~31k verses embedded via Gemini into pgvector |
| 3 | RAG Pipeline | Query → retrieve → grounded answer with citations |
| 4 | Eval Framework | Test set + Recall@k & MRR metrics + tuning experiment |
| 5 | Personal Corpus + UI | Upload sermon notes, hybrid search working |
| 6 | Vapi Voice Mode | Voice devotional on schedule + on-demand (Vercel Cron) |
| 7 | Deploy + AEO Polish | Live on Vercel with indexable topic pages |

---

## Day 1 — Setup & Bible Ingestion

**User input required:** Supabase project URL + keys (Claude Code will ask).

| # | Task |
|---|---|
| 1 | Run `npx create-next-app@latest verselink` (App Router, TypeScript, Tailwind). |
| 2 | Pause and ask user to create Supabase project. User provides URL + anon key + service role key. |
| 3 | In Supabase SQL editor (via psql or REST), run `CREATE EXTENSION IF NOT EXISTS vector;` |
| 4 | Download World English Bible (WEB) JSON from a public-domain source. Cache in `data/bible-raw/`. |
| 5 | Create `verses` table: `id, book, chapter, verse, text, embedding vector(768)`. **768, not 1536** — Gemini dimension. |
| 6 | Write `scripts/load-bible.ts`. Bulk-insert in batches of 1000 via Supabase service-role client. |
| 7 | Build `/bible/[book]/[chapter]` page rendering verses. |

**End of Day Goal:** Browse any chapter at `/bible/john/3`. Verses load from Supabase.

---

## Day 2 — Embeddings Pipeline

**User input required:** `GEMINI_API_KEY` (Claude Code will ask).

**Cost: $0.** Gemini's embedding API is free up to rate limits.

| # | Task |
|---|---|
| 1 | Pause and ask user for `GEMINI_API_KEY`. Add to `.env.local`. |
| 2 | `npm install @google/generative-ai` |
| 3 | Write `scripts/embed-bible.ts`. Init `GoogleGenerativeAI`, get model `text-embedding-004`. **One verse at a time** — Gemini does not support batch arrays. |
| 4 | Add 100ms sleep between calls to stay under free-tier rate limit. Add try/catch and progress logging every 100 verses. |
| 5 | Run the script. Takes ~45 min. Use checkpoint pattern (resume from last NULL embedding) so a crash doesn't restart from zero. |
| 6 | Create HNSW index: `CREATE INDEX ON verses USING hnsw (embedding vector_cosine_ops);` |
| 7 | Write `searchVerses(query, k=10)`. Build `/search` test page. |

**End of Day Goal:** Type "what does the Bible say about anxiety?" — get Matthew 6:34, Philippians 4:6, 1 Peter 5:7 ranked by meaning.

---

## Day 3 — RAG Pipeline

**User input required:** `ANTHROPIC_API_KEY` (Claude Code will ask).

| # | Task |
|---|---|
| 1 | Pause and ask user for `ANTHROPIC_API_KEY`. Add to `.env.local`. |
| 2 | `npm install @anthropic-ai/sdk` |
| 3 | Create Route Handler `app/api/ask/route.ts`. Accept POST `{ question: string }`. |
| 4 | Handler logic: embed question with Gemini → `searchVerses(question, 8)` → call Claude with the 8 verses as grounded context. |
| 5 | Prompt Claude to ONLY use supplied verses, cite each by reference, refuse to invent references. |
| 6 | Return strict JSON: `{ answer, citations: [{ ref, text, relevance }] }`. |
| 7 | Build chat UI: input, streaming answer, citation cards, "show retrieved context" debug toggle. |

**End of Day Goal:** Ask any question, get grounded answer in <3 sec with verifiable verse citations.

---

## Day 4 — Eval Framework (The Resume Day)

**No user input needed — fully autonomous day.**

| # | Task |
|---|---|
| 1 | Generate `/evals/questions.json` with 30 test questions. Use Claude to draft them, then human-review for sensible expected verses. |
| 2 | Write `scripts/run-eval.ts`. Loop questions, call `searchVerses(q, 10)`, check if expected refs appear in top 5 / top 10. |
| 3 | Compute Recall@5, Recall@10, MRR (Mean Reciprocal Rank). |
| 4 | Save baseline to `/evals/results/baseline.json`. Never edit again. |
| 5 | Experiment: change HNSW `ef_search` parameter (controls recall vs. speed). Re-run evals. Save as `hnsw-tuned.json`. |
| 6 | Build `/evals` page with table of all runs side by side. |

**End of Day Goal:** `/evals` page shows concrete numbers across two configurations. First ML experiment complete.

---

## Day 5 — Personal Corpus + Hybrid Search

**No user input needed.**

| # | Task |
|---|---|
| 1 | Add `/upload` page accepting `.md`, `.txt`, `.pdf`. Multipart upload to a Route Handler. |
| 2 | `npm install pdf-parse gpt-tokenizer`. Server-side: parse PDFs, read md/txt directly. |
| 3 | Chunk extracted text into ~500-token pieces with 50-token overlap. Use `gpt-tokenizer` to count accurately. |
| 4 | Embed each chunk via Gemini (one-at-a-time loop, same as Day 2). INSERT into `chunks` table: `id, user_id, doc_title, source_type, text, embedding vector(768), position`. |
| 5 | Update `/api/ask`: parallel-retrieve top 8 from `verses` AND top 4 from `chunks` (filtered by user_id). Merge by similarity score. |
| 6 | Source filter UI: "Bible only" / "Bible + my notes" / "My notes only". Supabase Auth (magic link) + RLS on chunks. |

**End of Day Goal:** Upload last Sunday's sermon notes. Ask a question — your notes are retrieved alongside Scripture.

---

## Day 6 — Vapi Voice Mode (No n8n Needed)

**User input required:** Vapi account creation + `VAPI_PRIVATE_KEY`, `VAPI_PHONE_NUMBER_ID`, assistant ID. Also: deploy to Vercel first so Vapi can call back.

The original plan used n8n for the daily cron and webhook. Vercel Cron Jobs + Next.js Route Handlers replace it cleanly — one platform, no extra account.

| # | Task |
|---|---|
| 1 | Pause and walk user through Vapi signup. User creates assistant with the system prompt Claude Code provides. User gives `VAPI_PRIVATE_KEY`, `VAPI_PHONE_NUMBER_ID`, assistant ID. |
| 2 | Define a Vapi tool `searchScripture(query)` that POSTs to `/api/ask`. Requires the app to be deployed first — Claude Code prompts the user to deploy to Vercel at this step (one-time auth in browser). |
| 3 | Set dynamic variables on the Vapi assistant: `name`, `current_study_focus`. |
| 4 | Create `app/api/cron/daily-devotional/route.ts` — Vercel Cron Job. Queries Supabase for opted-in users, calls Vapi outbound API per user, enforces 5-calls/day cap with a DB query. |
| 5 | Configure cron in `vercel.json`: schedule `0 11 * * *` (6am ET = 11am UTC). Add `CRON_SECRET` env var for auth. |
| 6 | Create `app/api/vapi-webhook/route.ts`. Receives transcripts from Vapi. Stores as chunks with `source_type='voice_session'`. |
| 7 | Add "Call Me Now" button on the home page — POSTs to `/api/call-now`, which checks the daily cap and calls Vapi. |

**End of Day Goal:** Phone rings at 6am with a real Bible study conversation. Transcript appears in app as a searchable chunk.

---

## Day 7 — Deploy & AEO Polish

**User input required:** Vercel auth (one-time browser login).

Most of the deploy is done by Day 6 (so Vapi can reach the app). Day 7 focuses on the AEO + polish layer.

| # | Task |
|---|---|
| 1 | Verify all env vars in Vercel dashboard. Add `CRON_SECRET` if not already there. |
| 2 | Pick 50 high-intent topic queries (anxiety, grief, purpose, waiting, forgiveness, doubt, etc.). Generate `/topics/[slug]` static pages at build time using the RAG engine. |
| 3 | Add JSON-LD schema markup (FAQPage, QAPage) to each topic page. |
| 4 | Generate `sitemap.xml` + `robots.txt`. Add OpenGraph tags. Submit sitemap to Google Search Console (user step — Claude Code provides the URL). |
| 5 | Polish: skeleton loaders, empty states, mobile responsiveness, friendly error messages. |
| 6 | Claude Code generates a 90-second demo script for the user to record as a Loom. Pin to GitHub README. |

**End of Day Goal:** Live URL, 50 indexed topic pages, Loom demo script ready to record.

---

## Skills Gained After This Week

- Embeddings & vector search (pgvector, HNSW)
- RAG architecture (retrieve → augment → generate)
- ML eval design (Recall@k, MRR)
- Chunking strategy + hybrid retrieval
- Anti-hallucination prompting (structured JSON output from Claude)
- Gemini embedding API
- Vapi voice agents calling your own backend tools
- Vercel Cron Jobs (scheduled serverless functions)
- AEO at scale (schema markup + ISR + topic clusters)

---

## Suggested Resume Bullet

> Built and shipped VerseLink, a RAG-powered Bible study companion indexing 31,000+ verses plus user-uploaded sermon notes in Supabase pgvector using Google Gemini embeddings. Retrieves contextually relevant passages via cosine similarity, generates citation-backed answers through Claude with strict anti-hallucination prompting, and offers a Vapi-powered voice devotional mode triggered by Vercel Cron Jobs. Includes an automated evaluation pipeline measuring Recall@k and MRR with an HNSW tuning experiment, and 50 AEO-optimized static topic pages with FAQPage / QAPage schema markup.

---

## Tips for Success

- **Day 4 (evals) is the most important day on your resume.** Don't skip it.
- **Public-domain Bibles only:** WEB, KJV, ASV. ESV/NIV will get a takedown.
- **Gemini embeds one text at a time** — no batch arrays. Loop with sleep.
- **Vapi 5-calls/day hard cap.** Enforce in the Route Handler before every call.
- **Deploy to Vercel by Day 6**, not Day 7 — Vapi needs a public URL to hit the backend.
