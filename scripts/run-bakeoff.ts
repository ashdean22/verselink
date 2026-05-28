/**
 * scripts/run-bakeoff.ts
 *
 * Runs the 30-question eval against three open models via OpenRouter,
 * then prints a comparison table vs the Claude baseline.
 *
 * Run with:  npx tsx scripts/run-bakeoff.ts
 *
 * Requirements:
 *   - Next.js dev server running at http://localhost:3000
 *   - ANTHROPIC_API_KEY + OPENROUTER_API_KEY in .env.local
 *   - evals/results/baseline-claude.json already exists (run baseline first)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// ── Model definitions ───────────────────────────────────────────────────────
// Prices sourced from https://openrouter.ai/api/v1/models on 2026-05-26.
// Note: qwen-2.5-32b-instruct is not on OpenRouter; 72b is the closest equivalent.
const MODELS = [
  {
    id:    'meta-llama/llama-3.3-70b-instruct',
    slug:  'llama-3.3-70b',
    inputPricePerMtok:  0.10,
    outputPricePerMtok: 0.32,
  },
  {
    id:    'qwen/qwen-2.5-72b-instruct',
    slug:  'qwen-2.5-72b',
    inputPricePerMtok:  0.36,
    outputPricePerMtok: 0.40,
  },
  {
    id:    'google/gemma-3-27b-it',
    slug:  'gemma-3-27b',
    inputPricePerMtok:  0.08,
    outputPricePerMtok: 0.16,
  },
] as const;

// ── Cost estimation ─────────────────────────────────────────────────────────
// Uses token counts from the Claude baseline run as a proxy — prompts are
// identical, so open models will hit similar input lengths.
// Judge (Claude Opus 4.7) cost is ~$0.006/call; 30q × 3 runs = 90 calls ≈ $0.54.
const QUESTIONS     = 30;
const AVG_IN_TOK    = 2641;   // from baseline-claude.json
const AVG_OUT_TOK   = 681;
const JUDGE_IN_TOK  = 400;    // judge prompt estimate
const JUDGE_OUT_TOK = 1;
const OPUS_IN_PRICE = 15.0;   // $/Mtok
const OPUS_OUT_PRICE = 75.0;
const COST_CEILING  = 5.0;

function estimateTotalCost(): number {
  const judgeCostPerRun =
    QUESTIONS * ((JUDGE_IN_TOK * OPUS_IN_PRICE + JUDGE_OUT_TOK * OPUS_OUT_PRICE) / 1e6);

  return MODELS.reduce((total, m) => {
    const modelCost =
      QUESTIONS * ((AVG_IN_TOK * m.inputPricePerMtok + AVG_OUT_TOK * m.outputPricePerMtok) / 1e6);
    return total + modelCost + judgeCostPerRun;
  }, 0);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function outPath(slug: string): string {
  return path.join(process.cwd(), 'evals', 'results', `bakeoff-${slug}.json`);
}

function readSummary(file: string) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return (raw.summary ?? raw) as {
    model?: string;
    n: number;
    avgQualityScore: number;
    faithfulnessRate: number | null;
    latencyP50Ms: number;
    avgCostPerQueryUsd: number;
  };
}

function row(
  label: string,
  quality: number,
  faithfulness: number | null,
  p50: number,
  costPerQuery: number
) {
  const faith = faithfulness != null ? `${(faithfulness * 100).toFixed(0)}%` : 'n/a';
  const p50s  = `${(p50 / 1000).toFixed(1)}s`;
  const cost  = `$${costPerQuery.toFixed(5)}`;
  return `  ${label.padEnd(38)} ${String(quality.toFixed(2)).padStart(7)}   ${faith.padStart(11)}   ${p50s.padStart(8)}   ${cost.padStart(10)}`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const estimated = estimateTotalCost();
  console.log(`\nEstimated total cost across all 3 runs: $${estimated.toFixed(2)}`);

  if (estimated > COST_CEILING) {
    console.error(
      `\n⚠  Estimated cost ($${estimated.toFixed(2)}) exceeds the $${COST_CEILING} ceiling.` +
      `\nReview MODELS pricing in this script and confirm before running.`
    );
    process.exit(1);
  }

  console.log(`Cost is under $${COST_CEILING} — proceeding.\n`);

  // Run benchmark for each model
  for (const model of MODELS) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Running: ${model.id}`);
    console.log('─'.repeat(60));

    const result = spawnSync('npx', ['tsx', 'scripts/baseline-benchmark.ts'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        BENCHMARK_MODEL:         model.id,
        BENCHMARK_INPUT_PRICE:   String(model.inputPricePerMtok),
        BENCHMARK_OUTPUT_PRICE:  String(model.outputPricePerMtok),
        BENCHMARK_OUT:           outPath(model.slug),
      },
    });

    if (result.status !== 0) {
      console.error(`\nBenchmark failed for ${model.id} (exit ${result.status})`);
      process.exit(1);
    }
  }

  // ── Comparison table ──────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(80)}`);
  console.log('BAKE-OFF RESULTS — Claude sonnet-4-6 vs open models (quality scored by Opus 4.7)');
  console.log('═'.repeat(80));
  console.log(
    `  ${'Model'.padEnd(38)} ${'Quality'.padStart(7)}   ${'Faithful'.padStart(11)}   ${'p50 lat'.padStart(8)}   ${'$/query'.padStart(10)}`
  );
  console.log('  ' + '─'.repeat(76));

  const baselinePath = path.join(process.cwd(), 'evals', 'results', 'baseline-claude.json');
  const baseline = readSummary(baselinePath);
  console.log(row('claude-sonnet-4-6 (baseline)', baseline.avgQualityScore, baseline.faithfulnessRate, baseline.latencyP50Ms, baseline.avgCostPerQueryUsd));

  for (const model of MODELS) {
    const fp = outPath(model.slug);
    if (!fs.existsSync(fp)) {
      console.log(`  ${model.id.padEnd(38)} [missing result file]`);
      continue;
    }
    const s = readSummary(fp);
    console.log(row(model.id, s.avgQualityScore, s.faithfulnessRate, s.latencyP50Ms, s.avgCostPerQueryUsd));
  }

  console.log('─'.repeat(80));
  console.log('\nNote: $/query tracks only the generation model. Judge (Opus 4.7) adds ~$0.006/query across all rows.\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
