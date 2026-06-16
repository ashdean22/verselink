/**
 * app/api/cron/daily-devotional/route.ts — Vercel Cron Job
 *
 * Runs at 6:00 AM ET (11:00 UTC) every day. Calls EVERY verified, active
 * subscriber with their devotional. Replaces the old single-number behavior.
 *
 * Vercel automatically sends the CRON_SECRET in the Authorization header
 * for cron-triggered requests. We verify it to reject manual HTTP hits.
 *
 * Per-number and global daily call caps are still enforced — each call goes
 * through /api/call-now, which checks calls_log before dialing Vapi. The
 * global cap naturally bounds total spend even with many subscribers.
 *
 * Schedule is configured in vercel.json:
 *   { "path": "/api/cron/daily-devotional", "schedule": "0 11 * * *" }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Only verified + active subscribers. Unverified numbers are NEVER called.
  const supabase = createServiceClient()
  const { data: subscribers, error } = await supabase
    .from('devotional_subscribers')
    .select('phone')
    .eq('verified', true)
    .eq('active', true)

  if (error) {
    console.error('Subscriber fetch failed:', error)
    return NextResponse.json({ error: 'Could not load subscribers' }, { status: 500 })
  }

  if (!subscribers?.length) {
    return NextResponse.json({ triggered: 0, results: [] })
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  // Place calls sequentially so the global cap (checked inside /api/call-now)
  // is observed in order and we stop cleanly once it's hit.
  const results: Array<{ phone: string; ok: boolean; detail: string }> = []
  for (const { phone } of subscribers) {
    try {
      const res = await fetch(`${baseUrl}/api/call-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone }),
      })
      const data = await res.json()
      results.push({
        phone,
        ok: res.ok,
        detail: res.ok ? (data.callId ?? 'placed') : (data.error ?? `status ${res.status}`),
      })
    } catch (err) {
      console.error(`Devotional call failed for ${phone}:`, err)
      results.push({ phone, ok: false, detail: 'network error' })
    }
  }

  const triggered = results.filter(r => r.ok).length
  console.log(`Daily devotional: ${triggered}/${subscribers.length} calls placed`)
  return NextResponse.json({ triggered, results })
}
