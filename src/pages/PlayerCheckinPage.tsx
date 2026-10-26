import { useCallback, useEffect, useRef, useState } from 'react'
import { longDate } from '../lib/stats'
import { phoneApi, type PhonePlayer } from '../lib/remoteCheckin'

/** Remembers who checked in on this phone, to offer them first next time. */
const ME = 'mbq-me'
const remembered = () => {
  try {
    return localStorage.getItem(ME)
  } catch {
    return null
  }
}
const remember = (id: string) => {
  try {
    localStorage.setItem(ME, id)
  } catch {
    // Private browsing: they just pick their name again next time.
  }
}
/** The PIN that worked for this check-in, so reopening the link doesn't ask again. */
const pinKey = (code: string) => `mbq-pin-${code}`
const savedPin = (code: string) => {
  try {
    return localStorage.getItem(pinKey(code)) ?? ''
  } catch {
    return ''
  }
}
const savePin = (code: string, pin: string) => {
  try {
    localStorage.setItem(pinKey(code), pin)
  } catch {
    // They enter it again next time.
  }
}

type Load =
  | { state: 'loading' }
  | { state: 'pin'; why?: 'wrong' | 'changed' }
  | { state: 'locked' }
  | { state: 'closed' }
  | { state: 'offline' }
  | { state: 'ready'; date: string; players: PhonePlayer[] }
type ApiError = { status?: number; message?: string }

/**
 * What a failed request means for the page; undefined for anything else.
 * typed: the PIN was entered just now, not saved from before.
 */
const failure = (e: ApiError, pin: string, typed: boolean): Load | undefined =>
  e.status === 404
    ? { state: 'closed' }
    : e.status === 401
      ? { state: 'pin', why: !pin ? undefined : typed ? 'wrong' : 'changed' }
      : e.message === 'locked'
        ? { state: 'locked' }
        : undefined
