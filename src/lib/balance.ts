import type { Game, GameSwap, Pair } from '../types'

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
   * 0 = skill always wins; Infinity (default) = fresh partners always win.
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

/** Total times the players in a group have already shared a court (0 = all new to each other). */
export function metTotal(four: string[], met: Map<string, number>): number {
  return groupPairs(four).reduce((n, k) => n + (met.get(k) ?? 0), 0)
}

/**
 * Players moved back by an automatic swap who haven't played since. They are
 * never moved back twice in a row, so nobody waits more than one extra game.
 */
export function bumpedPlayers(games: Game[]): Set<string> {
  const bumped = new Set<string>()
  for (const g of [...games].sort((a, b) => a.startedAt - b.startedAt)) {
    for (const id of [...g.teamA, ...g.teamB]) bumped.delete(id)
    if (g.swap) bumped.add(g.swap.out)
    if (g.swap?.also) bumped.add(g.swap.also.out)
  }
  return bumped
}

export function pairKey([x, y]: Pair): string {
  return x < y ? `${x}|${y}` : `${y}|${x}`
}

/**
 * Split four players into two teams. In order of priority:
 * 1. fresh partners (rotate who plays with whom),
 * 2. even total skill,
 * 3. one male + one female per team.
 */
export function splitTeams(
  four: string[],
  skillOf: SkillOf,
  { partners = new Map(), genderOf = () => undefined, slack = Infinity }: BalanceOptions = {},
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
  reason: GameSwap['reason']
  /** For 'rematch': the four who would be on court together again. */
  group?: string[]
  /** For 'repeat': the partnership that would happen again. */
  repeatedPair?: Pair
  /** A second swap, used only when one swap can't avoid a repeat partnership or rematch. */
  also?: { in: string; out: string }
}

/**
 * Balance along the way: swap one of the first four in the queue with someone
 * a little further back (positions 5..lookahead) when that lets players meet
 * people they haven't played with yet. If one swap still leaves a repeated
 * partnership (or the same four), two players are swapped. In order of priority:
 * 1. no repeated partnerships,
 * 2. fewest past meetings within the group (the same four never again),
 * 3. even total skill (only a very lopsided game triggers a swap by itself).
 */
export function suggestSwap(
  queue: string[],
  skillOf: SkillOf,
  {
    threshold = 3,
    lookahead = 8,
    locked = new Set(),
    met = new Map(),
    ...opts
  }: BalanceOptions & { threshold?: number; lookahead?: number } = {},
): SwapSuggestion | null {
  if (queue.length < 5) return null
  const four = queue.slice(0, 4)
  const current = splitTeams(four, skillOf, opts)
  const isRematch = metPairs(four, met) >= REMATCH_AT
  const lopsided = (s: ScoredSplit) => Math.max(0, s.diff - threshold + 1)
  const cost = (group: string[], s: ScoredSplit) =>
    s.repeats * 1000 + (metPairs(group, met) >= REMATCH_AT ? 500 : 0) + metTotal(group, met) * 100 + lopsided(s) * 10 + s.diff
  if (current.repeats === 0 && metTotal(four, met) === 0 && lopsided(current) === 0) return null

  const currentCost = cost(four, current)
  const candidates = queue.slice(4, lookahead).filter((id) => !locked.has(id))
  const outs = four.filter((id) => !locked.has(id))
  let best: { cost: number; idea: SwapSuggestion } | null = null
  const consider = (moves: { in: string; out: string }[]) => {
    const trial = four.map((id) => moves.find((m) => m.out === id)?.in ?? id)
    const split = splitTeams(trial, skillOf, opts)
    const c = cost(trial, split)
    if (c >= currentCost || (best && c >= best.cost)) return
    best = {
      cost: c,
      idea: {
        ...moves[0],
        also: moves[1],
        split,
        reason: isRematch
          ? 'rematch'
          : current.repeats > 0
            ? 'repeat'
            : metTotal(four, met) > metTotal(trial, met)
              ? 'variety'
              : 'lopsided',
        repeatedPair: current.repeatedPairs[0],
        group: isRematch ? four : undefined,
      },
    }
  }
  for (const c of candidates) for (const out of outs) consider([{ in: c, out }])
  // Moving two people back is a bigger change, so only to avoid a repeat or rematch.
  const stuck = (b: typeof best) => {
    const idea = b?.idea
    if (!idea) return current.repeats > 0 || isRematch
    const group = four.map((id) => (id === idea.out ? idea.in : id))
    return idea.split.repeats > 0 || metPairs(group, met) >= REMATCH_AT
  }
  if (stuck(best)) {
    for (let i = 0; i < candidates.length; i++)
      for (let j = i + 1; j < candidates.length; j++)
        for (let x = 0; x < outs.length; x++)
          for (let y = x + 1; y < outs.length; y++)
            consider([
              { in: candidates[i], out: outs[x] },
              { in: candidates[j], out: outs[y] },
            ])
  }
  return (best as { idea: SwapSuggestion } | null)?.idea ?? null
}
