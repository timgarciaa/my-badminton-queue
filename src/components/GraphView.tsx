import type { ReactNode } from 'react'
import { playedGames } from '../lib/stats'
import { gapCounts, overall, playerDays, scoreGap, sessionTrends } from '../lib/trends'
import type { Session } from '../types'
import { Bars, ChartCard, Columns, Ranges, type Datum } from './Charts'

const round1 = (n: number) => Math.round(n * 10) / 10
const min = (n: number) => `${round1(n)} min`
const minShort = (n: number) => `${Math.round(n)}m`
const signed = (n: number) => {
  const r = Math.round(n)
  return r < 0 ? `−${-r}m` : `${r}m`
}
const pts = (n: number) => `${round1(n)}`
const early = (n: number) => (Math.round(n) === 0 ? 'right at the start' : n > 0 ? `${Math.round(n)} min early` : `${Math.round(-n)} min after the start`)
const dayLabel = (iso: string) => new Date(iso + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
/** Minutes since midnight as a clock time. */
const clockOf = (minutes: number) => {
  const d = new Date()
  d.setHours(0, Math.round(minutes), 0, 0)
  return clock(d.getTime())
}
const table = (data: Datum[], format: (v: number) => string): [string, string][] =>
  data.map((d) => [d.tip ? `${d.label} · ${d.tip}` : d.label, d.value === null ? '–' : format(d.value)])

/**
 * Charts over the chosen sessions: averages session by session, or game by
 * game and player by player for one session.
 */
export function GraphView({ sessions, name }: { sessions: Session[]; name: (id: string) => string }) {
  const trends = sessionTrends(sessions)
  const all = overall(sessions)
  const one = trends.length === 1 ? sessions.find((s) => s.id === trends[0].id) : undefined
  const games = playedGames(sessions)
  const gaps = gapCounts(games)
  const gapData: Datum[] = gaps.map((b) => ({ key: b.label, label: `${b.label} pts`, value: b.count, tip: `won by ${b.label} points` }))

  const kpis: [string, ReactNode, string?][] = [
    ['Avg game', all.gameMin === null ? '–' : min(all.gameMin), `${games.length} games`],
    [
      'Avg check-in',
      all.checkinClock === null ? '–' : clockOf(all.checkinClock),
      all.earlyMin === null ? undefined : early(all.earlyMin),
    ],
    ['Avg score gap', all.gap === null ? '–' : `${pts(all.gap)} pts`, all.scored ? `${all.scored} scored games` : 'No scores yet'],
    ['Games per player', all.perPlayer === null ? '–' : pts(all.perPlayer), one ? 'this session' : 'per session'],
    ['Wait between games', all.waitMin === null ? '–' : min(all.waitMin), 'from end to next start'],
  ]

  return (
    <div className="space-y-5">
      <div className="d-stats d-stats-horizontal w-full overflow-hidden bg-base-100 shadow-sm ring-1 ring-slate-200">
        {kpis.map(([title, value, desc]) => (
          <div key={title} className="d-stat py-3">
            <div className="d-stat-title">{title}</div>
            <div className="d-stat-value text-2xl tabular-nums">{value}</div>
            {desc && <div className="d-stat-desc">{desc}</div>}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-5">{one ? <OneSession session={one} name={name} gapData={gapData} /> : <Sessions trends={trends} gapData={gapData} averages={all} />}</div>
    </div>
  )
}

function GapChart({ gapData }: { gapData: Datum[] }) {
  return (
    <ChartCard title="Score gaps" subtitle="Won games by how many points they were won by" table={table(gapData, (v) => `${v} games`)}>
      {gapData.some((d) => d.value) ? <Columns data={gapData} format={(v) => `${Math.round(v)}`} /> : <Empty>No scored games yet.</Empty>}
    </ChartCard>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-slate-400">{children}</p>
}

function Sessions({
  trends,
  gapData,
  averages,
}: {
  trends: ReturnType<typeof sessionTrends>
  gapData: Datum[]
  averages: ReturnType<typeof overall>
}) {
  const per = (value: (t: (typeof trends)[number]) => number | null, tip?: (t: (typeof trends)[number]) => string): Datum[] =>
    trends.map((t) => ({ key: t.id, label: dayLabel(t.date), value: value(t), tip: tip?.(t) }))
  const gameTime = per((t) => t.gameMin, (t) => `${dayLabel(t.date)} · ${t.games} games`)
  const checkin = per(
    (t) => t.earlyMin,
    (t) => `${dayLabel(t.date)} · avg ${t.checkinClock === null ? '–' : clockOf(t.checkinClock)}, first game ${t.firstGameAt ? clock(t.firstGameAt) : '–'}`,
  )
  const gap = per((t) => t.gap, (t) => `${dayLabel(t.date)} · ${t.scored} scored games`)
  const wait = per((t) => t.waitMin, (t) => dayLabel(t.date))
  const players = per((t) => t.players, (t) => `${dayLabel(t.date)} · ${t.games} games`)
  const ranges = trends
    .filter((t) => t.perPlayer)
    .map((t) => ({ key: t.id, label: dayLabel(t.date), ...t.perPlayer!, tip: `${dayLabel(t.date)} · avg ${pts(t.perPlayer!.avg)}` }))
  return (
    <>
      <ChartCard title="Average game time" subtitle="Minutes per game, each session" table={table(gameTime, min)}>
        <Columns data={gameTime} format={minShort} average={averages.gameMin} />
      </ChartCard>
      <ChartCard
        title="Check-in"
        subtitle="Average minutes players checked in before the first game (below 0: after it)"
        table={table(checkin, early)}
      >
        <Columns data={checkin} format={signed} />
      </ChartCard>
      <ChartCard title="Average score gap" subtitle="Points between the teams in scored games, each session" table={table(gap, (v) => `${pts(v)} pts`)}>
        {gap.some((d) => d.value !== null) ? <Columns data={gap} format={pts} average={averages.gap} /> : <Empty>No scored games yet.</Empty>}
      </ChartCard>
      <GapChart gapData={gapData} />
      <ChartCard
        title="Games per player"
        subtitle="Fewest to most games a player got, with the average (dot); late arrivals included"
        table={ranges.map((r) => [r.label, `${r.min}–${r.max} · avg ${pts(r.avg)}`])}
      >
        <Ranges data={ranges} format={(v) => `${Math.round(v * 10) / 10}`} />
      </ChartCard>
      <ChartCard title="Wait between games" subtitle="Average minutes from a player's game ending to their next one" table={table(wait, min)}>
        <Columns data={wait} format={minShort} average={averages.waitMin} />
      </ChartCard>
      <ChartCard title="Players" subtitle="Checked in, each session" table={table(players, (v) => `${v}`)} className="col-span-2">
        <Columns data={players} format={(v) => `${Math.round(v)}`} height={160} />
      </ChartCard>
    </>
  )
}

function OneSession({ session, name, gapData }: { session: Session; name: (id: string) => string; gapData: Datum[] }) {
  const games = playedGames([session])
  const days = playerDays(session)
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((n): n is number => n !== null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  const byGame = (value: (g: (typeof games)[number]) => number | null, tip: (g: (typeof games)[number]) => string): Datum[] =>
    games.map((g, k) => ({ key: g.id, label: `${k + 1}`, value: value(g), tip: tip(g) }))
  const teams = (g: (typeof games)[number]) => `${g.teamA.map(name).join(' & ')} vs ${g.teamB.map(name).join(' & ')}`
  const gameTime = byGame((g) => (g.endedAt! - g.startedAt) / 60_000, (g) => `Game ${games.indexOf(g) + 1} · ${teams(g)}`)
  const gap = byGame(scoreGap, (g) => `Game ${games.indexOf(g) + 1} · ${g.score ? g.score.join('–') : 'no score'}`)
  const perPlayer = (value: (d: (typeof days)[number]) => number | null, tip: (d: (typeof days)[number]) => string): Datum[] =>
    days.map((d) => ({ key: d.id, label: name(d.id), value: value(d), tip: tip(d) }))
  const checkin = perPlayer((d) => d.earlyMin, (d) => `checked in ${clock(d.checkedInAt)}`)
  const played = perPlayer((d) => d.games, (d) => `checked in ${clock(d.checkedInAt)}`)
  const wait = perPlayer((d) => d.waitMin, (d) => `${d.games} games`)
  return (
    <>
      <ChartCard title="Game time" subtitle="Minutes per game, in the order they started" table={table(gameTime, min)}>
        <Columns data={gameTime} format={minShort} average={avg(gameTime.map((d) => d.value))} />
      </ChartCard>
      <ChartCard title="Score gap" subtitle="Points between the teams, game by game" table={table(gap, (v) => `${v} pts`)}>
        {gap.some((d) => d.value !== null) ? <Columns data={gap} format={pts} average={avg(gap.map((d) => d.value))} /> : <Empty>No scored games.</Empty>}
      </ChartCard>
      <ChartCard title="Check-in" subtitle="Minutes before the first game, in check-in order (below 0: after it)" table={table(checkin, early)}>
        <Bars data={checkin} format={signed} />
      </ChartCard>
      <ChartCard title="Games per player" subtitle="In check-in order; the line is the average" table={table(played, (v) => `${v} games`)}>
        <Bars data={played} format={(v) => `${v}`} average={avg(played.map((d) => d.value))} />
      </ChartCard>
      <ChartCard title="Wait between games" subtitle="Average minutes from a player's game ending to their next one" table={table(wait, min)}>
        <Bars data={wait} format={minShort} average={avg(wait.map((d) => d.value))} />
      </ChartCard>
      <GapChart gapData={gapData} />
    </>
  )
}