type Done = { name: string; at: number | null; isNew?: boolean }

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** What players see on their phone after scanning the QR code: tap your name to check in. */
export function PlayerCheckinPage({ code }: { code: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<PhonePlayer | null>(null)
  const [newName, setNewName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [me, setMe] = useState(remembered)
  const [pin, setPin] = useState(() => savedPin(code))
  const [pinInput, setPinInput] = useState('')
  // Whether the PIN was entered on this visit (not saved from before), without reloading the names.
  const typed = useRef(false)

  const refresh = useCallback(() => {
    phoneApi.players(code, pin).then(
      (r) => {
        savePin(code, pin)
        setLoad({ state: 'ready', ...r })
      },
      (e: ApiError) => setLoad(failure(e, pin, typed.current) ?? { state: 'offline' }),
    )
  }, [code, pin])
  useEffect(refresh, [refresh])

  const enterPin = (value: string) => {
    setPinInput(value)
    if (value.length < 4) return
    setLoad({ state: 'loading' })
    setPinInput('')
    typed.current = true
    // A new PIN reloads the names with it.
    if (value === pin) refresh()
    else setPin(value)
  }

  const send = async (who: { id: string } | { name: string }, name: string) => {
    setBusy(true)
    setFailed(false)
    try {
      const r = await phoneApi.checkIn(code, pin, who)
      if ('id' in who) {
        remember(who.id)
        setMe(who.id)
      }
      setDone({ name, at: r.at, isNew: 'name' in who })
      setPicked(null)
      setNewName(null)
      setQuery('')
      refresh()
    } catch (e) {
      // The host may have changed the PIN since.
      const next = failure(e as ApiError, pin, false)
      if (next) {
        setLoad(next)
        setPicked(null)
        setNewName(null)
      } else setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative h-full overflow-y-auto bg-slate-100 pb-[env(safe-area-inset-bottom)]">
      {/* Teal band behind the header; the cards overlap its lower edge. */}
      <div className="absolute inset-x-0 top-0 h-[calc(env(safe-area-inset-top)+10rem)] rounded-b-[2rem] bg-gradient-to-br from-teal-700 to-teal-500" />
      <div className="relative mx-auto max-w-md px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-10">
        <header className="text-white">
          <p className="text-sm font-semibold text-teal-100">My Badminton Queue</p>
          <h1 className="text-3xl font-black tracking-tight">Check in</h1>
          {load.state === 'ready' && load.date && <p className="text-teal-100">{longDate(load.date)}</p>}
        </header>

        <main className="mt-5">
          {load.state === 'loading' && <Card>Loading…</Card>}
          {load.state === 'pin' && (
            <Card>
              <h2 className="text-xl font-bold">Enter the PIN</h2>
              <p className="mt-1 text-slate-600">Ask the host for today&apos;s PIN.</p>
              <input
                className="field mt-4 text-center font-mono text-4xl font-bold tracking-[0.5em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                aria-label="PIN"
                maxLength={4}
                value={pinInput}
                onChange={(e) => enterPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
              {load.why === 'wrong' && <p className="mt-3 font-semibold text-rose-700">That PIN isn&apos;t right. Try again.</p>}
              {load.why === 'changed' && (
                <p className="mt-3 font-semibold text-amber-700">The PIN has changed. Ask the host for the new one.</p>
              )}
            </Card>
          )}
          {load.state === 'locked' && (
            <Card>
              <h2 className="text-xl font-bold">Check-in is paused</h2>
              <p className="mt-1 text-slate-600">
                Too many wrong PINs were tried. Ask the host to set a new PIN, then try again.
              </p>
              <button className="d-btn d-btn-primary mt-4 h-12 w-full text-base" onClick={() => setLoad({ state: 'pin' })}>
                Enter the new PIN
              </button>
            </Card>
          )}
          {load.state === 'closed' && (
            <Card>
              <h2 className="text-xl font-bold">This check-in has ended</h2>
              <p className="mt-1 text-slate-600">Ask the host for today&apos;s QR code or link.</p>
            </Card>
          )}
          {load.state === 'offline' && (
            <Card>
              <h2 className="text-xl font-bold">Can&apos;t connect</h2>
              <p className="mt-1 text-slate-600">Check your signal, then try again.</p>
              <button className="d-btn d-btn-primary mt-4 h-12 w-full text-base" onClick={refresh}>
                Try again
              </button>
            </Card>
          )}
          {load.state === 'ready' && done && (
            <Card>
              <div className="flex flex-col items-center py-4 text-center">
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-white motion-safe:animate-just-in">
                  <svg viewBox="0 0 24 24" className="h-11 w-11" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12l4 4L19 6" />
                  </svg>
                </span>
                {done.isNew ? (
                  <>
                    <h2 className="mt-4 text-2xl font-black">Thanks, {done.name}!</h2>
                    <p className="mt-1 text-slate-600">
                      You arrived at {time(done.at!)}. The host will add you to the list.
                    </p>
                  </>
                ) : done.at ? (
                  <>
                    <h2 className="mt-4 text-2xl font-black">You&apos;re in, {done.name}!</h2>
                    <p className="mt-1 text-slate-600">Checked in at {time(done.at)}. See you on court.</p>
                  </>
                ) : (
                  <>
                    <h2 className="mt-4 text-2xl font-black">{done.name}, you&apos;re already in</h2>
                    <p className="mt-1 text-slate-600">No need to check in again.</p>
                  </>
                )}
                <button className="d-btn d-btn-ghost mt-5 text-teal-700" onClick={() => setDone(null)}>
                  Check in someone else
                </button>
              </div>
            </Card>
          )}
          {load.state === 'ready' && !done && (
            <List
              players={load.players}
              me={me}
              query={query}
              setQuery={setQuery}
              onPick={setPicked}
              onNotMe={() => setMe(null)}
              onNew={() => setNewName('')}
            />
          )}
        </main>
      </div>

      {(picked || newName !== null) && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-900/40" onClick={() => !busy && (setPicked(null), setNewName(null))}>
          <div
            className="mx-auto w-full max-w-md rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] motion-safe:animate-toast-in"
            onClick={(e) => e.stopPropagation()}
          >
            {picked ? (
              <>
                <h2 className="text-2xl font-black">Check in as {picked.name}?</h2>
                <p className="mt-1 text-slate-600">You&apos;ll join the queue in the order you arrived.</p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-black">Not on the list?</h2>
                <label className="mt-3 block text-sm font-semibold text-slate-600" htmlFor="new-name">
                  Your name
                </label>
                <input
                  id="new-name"
                  className="field mt-1"
                  autoFocus
                  maxLength={40}
                  autoComplete="name"
                  value={newName ?? ''}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </>
            )}
            {failed && <p className="mt-3 font-semibold text-rose-700">Didn&apos;t go through. Check your signal and try again.</p>}
            <button
              className="d-btn d-btn-primary mt-5 h-14 w-full text-lg"
              disabled={busy || (!picked && !newName?.trim())}
              onClick={() => (picked ? send({ id: picked.id }, picked.name) : send({ name: newName!.trim() }, newName!.trim()))}
            >
              {busy ? <span className="d-loading d-loading-spinner" /> : 'Check in'}
            </button>
            <button
              className="d-btn d-btn-ghost mt-2 h-12 w-full"
              disabled={busy}
              onClick={() => {
                setPicked(null)
                setNewName(null)
                setFailed(false)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-3xl bg-white p-5 shadow-lg">{children}</div>
}

function List({
  players,
  me,
  query,
  setQuery,
  onPick,
  onNotMe,
  onNew,
}: {
  players: PhonePlayer[]
  me: string | null
  query: string
  setQuery: (q: string) => void
  onPick: (p: PhonePlayer) => void
  onNotMe: () => void
  onNew: () => void
}) {
  const mine = players.find((p) => p.id === me)
  const shown = players
    .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(a.in) - Number(b.in) || a.name.localeCompare(b.name))

  return (
    <div className="space-y-4">
      {mine && !mine.in && (
        <div className="rounded-3xl bg-white p-5 shadow-lg">
          <p className="text-slate-600">Welcome back</p>
          <button className="d-btn d-btn-primary mt-2 h-14 w-full text-lg" onClick={() => onPick(mine)}>
            Check in as {mine.name}
          </button>
          <button className="mt-2 w-full text-center text-sm font-semibold text-teal-700" onClick={onNotMe}>
            Not {mine.name}?
          </button>
        </div>
      )}

      <div className="rounded-3xl bg-white p-4 shadow-lg">
        <input
          className="field"
          type="search"
          placeholder="Find your name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="mt-3 divide-y divide-slate-100">
          {shown.map((p) => (
            <li key={p.id}>
              <button
                className="flex w-full items-center gap-3 py-3.5 text-left disabled:opacity-50"
                disabled={p.in}
                onClick={() => onPick(p)}
              >
                <span className="flex-1 text-lg font-semibold">{p.name}</span>
                {p.in ? (
                  <span className="text-sm font-semibold text-emerald-700">Checked in</span>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-300" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                )}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="py-3 text-slate-500">No one matches.</li>}
        </ul>
        <button className="d-btn d-btn-ghost mt-2 w-full text-teal-700" onClick={onNew}>
          Not on the list? Add your name
        </button>
      </div>
    </div>
  )
}
