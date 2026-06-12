'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { BIBLE_BOOKS } from '@/lib/bible-books'
import { VERSIONS, type Version } from './versions'

const LS_KEY = 'verselink:version'

interface BibleNavProps {
  currentSlug:        string
  currentChapter:     number
  currentVersion:     Version
  hasExplicitVersion: boolean   // true when ?version= was present in the URL
}

export default function BibleNav({ currentSlug, currentChapter, currentVersion, hasExplicitVersion }: BibleNavProps) {
  const router      = useRouter()
  const currentBook = BIBLE_BOOKS.find(b => b.slug === currentSlug)

  // On first render: if the URL had no explicit version, apply the stored preference.
  // If the URL did have one, write it to storage so other pages inherit it.
  useEffect(() => {
    if (hasExplicitVersion) {
      localStorage.setItem(LS_KEY, currentVersion)
    } else {
      const stored = localStorage.getItem(LS_KEY) as Version | null
      if (stored && VERSIONS.includes(stored) && stored !== currentVersion) {
        router.replace(`/bible/${currentSlug}/${currentChapter}?version=${stored}`)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onBookChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`/bible/${e.target.value}/1?version=${currentVersion}`)
  }

  function onChapterChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`/bible/${currentSlug}/${e.target.value}?version=${currentVersion}`)
  }

  function onVersionChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value as Version
    localStorage.setItem(LS_KEY, v)
    router.push(`/bible/${currentSlug}/${currentChapter}?version=${v}`)
  }

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-stone-200 px-4 py-2 flex items-center gap-3 -mx-6 mb-6">
      <select
        value={currentSlug}
        onChange={onBookChange}
        className="text-sm border border-stone-200 rounded-md px-2 py-1.5 bg-white text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-400"
      >
        <optgroup label="Old Testament">
          {BIBLE_BOOKS.filter(b => b.testament === 'OT').map(b => (
            <option key={b.slug} value={b.slug}>{b.name}</option>
          ))}
        </optgroup>
        <optgroup label="New Testament">
          {BIBLE_BOOKS.filter(b => b.testament === 'NT').map(b => (
            <option key={b.slug} value={b.slug}>{b.name}</option>
          ))}
        </optgroup>
      </select>

      <select
        value={currentChapter}
        onChange={onChapterChange}
        className="text-sm border border-stone-200 rounded-md px-2 py-1.5 bg-white text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-400"
      >
        {Array.from({ length: currentBook?.chapters ?? 1 }, (_, i) => i + 1).map(ch => (
          <option key={ch} value={ch}>Chapter {ch}</option>
        ))}
      </select>

      <select
        value={currentVersion}
        onChange={onVersionChange}
        className="text-sm border border-stone-200 rounded-md px-2 py-1.5 bg-white text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-400"
      >
        {VERSIONS.map(v => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>

      <a
        href="/bible"
        className="ml-auto text-xs text-stone-400 hover:text-stone-600"
      >
        All books
      </a>
    </div>
  )
}
