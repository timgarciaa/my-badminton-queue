import type { GameSwap, Pair } from '../types'
import { groupPairs, pairKey, splitTeams, suggestSwap, type BalanceOptions } from './balance'
import { swap } from './queue'

export interface PlannedGame {
  teamA: Pair
  teamB: Pair
  diff: number
  swap?: GameSwap
  /** Teams were set by hand. */
  manual?: boolean
}

/** True when the fixed teams are exactly the first four players in the queue. */
export function isFirstFour(queue: string[], fixed: { teamA: Pair; teamB: Pair }): boolean {
  const ids = [...fixed.teamA, ...fixed.teamB]
  const first = queue.slice(0, 4)
  return first.length === 4 && ids.every((id) => first.includes(id))
}

/**
 * Preview the next games from the queue, exactly as "Next game" would start
 * them (including automatic swaps). Later games assume the earlier ones go
 * ahead as planned, so they are a forecast.
 */
export function planGames(
  queue: string[],
  skillOf: (id: string) => number,
  {
    partners = new Map(),
    met = new Map(),
    autoSwap = true,
    fixed,
    ...opts
  }: BalanceOptions & {
    autoSwap?: boolean
    /** Teams set by hand for the next game; used if they are the first four in the queue. */
    fixed?: { teamA: Pair; teamB: Pair }
  } = {},
  max = 3,
): { games: PlannedGame[]; rest: string[]; order: string[] } {
  let q = [...queue]
  const counts = new Map(partners)
  const meets = new Map(met)
  const games: PlannedGame[] = []
  if (fixed && isFirstFour(q, fixed) && max > 0) {
    const ids = [...fixed.teamA, ...fixed.teamB]
    const total = (t: Pair) => skillOf(t[0]) + skillOf(t[1])
    games.push({ teamA: fixed.teamA, teamB: fixed.teamB, diff: Math.abs(total(fixed.teamA) - total(fixed.teamB)), manual: true })
    for (const team of [fixed.teamA, fixed.teamB]) counts.set(pairKey(team), (counts.get(pairKey(team)) ?? 0) + 1)
    for (const key of groupPairs(ids)) meets.set(key, (meets.get(key) ?? 0) + 1)
    q = q.filter((id) => !ids.includes(id))
  }
  while (q.length >= 4 && games.length < max) {
    const idea = autoSwap ? suggestSwap(q, skillOf, { ...opts, partners: counts, met: meets }) : null
    if (idea) q = swap(q, idea.out, idea.in)
    const split = splitTeams(q.slice(0, 4), skillOf, { ...opts, partners: counts })
    games.push({
      teamA: split.teamA,
      teamB: split.teamB,
      diff: split.diff,
      swap: idea ? { in: idea.in, out: idea.out, reason: idea.reason } : undefined,
    })
    for (const team of [split.teamA, split.teamB]) counts.set(pairKey(team), (counts.get(pairKey(team)) ?? 0) + 1)
    for (const key of groupPairs(q.slice(0, 4))) meets.set(key, (meets.get(key) ?? 0) + 1)
    q = q.slice(4)
  }
  // The queue in the order shown: each game's team A, team B, then the rest.
  const order = [...games.flatMap((g) => [...g.teamA, ...g.teamB]), ...q]
  return { games, rest: q, order }
}
