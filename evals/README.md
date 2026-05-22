# VerseLink Retrieval Evals

## What we measure

| Metric     | Definition |
|------------|------------|
| Recall@5   | Fraction of expected verses found in the top 5 results |
| Recall@10  | Same, top 10 results |
| MRR        | Mean Reciprocal Rank — 1/rank of the first correct verse, averaged across questions |

## Corpus (Day 5+)

Retrieval now spans **two corpora** searched in parallel:

- **Scripture** — 31,098 verses from the World English Bible (WEB, public domain)
- **Commentary** — Matthew Henry's Commentary on the Whole Bible (1708, public domain), chunked into ~500-token windows with 50-token overlap and embedded with Gemini

`evals/questions.json` targets **Scripture** verses only, so Recall@k and MRR measure whether the right *verses* appear in the top-k regardless of commentary results. Commentary chunks are additional context that improve answer quality but don't affect these metrics directly.

## Results

| Run          | ef_search | Recall@5 | Recall@10 | MRR   |
|--------------|-----------|----------|-----------|-------|
| baseline     | default   | 0.278    | 0.478     | 0.389 |
| hnsw-tuned   | 100       | 0.289    | 0.489     | 0.397 |

**Key finding:** Tuning `ef_search` from default (40) to 100 rescued one MISS (fear: not found → rank 4) for a +1.1pp Recall@5 lift. The remaining misses — strength, wisdom, eternal-life, joy — reflect embedding alignment, not index quality. The expected verse simply isn't the *most similar* vector to the question in Gemini's embedding space.

## Running evals

```bash
# Baseline
npm run run-eval

# With custom ef_search
npm run run-eval -- --ef 100 --tag hnsw-tuned

# After Day 5 corpus expansion (re-run to see if commentary improves verse recall)
npm run run-eval -- --tag post-commentary
```

Results are saved to `evals/results/{tag}.json` and displayed at `/evals`.

## Adding questions

Edit `evals/questions.json`. Each entry:
```json
{
  "id": 31,
  "question": "What does the Bible say about rest?",
  "expected": ["Matthew 11:28", "Hebrews 4:9"],
  "topic": "rest"
}
```
`expected` should list the 2-3 most-cited Scripture references for the topic, not every possible relevant verse.
