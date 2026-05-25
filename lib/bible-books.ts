export interface BibleBook {
  name: string
  slug: string
  chapters: number
  testament: 'OT' | 'NT'
}

export const BIBLE_BOOKS: BibleBook[] = [
  // Old Testament
  { name: 'Genesis',          slug: 'genesis',          chapters: 50,  testament: 'OT' },
  { name: 'Exodus',           slug: 'exodus',           chapters: 40,  testament: 'OT' },
  { name: 'Leviticus',        slug: 'leviticus',        chapters: 27,  testament: 'OT' },
  { name: 'Numbers',          slug: 'numbers',          chapters: 36,  testament: 'OT' },
  { name: 'Deuteronomy',      slug: 'deuteronomy',      chapters: 34,  testament: 'OT' },
  { name: 'Joshua',           slug: 'joshua',           chapters: 24,  testament: 'OT' },
  { name: 'Judges',           slug: 'judges',           chapters: 21,  testament: 'OT' },
  { name: 'Ruth',             slug: 'ruth',             chapters: 4,   testament: 'OT' },
  { name: '1 Samuel',         slug: '1-samuel',         chapters: 31,  testament: 'OT' },
  { name: '2 Samuel',         slug: '2-samuel',         chapters: 24,  testament: 'OT' },
  { name: '1 Kings',          slug: '1-kings',          chapters: 22,  testament: 'OT' },
  { name: '2 Kings',          slug: '2-kings',          chapters: 25,  testament: 'OT' },
  { name: '1 Chronicles',     slug: '1-chronicles',     chapters: 29,  testament: 'OT' },
  { name: '2 Chronicles',     slug: '2-chronicles',     chapters: 36,  testament: 'OT' },
  { name: 'Ezra',             slug: 'ezra',             chapters: 10,  testament: 'OT' },
  { name: 'Nehemiah',         slug: 'nehemiah',         chapters: 13,  testament: 'OT' },
  { name: 'Esther',           slug: 'esther',           chapters: 10,  testament: 'OT' },
  { name: 'Job',              slug: 'job',              chapters: 42,  testament: 'OT' },
  { name: 'Psalms',           slug: 'psalms',           chapters: 150, testament: 'OT' },
  { name: 'Proverbs',         slug: 'proverbs',         chapters: 31,  testament: 'OT' },
  { name: 'Ecclesiastes',     slug: 'ecclesiastes',     chapters: 12,  testament: 'OT' },
  { name: 'Song of Solomon',  slug: 'song-of-solomon',  chapters: 8,   testament: 'OT' },
  { name: 'Isaiah',           slug: 'isaiah',           chapters: 66,  testament: 'OT' },
  { name: 'Jeremiah',         slug: 'jeremiah',         chapters: 52,  testament: 'OT' },
  { name: 'Lamentations',     slug: 'lamentations',     chapters: 5,   testament: 'OT' },
  { name: 'Ezekiel',          slug: 'ezekiel',          chapters: 48,  testament: 'OT' },
  { name: 'Daniel',           slug: 'daniel',           chapters: 12,  testament: 'OT' },
  { name: 'Hosea',            slug: 'hosea',            chapters: 14,  testament: 'OT' },
  { name: 'Joel',             slug: 'joel',             chapters: 3,   testament: 'OT' },
  { name: 'Amos',             slug: 'amos',             chapters: 9,   testament: 'OT' },
  { name: 'Obadiah',          slug: 'obadiah',          chapters: 1,   testament: 'OT' },
  { name: 'Jonah',            slug: 'jonah',            chapters: 4,   testament: 'OT' },
  { name: 'Micah',            slug: 'micah',            chapters: 7,   testament: 'OT' },
  { name: 'Nahum',            slug: 'nahum',            chapters: 3,   testament: 'OT' },
  { name: 'Habakkuk',         slug: 'habakkuk',         chapters: 3,   testament: 'OT' },
  { name: 'Zephaniah',        slug: 'zephaniah',        chapters: 3,   testament: 'OT' },
  { name: 'Haggai',           slug: 'haggai',           chapters: 2,   testament: 'OT' },
  { name: 'Zechariah',        slug: 'zechariah',        chapters: 14,  testament: 'OT' },
  { name: 'Malachi',          slug: 'malachi',          chapters: 4,   testament: 'OT' },
  // New Testament
  { name: 'Matthew',          slug: 'matthew',          chapters: 28,  testament: 'NT' },
  { name: 'Mark',             slug: 'mark',             chapters: 16,  testament: 'NT' },
  { name: 'Luke',             slug: 'luke',             chapters: 24,  testament: 'NT' },
  { name: 'John',             slug: 'john',             chapters: 21,  testament: 'NT' },
  { name: 'Acts',             slug: 'acts',             chapters: 28,  testament: 'NT' },
  { name: 'Romans',           slug: 'romans',           chapters: 16,  testament: 'NT' },
  { name: '1 Corinthians',    slug: '1-corinthians',    chapters: 16,  testament: 'NT' },
  { name: '2 Corinthians',    slug: '2-corinthians',    chapters: 13,  testament: 'NT' },
  { name: 'Galatians',        slug: 'galatians',        chapters: 6,   testament: 'NT' },
  { name: 'Ephesians',        slug: 'ephesians',        chapters: 6,   testament: 'NT' },
  { name: 'Philippians',      slug: 'philippians',      chapters: 4,   testament: 'NT' },
  { name: 'Colossians',       slug: 'colossians',       chapters: 4,   testament: 'NT' },
  { name: '1 Thessalonians',  slug: '1-thessalonians',  chapters: 5,   testament: 'NT' },
  { name: '2 Thessalonians',  slug: '2-thessalonians',  chapters: 3,   testament: 'NT' },
  { name: '1 Timothy',        slug: '1-timothy',        chapters: 6,   testament: 'NT' },
  { name: '2 Timothy',        slug: '2-timothy',        chapters: 4,   testament: 'NT' },
  { name: 'Titus',            slug: 'titus',            chapters: 3,   testament: 'NT' },
  { name: 'Philemon',         slug: 'philemon',         chapters: 1,   testament: 'NT' },
  { name: 'Hebrews',          slug: 'hebrews',          chapters: 13,  testament: 'NT' },
  { name: 'James',            slug: 'james',            chapters: 5,   testament: 'NT' },
  { name: '1 Peter',          slug: '1-peter',          chapters: 5,   testament: 'NT' },
  { name: '2 Peter',          slug: '2-peter',          chapters: 3,   testament: 'NT' },
  { name: '1 John',           slug: '1-john',           chapters: 5,   testament: 'NT' },
  { name: '2 John',           slug: '2-john',           chapters: 1,   testament: 'NT' },
  { name: '3 John',           slug: '3-john',           chapters: 1,   testament: 'NT' },
  { name: 'Jude',             slug: 'jude',             chapters: 1,   testament: 'NT' },
  { name: 'Revelation',       slug: 'revelation',       chapters: 22,  testament: 'NT' },
]

export const SLUG_TO_BOOK = Object.fromEntries(BIBLE_BOOKS.map(b => [b.slug, b]))
export const NAME_TO_BOOK  = Object.fromEntries(BIBLE_BOOKS.map(b => [b.name, b]))
export const BOOK_ORDER    = BIBLE_BOOKS.map(b => b.name)

export function bookToSlug(name: string) {
  return name.toLowerCase().replace(/ /g, '-')
}
