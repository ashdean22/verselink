import AskBox from './AskBox'

export default function AskPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Ask Scripture</h1>
        <p className="text-sm text-stone-500">
          Ask any question. Answers are grounded only in retrieved verses — no hallucinated references.
        </p>
      </div>
      <AskBox />
    </div>
  )
}
