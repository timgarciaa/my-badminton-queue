import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { shuttlesUsed } from '../lib/cost'
import {
  checkinPlaces,
  checkinStandings,
  duoRecords,
  playedGames,
  playerRecords,
  streaks,
  winRate,
  type PlayerRecord,
} from '../lib/stats'
import { awardList, podiumAwards, type Award as AwardData } from '../lib/awards'
import { GraphView } from '../components/GraphView'
import { PlayerStats } from '../components/PlayerStats'
import { SeasonBar } from '../components/SeasonBar'
import { SessionSelect } from '../components/SessionSelect'
import { PlaceCell, ShareIcon, Standings, WinsStandings } from '../components/Standings'
import { EmptyState } from '../components/ui'
import { AWARD_SIZE, awardImage, checkinImage, drawAward, shareImage, type AwardArt, type AwardTone } from '../lib/shareImage'
import { useScope } from '../lib/scope'
import { usePlayerMap, useStore } from '../store/useStore'
import type { Pair, Session } from '../types'

const pct = (r: PlayerRecord) => {
  const rate = winRate(r)
  return rate === null ? '–' : `${Math.round(rate * 100)}%`
}
const record = (r: PlayerRecord) => `${r.wins}–${r.losses}`

/**
 * Analytics over past sessions: pick all time, the last 3 months or one
 * session. Overview shows its summary, awards (best and worst duos, streaks,
 * rivalries) and tables; Players shows one player's own stats; Graph charts
 * game time, check-in, score gaps and more.
 */
