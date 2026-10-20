import { useEffect, useRef, useState } from 'react'
import { EmptyState, Initials, PlayerTags } from '../components/ui'
import { useStore } from '../store/useStore'
import type { Player } from '../types'

type Status = 'queue' | 'court' | 'resting'
type Filter = 'all' | Status
type Sort = 'first' | 'latest' | 'name'

/** How long a tapped tile animates before the player moves to Checked in. */
const CONFIRM_MS = 350
/** How long a just-checked-in card stays highlighted. */
const RECENT_MS = 4000

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/**
 * Check-in is one-way: tapping a name only ever checks the player in.
 * Checking out (for mistakes) is a separate, confirmed button, so a double
 * tap can never drop someone to the back of the queue.
 */
export function CheckInPage({ onGoToPlayers }: { onGoToPlayers: () => void }) {
  const players = useStore((s) => s.players)
  const session = useStore((s) => s.session)
  const checkIn = useStore((s) => s.checkIn)
  const checkOut = useStore((s) => s.checkOut)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  // Check-in order by default, first to arrive at the top.
  const [sort, setSort] = useState<Sort>('first')
  // Tiles playing their confirm animation, and cards to highlight after.
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const [recent, setRecent] = useState<Set<string>>(new Set())
  const [justIn, setJustIn] = useState<Player | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))
  const without = (set: Set<string>, id: string) => {
    const next = new Set(set)
    next.delete(id)
    return next
  }

  // Hide the toast after a few seconds.
  useEffect(() => {
    if (!justIn) return
    const t = setTimeout(() => setJustIn(null), 6000)
    return () => clearTimeout(t)
  }, [justIn])

  const attendees = new Map(session.attendees.map((a) => [a.playerId, a]))
  const courtOf = new Map(
    session.games.filter((g) => !g.endedAt).flatMap((g) => [...g.teamA, ...g.teamB].map((id) => [id, g.court])),
  )
  const statusOf = (p: Player): Status =>
    courtOf.has(p.id) ? 'court' : attendees.get(p.id)?.resting ? 'resting' : 'queue'
  const matches = (p: Player) => p.active && p.name.toLowerCase().includes(query.toLowerCase())
  const byName = (a: Player, b: Player) => a.name.localeCompare(b.name)
  const notHere = players.filter((p) => matches(p) && !attendees.has(p.id)).sort(byName)
  const present = players.filter((p) => attendees.has(p.id))
  const here = present
    .filter(matches)
    .filter((p) => filter === 'all' || statusOf(p) === filter)
    .sort((a, b) => {
      if (sort === 'name') return byName(a, b)
      const diff = attendees.get(a.id)!.checkedInAt - attendees.get(b.id)!.checkedInAt
      return sort === 'first' ? diff : -diff
    })
  const count = (st: Status) => present.filter((p) => statusOf(p) === st).length
  const males = present.filter((p) => p.gender === 'M').length
  const females = present.filter((p) => p.gender === 'F').length

  // Confirm on the tile first, then move the player across and highlight them.
  const tapIn = (p: Player) => {
    if (leaving.has(p.id)) return
    setLeaving((s) => new Set(s).add(p.id))
    later(() => {
      checkIn(p.id)
      setLeaving((s) => without(s, p.id))
      setRecent((s) => new Set(s).add(p.id))
      setJustIn(p)
      later(() => setRecent((s) => without(s, p.id)), RECENT_MS)
    }, CONFIRM_MS)
  }

  if (players.length === 0) {
    return (
      <div className="p-6">
        <EmptyState>
          No players yet.{' '}
          <button className="font-semibold text-teal-700 underline" onClick={onGoToPlayers}>
            Add players
          </button>
        </EmptyState>
      </div>
    )
  }

  const queuePos = justIn ? session.queue.indexOf(justIn.id) + 1 : 0

  return (
    <div className="space-y-5 p-5 pb-24">
      <div className="flex items-center gap-4">
        <input
          className="field max-w-sm py-2.5 text-base"
          placeholder="Find player"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex items-baseline gap-2">
          <strong className="text-3xl font-black text-teal-700 tabular-nums">{present.length}</strong>
          <span className="text-slate-600">present</span>
        </div>
        <div className="flex gap-1.5">
          <span className="d-badge border-indigo-200 bg-indigo-50 font-semibold text-indigo-800">{males} male</span>
          <span className="d-badge border-pink-200 bg-pink-50 font-semibold text-pink-800">{females} female</span>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
          Not here yet ({notHere.length}) · tap to check in
        </h2>
        {notHere.length === 0 ? (
          <p className="text-slate-500">{query ? 'No one matches.' : 'Everyone is checked in.'}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-2.5">
            {notHere.map((p) => {
              const going = leaving.has(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => tapIn(p)}
                  className={`flex items-center gap-3 rounded-2xl border-2 px-3 py-3 text-left transition active:scale-[0.96] ${
                    going
                      ? 'border-emerald-400 bg-emerald-50 motion-safe:animate-check-out'
                      : 'border-dashed border-slate-300 bg-white active:border-teal-500'
                  }`}
                >
                  <Initials player={p} muted={!going} size="w-10" />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block text-lg leading-tight font-semibold text-slate-800">{p.name}</span>
                    <PlayerTags player={p} />
                  </span>
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${
                      going ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'
                    }`}
                    aria-hidden
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d={going ? 'M5 12l4 4L19 6' : 'M12 5v14M5 12h14'} />
                    </svg>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold tracking-wide text-slate-500 uppercase">Checked in ({present.length})</h2>
          <div role="tablist" className="d-tabs d-tabs-box d-tabs-sm">
            {(
              [
                ['all', 'All', present.length],
                ['queue', 'In queue', count('queue')],
                ['court', 'On court', count('court')],
                ['resting', 'Resting', count('resting')],
              ] as const
            ).map(([id, label, n]) => (
              <button
                key={id}
                role="tab"
                className={`d-tab gap-1 font-semibold ${filter === id ? 'd-tab-active' : ''}`}
                onClick={() => setFilter(id)}
              >
                {label} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>
          <div role="tablist" className="d-tabs d-tabs-box d-tabs-sm ml-auto">
            {(
              [
                ['first', 'First in'],
                ['latest', 'Latest in'],
                ['name', 'A–Z'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                className={`d-tab font-semibold ${sort === id ? 'd-tab-active' : ''}`}
                onClick={() => setSort(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {here.length === 0 ? (
          <p className="text-slate-500">{query || filter !== 'all' ? 'No one matches.' : 'Nobody yet.'}</p>
        ) : (
          // Every card is one size: rows share a height and text stays on one line each.
          <div className="grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2.5">
            {here.map((p) => {
              const a = attendees.get(p.id)!
              const st = statusOf(p)
              const canCheckOut = st !== 'court' && a.gamesPlayed === 0
              const isNew = recent.has(p.id)
              return (
                <div
                  key={p.id}
                  className={`d-card d-card-border relative flex-row items-center gap-3 bg-emerald-50 px-3 py-2.5 ${
                    isNew ? 'border-emerald-400 motion-safe:animate-just-in' : 'border-emerald-200'
                  }`}
                >
                  <Initials player={p} size="w-10" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2 pr-6">
                      <span className="truncate text-lg leading-tight font-semibold" title={p.name}>
                        {p.name}
                      </span>
                      <PlayerTags player={p} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-x-1.5 overflow-hidden text-xs whitespace-nowrap text-slate-500 tabular-nums">
                      {isNew ? (
                        <span className="font-bold text-emerald-700">Just checked in</span>
                      ) : (
                        <span
                          className={`font-semibold ${
                            st === 'court' ? 'text-emerald-700' : st === 'resting' ? 'text-amber-700' : 'text-teal-700'
                          }`}
                        >
                          {st === 'court' ? `On court ${courtOf.get(p.id)}` : st === 'resting' ? 'Resting' : 'In queue'}
                        </span>
                      )}
                      <span>·</span>
                      <span>
                        {a.gamesPlayed} {a.gamesPlayed === 1 ? 'game' : 'games'}
                      </span>
                      <span>·</span>
                      <span title="Checked in">
                        {new Date(a.checkedInAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  {canCheckOut && (
                    <button
                      className="d-btn d-btn-ghost d-btn-xs d-btn-square absolute top-1.5 right-1.5 text-slate-400"
                      aria-label={`Check out ${p.name}`}
                      title="Check out"
                      onClick={() => confirm(`Check out ${p.name}? They will be removed from the queue.`) && checkOut(p.id)}
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <p className="mt-3 text-sm text-slate-500">
          Leaving early or taking a break? Use <strong>Rest</strong> in the queue on the Courts tab — they keep their
          games and still share the cost.
        </p>
      </section>

      {justIn && (
        <div className="d-toast d-toast-center bottom-20 z-40">
          <div key={justIn.id} className="d-alert d-alert-success gap-4 shadow-lg motion-safe:animate-toast-in">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l4 4L19 6" />
            </svg>
            <span>
              <strong>{justIn.name}</strong> checked in
              {queuePos > 0 && <span className="opacity-80"> · {ordinal(queuePos)} in the queue</span>}
            </span>
            <button
              className="d-btn d-btn-sm border-white/40 bg-white/20 text-white"
              onClick={() => {
                checkOut(justIn.id)
                setJustIn(null)
              }}
            >
              Undo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
