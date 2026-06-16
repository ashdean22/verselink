/**
 * lib/callLimits.ts — shared outbound-call rate limiting (cost guardrail).
 *
 * Every Vapi call costs real money, so we cap them in two dimensions, both
 * keyed off the append-only `calls_log` table:
 *   - PER_NUMBER_CAP: stops one number being dialed to death (abuse/harassment).
 *   - GLOBAL_CAP:     stops total daily spend from runaway loops / many users.
 *
 * These are enforced in the Route Handler BEFORE calling Vapi (project rule #6).
 * Verification calls and devotional calls both go through here.
 */

import { createServiceClient } from '@/lib/supabase'

export const PER_NUMBER_CAP = 5
export const GLOBAL_CAP = 50

function startOfToday(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

async function getGlobalCount(): Promise<number> {
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('calls_log')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfToday())
  if (error) throw new Error(`Global cap check failed: ${error.message}`)
  return count ?? 0
}

async function getPerNumberCount(phoneNumber: string): Promise<number> {
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('calls_log')
    .select('*', { count: 'exact', head: true })
    .eq('phone_number', phoneNumber)
    .gte('created_at', startOfToday())
  if (error) throw new Error(`Per-number cap check failed: ${error.message}`)
  return count ?? 0
}

/**
 * Append a row recording that we placed a call to this number today.
 * Best-effort: callers log AFTER the call is placed and swallow failures.
 */
export async function logCall(phoneNumber: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('calls_log').insert([{ phone_number: phoneNumber }])
  if (error) throw new Error(`Log insert failed: ${error.message}`)
}

export type CapResult =
  | { ok: true }
  | { ok: false; status: 429; error: string }

/**
 * Check both caps for a number. Returns { ok: true } when a call is allowed,
 * otherwise an HTTP-shaped error the route can return directly.
 */
export async function checkCallCaps(phoneNumber: string): Promise<CapResult> {
  const globalCount = await getGlobalCount()
  if (globalCount >= GLOBAL_CAP) {
    return { ok: false, status: 429, error: 'Voice mode at capacity today — try tomorrow.' }
  }

  const perNumberCount = await getPerNumberCount(phoneNumber)
  if (perNumberCount >= PER_NUMBER_CAP) {
    return {
      ok: false,
      status: 429,
      error: `Daily limit reached (${PER_NUMBER_CAP} calls/day per number). Try again tomorrow.`,
    }
  }

  return { ok: true }
}
