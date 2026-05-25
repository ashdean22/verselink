/**
 * app/api/call-now/route.ts — Trigger an on-demand Vapi outbound call
 *
 * Rate limits:
 *   - Per phone number: 5 calls/day (prevents individual abuse)
 *   - Global:          50 calls/day (protects against credit drain from many users)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

const PER_NUMBER_CAP = 5
const GLOBAL_CAP = 50
const E164_RE = /^\+[1-9]\d{6,14}$/

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

async function logCall(phoneNumber: string) {
  const supabase = createServiceClient()
  const { error } = await supabase.from('calls_log').insert([{ phone_number: phoneNumber }])
  if (error) throw new Error(`Log insert failed: ${error.message}`)
}

export async function POST(req: NextRequest) {
  const vapiKey       = process.env.VAPI_PRIVATE_KEY
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID
  const assistantId   = process.env.VAPI_ASSISTANT_ID

  if (!vapiKey || !phoneNumberId || !assistantId) {
    return NextResponse.json(
      { error: 'Vapi env vars not configured — add VAPI_PRIVATE_KEY, VAPI_PHONE_NUMBER_ID, VAPI_ASSISTANT_ID to .env.local' },
      { status: 503 }
    )
  }

  let phoneNumber: string
  try {
    const body = await req.json()
    phoneNumber = body.phoneNumber ?? ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!E164_RE.test(phoneNumber)) {
    return NextResponse.json(
      { error: 'Invalid phone number. Must be E.164 format (e.g. +15551234567).' },
      { status: 400 }
    )
  }

  try {
    const globalCount = await getGlobalCount()
    if (globalCount >= GLOBAL_CAP) {
      return NextResponse.json(
        { error: 'Voice mode at capacity today — try tomorrow.' },
        { status: 429 }
      )
    }

    const perNumberCount = await getPerNumberCount(phoneNumber)
    if (perNumberCount >= PER_NUMBER_CAP) {
      return NextResponse.json(
        { error: `Daily limit reached (${PER_NUMBER_CAP} calls/day per number). Try again tomorrow.` },
        { status: 429 }
      )
    }
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Could not verify daily call limit' }, { status: 500 })
  }

  const vapiRes = await fetch('https://api.vapi.ai/call/phone', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${vapiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      assistantId,
      customer:     { number: phoneNumber },
      phoneNumberId,
    }),
  })

  if (!vapiRes.ok) {
    const errBody = await vapiRes.text()
    console.error('Vapi call failed:', errBody)
    return NextResponse.json({ error: 'Vapi call failed — check server logs' }, { status: 502 })
  }

  try {
    await logCall(phoneNumber)
  } catch (err) {
    console.error('Call log insert failed (call was still placed):', err)
  }

  const call = await vapiRes.json()
  return NextResponse.json({ success: true, callId: call.id })
}
