import type { Scope } from '../lib/scope'
import { longDate } from '../lib/stats'
import type { Session } from '../types'

const played = (list: Session[]) => list.filter((s) => s.games.length).length
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** Pick the sessions the stats cover (see useScope). */
export function SessionSelect({
  scope,
  onChange,
  session,
  history,
  all,
  recent,
  current = 'Today (current)',
  className = '',
}: {
  scope: Scope
  onChange: (scope: Scope) => void
  session: Session
  history: Session[]
  all: Session[]
  recent: Session[]
  /** The open session's name; leave it out when null. */
  current?: string | null
  className?: string
}) {
  return (
    <select
      className={`d-select font-semibold ${className}`}
      aria-label="Sessions to show"
      value={scope}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="all">All time · {played(all)} sessions</option>
      <option value="3m">Last 3 months · {played(recent)} sessions</option>
      {current !== null && (
        <option value={session.id}>
          {current} · {session.games.length} games
        </option>
      )}
      {history.map((s) => (
        <option key={s.id} value={s.id}>
          {longDate(s.date)}
          {s.games.length > 0 && ` · ${clock(Math.min(...s.games.map((g) => g.startedAt)))}`}
          {` · ${s.games.length} games`}
        </option>
      ))}
    </select>
  )
}
