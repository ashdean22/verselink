/**
 * app/topics/[slug]/page.tsx — AEO-optimized topic pages
 *
 * AEO (Answer Engine Optimization): designed to surface in AI answer engines
 * (ChatGPT, Perplexity, Google AI Overviews) when someone asks a Bible question.
 * Key techniques:
 *   - ISR (revalidate=86400): pages are cached as static HTML for 24h, then
 *     regenerated in the background. First visitor triggers generation; everyone
 *     else gets instant cached HTML. Crawlers see fully rendered content.
 *   - FAQPage JSON-LD: schema.org structured data that tells crawlers this page
 *     contains a question and answer. Increases chance of rich snippet display.
 *   - Semantic HTML: clear H1, blockquote for verse text, strong citation structure.
 */

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { TOPICS, TOPIC_SLUGS } from '@/lib/topics'
import { hybridSearch } from '@/lib/search'
import { generateAnswer } from '@/lib/rag'
import type { RAGAnswer } from '@/lib/rag'
import { isVerseCitation } from '@/lib/commentary'

// ISR: generate on first request, cache for 24 hours, regenerate in background.
// We do NOT use generateStaticParams here — that would prerender all 50 pages
// simultaneously at build time, immediately hitting Claude's rate limit.
// Instead, pages are generated on first visitor request and then cached.
export const revalidate = 86400
export const dynamicParams = true

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const topic = TOPICS[slug]
  if (!topic) return {}

  const description = `${topic.question} Discover what the Bible says about ${topic.title.toLowerCase()}, with verse citations and commentary across traditions (Reformed, Arminian, Evangelical, Puritan, Catholic).`

  return {
    title: `${topic.title} — What Does the Bible Say? | VerseLink`,
    description,
    openGraph: {
      title: `${topic.title} — What Does the Bible Say?`,
      description,
      url: `https://verselink-two.vercel.app/topics/${slug}`,
      siteName: 'VerseLink',
      type: 'article',
    },
    twitter: {
      card: 'summary',
      title: `${topic.title} — What Does the Bible Say?`,
      description,
    },
  }
}

async function getTopicContent(question: string): Promise<RAGAnswer | null> {
  try {
    const { verses, chunks } = await hybridSearch(question, 5, 6, 2)
    if (verses.length === 0) return null
    return await generateAnswer(question, verses, chunks)
  } catch (err) {
    console.error('Topic RAG failed:', err)
    return null
  }
}

interface JsonLdProps {
  topic: { title: string; question: string }
  answer: RAGAnswer
  slug: string
}

function buildJsonLd({ topic, answer, slug }: JsonLdProps) {
  // FAQPage schema: tells crawlers this page contains a Q&A.
  // Each citation verse becomes its own FAQ entry for additional indexing surface.
  const citations = Array.isArray(answer.citations) ? answer.citations : []
  const mainEntity = [
    {
      '@type': 'Question',
      name: topic.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: answer.answer,
      },
    },
    ...citations.filter(c => isVerseCitation(c.ref)).map(c => ({
      '@type': 'Question',
      name: `What does ${c.ref} say about ${topic.title.toLowerCase()}?`,
      acceptedAnswer: {
        '@type': 'Answer',
        text: `${c.ref}: "${c.text}" — ${c.relevance}`,
      },
    })),
  ]

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url: `https://verselink-two.vercel.app/topics/${slug}`,
    name: `${topic.title} — What Does the Bible Say?`,
    mainEntity,
  }
}

export default async function TopicPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const topic = TOPICS[slug]
  if (!topic) notFound()

  const answer = await getTopicContent(topic.question)
  const relatedTopics = topic.related
    .filter(s => TOPICS[s])
    .map(s => ({ slug: s, title: TOPICS[s].title }))

  return (
    <>
      {answer && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(buildJsonLd({ topic, answer, slug })),
          }}
        />
      )}

      <div className="max-w-3xl mx-auto space-y-8">
        {/* Breadcrumb */}
        <nav className="text-xs text-stone-400">
          <a href="/topics" className="hover:text-stone-600">Topics</a>
          <span className="mx-1">/</span>
          <span>{topic.title}</span>
        </nav>

        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-stone-900">{topic.title}</h1>
          <p className="text-stone-500 text-lg">{topic.question}</p>
        </div>

        {/* Answer */}
        {answer ? (
          <div className="space-y-6">
            <div className="rounded-lg border border-stone-200 bg-white p-6">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">
                Answer
              </p>
              <p className="text-stone-800 leading-relaxed text-base">{answer.answer}</p>
            </div>

            {/* Citations */}
            {Array.isArray(answer.citations) && answer.citations.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">
                  Scripture & Commentary
                </h2>
                {answer.citations.map((c, i) => {
                  const isVerse = isVerseCitation(c.ref)
                  const [book, chv] = isVerse ? c.ref.split(/(?<=\D)\s(?=\d)/) : [null, null]
                  const chapter = chv?.split(':')[0]
                  const slug2 = book?.toLowerCase().replace(/ /g, '-')

                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-stone-200 bg-white p-5 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        {isVerse && slug2 && chapter ? (
                          <a
                            href={`/bible/${slug2}/${chapter}`}
                            className="text-sm font-bold text-stone-700 hover:underline"
                          >
                            {c.ref}
                          </a>
                        ) : (
                          <>
                            <span className="text-sm font-bold text-indigo-700">{c.ref}</span>
                            <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                              commentary
                            </span>
                            {c.tradition && (
                              <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                                {c.tradition}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <blockquote className="text-sm text-stone-700 italic border-l-2 border-stone-200 pl-3">
                        "{c.text}"
                      </blockquote>
                      <p className="text-xs text-stone-500">{c.relevance}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-8 text-center">
            <p className="text-stone-500 text-sm">
              Content is loading — embeddings may still be processing.
              <br />
              <a href="/ask" className="underline hover:text-stone-700 mt-1 inline-block">
                Ask this question directly →
              </a>
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="rounded-lg border border-stone-200 bg-white p-5 flex items-center justify-between">
          <div>
            <p className="font-semibold text-stone-800 text-sm">Have a follow-up question?</p>
            <p className="text-xs text-stone-500 mt-0.5">Ask anything — answers are grounded in Scripture.</p>
          </div>
          <a
            href={`/ask?q=${encodeURIComponent(topic.question)}`}
            className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 shrink-0 ml-4"
          >
            Ask →
          </a>
        </div>

        {/* Related topics */}
        {relatedTopics.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">
              Related Topics
            </h2>
            <div className="flex flex-wrap gap-2">
              {relatedTopics.map(t => (
                <a
                  key={t.slug}
                  href={`/topics/${t.slug}`}
                  className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 hover:border-stone-400 hover:text-stone-800"
                >
                  {t.title}
                </a>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-stone-400 border-t border-stone-100 pt-4">
          Scripture from the World English Bible (WEB) — public domain.
          Commentary excerpts from Matthew Henry, John Calvin, John Gill, Adam Clarke,
          Jamieson-Fausset-Brown, and Haydock — all public domain.
          Answers generated by Claude and grounded only in retrieved text.
        </p>
      </div>
    </>
  )
}
