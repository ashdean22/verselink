/**
 * app/api/cron/daily-devotional/route.ts — Vercel Cron Job
 *
 * Runs at 6:00 AM ET (11:00 UTC) every day.
 * Triggers an outbound Vapi devotional call.
 *
 * Vercel automatically sends the CRON_SECRET in the Authorization header
 * for cron-triggered requests. We verify it to reject manual HTTP hits.
 *
 * Schedule is configured in vercel.json:
 *   { "path": "/api/cron/daily-devotional", "schedule": "0 11 * * *" }
 */

import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  // Vercel sends: Authorization: Bearer {CRON_SECRET}
  const auth = req.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Reuse the same call-now logic by calling our own API internally.
  // In production on Vercel, VERCEL_URL is set automatically.
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  const res = await fetch(`${baseUrl}/api/call-now`, { method: 'POST' })
  const data = await res.json()

  if (!res.ok) {
    console.error('Daily devotional call failed:', data)
    return NextResponse.json({ error: data.error }, { status: res.status })
  }

  console.log('Daily devotional triggered:', data.callId)
  return NextResponse.json({ triggered: true, callId: data.callId })
}
