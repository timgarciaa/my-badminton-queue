import { useState, type ReactNode } from 'react'
import {
  bestRecord,
  checkinPlaces,
  checkinStandings,
  emptyRecord,
  finishedGames,
  form,
  gameTime,
  longDate,
  mateRecords,
  ordinal,
  places,
  playedGames,
  playerRecords,
  standings,
  streaks,
  winRate,
  worstRecord,
  type MateRecord,
  type PlayerRecord,
} from '../lib/stats'
import { usePlayerMap } from '../store/useStore'
import { SKILL_LABELS, type Player, type Session } from '../types'
import { EmptyState, PlayerTags } from './ui'

const pct = (r: PlayerRecord) => {
  const rate = winRate(r)
  return rate === null ? '–' : `${Math.round(rate * 100)}%`
}
const record = (r: PlayerRecord) => `${r.wins}–${r.losses}`
const games = (n: number) => `${n} ${n === 1 ? 'game' : 'games'}`

/**
 * One player at a time: pick them from the list (ranked as in the standings)
 * to see their record, form, partners, opponents and games.
 */
export function PlayerStats({
  sessions,
  scope,
  showDate,
  chosen,
  onChoose,
}: {
  sessions: Session[]
  /** e.g. "All time", shown on the profile. */
  scope: string
  /** Show which session a game was in (more than one session). */
  showDate: boolean
  chosen: string | null
  onChoose: (id: string) => void
}) {
  const players = usePlayerMap()
  const [query, setQuery] = useState('')
  const ranked = standings(playedGames(sessions)).filter((s) => players.has(s.id))
  const place = places(ranked)
  if (!ranked.length) return <EmptyState>No one has finished a game here yet.</EmptyState>

  const i = Math.max(0, ranked.findIndex((r) => r.id === chosen))
  const q = query.trim().toLowerCase()
  const shown = ranked.map((r, n) => ({ ...r, place: place[n], player: players.get(r.id)! }))
    .filter((r) => !q || r.player.name.toLowerCase().includes(q))

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[15rem_1fr] gap-5 px-5 pb-5">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-base-100 shadow-sm ring-1 ring-slate-200">
        <div className="border-b border-slate-100 p-2">
          <input
            className="field h-11"
            type="search"
            placeholder={`Find a player (${ranked.length})`}
            aria-label="Find a player"
            autoCorrect="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {shown.map((r) => (
            <li key={r.id}>
              <button
                className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left ${
                  r.id === ranked[i].id ? 'bg-teal-600 text-white' : 'hover:bg-slate-50'
                }`}
                aria-current={r.id === ranked[i].id}
                onClick={() => onChoose(r.id)}
              >
                <span className={`w-9 shrink-0 text-center text-xs font-bold ${r.id === ranked[i].id ? 'text-teal-100' : 'text-slate-400'}`}>
                  {ordinal(r.place)}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">{r.player.name}</span>
                <span className={`shrink-0 text-sm tabular-nums ${r.id === ranked[i].id ? 'text-teal-50' : 'text-slate-500'}`}>
                  {record(r)}
                </span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="p-3 text-sm text-slate-500">No one called “{query.trim()}”.</li>}
        </ul>
      </aside>
      {/* Scrolls on its own; the margin keeps the cards' shadows from being cut off. */}
      <div className="-mx-3 min-h-0 overflow-y-auto px-3 pb-2">
        <Profile
          key={ranked[i].id}
          player={players.get(ranked[i].id)!}
          place={place[i]}
          of={ranked.length}
          sessions={sessions}
          scope={scope}
          showDate={showDate}
          onChoose={onChoose}
        />
      </div>
    </div>
  )
}

function Profile({
  player,
  place,
  of,
  sessions,
  scope,
  showDate,
  onChoose,
}: {
  player: Player
  place: number
  of: number
  sessions: Session[]
  scope: string
  showDate: boolean
  onChoose: (id: string) => void
}) {
  const players = usePlayerMap()
  const [allGames, setAllGames] = useState(false)
  const id = player.id
  const name = (other: string) => players.get(other)?.name ?? 'Removed player'
  const played = playedGames(sessions)
  const mine = finishedGames(sessions).filter((g) => g.teamA.includes(id) || g.teamB.includes(id))
  const rec = playerRecords(played).get(id) ?? emptyRecord()
  const rate = winRate(rec)
  const run = streaks(played).get(id) ?? { wins: 0, losses: 0, current: 0 }
  const recent = form(played, id)
  const partners = mateRecords(played, id, 'partner')
  const opponents = mateRecords(played, id, 'opponent')
  const courtMinutes = Math.round(mine.reduce((n, g) => n + (g.endedAt! - g.startedAt), 0) / 60_000)
  const attended = sessions.filter((s) => s.attendees.some((a) => a.playerId === id)).length
  const arrivals = checkinStandings(sessions)
  const arrivalPlaces = checkinPlaces(arrivals)
  const a = arrivals.findIndex((r) => r.id === id)
  const arrival = arrivals[a]

  const bestPartner = bestRecord(partners)
  const toughest = worstRecord(opponents)
  const easiest = bestRecord(opponents)
  const goTo = partners[0]
  const shown = allGames ? mine : mine.slice(0, 15)

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-800 via-teal-600 to-emerald-500 p-6 text-white shadow-lg">
        {/* Decoration: rings like a court's centre circle. */}
        <span aria-hidden className="absolute -top-16 -right-10 h-64 w-64 rounded-full border-[28px] border-white/10" />
        <span aria-hidden className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold tracking-wide text-teal-100 uppercase">{scope}</div>
            <h3 className="truncate text-4xl font-black tracking-tight">{player.name}</h3>
            <div className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-teal-50">
              <PlayerTags player={player} />
              {SKILL_LABELS[player.skill]}
            </div>
            <div className="mt-4 text-xs font-bold tracking-wide text-teal-100 uppercase">
              Form {recent.length > 0 && <span className="font-semibold normal-case">· last {recent.length}, newest on the right</span>}
            </div>
            <div className="mt-1 flex gap-1.5">
              {recent.length === 0 && <span className="text-sm text-teal-50">No results yet</span>}
              {recent.map((r, n) => (
                <span
                  key={n}
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black shadow ${
                    r === 'W' ? 'bg-white text-emerald-700' : 'bg-rose-500 text-white'
                  }`}
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
          <WinRing rate={rate} />
        </div>
        <div className="relative mt-5 grid grid-cols-4 gap-3">
          <HeroTile label="Place" value={ordinal(place)} detail={`of ${of}`} />
          <HeroTile label="Record" value={record(rec)} detail={rec.played > rec.wins + rec.losses ? `${rec.played - rec.wins - rec.losses} no result` : 'won–lost'} />
          <HeroTile label="Games" value={rec.played} detail={`in ${attended} ${attended === 1 ? 'session' : 'sessions'}`} />
          <HeroTile label="On court" value={courtMinutes >= 60 ? `${Math.floor(courtMinutes / 60)}h ${courtMinutes % 60}m` : `${courtMinutes}m`} detail="playing time" />
        </div>
      </section>

      <div className="grid grid-cols-4 gap-3">
        <Tile label="Best run" value={run.wins ? `W${run.wins}` : '–'} tone="text-emerald-700" detail="wins in a row" />
        <Tile label="Worst run" value={run.losses ? `L${run.losses}` : '–'} tone="text-rose-600" detail="losses in a row" />
        <Tile
          label="Now"
          value={run.current > 0 ? `W${run.current}` : run.current < 0 ? `L${-run.current}` : '–'}
          tone={run.current > 0 ? 'text-emerald-700' : run.current < 0 ? 'text-rose-600' : ''}
          detail={run.current > 0 ? 'on a winning run' : run.current < 0 ? 'looking for a win' : 'no results yet'}
        />
        <Tile
          label="Check-in"
          value={arrival ? (arrival.at !== undefined ? clock(arrival.at) : ordinal(arrivalPlaces[a])) : '–'}
          tone="text-indigo-700"
          detail={
            !arrival
              ? 'needs two players checked in'
              : arrival.at !== undefined
                ? Math.round(arrival.after) ? `${Math.round(arrival.after)} min after the first` : 'first to arrive'
                : `${arrival.firsts ? `first ${arrival.firsts}× · ` : ''}avg +${Math.round(arrival.after)} min`
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Highlight icon="M7 11a4 4 0 100-8 4 4 0 000 8zM17 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a5 5 0 0110 0v1M12 21v-1a5 5 0 0110 0v1" tone="bg-emerald-50 text-emerald-800 ring-emerald-200" title="Best partner" mate={bestPartner} name={name} onChoose={onChoose}>
          {bestPartner && `${record(bestPartner)} together · ${pct(bestPartner)}`}
        </Highlight>
        <Highlight icon="M12 21s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.5-7 10-7 10z" tone="bg-sky-50 text-sky-800 ring-sky-200" title="Most played with" mate={goTo} name={name} onChoose={onChoose}>
          {goTo && `${games(goTo.played)} together · ${record(goTo)}`}
        </Highlight>
        <Highlight icon="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" tone="bg-rose-50 text-rose-800 ring-rose-200" title="Toughest opponent" mate={toughest} name={name} onChoose={onChoose}>
          {toughest && `Won ${toughest.wins} of ${toughest.wins + toughest.losses} against them`}
        </Highlight>
        <Highlight icon="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z" tone="bg-amber-50 text-amber-900 ring-amber-200" title="Favourite opponent" mate={easiest} name={name} onChoose={onChoose}>
          {easiest && `Won ${easiest.wins} of ${easiest.wins + easiest.losses} against them`}
        </Highlight>
      </div>

      <div className="grid grid-cols-2 items-start gap-5">
        <MateTable title="Partners" rows={partners} name={name} onChoose={onChoose} />
        <MateTable title="Opponents" rows={opponents} name={name} onChoose={onChoose} />
      </div>

      <section className="d-card d-card-border overflow-hidden bg-base-100 shadow-sm">
        <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-lg font-bold">Games</h3>
          <span className="text-xs text-slate-500">Newest first · {games(mine.length)}</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {shown.map((g) => {
            const mineA = g.teamA.includes(id)
            const [us, them] = mineA ? [g.teamA, g.teamB] : [g.teamB, g.teamA]
            const result = !g.winner ? null : (g.winner === 'A') === mineA ? 'W' : 'L'
            return (
              <li key={`${g.date}-${g.id}`} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black ${
                    result === 'W' ? 'bg-emerald-100 text-emerald-700' : result === 'L' ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-400'
                  }`}
                  title={result === 'W' ? 'Won' : result === 'L' ? 'Lost' : g.outOfHours ? 'Out of hours' : 'No result'}
                >
                  {result ?? '–'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    with {us.filter((p) => p !== id).map(name).join(' & ')}
                    <span className="font-normal text-slate-500"> vs </span>
                    {them.map(name).join(' & ')}
                  </div>
                  <div className="text-xs text-slate-500">
                    {showDate && `${longDate(g.date)} · `}Game {g.number} · Court {g.court}
                  </div>
                </div>
                {g.score && (
                  <span className="shrink-0 text-lg font-black text-slate-800 tabular-nums">
                    {mineA ? g.score[0] : g.score[1]}–{mineA ? g.score[1] : g.score[0]}
                  </span>
                )}
                <span className="w-12 shrink-0 text-right text-sm text-slate-500 tabular-nums">{gameTime(g)}</span>
              </li>
            )
          })}
        </ul>
        {mine.length > shown.length && (
          <button className="d-btn d-btn-ghost w-full rounded-none border-t border-slate-100" onClick={() => setAllGames(true)}>
            Show all {mine.length} games
          </button>
        )}
      </section>
    </div>
  )
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** Win rate as a ring that fills up. */
function WinRing({ rate }: { rate: number | null }) {
  const r = 52
  const length = 2 * Math.PI * r
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth="12" />
        {rate !== null && (
          <circle cx="60" cy="60" r={r} fill="none" stroke="white" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${length * rate} ${length}`} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-black tabular-nums">{rate === null ? '–' : `${Math.round(rate * 100)}%`}</span>
        <span className="text-xs font-bold tracking-wide text-teal-100 uppercase">Win rate</span>
      </div>
    </div>
  )
}

function HeroTile({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="rounded-2xl bg-white/15 px-3 py-2.5 ring-1 ring-white/20 backdrop-blur-sm">
      <div className="text-xs font-bold tracking-wide text-teal-100 uppercase">{label}</div>
      <div className="text-2xl font-black tabular-nums">{value}</div>
      <div className="truncate text-xs text-teal-50">{detail}</div>
    </div>
  )
}

function Tile({ label, value, detail, tone = '' }: { label: string; value: ReactNode; detail: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-base-100 px-4 py-3 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs font-bold tracking-wide text-slate-500 uppercase">{label}</div>
      <div className={`text-2xl font-black tabular-nums ${tone}`}>{value}</div>
      <div className="truncate text-xs text-slate-500">{detail}</div>
    </div>
  )
}

/** A partner or opponent who stands out; tap to open their stats. */
function Highlight({
  icon,
  tone,
  title,
  mate,
  name,
  onChoose,
  children,
}: {
  icon: string
  tone: string
  title: string
  mate?: MateRecord
  name: (id: string) => string
  onChoose: (id: string) => void
  children?: string | false
}) {
  return (
    <button
      className={`flex items-center gap-3 rounded-2xl p-3 text-left ring-1 disabled:cursor-default ${tone}`}
      disabled={!mate}
      onClick={() => mate && onChoose(mate.id)}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/70">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={icon} />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold tracking-wide uppercase opacity-80">{title}</span>
        <span className="block truncate text-lg font-black">{mate ? name(mate.id) : '–'}</span>
        <span className="block truncate text-sm opacity-80">{mate ? children : 'Not enough results yet'}</span>
      </span>
    </button>
  )
}

/** Partners or opponents with the player's record alongside or against each; tap one to open their stats. */
function MateTable({
  title,
  rows,
  name,
  onChoose,
}: {
  title: string
  rows: MateRecord[]
  name: (id: string) => string
  onChoose: (id: string) => void
}) {
  const players = usePlayerMap()
  return (
    <section className="d-card d-card-border overflow-hidden bg-base-100 shadow-sm">
      <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-lg font-bold">{title}</h3>
        <span className="text-xs text-slate-500">{rows.length}</span>
      </div>
      <table className="d-table d-table-sm w-full table-fixed tabular-nums">
        <thead>
          <tr>
            <th>Player</th>
            <th className="w-9 text-center">P</th>
            <th className="w-14 text-center">W–L</th>
            <th className="w-14 text-right">Win %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className={players.has(r.id) ? 'cursor-pointer hover:bg-slate-50' : ''}
              onClick={() => players.has(r.id) && onChoose(r.id)}
            >
              <td className="truncate font-semibold" title={name(r.id)}>
                {name(r.id)}
              </td>
              <td className="text-center">{r.played}</td>
              <td className="text-center">
                <span className="font-bold text-emerald-700">{r.wins}</span>–<span className="font-bold text-rose-600">{r.losses}</span>
              </td>
              <td className="text-right font-semibold">{pct(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