export function StatsPage() {
  const session = useStore((s) => s.session)
  const history = useStore((s) => s.history)
  const seasons = useStore((s) => s.seasons)
  const players = usePlayerMap()
  const { scope, setScope, range, setRange, season, all, recent, sessions, span, label } = useScope(session, history, seasons)
  const [view, setView] = useState<'overview' | 'players' | 'graph'>('overview')
  const [chosen, setChosen] = useState<string | null>(null)
  const games = playedGames(sessions)
  const name = (id: string) => players.get(id)?.name ?? 'Removed player'
  const names = (p: Pair) => p.map(name).sort((a, b) => a.localeCompare(b)).join(' & ')

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 px-5 pt-5 pb-4">
        <h2 className="text-xl font-bold">Stats</h2>
        <div role="tablist" className="d-tabs d-tabs-box">
          {(['overview', 'players', 'graph'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={`d-tab h-10 px-5 font-semibold ${view === v ? 'd-tab-active' : ''}`}
              onClick={() => setView(v)}
            >
              {v === 'overview' ? 'Overview' : v === 'players' ? 'Players' : 'Graph'}
            </button>
          ))}
        </div>
        <SessionSelect
          className="ml-auto w-72"
          scope={scope}
          onChange={setScope}
          session={session}
          history={history}
          all={all}
          recent={recent}
          seasons={seasons}
        />
      </div>
      <SeasonBar scope={scope} range={range} onRange={setRange} season={season} sessions={sessions} onScope={setScope} />

      {games.length === 0 ? (
        <div className="space-y-5 px-5 pb-5">
          {view === 'overview' && <Overview sessions={sessions} />}
          <EmptyState>
            {scope === '3m'
              ? 'No finished games in the last 3 months.'
              : scope === 'range' || season
                ? `No finished games from ${label}.`
              : scope === session.id || history.length === 0
                ? 'Stats show up once games are finished. End a session on the Costs tab to keep it in history.'
                : 'No finished games in this session.'}
          </EmptyState>
        </div>
      ) : view === 'players' ? (
        <PlayerStats sessions={sessions} scope={label} showDate={span} chosen={chosen} onChoose={setChosen} />
      ) : view === 'graph' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <GraphView sessions={sessions} name={name} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5">
          <Overview sessions={sessions} />
          <ScopeLabel.Provider value={label}>
            <Dashboard
              games={games}
              sessions={sessions}
              showDate={span}
              name={name}
              names={names}
              onChoose={(id) => {
                setChosen(id)
                setView('players')
              }}
            />
          </ScopeLabel.Provider>
        </div>
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
  onChoose,
}: {
  games: ReturnType<typeof playedGames>
  sessions: Session[]
  /** Show which session a game was in (all time). */
  showDate: boolean
  name: (id: string) => string
  names: (p: Pair) => string
  /** Open a player's own stats. */
  onChoose: (id: string) => void
}) {
  const duos = duoRecords(games)
  const runs = streaks(games)
  const records = [...playerRecords(games)].map(([id, r]) => ({ id, ...r }))
  const scope = useContext(ScopeLabel)
  const sessionCount = sessions.filter((s) => s.games.length).length
  const podium = podiumAwards(sessions, { name })
  const awards = awardList(sessions, { name, names, showDate })

  return (
    <>
      <div className="grid grid-cols-3 gap-5">
        {podium.map((a) => (
          <AwardCard key={a.key} award={a} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-5 xl:grid-cols-4">
        {awards.map((a) => (
          <AwardCard key={a.key} award={a} />
        ))}
      </div>

      <div className="grid grid-cols-2 items-start gap-5">
        <div className="space-y-5">
          <Standings
            games={games}
            title={scope === 'All time' ? 'All-time standings' : scope === 'Last 3 months' ? 'Standings · last 3 months' : 'Standings'}
            subtitle={
              showDate
                ? `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'} · ${games.length} games`
                : `${scope} · ${games.length} ${games.length === 1 ? 'game' : 'games'}`
            }
            filename={`standings-${scope.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`}
            onFocus={(id) => id && onChoose(id)}
            hint="Tap a player to see their stats"
          />
          <WinsStandings
            games={games}
            title={scope === 'All time' ? 'All-time wins' : scope === 'Last 3 months' ? 'Wins · last 3 months' : 'Wins'}
            subtitle={
              showDate
                ? `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'} · ${games.length} games`
                : `${scope} · ${games.length} ${games.length === 1 ? 'game' : 'games'}`
            }
            filename={`wins-${scope.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`}
          />
          <CheckinStandings sessions={sessions} name={name} />
        </div>
        <div className="space-y-5">
          <DuoTable duos={duos} names={names} />
          <StreakTable runs={runs} records={records} name={name} />
        </div>
      </div>
    </>
  )
}

function AwardCard({ award: a }: { award: AwardData }) {
  return (
    <Award title={a.title} art={a.art} tone={a.tone} who={a.who} value={a.value} empty={a.empty}>
      {a.detail}
    </Award>
  )
}

/** The games the dashboard covers, e.g. "Last 3 months"; printed on shared award cards. */
const ScopeLabel = createContext('')

/** Cards are drawn at 2/3 of the shared image's size: sharp at the size they show on the iPad. */
const CARD_SCALE = 2 / 3

/**
 * An award as the card that gets shared, drawn live: its own picture, who won
 * it and the number. Share sends the same card at full size.
 */
function Award({
  title,
  tone,
  art,
  who,
  value,
  empty = 'Not enough results yet',
  children,
}: {
  title: string
  tone: AwardTone
  art: AwardArt
  who?: string
  value?: string
  empty?: string
  /** What the value means, e.g. "in a row". */
  children?: string | false
}) {
  const scope = useContext(ScopeLabel)
  const ref = useRef<HTMLCanvasElement>(null)
  const won = !!(who && value)
  const detail = children || ''

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.setTransform(CARD_SCALE, 0, 0, CARD_SCALE, 0, 0)
    drawAward(ctx, { title, who, value, detail, scope, tone, art, empty })
  }, [title, who, value, detail, scope, tone, art, empty])

  const share = () => {
    const image = awardImage({ title, who, value, detail, scope, tone, art })
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    void shareImage(image, `${slug(title)}-${slug(scope)}.png`, title)
  }

  return (
    <div className="relative overflow-hidden rounded-3xl shadow-lg ring-1 ring-black/5">
      <canvas
        ref={ref}
        width={AWARD_SIZE.width * CARD_SCALE}
        height={AWARD_SIZE.height * CARD_SCALE}
        className="block aspect-[4/5] h-auto w-full"
        role="img"
        aria-label={won ? `${title}: ${who}, ${value}, ${detail}` : `${title}: ${empty}`}
      />
      {won && (
        <button
          className="d-btn d-btn-circle absolute top-3 right-3 h-12 w-12 border-0 bg-white/90 text-slate-800 shadow-md"
          aria-label={`Share ${title}`}
          title={`Share ${title}`}
          onClick={share}
        >
          <ShareIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}

/**
 * Who checks in earliest. One session lists everyone in order with times;
 * several rank by average minutes after the first arrival.
 */
function CheckinStandings({ sessions, name }: { sessions: Session[]; name: (id: string) => string }) {
  const scope = useContext(ScopeLabel)
  const rows = checkinStandings(sessions)
  const place = checkinPlaces(rows)
  const single = rows.some((r) => r.at !== undefined)
  const counted = sessions.filter((s) => s.attendees.length >= 2).length
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  // "First" only for one session; an average near 0 isn't always first.
  const after = (m: number) => (single && !Math.round(m) ? 'First' : `+${Math.round(m)} min`)

  const share = () => {
    const image = checkinImage(
      rows.map((r, i) => ({ ...r, name: name(r.id), place: place[i] })),
      {
        title: 'Check-in standings',
        subtitle: single ? scope : `${scope} · ${counted} sessions`,
      },
    )
    void shareImage(image, `check-in-${scope.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`, 'Check-in standings')
  }

  return (
    <section className="d-card d-card-border overflow-hidden bg-base-100 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-lg font-bold">Check-in standings</h3>
          <p className="text-xs text-slate-500">
            {single ? 'In order of check-in' : 'By average minutes after the first arrival'}
          </p>
        </div>
        <button className="d-btn d-btn-primary d-btn-soft h-11" disabled={rows.length === 0} onClick={share}>
          <ShareIcon />
          Share
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="p-5 text-slate-500">Needs at least two players checked in.</p>
      ) : (
        <table className="d-table d-table-sm w-full table-fixed tabular-nums">
          <thead>
            <tr>
              <th className="w-16">#</th>
              <th>Player</th>
              {single ? (
                <th className="w-24 text-center">Checked in</th>
              ) : (
                <>
                  <th className="w-20 text-center">Sessions</th>
                  <th className="w-16 text-center">Firsts</th>
                </>
              )}
              <th className="w-24 text-right">{single ? 'After first' : 'Avg after'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <PlaceCell places={place} i={i} />
                <td className="truncate text-base font-semibold" title={name(r.id)}>
                  {name(r.id)}
                </td>
                {single ? (
                  <td className="text-center font-semibold text-indigo-700">{clock(r.at!)}</td>
                ) : (
                  <>
                    <td className="text-center">{r.sessions}</td>
                    <td className="text-center font-bold text-amber-700">{r.firsts}</td>
                  </>
                )}
                <td className="text-right font-semibold">{after(r.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
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
