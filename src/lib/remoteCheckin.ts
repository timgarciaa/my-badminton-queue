import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { type PhoneCheckin, useStore } from '../store/useStore'
import type { RemoteCheckin } from '../types'

/** The check-in API (server/), or undefined when this build has none. */
export const CHECKIN_API: string | undefined = import.meta.env.VITE_CHECKIN_API || undefined

/** How often the iPad looks for phone check-ins. */
const POLL_MS = 4000

/** The link players open: the app with ?c=CODE. */
export const checkinLink = (code: string) => `${location.origin}${import.meta.env.BASE_URL}?c=${code}`

export interface PhonePlayer {
  id: string
  name: string
  in: boolean
}

/** Four random digits, offered as the PIN. */
export const randomPin = () => String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, '0')

async function call<T>(method: string, path: string, opts: { key?: string; pin?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${CHECKIN_API}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined && { 'content-type': 'application/json' }),
      ...(opts.key && { 'x-key': opts.key }),
      ...(opts.pin && { 'x-pin': opts.pin }),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error ?? res.statusText), { status: res.status })
  return data as T
}

/** For the player's phone. */
export const phoneApi = {
  players: (code: string, pin: string) => call<{ date: string; players: PhonePlayer[] }>('GET', `/s/${code}`, { pin }),
  checkIn: (code: string, pin: string, who: { id: string } | { name: string }) =>
    call<{ at: number | null; already?: boolean }>('POST', `/s/${code}/checkin`, { pin, body: who }),
}

/** What the iPad has heard from the check-in API; not saved. */
export const useRemoteStatus = create<{ newcomers: PhoneCheckin[]; online: boolean; locked: boolean }>(() => ({
  newcomers: [],
  online: true,
  /** Too many wrong PINs: players can't check in until the PIN is changed. */
  locked: false,
}))

/**
 * While phone check-in is open, keep the names on the server up to date and
 * check in whoever checks in on their phone. Runs for the whole app (not just
 * the Check-in tab), so check-ins land wherever the iPad is.
 */
export function useRemoteCheckin() {
  const remote = useStore((s) => s.session.remote)
  const date = useStore((s) => s.session.date)
  const players = useStore((s) => s.players)
  const attendees = useStore((s) => s.session.attendees)
  const applyRemote = useStore((s) => s.applyRemote)
  const code = remote?.code
  const key = remote?.key
  const pin = remote?.pin

  // Send the names (and who is already in), shortly after they change.
  useEffect(() => {
    if (!CHECKIN_API || !code || !key) return
    const t = setTimeout(() => {
      const body = {
        date,
        pin,
        players: players.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name })),
        here: attendees.map((a) => a.playerId),
      }
      call('PUT', `/s/${code}`, { key, body }).then(
        () => useRemoteStatus.setState({ online: true }),
        () => useRemoteStatus.setState({ online: false }),
      )
    }, 800)
    return () => clearTimeout(t)
  }, [code, key, pin, date, players, attendees])

  // Look for phone check-ins while the app is on screen.
  useEffect(() => {
    if (!CHECKIN_API || !code || !key) return
    let stopped = false
    const poll = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const { checkins, locked } = await call<{ checkins: PhoneCheckin[]; locked: boolean }>('GET', `/s/${code}/checkins`, { key })
        if (stopped) return
        applyRemote(checkins)
        const handled = new Set(useStore.getState().session.remote?.handled)
        useRemoteStatus.setState({
          online: true,
          locked,
          newcomers: checkins.filter((c) => c.id.startsWith('new-') && !handled.has(c.id)),
        })
      } catch {
        if (!stopped) useRemoteStatus.setState({ online: false })
      }
    }
    // The first look waits for the names to be sent, which opens the check-in.
    const first = setTimeout(poll, 1500)
    const timer = setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', poll)
    return () => {
      stopped = true
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
      useRemoteStatus.setState({ newcomers: [], locked: false })
    }
  }, [code, key, applyRemote])

  // Close the old link when phone check-in is turned off or the session ends.
  const last = useRef<RemoteCheckin | undefined>(remote)
  useEffect(() => {
    const prev = last.current
    last.current = remote
    if (CHECKIN_API && prev && prev.code !== remote?.code) {
      call('DELETE', `/s/${prev.code}`, { key: prev.key }).catch(() => {})
    }
  }, [remote])
}
