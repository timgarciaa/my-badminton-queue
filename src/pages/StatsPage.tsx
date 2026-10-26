import { createContext, useContext, useState, type ReactNode } from 'react'
import { shuttlesUsed } from '../lib/cost'
import {
  arrivals,
  bestRecord,
  duoRecords,
  finishedGames,
  gameExtremes,
  gameTime,
  longDate,
  mostOften,
  playedGames,
  playerRecords,
  rivalries,
  sessionsWithin,
  streaks,
  winRate,
  worstRecord,
  type PlayerRecord,
} from '../lib/stats'
import { ShareIcon, Standings } from '../components/Standings'
import { EmptyState } from '../components/ui'
import { awardImage, shareImage, type AwardTone } from '../lib/shareImage'
import { usePlayerMap, useStore } from '../store/useStore'
import type { Pair, Session } from '../types'

/** 'all', the last three months ('3m'), or a session id. */
type Scope = string

const pct = (r: PlayerRecord) => {
  const rate = winRate(r)
  return rate === null ? '–' : `${Math.round(rate * 100)}%`
}
const record = (r: PlayerRecord) => `${r.wins}–${r.losses}`

/**
 * Analytics over past sessions: pick all time, the last 3 months or one
 * session to see its summary, awards (best and worst duos, streaks,
 * rivalries) and tables.
 */
