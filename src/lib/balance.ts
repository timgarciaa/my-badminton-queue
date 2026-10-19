import type { Game, Pair } from '../types'

export interface Split {
  teamA: Pair
  teamB: Pair
  /** Absolute difference in total skill between the teams. */
  diff: number
}

export interface ScoredSplit extends Split {
  /** Times these partnerships already happened this session (summed). */
  repeats: number
  /** Teams in this split that have partnered before. */
  repeatedPairs: Pair[]
}

type SkillOf = (id: string) => number
type GenderOf = (id: string) => string | undefined

export interface BalanceOptions {
  /** How often each pair ("id|id") has been teammates this session. */
  partners?: Map<string, number>
  genderOf?: GenderOf
  /**
   * How much extra skill difference is acceptable to get fresh partners.
   * 0 = skill always wins; 2 = allow a slightly less even game.
   */
  slack?: number
  /** Players the organizer placed by hand; never swapped automatically. */
  locked?: Set<string>
  /** How often each pair ("id|id") has shared a court (as partners or opponents). */
  met?: Map<string, number>
}

/** The three distinct ways to split four players into two pairs. */
export function allSplits(four: string[], skillOf: SkillOf): Split[] {
  const [a, b, c, d] = four
  const pairings: [Pair, Pair][] = [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ]
  return pairings.map(([teamA, teamB]) => ({
    teamA,
    teamB,
    diff: Math.abs(skillOf(teamA[0]) + skillOf(teamA[1]) - skillOf(teamB[0]) - skillOf(teamB[1])),
  }))
}

/** How many times each pair has been teammates in the given games. */
export function partnerCounts(games: Game[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const g of games) {
    for (const team of [g.teamA, g.teamB]) {
      const key = pairKey(team)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

/** How many times each pair of players has been on the same court. */
export function meetCounts(games: Game[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const g of games) {
    for (const key of groupPairs([...g.teamA, ...g.teamB])) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** The 6 pair keys within a group of four. */
export function groupPairs(four: string[]): string[] {
  const keys: string[] = []
  for (let i = 0; i < four.length; i++)
    for (let j = i + 1; j < four.length; j++) keys.push(pairKey([four[i], four[j]]))
  return keys
}

/** Pairs within the group that already shared a court; 6 means the same four again. */
export function metPairs(four: string[], met: Map<string, number>): number {
  return groupPairs(four).filter((k) => (met.get(k) ?? 0) > 0).length
}

/** At or above this many met pairs (of 6) the group counts as a rematch. */
export const REMATCH_AT = 5

export function pairKey([x, y]: Pair): string {
  return x < y ? `${x}|${y}` : `${y}|${x}`
}

/**
 * Split four players into two teams. In order of priority:
 * 1. fresh partners (rotate who plays with whom), as long as the game stays
 *    within `slack` of the most even split,
 * 2. even total skill,
 * 3. one male + one female per team.
 */
export function splitTeams(
  four: string[],
  skillOf: SkillOf,
  { partners = new Map(), genderOf = () => undefined, slack = 2 }: BalanceOptions = {},
): ScoredSplit {
  if (four.length !== 4) throw new Error('splitTeams needs exactly 4 players')
  // A team counts as same-gender only when both genders are known and equal.
  const sameGender = ([x, y]: Pair) => {
    const gx = genderOf(x)
    return gx !== undefined && gx === genderOf(y)
  }
  const scored: ScoredSplit[] = allSplits(four, skillOf).map((s) => {
    const repeatedPairs = [s.teamA, s.teamB].filter((t) => (partners.get(pairKey(t)) ?? 0) > 0)
    const repeats = (partners.get(pairKey(s.teamA)) ?? 0) + (partners.get(pairKey(s.teamB)) ?? 0)
    return { ...s, repeats, repeatedPairs }
  })
  const minDiff = Math.min(...scored.map((s) => s.diff))
  const unmixed = (s: Split) => Number(sameGender(s.teamA)) + Number(sameGender(s.teamB))
  const score = (s: ScoredSplit) => s.repeats * 1000 + s.diff * 100 + unmixed(s) * 10
  return scored
    .filter((s) => s.diff <= minDiff + slack)
    .reduce((best, s) => (score(s) < score(best) ? s : best))
}

export interface SwapSuggestion {
  out: string
  in: string
  split: ScoredSplit
  /** Why the next game needs help. */
  reason: 'rematch' | 'repeat' | 'lopsided'
  /** For 'rematch': the four who would be on court together again. */
  group?: string[]
  /** For 'repeat': the partnership that would happen again. */
  repeatedPair?: Pair
}

/**
 * Balance along the way: if the first four in the queue would be a rematch
 * (nearly the same four as an earlier game), repeat a partnership or make a
 * lopsided game, suggest swapping one of them with someone a little further
 * back in the queue (positions 5..lookahead).
 */
export function suggestSwap(
  queue: string[],
  skillOf: SkillOf,
  {
    threshold = 3,
    lookahead = 6,
    locked = new Set(),
    met = new Map(),
    ...opts
  }: BalanceOptions & { threshold?: number; lookahead?: number } = {},
): SwapSuggestion | null {
  if (queue.length < 5) return null
  const four = queue.slice(0, 4)
  const current = splitTeams(four, skillOf, opts)
  const currentMet = metPairs(four, met)
  const cost = (group: string[], s: ScoredSplit) =>
    s.repeats * 100 +
    Math.max(0, metPairs(group, met) - REMATCH_AT + 1) * 60 +
    Math.max(0, s.diff - threshold + 1) * 10 +
    s.diff
  const isRematch = currentMet >= REMATCH_AT
  if (!isRematch && current.repeats === 0 && current.diff < threshold) return null

  const currentCost = cost(four, current)
  let best: { cost: number; idea: SwapSuggestion } | null = null
  for (const candidate of queue.slice(4, lookahead)) {
    if (locked.has(candidate)) continue
    for (const out of four) {
      if (locked.has(out)) continue
      const trial = four.map((id) => (id === out ? candidate : id))
      const split = splitTeams(trial, skillOf, opts)
      const c = cost(trial, split)
      if (c < currentCost && (!best || c < best.cost)) {
        best = {
          cost: c,
          idea: {
            out,
            in: candidate,
            split,
            reason: isRematch ? 'rematch' : current.repeats > 0 ? 'repeat' : 'lopsided',
            repeatedPair: current.repeatedPairs[0],
            group: isRematch ? four : undefined,
          },
        }
      }
    }
  }
  return best?.idea ?? null
}
