import type { Game, Session } from '../types'
import { playedGames } from './stats'

const MIN = 60_000
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const ids = (g: Game) => [...g.teamA, ...g.teamB]

/** Points between the two teams of a scored game. */
export const scoreGap = (g: Game) => (g.score ? Math.abs(g.score[0] - g.score[1]) : null)

/** Minutes of clock time since midnight, for averaging check-in times across days. */
export const clockMinutes = (ms: number) => {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

/** One player in one session. */
export interface PlayerDay {
  id: string
  games: number
  checkedInAt: number
  /** Minutes they checked in before the first game (negative: after it started). */
  earlyMin: number | null
  /** Average minutes they waited between their games. */
  waitMin: number | null
}

/** Each checked-in player's day, in check-in order. */
export function playerDays(s: Session): PlayerDay[] {
  const games = playedGames([s])
  const first = games[0]?.startedAt
  return [...s.attendees]
    .sort((a, b) => a.checkedInAt - b.checkedInAt)
    .map((a) => {
      const mine = games.filter((g) => ids(g).includes(a.playerId))
      const waits = mine.slice(1).map((g, i) => (g.startedAt - mine[i].endedAt!) / MIN)
      return {
        id: a.playerId,
        games: mine.length,
        checkedInAt: a.checkedInAt,
        earlyMin: first === undefined ? null : (first - a.checkedInAt) / MIN,
        waitMin: mean(waits),
      }
    })
}

/** A session's averages, for charting sessions side by side. */
export interface SessionTrend {
  id: string
  date: string
  players: number
  games: number
  /** Average game length, minutes. */
  gameMin: number | null
  /** When the first game started. */
  firstGameAt?: number
  /** Average check-in, minutes since midnight. */
  checkinClock: number | null
  /** Average minutes players checked in before the first game (negative: after). */
  earlyMin: number | null
  /** Average points between the teams, over scored games. */
  gap: number | null
  scored: number
  /** Games per player who played: average, fewest and most. */
  perPlayer: { avg: number; min: number; max: number } | null
  /** Average minutes players waited between their games. */
  waitMin: number | null
}

export function sessionTrend(s: Session): SessionTrend {
  const games = playedGames([s])
  const days = playerDays(s)
  const played = days.filter((d) => d.games > 0).map((d) => d.games)
  const gaps = games.map(scoreGap).filter((n): n is number => n !== null)
  const waits = days.map((d) => d.waitMin).filter((n): n is number => n !== null)
  return {
    id: s.id,
    date: s.date,
    players: s.attendees.length,
    games: games.length,
    gameMin: mean(games.map((g) => (g.endedAt! - g.startedAt) / MIN)),
    firstGameAt: games[0]?.startedAt,
    checkinClock: mean(s.attendees.map((a) => clockMinutes(a.checkedInAt))),
    earlyMin: mean(days.map((d) => d.earlyMin).filter((n): n is number => n !== null)),
    gap: mean(gaps),
    scored: gaps.length,
    perPlayer: played.length ? { avg: mean(played)!, min: Math.min(...played), max: Math.max(...played) } : null,
    waitMin: mean(waits),
  }
}

/** Sessions with finished games, oldest first. */
export function sessionTrends(sessions: Session[]): SessionTrend[] {
  return sessions
    .filter((s) => s.games.some((g) => g.endedAt))
    .map(sessionTrend)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.firstGameAt ?? 0) - (b.firstGameAt ?? 0))
}

/** Score gaps grouped: close games to blowouts. */
export const GAP_BUCKETS = [
  { label: '1–2', from: 1, to: 2 },
  { label: '3–5', from: 3, to: 5 },
  { label: '6–9', from: 6, to: 9 },
  { label: '10+', from: 10, to: Infinity },
] as const

/** How many won, scored games fall in each gap bucket. */
export function gapCounts(games: Game[]): { label: string; count: number }[] {
  const gaps = games.filter((g) => g.winner).map(scoreGap).filter((n): n is number => n !== null)
  return GAP_BUCKETS.map((b) => ({ label: b.label, count: gaps.filter((n) => n >= b.from && n <= b.to).length }))
}

/** Averages over everything chosen: game length, check-in, score gap, games per player, wait. */
export function overall(sessions: Session[]) {
  const trends = sessionTrends(sessions)
  const games = playedGames(sessions)
  const days = sessions.flatMap(playerDays)
  const gaps = games.map(scoreGap).filter((n): n is number => n !== null)
  return {
    gameMin: mean(games.map((g) => (g.endedAt! - g.startedAt) / MIN)),
    checkinClock: mean(sessions.flatMap((s) => s.attendees.map((a) => clockMinutes(a.checkedInAt)))),
    earlyMin: mean(days.map((d) => d.earlyMin).filter((n): n is number => n !== null)),
    gap: mean(gaps),
    scored: gaps.length,
    perPlayer: mean(days.filter((d) => d.games > 0).map((d) => d.games)),
    waitMin: mean(days.map((d) => d.waitMin).filter((n): n is number => n !== null)),
    sessions: trends.length,
  }
}

/** About `count` round tick values covering lo..hi (always including 0). */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  const min = Math.min(0, lo)
  const max = Math.max(0, hi)
  if (min === max) return [0, 1]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const ticks: number[] = []
  for (let t = Math.floor(min / step) * step; t <= Math.ceil(max / step) * step + step / 2; t += step) {
    ticks.push(Math.round(t * 1000) / 1000)
  }
  return ticks
}
