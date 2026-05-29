/**
 * app/evals/page.tsx — Retrieval Eval Dashboard (Server Component)
 *
 * Reads all JSON files from evals/results/ at request time and renders
 * a side-by-side comparison of every eval run.
 *
 * WHY SERVER COMPONENT:
 *   Node's `fs` module is only available server-side. Because this page just
 *   reads files and renders HTML, we don't need any client-side JS — Server
 *   Components are the right fit.
 */

import * as fs from 'fs'
import * as path from 'path'

interface QuestionResult {
  id: number
  question: string
  topic: string
  expected: string[]
  retrieved: string[]
  recall_at_5: number
  recall_at_10: number
  reciprocal_rank: number
  first_hit_rank: number | null
}

interface EvalRun {
  tag: string
  ef_search: number | null
  timestamp: string
  recall_at_5: number
  recall_at_10: number
  mrr: number
  n_questions: number
  questions: QuestionResult[]
}

function loadRuns(): EvalRun[] {
  const dir = path.join(process.cwd(), 'evals', 'results')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as EvalRun)
    .sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''))
}

function MetricCell({ value, baseline }: { value: number; baseline: number }) {
  const delta = value - baseline
  const sign = delta >= 0 ? '+' : ''
  const color = delta > 0.005 ? 'text-green-600' : delta < -0.005 ? 'text-red-500' : 'text-gray-500'
  return (
    <td className="px-4 py-2 text-center font-mono text-sm">
      <span className="font-semibold">{value.toFixed(3)}</span>
      {delta !== 0 && (
        <span className={`ml-1 text-xs ${color}`}>
          ({sign}{delta.toFixed(3)})
        </span>
      )}
    </td>
  )
}

function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="text-xs font-medium text-red-500">MISS</span>
  const color =
    rank === 1 ? 'bg-green-100 text-green-800' :
    rank <= 3  ? 'bg-blue-100 text-blue-800' :
    rank <= 5  ? 'bg-yellow-100 text-yellow-800' :
                 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${color}`}>
      #{rank}
    </span>
  )
}

export default function EvalsPage() {
  const runs = loadRuns()

  if (runs.length === 0) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">No eval results found. Run <code className="bg-gray-100 px-1 rounded">npm run run-eval</code> first.</p>
      </main>
    )
  }

  const baseline = runs[0]
  // Build a map: topic → run tag → QuestionResult for the per-question grid
  const topics = baseline.questions.map(q => q.topic)

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Retrieval Eval Results</h1>
      <p className="text-sm text-gray-500 mb-8">
        Recall@k and MRR measure how well the vector index surfaces expected verses.
        Higher is better. Delta shown vs. the earliest run (baseline).
      </p>

      {/* ── Summary table ── */}
      <section className="mb-12">
        <h2 className="text-base font-semibold text-gray-700 mb-3">Summary</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Run</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">ef_search</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Recall@5</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Recall@10</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">MRR</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Questions</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((run, i) => (
                <tr key={run.tag} className={i === 0 ? 'bg-blue-50' : 'bg-white'}>
                  <td className="px-4 py-3 font-mono text-sm font-medium">
                    {run.tag}
                    {i === 0 && <span className="ml-2 text-xs text-blue-500">(baseline)</span>}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-sm text-gray-600">
                    {run.ef_search ?? 'default'}
                  </td>
                  <MetricCell value={run.recall_at_5}  baseline={baseline.recall_at_5} />
                  <MetricCell value={run.recall_at_10} baseline={baseline.recall_at_10} />
                  <MetricCell value={run.mrr}          baseline={baseline.mrr} />
                  <td className="px-4 py-3 text-center text-gray-600">{run.n_questions}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(run.timestamp).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Metric explainers */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            {
              label: 'Recall@5',
              desc: 'Of all expected verses for a question, what fraction appear in the top 5 results? 1.0 = all expected verses found in the first 5 hits.',
            },
            {
              label: 'Recall@10',
              desc: 'Same as Recall@5 but looking at the top 10. Always ≥ Recall@5 — a useful ceiling check.',
            },
            {
              label: 'MRR',
              desc: 'Mean Reciprocal Rank. For each question, 1/rank of the first correct verse (rank 1 → 1.0, rank 5 → 0.2, not found → 0). Penalizes correct-but-buried results.',
            },
          ].map(({ label, desc }) => (
            <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-700 mb-1">{label}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Per-question breakdown ── */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">Per-Question Breakdown</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600 w-8">#</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Topic</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Expected</th>
                {runs.map(run => (
                  <th key={run.tag} className="px-4 py-3 text-center font-semibold text-gray-600 whitespace-nowrap">
                    {run.tag}
                    <div className="text-xs text-gray-400 font-normal">1st hit rank</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {topics.map((topic, qi) => {
                const baseQ = baseline.questions[qi]
                return (
                  <tr key={topic} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-400 text-xs">{baseQ.id}</td>
                    <td className="px-4 py-2">
                      <span className="inline-block rounded bg-indigo-50 text-indigo-700 px-2 py-0.5 text-xs font-medium">
                        {topic}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {baseQ.expected.map(ref => (
                          <span key={ref} className="text-xs text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
                            {ref}
                          </span>
                        ))}
                      </div>
                    </td>
                    {runs.map(run => {
                      const q = run.questions.find(x => x.id === baseQ.id)
                      return (
                        <td key={run.tag} className="px-4 py-2 text-center">
                          <RankBadge rank={q?.first_hit_rank ?? null} />
                          {q && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              R@5={q.recall_at_5.toFixed(2)}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
