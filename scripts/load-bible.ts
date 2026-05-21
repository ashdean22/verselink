/**
 * scripts/load-bible.ts
 * Reads data/bible-raw/web.json and bulk-inserts all verses into Supabase.
 *
 * Run with:   npx tsx scripts/load-bible.ts
 *
 * Safe to re-run — uses ON CONFLICT DO NOTHING so duplicate verses are skipped.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BATCH_SIZE = 1000

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

// Service role client bypasses Row Level Security — required for bulk inserts from scripts.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

interface RawVerse {
  book: string
  chapter: number
  verse: number
  text: string
}

async function main() {
  const filePath = path.join(process.cwd(), 'data', 'bible-raw', 'web.json')
  if (!fs.existsSync(filePath)) {
    console.error(`Bible JSON not found at ${filePath}`)
    console.error('Run the download script first: python3 /tmp/download_web.py > data/bible-raw/web.json')
    process.exit(1)
  }

  console.log('Loading Bible JSON…')
  const raw: RawVerse[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  console.log(`Loaded ${raw.length} verses from JSON`)

  let inserted = 0
  let skipped = 0

  // Process in batches of BATCH_SIZE to avoid request size limits
  for (let i = 0; i < raw.length; i += BATCH_SIZE) {
    const batch = raw.slice(i, i + BATCH_SIZE).map((v) => ({
      book: v.book,
      chapter: v.chapter,
      verse: v.verse,
      text: v.text,
    }))

    const { error, count } = await supabase
      .from('verses')
      .upsert(batch, {
        onConflict: 'book,chapter,verse',
        ignoreDuplicates: true,
        count: 'exact',
      })

    if (error) {
      console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, error.message)
      process.exit(1)
    }

    inserted += count ?? batch.length
    const progress = Math.min(i + BATCH_SIZE, raw.length)
    process.stdout.write(`\r  Progress: ${progress}/${raw.length} verses (${Math.round((progress / raw.length) * 100)}%)`)
  }

  console.log(`\n\nDone! Inserted ${inserted} verses, skipped ${raw.length - inserted} duplicates.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
