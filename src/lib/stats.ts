import type { Game, Pair, Session } from '../types'
import { pairKey, type Help } from './balance'

export interface PlayerRecord {
  played: number
  wins: number
  losses: number
}

export const emptyRecord = (): PlayerRecord => ({ played: 0, wins: 0, losses: 0 })

/** Game number within its session (older games fall back to start order). */
export function gameNumber(games: Game[], game: Game): number {
  return game.number ?? games.findIndex((g) => g.id === game.id) + 1
}

/** Finished games, newest first, each with its session date and game number. */
export function finishedGames(sessions: Session[]): (Game & { date: string; number: number })[] {
  return sessions
    .flatMap((s) =>
      s.games.filter((g) => g.endedAt).map((g) => ({ ...g, date: s.date, number: gameNumber(s.games, g) })),
    )
    .sort((a, b) => b.startedAt - a.startedAt)
}

/** Win/loss per player. Games without a recorded winner count as played only. */
export function playerRecords(games: Game[]): Map<string, PlayerRecord> {
  const records = new Map<string, PlayerRecord>()
  const get = (id: string) => {
    let r = records.get(id)
    if (!r) records.set(id, (r = emptyRecord()))
    return r
  }
  for (const g of games) {
    if (!g.endedAt) continue
    for (const [team, ids] of [['A', g.teamA], ['B', g.teamB]] as const) {
      for (const id of ids) {
        const r = get(id)
        r.played++
        if (g.winner === team) r.wins++
        else if (g.winner) r.losses++
      }
    }
  }
  return records
}

export interface Standing extends PlayerRecord {
  id: string
  rate: number | null
}

/** Players ranked by wins, then win rate, then fewest games played. */
export function standings(games: Game[]): Standing[] {
  return [...playerRecords(games)]
    .map(([id, r]) => ({ id, ...r, rate: winRate(r) }))
    .sort((a, b) => b.wins - a.wins || (b.rate ?? -1) - (a.rate ?? -1) || a.played - b.played)
}

/**
 * Places for ranked standings: players with the same wins and losses tie and
 * share a place, and the next record takes the next place (1, 1, 2, 3, 3...).
 */
export function places(rows: PlayerRecord[]): number[] {
  return placesBy(rows, (r) => `${r.wins}-${r.losses}`)
}

/** Places for ranked rows, where rows with the same `key` as the one above tie (1, 1, 2...). */
export function placesBy<T>(rows: T[], key: (r: T) => string): number[] {
  const out: number[] = []
  rows.forEach((r, i) => {
    const prev = rows[i - 1]
    out.push(prev !== undefined && key(prev) === key(r) ? out[i - 1] : (out[i - 1] ?? 0) + 1)
  })
  return out
}

/** 1st, 2nd, 3rd, 4th... 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  return `${n}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`
}

/** The team ahead on points; undefined for a tie or no score. */
export function scoreLeader(score?: [number, number]): 'A' | 'B' | undefined {
  if (!score || score[0] === score[1]) return undefined
  return score[0] > score[1] ? 'A' : 'B'
}

/** Both teams' points as typed, or undefined until both are filled in. */
export function parseScore(points: [string, string]): [number, number] | undefined {
  if (points.some((p) => p === '')) return undefined
  return [Number(points[0]), Number(points[1])]
}

export function winRate(r: PlayerRecord): number | null {
  const decided = r.wins + r.losses
  return decided ? r.wins / decided : null
}

