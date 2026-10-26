import type { GameSwap, Pair, SetGame } from '../types'
import { groupPairs, pairKey, splitTeams, suggestSwap, type BalanceOptions } from './balance'
import { applySwap } from './queue'

export interface PlannedGame {
  teamA: Pair
  teamB: Pair
  diff: number
  swap?: GameSwap
  /** Teams were set by hand. */
  manual?: boolean
  /** Id of the set game this is. */
  set?: string
  /** A struggling player partnered with the player on the best win streak. */
  help?: { player: string; partner: string; streak: number }
}

export const setIds = (g: Pick<SetGame, 'teamA' | 'teamB'>) => [...g.teamA, ...g.teamB]

/** Players held for set games, which skip normal games until their set plays. */
export const heldIds = (sets: SetGame[] = []) => new Set(sets.flatMap(setIds))

/** A set game is ready once all four of its players are waiting in the queue. */
export const isSetReady = (set: SetGame, queue: string[]) => setIds(set).every((id) => queue.includes(id))

/**
 * Winners stay: the next game for the winners and the next two waiting players.
 * Split up, each winner partners one of the two, picking the pairing with fewer
 * repeat partners, then the more even game. Together, the winners keep their
 * team and the two waiting players challenge them. Null when fewer than two
 * players are waiting.
 */
export function winnersStayGame(
  winners: Pair,
  waiting: string[],
  skillOf: (id: string) => number,
  partners: Map<string, number> = new Map(),
  split = true,
): { teamA: Pair; teamB: Pair } | null {
  if (waiting.length < 2) return null
  const [w1, w2] = winners
  const [a, b] = waiting
  if (!split) return { teamA: winners, teamB: [a, b] }
  const total = (t: Pair) => skillOf(t[0]) + skillOf(t[1])
  const cost = ([x, y]: [Pair, Pair]) =>
    ((partners.get(pairKey(x)) ?? 0) + (partners.get(pairKey(y)) ?? 0)) * 100 + Math.abs(total(x) - total(y))
  const together: [Pair, Pair] = [
    [w1, a],
    [w2, b],
  ]
  const crossed: [Pair, Pair] = [
    [w1, b],
    [w2, a],
  ]
  const [teamA, teamB] = cost(crossed) < cost(together) ? crossed : together
  return { teamA, teamB }
}

/** Skill as matching sees it: with skill matching off, every player counts the same. */
export function matchSkill(skillOf: (id: string) => number, on: boolean): (id: string) => number {
  return on ? skillOf : () => 3
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
 *
 * Set games play once all four players are waiting: right after the game that
 * was next when they became ready (or first, if that game has started). Until
 * then their players are skipped, so the rest of the queue keeps moving.
 */
export function planGames(
  queue: string[],
  skillOf: (id: string) => number,
  {
    partners = new Map(),
    met = new Map(),
    autoSwap = true,
    fixed,
    sets = [],
    help,
    ...opts
  }: BalanceOptions & {
    autoSwap?: boolean
    /** Set games waiting to be played, oldest first. */
    sets?: SetGame[]
    /** Teams set by hand for the next game; used if they are the first four in the queue. */
    fixed?: { teamA: Pair; teamB: Pair }
  } = {},
  max = 3,
): { games: PlannedGame[]; rest: string[]; order: string[]; held: string[] } {
  const held = heldIds(sets)
  let q = queue.filter((id) => !held.has(id))
  const counts = new Map(partners)
  const meets = new Map(met)
  const games: PlannedGame[] = []
  const total = (t: Pair) => skillOf(t[0]) + skillOf(t[1])
  const count = (ids: string[], teams: Pair[]) => {
    for (const team of teams) counts.set(pairKey(team), (counts.get(pairKey(team)) ?? 0) + 1)
    for (const key of groupPairs(ids)) meets.set(key, (meets.get(key) ?? 0) + 1)
  }
  const setsPlanned = new Set<string>()
  const addSets = (dueOnly: boolean) => {
    for (const set of sets) {
      if (games.length >= max || setsPlanned.has(set.id) || (dueOnly && !set.due) || !isSetReady(set, queue)) continue
      games.push({ teamA: set.teamA, teamB: set.teamB, diff: Math.abs(total(set.teamA) - total(set.teamB)), manual: true, set: set.id })
      count(setIds(set), [set.teamA, set.teamB])
      setsPlanned.add(set.id)
    }
  }
  addSets(true)
  if (fixed && isFirstFour(q, fixed) && games.length < max) {
    const ids = [...fixed.teamA, ...fixed.teamB]
    games.push({ teamA: fixed.teamA, teamB: fixed.teamB, diff: Math.abs(total(fixed.teamA) - total(fixed.teamB)), manual: true })
    count(ids, [fixed.teamA, fixed.teamB])
    q = q.filter((id) => !ids.includes(id))
    addSets(false)
  }
  while (q.length >= 4 && games.length < max) {
    const idea = autoSwap ? suggestSwap(q, skillOf, { ...opts, partners: counts, met: meets }) : null
    if (idea) q = applySwap(q, idea)
    // Help only picks partners within the four; swaps (above) are decided without it.
    const split = splitTeams(q.slice(0, 4), skillOf, { ...opts, partners: counts, help })
    games.push({
      teamA: split.teamA,
      teamB: split.teamB,
      diff: split.diff,
      swap: idea ? { in: idea.in, out: idea.out, reason: idea.reason, ...(idea.also && { also: idea.also }) } : undefined,
      ...(split.helped && { help: split.helped }),
    })
    count(q.slice(0, 4), [split.teamA, split.teamB])
    q = q.slice(4)
    addSets(false)
  }
  // Not enough other players for a game first: ready sets go now.
  addSets(false)
  // Held players still waiting for the rest of their set.
  const planned = new Set(games.flatMap(setIds))
  const waitingHeld = queue.filter((id) => held.has(id) && !planned.has(id))
  // The queue in the order shown: each game's team A, team B, the rest, then held players.
  const order = [...games.flatMap(setIds), ...q, ...waitingHeld]
  return { games, rest: q, order, held: waitingHeld }
}
