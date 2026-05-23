/**
 * app/api/call-now/route.ts — Trigger an on-demand Vapi outbound call
 *
 * Called by the "Call Me Now" button on the home page.
 * Enforces a 5-calls/day hard cap before hitting Vapi — prevents runaway billing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

const DAILY_CAP = 5

async function getTodayCallCount(): Promise<number> {
  const supabase = createServiceClient()
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from('calls_log')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfDay.toISOString())
  if (error) throw new Error(`Cap check failed: ${error.message}`)
  return count ?? 0
}

async function logCall() {
  const supabase = createServiceClient()
  const { error } = await supabase.from('calls_log').insert([{}])
  if (error) throw new Error(`Log insert failed: ${error.message}`)
}

export async function POST(req: NextRequest) {
  const vapiKey        = process.env.VAPI_PRIVATE_KEY
  const phoneNumberId  = process.env.VAPI_PHONE_NUMBER_ID
  const assistantId    = process.env.VAPI_ASSISTANT_ID
  const myPhone        = process.env.VAPI_MY_PHONE_NUMBER

  if (!vapiKey || !phoneNumberId || !assistantId || !myPhone) {
    return NextResponse.json(
      { error: 'Vapi env vars not configured — add VAPI_PRIVATE_KEY, VAPI_PHONE_NUMBER_ID, VAPI_ASSISTANT_ID, VAPI_MY_PHONE_NUMBER to .env.local' },
      { status: 503 }
    )
  }

  // ── Hard cap: max 5 calls per day ────────────────────────────────────────────
  let todayCount: number
  try {
    todayCount = await getTodayCallCount()
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Could not verify daily call limit' }, { status: 500 })
  }

  if (todayCount >= DAILY_CAP) {
    return NextResponse.json(
      { error: `Daily limit reached (${DAILY_CAP} calls/day). Try again tomorrow.` },
      { status: 429 }
    )
  }

  // ── Trigger outbound call via Vapi ───────────────────────────────────────────
  const vapiRes = await fetch('https://api.vapi.ai/call/phone', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${vapiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      assistantId,
      customer:     { number: myPhone },
      phoneNumberId,
    }),
  })

  if (!vapiRes.ok) {
    const errBody = await vapiRes.text()
    console.error('Vapi call failed:', errBody)
    return NextResponse.json({ error: 'Vapi call failed — check server logs' }, { status: 502 })
  }

  // Log the call AFTER a successful Vapi response
  try {
    await logCall()
  } catch (err) {
    console.error('Call log insert failed (call was still placed):', err)
  }

  const call = await vapiRes.json()
  return NextResponse.json({ success: true, callId: call.id, remaining: DAILY_CAP - todayCount - 1 })
}