export function StatsPage() {
  const session = useStore((s) => s.session)
  const history = useStore((s) => s.history)
  const players = usePlayerMap()
  const [scope, setScope] = useState<Scope>('all')

  const all = [session, ...history]
  const recent = sessionsWithin(all, 3)
  const played = (list: Session[]) => list.filter((s) => s.games.length).length
  const sessions = scope === 'all' ? all : scope === '3m' ? recent : all.filter((s) => s.id === scope)
  const span = scope === 'all' || scope === '3m'
  const games = playedGames(sessions)
  const label =
    scope === 'all'
      ? 'All time'
      : scope === '3m'
        ? 'Last 3 months'
        : `${longDate(sessions[0]?.date ?? session.date)}${scope === session.id ? ' · today' : ''}`
  const name = (id: string) => players.get(id)?.name ?? 'Removed player'
  const names = (p: Pair) => p.map(name).sort((a, b) => a.localeCompare(b)).join(' & ')

  return (
    <div className="h-full space-y-5 overflow-y-auto p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">Stats</h2>
        <select
          className="d-select w-72 font-semibold"
          aria-label="Sessions to show"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="all">All time · {played(all)} sessions</option>
          <option value="3m">Last 3 months · {played(recent)} sessions</option>
          <option value={session.id}>Today (current) · {session.games.length} games</option>
          {history.map((s) => (
            <option key={s.id} value={s.id}>
              {longDate(s.date)}
              {s.games.length > 0 &&
                ` · ${new Date(Math.min(...s.games.map((g) => g.startedAt))).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
              {` · ${s.games.length} games`}
            </option>
          ))}
        </select>
      </div>

      <Overview sessions={sessions} />

      {games.length === 0 ? (
        <EmptyState>
          {scope === '3m'
            ? 'No finished games in the last 3 months.'
            : scope === session.id || history.length === 0
              ? 'Stats show up once games are finished. End a session on the Costs tab to keep it in history.'
              : 'No finished games in this session.'}
        </EmptyState>
      ) : (
        <ScopeLabel.Provider value={label}>
          <Dashboard games={games} sessions={sessions} showDate={span} name={name} names={names} />
        </ScopeLabel.Provider>
      )}
    </div>
  )
}

/** Totals for the chosen sessions. */
function Overview({ sessions }: { sessions: Session[] }) {
  const games = playedGames(sessions)
  const outOfHours = games.filter((g) => !g.winner && g.outOfHours).length
  const noResult = games.filter((g) => !g.winner).length - outOfHours
  const undecided = [noResult && `${noResult} with no result`, outOfHours && `${outOfHours} out of hours`]
    .filter(Boolean)
    .join(' · ')
  const players = new Set(sessions.flatMap((s) => s.attendees.map((a) => a.playerId))).size
  const minutes = games.length
    ? Math.round(games.reduce((n, g) => n + (g.endedAt! - g.startedAt), 0) / games.length / 60_000)
    : 0
  const stats: [string, ReactNode, string?][] = [
    ['Sessions', sessions.filter((s) => s.games.length).length],
    ['Games', games.length, undecided || undefined],
    ['Players', players],
    ['Avg game', `${minutes} min`],
    ['Shuttles', sessions.reduce((n, s) => n + shuttlesUsed(s), 0)],
  ]
  return (
    <div className="d-stats d-stats-horizontal w-full overflow-hidden bg-base-100 shadow-sm ring-1 ring-slate-200">
      {stats.map(([title, value, desc]) => (
        <div key={title} className="d-stat py-3">
          <div className="d-stat-title">{title}</div>
          <div className="d-stat-value text-2xl tabular-nums">{value}</div>
          {desc && <div className="d-stat-desc">{desc}</div>}
        </div>
      ))}
    </div>
  )
}

function Dashboard({
  games,
  sessions,
  showDate,
  name,
  names,
}: {
  games: ReturnType<typeof playedGames>
  sessions: Session[]
  /** Show which session a game was in (all time). */
  showDate: boolean
  name: (id: string) => string
  names: (p: Pair) => string
}) {
  const duos = duoRecords(games)
  const runs = streaks(games)
  const records = [...playerRecords(games)].map(([id, r]) => ({ id, ...r }))
  const rival = rivalries(games).find((r) => r.met >= 2)

  const bestDuo = bestRecord(duos)
  const worstDuo = worstRecord(duos)
  const topBy = (f: (id: string) => number) => {
    const ids = [...runs.keys()]
    const top = Math.max(0, ...ids.map(f))
    return { top, ids: ids.filter((id) => f(id) === top) }
  }
  const winRun = topBy((id) => runs.get(id)!.wins)
  const lossRun = topBy((id) => runs.get(id)!.losses)
  const hot = topBy((id) => runs.get(id)!.current)
  const mostPlayed = Math.max(...records.map((r) => r.played))
  const iron = records.filter((r) => r.played === mostPlayed).map((r) => r.id)
  const bestPlayer = bestRecord(records, 3)
  const { longest, shortest } = gameExtremes(finishedGames(sessions))
  const which = (g: NonNullable<typeof longest>) => `Game ${g.number} · Court ${g.court}`
  const teams = (g: NonNullable<typeof longest>) =>
    `${names(g.teamA)} vs ${names(g.teamB)}${showDate ? ` · ${longDate(g.date)}` : ''}`
  // Arrivals: one session shows times; several show who was first or last most often.
  const arrived = arrivals(sessions)
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const early = mostOften(arrived.map((a) => a.first))
  const late = mostOften(arrived.map((a) => a.last))
  const often = (times: number, what: string) => `${what} in ${times} of ${arrived.length} sessions`
  const scope = useContext(ScopeLabel)
  const sessionCount = sessions.filter((s) => s.games.length).length
  const who = (ids: string[]) => (ids.length > 2 ? `${name(ids[0])}, ${name(ids[1])} +${ids.length - 2}` : ids.map(name).join(' & '))

  return (
    <>
      <div className="grid grid-cols-4 gap-4">
        <Award title="Unbeatable duo" tone="emerald" who={bestDuo && names(bestDuo.pair)} value={bestDuo && record(bestDuo)}>
          {bestDuo && `${pct(bestDuo)} · ${bestDuo.played} ${bestDuo.played === 1 ? 'game' : 'games'} together`}
        </Award>
        <Award title="Worst duo" tone="rose" who={worstDuo && names(worstDuo.pair)} value={worstDuo && record(worstDuo)}>
          {worstDuo && `${pct(worstDuo)} · ${worstDuo.played} ${worstDuo.played === 1 ? 'game' : 'games'} together`}
        </Award>
        <Award
          title="Longest win streak"
          tone="amber"
          who={winRun.top ? who(winRun.ids) : undefined}
          value={winRun.top ? `${winRun.top} ${winRun.top === 1 ? 'win' : 'wins'}` : undefined}
        >
          in a row
        </Award>
        <Award
          title="Longest losing run"
          tone="slate"
          who={lossRun.top ? who(lossRun.ids) : undefined}
          value={lossRun.top ? `${lossRun.top} ${lossRun.top === 1 ? 'loss' : 'losses'}` : undefined}
        >
          in a row
        </Award>
        <Award
          title="On a roll"
          tone="orange"
          who={hot.top >= 2 ? who(hot.ids) : undefined}
          value={hot.top >= 2 ? `${hot.top} wins` : undefined}
          empty="Nobody has won 2 in a row lately"
        >
          and counting
        </Award>
        <Award title="Best win rate" tone="violet" who={bestPlayer && name(bestPlayer.id)} value={bestPlayer && pct(bestPlayer)}>
          {bestPlayer && `${record(bestPlayer)} in ${bestPlayer.wins + bestPlayer.losses} decided games`}
        </Award>
        <Award title="Most games" tone="sky" who={who(iron)} value={`${mostPlayed} games`}>
          {iron.length > 1 ? `${iron.length} players tied` : 'played'}
        </Award>
        <Award
          title="Biggest rivalry"
          tone="teal"
          who={rival && `${name(rival.pair[0])} vs ${name(rival.pair[1])}`}
          value={rival && `${rival.wins[0]}–${rival.wins[1]}`}
          empty="No two players have faced each other twice"
        >
          {rival && `Met ${rival.met} times`}
        </Award>
        <Award title="Longest game" tone="indigo" who={longest && which(longest)} value={longest && gameTime(longest)}>
          {longest && teams(longest)}
        </Award>
        <Award
          title="Shortest game"
          tone="lime"
          who={shortest && which(shortest)}
          value={shortest && gameTime(shortest)}
          empty="No game lasted over a minute"
        >
          {shortest && teams(shortest)}
        </Award>
        <Award
          title="Early bird"
          tone="cyan"
          who={arrived.length ? who(early.ids) : undefined}
          value={arrived.length === 1 ? clock(arrived[0].firstAt) : arrived.length ? `${early.times}×` : undefined}
          empty="Needs at least two players checked in"
        >
          {arrived.length === 1 ? 'first to check in' : often(early.times, 'first to arrive')}
        </Award>
        <Award
          title="Last to arrive"
          tone="fuchsia"
          who={arrived.length ? who(late.ids) : undefined}
          value={arrived.length === 1 ? clock(arrived[0].lastAt) : arrived.length ? `${late.times}×` : undefined}
          empty="Needs at least two players checked in"
        >
          {arrived.length === 1
            ? `${Math.round((arrived[0].lastAt - arrived[0].firstAt) / 60_000)} min after the first`
            : often(late.times, 'last to arrive')}
        </Award>
      </div>

      <div className="grid grid-cols-2 items-start gap-5">
        <Standings
          games={games}
          title={scope === 'All time' ? 'All-time standings' : scope === 'Last 3 months' ? 'Standings · last 3 months' : 'Standings'}
          subtitle={
            showDate
              ? `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'} · ${games.length} games`
              : `${scope} · ${games.length} ${games.length === 1 ? 'game' : 'games'}`
          }
          filename={`standings-${scope.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`}
        />
        <div className="space-y-5">
          <DuoTable duos={duos} names={names} />
          <StreakTable runs={runs} records={records} name={name} />
        </div>
      </div>
    </>
  )
}

/** The games the dashboard covers, e.g. "Last 3 months"; printed on shared award cards. */
const ScopeLabel = createContext('')

const TONES: Record<AwardTone, string> = {
  emerald: 'border-t-emerald-500 text-emerald-700',
  rose: 'border-t-rose-500 text-rose-700',
  amber: 'border-t-amber-400 text-amber-700',
  slate: 'border-t-slate-400 text-slate-600',
  orange: 'border-t-orange-400 text-orange-700',
  violet: 'border-t-violet-500 text-violet-700',
  sky: 'border-t-sky-500 text-sky-700',
  teal: 'border-t-teal-600 text-teal-700',
  indigo: 'border-t-indigo-500 text-indigo-700',
  lime: 'border-t-lime-500 text-lime-700',
  cyan: 'border-t-cyan-500 text-cyan-700',
  fuchsia: 'border-t-fuchsia-500 text-fuchsia-700',
}

function Award({
  title,
  tone,
  who,
  value,
  empty = 'Not enough results yet',
  children,
}: {
  title: string
  tone: AwardTone
  who?: string
  value?: string
  empty?: string
  /** What the value means, e.g. "in a row". */
  children?: string | false
}) {
  const scope = useContext(ScopeLabel)
  const share = () => {
    const image = awardImage({ title, who: who!, value: value!, detail: children || '', scope, tone })
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    void shareImage(image, `${slug(title)}-${slug(scope)}.png`, title)
  }
  return (
    <div className={`d-card relative border-t-4 bg-base-100 p-4 shadow-sm ring-1 ring-slate-200 ${TONES[tone]}`}>
      <p className="text-xs font-bold tracking-wide uppercase">{title}</p>
      {who && value ? (
        <>
          <p className="mt-1 truncate text-lg leading-tight font-bold text-slate-900" title={who}>
            {who}
          </p>
          <p className="text-3xl font-black tabular-nums">{value}</p>
          <p className="pr-9 text-xs text-slate-500">{children}</p>
          <button
            className="d-btn d-btn-circle d-btn-ghost d-btn-sm absolute right-1.5 bottom-1.5 h-10 w-10"
            aria-label={`Share ${title}`}
            title={`Share ${title}`}
            onClick={share}
          >
            <ShareIcon className="h-4.5 w-4.5" />
          </button>
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-400">{empty}</p>
      )}
    </div>
  )
}

/** Every partnership with its record, best first. */
function DuoTable({ duos, names }: { duos: ReturnType<typeof duoRecords>; names: (p: Pair) => string }) {
  const rows = [...duos].sort(
    (a, b) => b.wins - a.wins || (winRate(b) ?? -1) - (winRate(a) ?? -1) || a.losses - b.losses,
  )
  return (
    <section className="d-card d-card-border overflow-hidden bg-base-100 shadow-sm">
      <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-lg font-bold">Duos</h3>
        <span className="text-xs text-slate-500">{duos.length} partnerships</span>
      </div>
      <table className="d-table d-table-sm tabular-nums">
        <thead>
          <tr>
            <th>Duo</th>
            <th className="text-center">P</th>
            <th className="text-center">W</th>
            <th className="text-center">L</th>
            <th className="text-right">Win %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.pair.join('|')}>
              <td className="font-semibold">
                {names(d.pair)}
                {d.wins >= 2 && !d.losses && (
                  <span className="d-badge d-badge-success d-badge-soft d-badge-xs ml-2 font-bold">Unbeaten</span>
                )}
              </td>
              <td className="text-center">{d.played}</td>
              <td className="text-center font-bold text-emerald-700">{d.wins}</td>
              <td className="text-center font-bold text-rose-600">{d.losses}</td>
              <td className="text-right font-semibold">{pct(d)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Each player's longest win and losing runs, and the run they're on now. */
function StreakTable({
  runs,
  records,
  name,
}: {
  runs: ReturnType<typeof streaks>
  records: (PlayerRecord & { id: string })[]
  name: (id: string) => string
}) {
  const rows = records
    .map((r) => ({ ...r, run: runs.get(r.id) ?? { wins: 0, losses: 0, current: 0 } }))
    .sort((a, b) => b.run.wins - a.run.wins || b.run.current - a.run.current || a.run.losses - b.run.losses)
  return (
    <section className="d-card d-card-border overflow-hidden bg-base-100 shadow-sm">
      <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-lg font-bold">Streaks</h3>
        <span className="text-xs text-slate-500">Games with no result are skipped</span>
      </div>
      <table className="d-table d-table-sm tabular-nums">
        <thead>
          <tr>
            <th>Player</th>
            <th className="text-center">Record</th>
            <th className="text-center">Best run</th>
            <th className="text-center">Worst run</th>
            <th className="text-right">Now</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="font-semibold">{name(r.id)}</td>
              <td className="text-center">{record(r)}</td>
              <td className="text-center font-bold text-emerald-700">{r.run.wins ? `W${r.run.wins}` : '–'}</td>
              <td className="text-center font-bold text-rose-600">{r.run.losses ? `L${r.run.losses}` : '–'}</td>
              <td className="text-right">
                {r.run.current ? (
                  <span
                    className={`d-badge d-badge-sm d-badge-soft font-bold ${r.run.current > 0 ? 'd-badge-success' : 'd-badge-error'}`}
                  >
                    {r.run.current > 0 ? `W${r.run.current}` : `L${-r.run.current}`}
                  </span>
                ) : (
                  '–'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
