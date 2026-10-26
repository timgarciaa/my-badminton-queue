import { useState } from 'react'
import {
  CLOUD,
  type ClubSnapshot,
  fetchClub,
  fromDocs,
  keepThisDevice,
  signIn,
  signOut,
  takeClubData,
  useCloud,
  useSyncStatus,
} from '../lib/cloud'
import { useStore } from '../store/useStore'

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function CloudIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 18a4.5 4.5 0 01-.6-8.96A6 6 0 0118 8.5a4 4 0 01-.5 9.5z" />
    </svg>
  )
}

const LABELS = {
  saved: 'Saved',
  saving: 'Saving…',
  offline: 'Offline, will save',
  conflict: 'Not saved',
  expired: 'Not saved',
} as const

/** Next to the title while signed in: the club, and whether changes are saved. */
export function CloudStatus({ onOpen }: { onOpen: () => void }) {
  const club = useCloud((s) => s.club)
  const status = useSyncStatus((s) => s.status)
  if (!CLOUD || !club) return null
  const ok = status === 'saved' || status === 'saving'
  return (
    <button
      onClick={onOpen}
      className={`flex items-center gap-1 text-sm font-semibold ${ok ? 'text-teal-600/80' : 'text-amber-700'}`}
      title="Club account"
    >
      <CloudIcon />
      <span className="max-w-40 truncate">{club.name}</span>
      <span className="font-normal opacity-80">· {LABELS[status]}</span>
    </button>
  )
}

/** Shown under the header when saving needs the organizer: changed elsewhere, or signed out. */
export function CloudBanner({ onSignIn }: { onSignIn: () => void }) {
  const club = useCloud((s) => s.club)
  const status = useSyncStatus((s) => s.status)
  const [busy, setBusy] = useState(false)
  if (!CLOUD || !club || (status !== 'conflict' && status !== 'expired')) return null

  const resolve = async (keep: 'club' | 'device') => {
    if (keep === 'device' && !confirm(`Replace ${club.name}'s data in the cloud with this iPad's?`)) return
    setBusy(true)
    try {
      const snap = await fetchClub()
      if (keep === 'club') takeClubData(snap)
      else keepThisDevice(snap)
    } catch {
      alert("Couldn't reach the club. Check the internet connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="alert" className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-amber-900">
      <CloudIcon className="h-5 w-5 shrink-0" />
      {status === 'conflict' ? (
        <>
          <span className="flex-1">
            <strong>{club.name}</strong> was changed on another device, so this iPad&apos;s changes aren&apos;t saved.
          </span>
          <button className="d-btn d-btn-sm" disabled={busy} onClick={() => resolve('club')}>
            Use the club&apos;s data
          </button>
          <button className="d-btn d-btn-sm d-btn-warning" disabled={busy} onClick={() => resolve('device')}>
            Keep this iPad&apos;s
          </button>
        </>
      ) : (
        <>
          <span className="flex-1">
            Signed out of <strong>{club.name}</strong>. Sign in again to keep saving; this iPad keeps working meanwhile.
          </span>
          <button className="d-btn d-btn-sm d-btn-warning" onClick={onSignIn}>
            Sign in
          </button>
        </>
      )}
    </div>
  )
}

/** Settings card: sign in to a club, see that it's saving, sign out. */
export function ClubAccountCard() {
  const auth = useCloud((s) => s.auth)
  const club = useCloud((s) => s.club)
  const status = useSyncStatus((s) => s.status)
  const savedAt = useSyncStatus((s) => s.savedAt)
  const [username, setUsername] = useState(auth?.username ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<ClubSnapshot | null>(null)
  if (!CLOUD) return null

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { snap, choice } = await signIn(username, password)
      setPassword('')
      if (choice === 'upload') keepThisDevice(snap)
      else if (choice === 'download') takeClubData(snap)
      else setChoosing(snap)
    } catch (e) {
      setError(e instanceof TypeError ? "Can't connect. Check the internet connection." : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const signedIn = auth && club && status !== 'expired'

  return (
    <div className="d-card d-card-border bg-base-100 shadow-sm">
      <div className="d-card-body gap-3 p-4">
        <h2 className="d-card-title text-lg">
          <CloudIcon className="h-5 w-5 text-teal-700" />
          Club account
        </h2>
        {signedIn ? (
          <>
            <p className="text-sm text-slate-600">
              Signed in as <strong>{auth.username}</strong>. This iPad saves to <strong>{club.name}</strong> a few seconds
              after each change, and catches up when it&apos;s back online.
            </p>
            <p className="text-sm font-semibold text-teal-700">
              {LABELS[status]}
              {status === 'saved' && savedAt && ` at ${time(savedAt)}`}
            </p>
            <button
              className="d-btn d-btn-sm self-start"
              onClick={() =>
                confirm(`Sign out of ${club.name}? This iPad keeps its data but stops saving to the club.`) && signOut()
              }
            >
              Sign out
            </button>
          </>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <p className="text-sm text-slate-600">
              Organizers sign in to save this iPad&apos;s players and sessions to their club, so nothing is lost if the
              iPad is.
            </p>
            <input
              className="field py-2 text-base"
              placeholder="Username"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              className="field py-2 text-base"
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
            <button className="d-btn d-btn-primary w-full" disabled={busy || !username.trim() || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
      {choosing && <ChooseDataDialog snap={choosing} onDone={() => setChoosing(null)} />}
    </div>
  )
}

/** Both the club and this iPad have data: the organizer picks which to keep. */
function ChooseDataDialog({ snap, onDone }: { snap: ClubSnapshot; onDone: () => void }) {
  const players = useStore((s) => s.players)
  const history = useStore((s) => s.history)
  const theirs = fromDocs(snap.docs)
  const summary = (p: number, h: number) => `${plural(p, 'player')}, ${plural(h, 'past session')}`

  return (
    <div className="d-modal d-modal-open" role="dialog" aria-modal="true" aria-labelledby="choose-data-title">
      <div className="d-modal-box max-w-xl space-y-4">
        <div>
          <h2 id="choose-data-title" className="text-xl font-bold">
            Which data should {snap.club.name} use?
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            The club and this iPad both have data. Pick one to keep; the other is replaced. Not sure? Cancel and export
            a backup first (Backup, below).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            className="rounded-2xl border-2 border-slate-200 p-4 text-left hover:border-teal-500"
            onClick={() => {
              takeClubData(snap)
              onDone()
            }}
          >
            <span className="block font-bold">The club&apos;s data</span>
            <span className="block text-sm text-slate-600">{summary(theirs.players.length, theirs.history.length)}</span>
            <span className="mt-2 block text-sm font-semibold text-teal-700">Use it on this iPad</span>
          </button>
          <button
            className="rounded-2xl border-2 border-slate-200 p-4 text-left hover:border-teal-500"
            onClick={() => {
              keepThisDevice(snap)
              onDone()
            }}
          >
            <span className="block font-bold">This iPad&apos;s data</span>
            <span className="block text-sm text-slate-600">{summary(players.length, history.length)}</span>
            <span className="mt-2 block text-sm font-semibold text-teal-700">Save it to the club</span>
          </button>
        </div>
        <div className="d-modal-action mt-0">
          <button
            className="d-btn"
            onClick={() => {
              signOut()
              onDone()
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