/** A session date like "Sat, 25 Oct 2026". */
export const longDate = (iso: string) =>
  new Date(iso + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Sessions on or after the same day `months` months ago (the last day of a
 * shorter month: 3 months before 31 May is 28 or 29 Feb).
 */
export function sessionsWithin(sessions: Session[], months: number, today = new Date()): Session[] {
  const y = today.getFullYear()
  const m = today.getMonth() - months
  const lastDay = new Date(y, m + 1, 0).getDate()
  const from = new Date(y, m, Math.min(today.getDate(), lastDay)).toLocaleDateString('en-CA')
  return sessions.filter((s) => s.date >= from)
}

/** Finished games of the given sessions, in the order they were played. */
export function playedGames(sessions: Session[]): Game[] {
  return sessions.flatMap((s) => s.games.filter((g) => g.endedAt)).sort((a, b) => a.startedAt - b.startedAt)
}

/** Two players as partners: games together and their results. */
export interface DuoRecord extends PlayerRecord {
  pair: Pair
}

/** Records of every pair who played on the same team, most games first. */
export function duoRecords(games: Game[]): DuoRecord[] {
  const duos = new Map<string, DuoRecord>()
  for (const g of games) {
    if (!g.endedAt) continue
    for (const [side, team] of [['A', g.teamA], ['B', g.teamB]] as const) {
      const key = pairKey(team)
      let d = duos.get(key)
      if (!d) duos.set(key, (d = { pair: [...team].sort() as Pair, ...emptyRecord() }))
      d.played++
      if (g.winner === side) d.wins++
      else if (g.winner) d.losses++
    }
  }
  return [...duos.values()].sort((a, b) => b.played - a.played || b.wins - a.wins)
}

const decided = (r: PlayerRecord) => r.wins + r.losses

/**
 * The fewest decided games to qualify for a "best" or "worst" award: `want`,
 * or less when nobody has played that many (one session rarely repeats a pair).
 */
export function qualifying<T extends PlayerRecord>(records: T[], want: number): T[] {
  const most = Math.max(0, ...records.map(decided))
  const min = Math.max(1, Math.min(want, most))
  return records.filter((r) => decided(r) >= min)
}

/** Best record: win rate, then most wins, then fewest losses. Undefined without a win. */
export function bestRecord<T extends PlayerRecord>(records: T[], want = 2): T | undefined {
  const best = qualifying(records, want).sort(
    (a, b) => winRate(b)! - winRate(a)! || b.wins - a.wins || a.losses - b.losses,
  )[0]
  return best?.wins ? best : undefined
}

/** Worst record: win rate, then most losses, then fewest wins. Undefined without a loss. */
export function worstRecord<T extends PlayerRecord>(records: T[], want = 2): T | undefined {
  const worst = qualifying(records, want).sort(
    (a, b) => winRate(a)! - winRate(b)! || b.losses - a.losses || a.wins - b.wins,
  )[0]
  return worst?.losses ? worst : undefined
}

export interface Streak {
  /** Longest run of wins. */
  wins: number
  /** Longest run of losses. */
  losses: number
  /** The run the player is on now: positive for wins, negative for losses. */
  current: number
}

/** Win and loss streaks per player, over decided games in play order (games with no result are skipped). */
export function streaks(games: Game[]): Map<string, Streak> {
  const out = new Map<string, Streak>()
  for (const g of [...games].sort((a, b) => a.startedAt - b.startedAt)) {
    if (!g.endedAt || !g.winner) continue
    for (const [side, team] of [['A', g.teamA], ['B', g.teamB]] as const) {
      for (const id of team) {
        let s = out.get(id)
        if (!s) out.set(id, (s = { wins: 0, losses: 0, current: 0 }))
        s.current = g.winner === side ? Math.max(0, s.current) + 1 : Math.min(0, s.current) - 1
        s.wins = Math.max(s.wins, s.current)
        s.losses = Math.max(s.losses, -s.current)
      }
    }
  }
  return out
}

/** Two players who faced each other, with how often each won. */
export interface Rivalry {
  pair: Pair
  met: number
  /** Wins of pair[0] and pair[1] against each other. */
  wins: [number, number]
}

/** Opponents who met most, closest head-to-head first among equals. Decided games only. */
export function rivalries(games: Game[]): Rivalry[] {
  const out = new Map<string, Rivalry>()
  for (const g of games) {
    if (!g.endedAt || !g.winner) continue
    const winners = g.winner === 'A' ? g.teamA : g.teamB
    for (const a of g.teamA) {
      for (const b of g.teamB) {
        const pair = [a, b].sort() as Pair
        const key = pairKey(pair)
        let r = out.get(key)
        if (!r) out.set(key, (r = { pair, met: 0, wins: [0, 0] }))
        r.met++
        r.wins[winners.includes(pair[0]) ? 0 : 1]++
      }
    }
  }
  const gap = (r: Rivalry) => Math.abs(r.wins[0] - r.wins[1])
  return [...out.values()].sort((a, b) => b.met - a.met || gap(a) - gap(b))
}

/** Games shorter than this were most likely ended by mistake, so they never count as the shortest. */
export const MIN_GAME_MS = 60_000

const gameLength = (g: Game) => g.endedAt! - g.startedAt

/**
 * The longest and shortest finished games. The shortest lasted at least
 * MIN_GAME_MS and wasn't cut short by the court time running out.
 */
export function gameExtremes<T extends Game>(games: T[]): { longest?: T; shortest?: T } {
  const finished = games.filter((g) => g.endedAt)
  const longest = finished.reduce<T | undefined>((a, g) => (!a || gameLength(g) > gameLength(a) ? g : a), undefined)
  const shortest = finished
    .filter((g) => gameLength(g) >= MIN_GAME_MS && !g.outOfHours)
    .reduce<T | undefined>((a, g) => (!a || gameLength(g) < gameLength(a) ? g : a), undefined)
  return { longest, shortest }
}

/** A game's length as m:ss. */
export function gameTime(g: Game): string {
  const sec = Math.round(gameLength(g) / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/** A player who lost this many decided games in a row (and won none of them) gets a helping partner. */
export const WINLESS_RUN = 5

/**
 * Who to help and who can help, from recent games: players whose last
 * WINLESS_RUN decided games were all losses, and every player's current win
 * streak. Games with no result are skipped.
 */
export function helpFrom(games: Game[]): Help {
  const runs = streaks(games)
  const struggling = new Set([...runs].filter(([, r]) => r.current <= -WINLESS_RUN).map(([id]) => id))
  const streak = new Map([...runs].filter(([, r]) => r.current > 0).map(([id, r]) => [id, r.current]))
  return { struggling, streak }
}

/** Who checked in first and last in one session. */
export interface Arrival {
  first: string
  last: string
  firstAt: number
  lastAt: number
}

/** First and last to check in, for each session with at least two players. */
export function arrivals(sessions: Session[]): Arrival[] {
  return sessions.flatMap((s) => {
    if (s.attendees.length < 2) return []
    const order = [...s.attendees].sort((a, b) => a.checkedInAt - b.checkedInAt)
    const [first, last] = [order[0], order[order.length - 1]]
    return [{ first: first.playerId, last: last.playerId, firstAt: first.checkedInAt, lastAt: last.checkedInAt }]
  })
}

/** Players who were first (or last) most often, and how many times. */
export function mostOften(ids: string[]): { ids: string[]; times: number } {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  const times = Math.max(0, ...counts.values())
  return { ids: [...counts].filter(([, n]) => n === times).map(([id]) => id), times }
}

/** A player's arrivals: how many sessions, how often first, and how long after the first arrival. */
export interface CheckinRow {
  id: string
  sessions: number
  firsts: number
  /** Average minutes after the first player checked in. */
  after: number
  /** Check-in time, when covering one session. */
  at?: number
}

/**
 * Players ranked by how early they check in: on average the fewest minutes
 * after the first arrival, then most often first. Sessions with fewer than
 * two players are skipped.
 */
export function checkinStandings(sessions: Session[]): CheckinRow[] {
  const rows = new Map<string, CheckinRow & { total: number }>()
  const counted = sessions.filter((s) => s.attendees.length >= 2)
  for (const s of counted) {
    const firstAt = Math.min(...s.attendees.map((a) => a.checkedInAt))
    for (const a of s.attendees) {
      let r = rows.get(a.playerId)
      if (!r) rows.set(a.playerId, (r = { id: a.playerId, sessions: 0, firsts: 0, after: 0, total: 0 }))
      r.sessions++
      if (a.checkedInAt === firstAt) r.firsts++
      r.total += (a.checkedInAt - firstAt) / 60_000
      if (counted.length === 1) r.at = a.checkedInAt
    }
  }
  return [...rows.values()]
    .map(({ total, ...r }) => ({ ...r, after: total / r.sessions }))
    .sort((a, b) => a.after - b.after || b.firsts - a.firsts || b.sessions - a.sessions)
}

/** Check-in places: players arriving within the same minute (on average) share a place. */
export const checkinPlaces = (rows: CheckinRow[]) => placesBy(rows, (r) => String(Math.round(r.after)))

/** Someone a player partnered or faced, and the player's record with or against them. */
export interface MateRecord extends PlayerRecord {
  id: string
}

/**
 * One player's record with each partner, or against each opponent, most games
 * first. Games with no result count as played only.
 */
export function mateRecords(games: Game[], id: string, as: 'partner' | 'opponent'): MateRecord[] {
  const out = new Map<string, MateRecord>()
  for (const g of games) {
    if (!g.endedAt) continue
    const side = g.teamA.includes(id) ? 'A' : g.teamB.includes(id) ? 'B' : null
    if (!side) continue
    const [mine, theirs] = side === 'A' ? [g.teamA, g.teamB] : [g.teamB, g.teamA]
    for (const other of as === 'partner' ? mine.filter((p) => p !== id) : theirs) {
      let r = out.get(other)
      if (!r) out.set(other, (r = { id: other, ...emptyRecord() }))
      r.played++
      if (g.winner === side) r.wins++
      else if (g.winner) r.losses++
    }
  }
  return [...out.values()].sort((a, b) => b.played - a.played || b.wins - a.wins)
}

/** A player's last `n` decided results in play order, oldest first. */
export function form(games: Game[], id: string, n = 10): ('W' | 'L')[] {
  return [...games]
    .filter((g) => g.endedAt && g.winner && (g.teamA.includes(id) || g.teamB.includes(id)))
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-n)
    .map((g) => ((g.winner === 'A') === g.teamA.includes(id) ? 'W' : 'L'))
}
