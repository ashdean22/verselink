/**
 * scripts/baseline-benchmark.ts
 *
 * Runs the existing 30-question eval set against the current /api/ask
 * (Claude generation) and produces baseline numbers for the fine-tuning plan:
 *   - Median + p95 latency
 *   - Average cost per query and projected monthly cost
 *   - Citation faithfulness rate (% of verse refs that appear in retrieved ctx)
 *   - LLM-as-judge quality score (Claude Opus, 1-5)
 *
 * Output: evals/results/baseline-claude.json
 *
 * Run with:  npx tsx scripts/baseline-benchmark.ts
 *
 * Requirements:
 *   - Next.js dev server running at http://localhost:3000
 *   - /api/ask supports `{ includeUsage: true }` (see Step 2 in chat)
 *   - ANTHROPIC_API_KEY set in .env.local (for the judge)
 *   - npm install --save-dev tsx  (if not already)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

// ---------- CONFIG — ADJUST THESE ----------

const API_URL = process.env.BENCHMARK_API_URL || 'http://localhost:3000/api/ask';

// Override via BENCHMARK_MODEL env var — run-bakeoff.ts sets this per model.
const PROD_MODEL = process.env.BENCHMARK_MODEL || 'claude-sonnet-4-6';

// Override via BENCHMARK_INPUT_PRICE / BENCHMARK_OUTPUT_PRICE ($/Mtok).
const INPUT_PRICE_PER_MTOK  = parseFloat(process.env.BENCHMARK_INPUT_PRICE  || '3.00');
const OUTPUT_PRICE_PER_MTOK = parseFloat(process.env.BENCHMARK_OUTPUT_PRICE || '15.00');

// Judge model — uses your Anthropic key. Opus is the most reliable judge.
const JUDGE_MODEL = 'claude-opus-4-7';

// Volume assumption used for monthly cost projection
const QUERIES_PER_DAY = 10000;

// -------------------------------------------

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Eval questions.json — flexible shape, just needs SOMETHING question-like per entry
interface EvalEntry {
  question?: string;
  topic?: string;
  query?: string;
  [k: string]: unknown;
}

function getQuestionText(q: EvalEntry): string {
  return q.question || q.topic || q.query || '';
}

interface ApiResponse {
  answer: string;
  citations?: unknown[];
  retrievedVerses: { ref: string; text: string; similarity: number }[];
  retrievedChunks: { ref: string; text: string; similarity: number }[];
  inputTokens: number;
  outputTokens: number;
}

interface BenchResult {
  question: string;
  answer: string;
  retrieved: string[];
  citedRefs: string[];
  faithful: boolean;
  qualityScore: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// -------- helpers --------

async function callApi(question: string): Promise<{ data: ApiResponse; latencyMs: number }> {
  const start = Date.now();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, model: PROD_MODEL, includeUsage: true }),
  });
  const latencyMs = Date.now() - start;
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return { data: await res.json(), latencyMs };
}

/**
 * Pulls verse references out of free text.
 * Matches: "John 3:16", "1 Corinthians 13:1-3", "Ps 23", "Romans 8:28-39", etc.
 */
function extractVerseRefs(text: string): string[] {
  const pattern = /(?:[123]\s+)?[A-Z][a-z]+\.?\s+\d+(?::\d+(?:[-–]\d+)?)?/g;
  const matches = text.match(pattern) || [];
  return [...new Set(matches.map(m => m.trim()))];
}

/**
 * A cited reference is faithful if SOME retrieved ref overlaps with it
 * (string contains either way — handles "John 3" vs "John 3:16" comparisons).
 */
function isFaithful(citedRefs: string[], retrievedRefs: string[]): boolean {
  if (citedRefs.length === 0) return true; // no claims = nothing to verify
  return citedRefs.every(c =>
    retrievedRefs.some(r => r.includes(c) || c.includes(r))
  );
}

