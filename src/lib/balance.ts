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
  /** Teams in this split that were partners last session. */
  lastRepeats: number
  /** A struggling player partnered with the strongest player in the four. */
  helped?: { player: string; partner: string; rate: number }
}

type SkillOf = (id: string) => number
type GenderOf = (id: string) => string | undefined

/**
 * Players to help: someone who lost most of their games last session (or
 * every one of their recent games) partners the player with the best win rate
 * in the same four.
 */
export interface Help {
  struggling: Set<string>
  /** Win rate (0 to 1) of players strong enough to help. */
  strength: Map<string, number>
}

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
  /** Pair struggling players with the strongest player; only for the final split, never for swaps. */
  help?: Help
  /** How often each pair ("id|id") were teammates last session; fresh pairings are preferred. */
  lastPartners?: Map<string, number>
  /** Games each player has played in a row without sitting one out (see playStreaks). */
  played?: Map<string, number>
  /** Players never moved back by a swap (e.g. early arrivals who haven't played yet). */
  keep?: Set<string>
  /** Games each player has played this session (see fairShare), so swaps keep everyone's share even. */
  games?: Map<string, number>
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

/** How many games each player has played (or is playing). */
export function gamesPlayed(games: Game[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const g of games) for (const id of [...g.teamA, ...g.teamB]) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

/**
 * Games each player has played, plus their likely share of the games that
 * started before they checked in, so late arrivals aren't hurried to catch up.
 */
export function fairShare(games: Game[], attendees: { playerId: string; checkedInAt: number }[]): Map<string, number> {
  const played = gamesPlayed(games)
  return new Map(
    attendees.map((a) => {
      const missed = games.filter((g) => g.startedAt < a.checkedInAt).length
      return [a.playerId, (played.get(a.playerId) ?? 0) + (missed * 4) / attendees.length]
    }),
  )
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

/** After this many games in a row, a player sits the next one out when someone else can play. */
export const REST_AFTER = 2

/**
 * Games each player has played in a row without sitting one out, counting
 * only players who haven't sat out since: a game that starts after their
 * last one ended (without them) is a rest and clears it.
 */
export function playStreaks(games: Game[]): Map<string, number> {
  const sorted = [...games].sort((a, b) => a.startedAt - b.startedAt)
  const restedBetween = (from: number, to: number) => sorted.some((g) => g.startedAt >= from && g.startedAt < to)
  const out = new Map<string, number>()
  const last = new Map<string, Game>()
  for (const g of sorted) {
    for (const id of [...g.teamA, ...g.teamB]) {
      const prev = last.get(id)
      const run = prev?.endedAt !== undefined && !restedBetween(prev.endedAt, g.startedAt) ? (out.get(id) ?? 0) + 1 : 1
      out.set(id, run)
      last.set(id, g)
    }
  }
  for (const [id, g] of last) if (g.endedAt !== undefined && restedBetween(g.endedAt, Infinity)) out.delete(id)
  return out
}

export function pairKey([x, y]: Pair): string {
  return x < y ? `${x}|${y}` : `${y}|${x}`
}

/**
 * Split four players into two teams. In order of priority:
 * 1. fresh partners (rotate who plays with whom),
 * 2. with `help`: a struggling player partners the strongest player in the four,
 * 3. partners who weren't teammates last session,
 * 4. even total skill,
 * 5. one male + one female per team.
 */
export function splitTeams(
  four: string[],
  skillOf: SkillOf,
  { partners = new Map(), genderOf = () => undefined, slack = Infinity, help, lastPartners = new Map() }: BalanceOptions = {},
): ScoredSplit {
  if (four.length !== 4) throw new Error('splitTeams needs exactly 4 players')
  // A team counts as same-gender only when both genders are known and equal.
  const sameGender = ([x, y]: Pair) => {
    const gx = genderOf(x)
    return gx !== undefined && gx === genderOf(y)
  }
  // The best win rate among the four, from someone not struggling themselves.
  const struggling = (id: string) => !!help?.struggling.has(id)
  const best = Math.max(0, ...four.filter((id) => !struggling(id)).map((id) => help?.strength.get(id) ?? 0))
  const helpIn = ([x, y]: Pair) =>
    [
      [x, y],
      [y, x],
    ].map(([player, partner]) =>
      best && struggling(player) && !struggling(partner) && help!.strength.get(partner) === best
        ? { player, partner, rate: best }
        : undefined,
    )
  const canHelp = best > 0 && four.some(struggling)
  const scored: ScoredSplit[] = allSplits(four, skillOf).map((s) => {
    const repeatedPairs = [s.teamA, s.teamB].filter((t) => (partners.get(pairKey(t)) ?? 0) > 0)
    const repeats = (partners.get(pairKey(s.teamA)) ?? 0) + (partners.get(pairKey(s.teamB)) ?? 0)
    const lastRepeats = Number((lastPartners.get(pairKey(s.teamA)) ?? 0) > 0) + Number((lastPartners.get(pairKey(s.teamB)) ?? 0) > 0)
    const helped = [...helpIn(s.teamA), ...helpIn(s.teamB)].find(Boolean)
    return { ...s, repeats, repeatedPairs, lastRepeats, ...(helped && { helped }) }
  })
  const minDiff = Math.min(...scored.map((s) => s.diff))
  const unmixed = (s: Split) => Number(sameGender(s.teamA)) + Number(sameGender(s.teamB))
  // Help (2000) outweighs last session's partners (at most 2 × 300), any skill gap and the
  // gender mix (at most 820), never a repeat partner today (5000).
  const unhelped = (s: ScoredSplit) => (canHelp && !s.helped ? 2000 : 0)
  const score = (s: ScoredSplit) => s.repeats * 5000 + unhelped(s) + s.lastRepeats * 300 + s.diff * 100 + unmixed(s) * 10
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
  /** A second swap, used only when one swap can't avoid a repeat partnership, a rematch or no rest. */
  also?: { in: string; out: string }
}

/**
 * Balance along the way: swap one of the first four in the queue with someone
 * a little further back (positions 5..lookahead) when that lets players meet
 * people they haven't played with yet. If one swap still leaves a repeated
 * partnership (or the same four), two players are swapped. In order of priority:
 * 1. a rest for anyone who played REST_AFTER games in a row (they're never moved up),
 * 2. no repeated partnerships,
 * 3. fewest past meetings within the group (the same four never again),
 * 4. not moving up someone who just played,
 * 5. moving up whoever has played fewest games,
 * 6. partners who weren't teammates last session,
 * 7. even total skill (only a very lopsided game triggers a swap by itself).
 * Fair share: nobody moves up for someone who has played fewer games (unless
 * that player needs a rest, or to avoid a repeat partner), and a player 2
 * games behind someone in the four moves up. Players in `locked` never move;
 * players in `keep` are never moved back.
 */
export function suggestSwap(
  queue: string[],
  skillOf: SkillOf,
  {
    threshold = 3,
    lookahead = 8,
    locked = new Set(),
    met = new Map(),
    played = new Map(),
    keep = new Set(),
    games = new Map(),
    ...opts
  }: BalanceOptions & { threshold?: number; lookahead?: number } = {},
): SwapSuggestion | null {
  if (queue.length < 5) return null
  const four = queue.slice(0, 4)
  const current = splitTeams(four, skillOf, opts)
  const isRematch = metPairs(four, met) >= REMATCH_AT
  const tired = (id: string) => (played.get(id) ?? 0) >= REST_AFTER
  const lopsided = (s: ScoredSplit) => Math.max(0, s.diff - threshold + 1)
  // Someone moved up who hasn't sat out since their last game.
  const movedUpJustPlayed = (group: string[]) => group.filter((id) => !four.includes(id) && played.has(id)).length
  const cost = (group: string[], s: ScoredSplit) =>
    group.filter(tired).length * 10000 +
    s.repeats * 1000 +
    (metPairs(group, met) >= REMATCH_AT ? 500 : 0) +
    metTotal(group, met) * 100 +
    movedUpJustPlayed(group) * 250 +
    gamesIn(group) * 80 +
    s.lastRepeats * 60 +
    lopsided(s) * 10 +
    s.diff
  const needsRest = four.some(tired)
  const gamesOf = (id: string) => games.get(id) ?? 0
  const gamesIn = (group: string[]) => group.reduce((n, id) => n + gamesOf(id), 0)
  const currentCost = cost(four, current)
  const candidates = queue.slice(4, lookahead).filter((id) => !locked.has(id) && !tired(id))
  const outs = four.filter((id) => !locked.has(id) && !keep.has(id))
  // Someone further back is 2 or more games behind someone in the four.
  const behind = candidates.some((c) => outs.some((o) => gamesOf(c) <= gamesOf(o) - 2))
  if (!needsRest && !behind && current.repeats === 0 && metTotal(four, met) === 0 && lopsided(current) === 0) return null
  let best: { cost: number; idea: SwapSuggestion } | null = null
  // Fair share gives way only to a rest or to avoiding a repeat partner.
  const unfair = (m: { in: string; out: string }) => gamesOf(m.in) > gamesOf(m.out) && !tired(m.out) && current.repeats === 0
  const consider = (moves: { in: string; out: string }[]) => {
    if (moves.some(unfair)) return
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
        reason:
          trial.filter(tired).length < four.filter(tired).length
            ? 'rest'
            : isRematch
              ? 'rematch'
              : current.repeats > 0
                ? 'repeat'
                : metTotal(four, met) > metTotal(trial, met)
                  ? 'variety'
                  : lopsided(split) < lopsided(current)
                    ? 'lopsided'
                    : 'fair',
        repeatedPair: current.repeatedPairs[0],
        group: isRematch ? four : undefined,
      },
    }
  }
  for (const c of candidates) for (const out of outs) consider([{ in: c, out }])
  // Moving two people back is a bigger change, so only to avoid a repeat, a rematch or no rest.
  const stuck = (b: typeof best) => {
    const idea = b?.idea
    if (!idea) return current.repeats > 0 || isRematch || needsRest
    const group = four.map((id) => (id === idea.out ? idea.in : id))
    return idea.split.repeats > 0 || metPairs(group, met) >= REMATCH_AT || group.some(tired)
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
