/**
 * lib/phone.ts — shared E.164 phone helpers (safe for both client and server)
 *
 * E.164 is the international phone-number standard: a leading "+", a country
 * code, then the subscriber number — max 15 digits total, no spaces/dashes.
 * Example: +15551234567
 */

// Leading +, first digit 1-9, then 6–14 more digits.
export const E164_RE = /^\+[1-9]\d{6,14}$/

/**
 * Best-effort normalization of user input toward E.164.
 * Bare 10-digit and 11-digit (leading 1) inputs are assumed US (+1);
 * anything with a "+" or longer is passed through with a "+" prefix.
 * The result is still validated with E164_RE by callers.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits[0] === '1') return '+' + digits
  if (hasPlus || digits.length > 11) return '+' + digits
  return digits
}

export function isValidE164(phone: string): boolean {
  return E164_RE.test(phone)
}