async function judgeQuality(
  question: string,
  answer: string,
  retrieved: string[]
): Promise<number> {
  const prompt = `You are evaluating a Bible-study Q&A answer.

Question: ${question}

Retrieved context (verse refs the answer SHOULD be grounded in):
${retrieved.join(', ')}

Answer to evaluate:
${answer}

Score the answer on a 1–5 scale considering:
- Relevance: does it address the question?
- Accuracy: does it reflect Scripture and the retrieved context correctly?
- Groundedness: does it avoid claims unsupported by the context?

Reply with ONLY a single integer 1–5. No other text.`;

  const res = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 8,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = res.content[0];
  const txt = block.type === 'text' ? block.text.trim() : '';
  const n = parseInt(txt, 10);
  return Number.isNaN(n) ? 0 : Math.max(1, Math.min(5, n));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// -------- main --------

async function benchmarkOne(q: EvalEntry): Promise<BenchResult> {
  const questionText = getQuestionText(q);
  const { data, latencyMs } = await callApi(questionText);

  const retrieved = data.retrievedVerses.map(v => v.ref);
  const citedRefs = extractVerseRefs(data.answer);
  const faithful = isFaithful(citedRefs, retrieved);
  const qualityScore = await judgeQuality(questionText, data.answer, retrieved);

  const costUsd =
    (data.inputTokens  * INPUT_PRICE_PER_MTOK  / 1_000_000) +
    (data.outputTokens * OUTPUT_PRICE_PER_MTOK / 1_000_000);

  return {
    question: questionText,
    answer: data.answer,
    retrieved,
    citedRefs,
    faithful,
    qualityScore,
    latencyMs,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    costUsd,
  };
}

async function main() {
  const questionsPath = path.join(process.cwd(), 'evals', 'questions.json');
  const questions: EvalEntry[] = JSON.parse(fs.readFileSync(questionsPath, 'utf-8'));

  console.log(`Benchmarking ${questions.length} questions against ${PROD_MODEL}…\n`);

  const results: BenchResult[] = [];
  for (let i = 0; i < questions.length; i++) {
    process.stdout.write(`  [${i + 1}/${questions.length}] `);
    try {
      const r = await benchmarkOne(questions[i]);
      results.push(r);
      console.log(`${r.latencyMs}ms  quality=${r.qualityScore}/5  faithful=${r.faithful}  $${r.costUsd.toFixed(4)}`);
    } catch (err) {
      console.log(`FAILED — ${(err as Error).message}`);
    }
  }

  // ---- aggregate ----
  const latencies = results.map(r => r.latencyMs);
  const qualities = results.map(r => r.qualityScore);
  const costs     = results.map(r => r.costUsd);
  const faithful  = results.filter(r => r.faithful).length;
  const avgCost   = mean(costs);

  const summary = {
    model: PROD_MODEL,
    runAt: new Date().toISOString(),
    n: results.length,

    avgQualityScore:   Number(mean(qualities).toFixed(2)),
    faithfulnessRate:  Number((faithful / results.length).toFixed(3)),

    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),

    avgInputTokens:  Math.round(mean(results.map(r => r.inputTokens))),
    avgOutputTokens: Math.round(mean(results.map(r => r.outputTokens))),

    avgCostPerQueryUsd:   Number(avgCost.toFixed(5)),
    dailyCostAtVolumeUsd: Number((avgCost * QUERIES_PER_DAY).toFixed(2)),
    monthlyCostAtVolumeUsd: Number((avgCost * QUERIES_PER_DAY * 30).toFixed(2)),

    volumeAssumption: `${QUERIES_PER_DAY} queries/day`,
    pricingNote: `Input $${INPUT_PRICE_PER_MTOK}/Mtok, Output $${OUTPUT_PRICE_PER_MTOK}/Mtok`,
  };

  const outDir = path.join(process.cwd(), 'evals', 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = process.env.BENCHMARK_OUT
    ? path.resolve(process.env.BENCHMARK_OUT)
    : path.join(outDir, 'baseline-claude.json');
  fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));

  console.log('\n=== BASELINE SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nSaved → ${outFile}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
