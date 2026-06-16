/**
 * app/api/devotional/verify/route.ts — confirm the spoken code.
 *
 * The user types the 6-digit code they heard on the Vapi call. We check it
 * matches and hasn't expired (~10 min window), then flip verified = true and
 * clear the code so it can't be reused. Service-role only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { E164_RE } from '@/lib/phone'

export async function POST(req: NextRequest) {
  let phoneNumber: string
  let code: string
  try {
    const body = await req.json()
    phoneNumber = (body.phoneNumber ?? '').trim()
    code = (body.code ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!E164_RE.test(phoneNumber)) {
    return NextResponse.json({ error: 'Invalid phone number.' }, { status: 400 })
  }
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Enter the 6-digit code you heard.' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: sub, error } = await supabase
    .from('devotional_subscribers')
    .select('id, verification_code, code_expires_at')
    .eq('phone', phoneNumber)
    .maybeSingle()

  if (error) {
    console.error('verify lookup failed:', error)
    return NextResponse.json({ error: 'Verification failed — try again' }, { status: 500 })
  }
  if (!sub || !sub.verification_code) {
    return NextResponse.json({ error: 'No pending verification for that number.' }, { status: 404 })
  }

  const expired = !sub.code_expires_at || new Date(sub.code_expires_at).getTime() < Date.now()
  if (expired) {
    return NextResponse.json({ error: 'Code expired — request a new call.' }, { status: 410 })
  }
  if (sub.verification_code !== code) {
    return NextResponse.json({ error: 'Incorrect code.' }, { status: 401 })
  }

  // Confirmed: mark verified + active, and clear the one-time code.
  const { error: updErr } = await supabase
    .from('devotional_subscribers')
    .update({ verified: true, active: true, verification_code: null, code_expires_at: null })
    .eq('id', sub.id)

  if (updErr) {
    console.error('verify update failed:', updErr)
    return NextResponse.json({ error: 'Verification failed — try again' }, { status: 500 })
  }

  return NextResponse.json({ success: true, message: "You're subscribed to the daily devotional." })
}
