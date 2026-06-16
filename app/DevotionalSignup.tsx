'use client'

import { useState, useEffect, useId } from 'react'
import { normalizePhone, isValidE164 } from '@/lib/phone'

const LS_KEY = 'verselink_devotional_phone'

export default function DevotionalSignup() {
  const inputId = useId()
  const [phone, setPhone] = useState('')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // Remember a subscribed number across reloads so we can offer unsubscribe.
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY)
    if (saved) { setPhone(saved); setSubscribed(true) }
  }, [])

  const normalized = normalizePhone(phone)
  const phoneValid = isValidE164(normalized)

  async function post(url: string) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: normalized }),
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
      const { ok, data } = await post('/api/devotional/subscribe')
      if (!ok) { setError(data.error ?? 'Could not subscribe'); return }
      localStorage.setItem(LS_KEY, normalized)
      setSubscribed(true)
      setMessage(data.message ?? "You're subscribed to the daily devotional.")
    } catch {
      setError('Network error — try again')
    } finally {
      setBusy(false)
    }
  }

  async function handleUnsubscribe() {
    setBusy(true); setError(''); setMessage('')
    try {
      const { ok, data } = await post('/api/devotional/unsubscribe')
      if (!ok) { setError(data.error ?? 'Could not unsubscribe'); return }
      localStorage.removeItem(LS_KEY)
      setSubscribed(false)
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
        <h2 className="text-lg font-bold mb-0.5">Daily Devotional</h2>
        <p className="text-sm text-stone-500">
          Subscribe to get a Bible study call every morning.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor={inputId} className="text-xs font-medium text-stone-600">
          Your phone number
        </label>
        <input
          id={inputId}
          type="tel"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setError(''); setMessage('') }}
          placeholder="+1 555 123 4567"
          disabled={busy || subscribed}
          className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400 disabled:opacity-60"
        />
      </div>

      {subscribed ? (
        <button
          onClick={handleUnsubscribe}
          disabled={busy}
          className="w-full rounded-md border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Unsubscribe'}
        </button>
      ) : (
        <button
          onClick={handleSubscribe}
          disabled={!phoneValid || busy}
          className="w-full rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Subscribing…' : 'Subscribe'}
        </button>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      {message && !error && <p className="text-xs text-stone-500">{message}</p>}
    </div>
  )
}
