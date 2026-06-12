export const VERSIONS = ['WEB', 'KJV', 'ASV', 'BSB'] as const
export type Version = typeof VERSIONS[number]

export const VERSION_LABELS: Record<Version, string> = {
  WEB: 'World English Bible',
  KJV: 'King James Version',
  ASV: 'American Standard Version',
  BSB: 'Berean Standard Bible',
}
