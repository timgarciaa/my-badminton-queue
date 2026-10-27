import { useCallback, useEffect, useState } from 'react'
import {
  CLOUD,
  type ClubSnapshot,
  decideMember,
  fetchClub,
  fetchMembers,
  fromDocs,
  keepThisDevice,
  type Member,
  signOut,
  takeClubData,
  useCloud,
  useSyncStatus,
} from '../lib/cloud'
import { exportBackup } from '../lib/backup'
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

/** Shown under the header when the club was changed on another device, so saving needs the organizer. */
export function CloudBanner() {
  const club = useCloud((s) => s.club)
  const status = useSyncStatus((s) => s.status)
  const [busy, setBusy] = useState(false)
  if (!CLOUD || !club || status !== 'conflict') return null

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
      <span className="flex-1">
        <strong>{club.name}</strong> was changed on another device, so this iPad&apos;s changes aren&apos;t saved.
      </span>
      <button className="d-btn d-btn-sm" disabled={busy} onClick={() => resolve('club')}>
        Use the club&apos;s data
      </button>
      <button className="d-btn d-btn-sm d-btn-warning" disabled={busy} onClick={() => resolve('device')}>
        Keep this iPad&apos;s
      </button>
    </div>
  )
}

/** Settings card: the club this iPad saves to, its join code, its organizers, and signing out. */
export function ClubAccountCard() {
  const auth = useCloud((s) => s.auth)
  const club = useCloud((s) => s.club)
  const status = useSyncStatus((s) => s.status)
  const savedAt = useSyncStatus((s) => s.savedAt)
  if (!CLOUD || !auth || !club) return null

  return (
    <div className="d-card d-card-border bg-base-100 shadow-sm">
      <div className="d-card-body gap-3 p-4">
        <h2 className="d-card-title text-lg">
          <CloudIcon className="h-5 w-5 text-teal-700" />
          {club.name}
        </h2>
        <p className="text-sm text-slate-600">
          Signed in as <strong>{auth.username}</strong>. This iPad saves to the club a few seconds after each change,
          and catches up when it&apos;s back online.
        </p>
        <p className={`text-sm font-semibold ${status === 'saved' || status === 'saving' ? 'text-teal-700' : 'text-amber-700'}`}>
          {LABELS[status]}
          {status === 'saved' && savedAt && ` at ${time(savedAt)}`}
        </p>
        {club.code && (
          <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            <div className="text-xs font-bold tracking-wide text-slate-500 uppercase">Join code</div>
            <div className="font-mono text-2xl font-black tracking-[0.2em] text-slate-800 select-text">{club.code}</div>
            <p className="text-xs text-slate-500">
              New organizers enter this when they create an account. You approve them here.
            </p>
          </div>
        )}
        <Organizers me={auth.username} />
        <button
          className="d-btn d-btn-sm self-start"
          onClick={() =>
            confirm(`Sign out of ${club.name}? This iPad keeps its data but stops saving to the club.`) && signOut()
          }
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

/** The club's organizers, and people asking to join: approve or decline. */
function Organizers({ me }: { me: string }) {
  const waiting = useSyncStatus((s) => s.waiting)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchMembers().then(
      (m) => {
        setMembers(m)
        setFailed(false)
      },
      () => setFailed(true),
    )
  }, [])
  // Reload when the count of people waiting changes (checked every few minutes).
  useEffect(load, [load, waiting])

  const decide = async (m: Member, approve: boolean) => {
    if (!approve) {
      const ask = m.approved
        ? `Remove ${m.username} as an organizer? Their account is deleted.`
        : `Decline ${m.username}'s request to join?`
      if (!confirm(ask)) return
    }
    setBusy(m.username)
    try {
      await decideMember(m.username, approve)
      load()
    } catch {
      alert("Couldn't reach the club. Check the internet connection and try again.")
    } finally {
      setBusy(null)
    }
  }

  if (failed) return <p className="text-sm text-slate-500">Organizers show here when the iPad is online.</p>
  if (!members) return null
  const requests = members.filter((m) => !m.approved)
  const organizers = members.filter((m) => m.approved)

  return (
    <div className="space-y-2">
      {requests.length > 0 && (
        <div className="rounded-xl bg-sky-50 p-2 ring-1 ring-sky-200">
          <div className="px-1 text-xs font-bold tracking-wide text-sky-800 uppercase">
            Asking to join ({requests.length})
          </div>
          <ul>
            {requests.map((m) => (
              <li key={m.username} className="flex items-center gap-2 px-1 py-1.5">
                <span className="min-w-0 flex-1 truncate font-semibold">{m.username}</span>
                <button className="d-btn d-btn-primary d-btn-xs" disabled={busy === m.username} onClick={() => decide(m, true)}>
                  Approve
                </button>
                <button className="d-btn d-btn-ghost d-btn-xs" disabled={busy === m.username} onClick={() => decide(m, false)}>
                  Decline
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <div className="text-xs font-bold tracking-wide text-slate-500 uppercase">Organizers</div>
        <ul>
          {organizers.map((m) => (
            <li key={m.username} className="flex items-center gap-2 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {m.username}
                {m.username === me && <span className="text-slate-400"> (you)</span>}
              </span>
              {m.username !== me && (
                <button
                  className="d-btn d-btn-ghost d-btn-xs text-rose-700"
                  disabled={busy === m.username}
                  onClick={() => decide(m, false)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Both the club and this iPad have data: the organizer picks which to keep. */
export function ChooseDataDialog({ snap, onDone }: { snap: ClubSnapshot; onDone: () => void }) {
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
            The club and this iPad have different data. Pick one to keep; the other is replaced. Not sure? Download a
            backup of this iPad&apos;s data first.
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
        <div className="d-modal-action mt-0 justify-between">
          <button className="d-btn d-btn-ghost" onClick={() => exportBackup()}>
            Download backup
          </button>
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
