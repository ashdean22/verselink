'use client'

import { useState, useId } from 'react'
import { normalizePhone, isValidE164 } from '@/lib/phone'

type Step = 'enter-phone' | 'enter-code' | 'verified'

export default function DevotionalSignup() {
  const phoneInputId = useId()
  const codeInputId = useId()

  const [step, setStep] = useState<Step>('enter-phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const normalized = normalizePhone(phone)
  const phoneValid = isValidE164(normalized)
  const codeValid = /^\d{6}$/.test(code.trim())

  async function post(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  }

  async function handleSubscribe() {
    if (!phoneValid) {
      setError('Enter a valid phone number, e.g. +1 555 123 4567.')
      return
    }
    setBusy(true); setError(''); setMessage('')
    try {
      const { ok, data } = await post('/api/devotional/subscribe', { phoneNumber: normalized })
      if (!ok) { setError(data.error ?? 'Could not start verification'); return }
      setStep('enter-code')
      setMessage(data.message ?? 'Calling you now with a 6-digit code.')
    } catch {
      setError('Network error — try again')
    } finally {
      setBusy(false)
    }
  }

  async function handleVerify() {
    if (!codeValid) { setError('Enter the 6-digit code you heard.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const { ok, data } = await post('/api/devotional/verify', { phoneNumber: normalized, code: code.trim() })
      if (!ok) { setError(data.error ?? 'Verification failed'); return }
      setStep('verified')
      setMessage(data.message ?? "You're subscribed to the daily devotional.")
    } catch {
      setError('Network error — try again')
    } finally {
      setBusy(false)
    }
  }

  async function handleUnsubscribe() {
    if (!phoneValid) { setError('Enter the number to unsubscribe.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const { ok, data } = await post('/api/devotional/unsubscribe', { phoneNumber: normalized })
      if (!ok) { setError(data.error ?? 'Could not unsubscribe'); return }
      setStep('enter-phone'); setCode('')
      setMessage(data.message ?? "You've been unsubscribed.")
    } catch {
      setError('Network error — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm space-y-3">
      <div>
        <h2 className="text-lg font-bold mb-0.5">Daily Devotional Subscription</h2>
        <p className="text-sm text-stone-500">
          Get a Bible study call every morning. We&apos;ll call once to confirm your number.
        </p>
      </div>

      {step !== 'verified' && (
        <div className="space-y-1">
          <label htmlFor={phoneInputId} className="text-xs font-medium text-stone-600">
            Your phone number
          </label>
          <input
            id={phoneInputId}
            type="tel"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError(''); setMessage('') }}
            placeholder="+1 555 123 4567"
            disabled={busy || step === 'enter-code'}
            className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400 disabled:opacity-60"
          />
        </div>
      )}

      {step === 'enter-phone' && (
        <button
          onClick={handleSubscribe}
          disabled={!phoneValid || busy}
          className="w-full rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Calling…' : 'Subscribe & verify by call'}
        </button>
      )}

      {step === 'enter-code' && (
        <div className="space-y-2">
          <div className="space-y-1">
            <label htmlFor={codeInputId} className="text-xs font-medium text-stone-600">
              6-digit code (we just read it to you)
            </label>
            <input
              id={codeInputId}
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError('') }}
              placeholder="123456"
              disabled={busy}
              className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm tracking-widest text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400 disabled:opacity-60"
            />
          </div>
          <button
            onClick={handleVerify}
            disabled={!codeValid || busy}
            className="w-full rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Verifying…' : 'Confirm code'}
          </button>
          <button
            onClick={handleSubscribe}
            disabled={busy}
            className="w-full text-xs text-stone-500 hover:text-stone-700 disabled:opacity-50"
          >
            Didn&apos;t get a call? Call again
          </button>
        </div>
      )}

      {step === 'verified' && (
        <button
          onClick={handleUnsubscribe}
          disabled={busy}
          className="w-full rounded-md border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Unsubscribe'}
        </button>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      {message && !error && <p className="text-xs text-stone-500">{message}</p>}
    </div>
  )
}
