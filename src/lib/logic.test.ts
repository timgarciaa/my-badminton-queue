import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import { bumpedPlayers, meetCounts, metPairs, pairKey, partnerCounts, splitTeams, suggestSwap } from './balance'
import { costSummary, money } from './cost'
import { parseNames } from './importNames'
import { planGames } from './plan'
import { playerRecords, winRate } from './stats'
import { dequeue, enqueue, move, nextFour, pushFront, swap } from './queue'

const skills: Record<string, number> = { a: 5, b: 4, c: 2, d: 1, e: 3, f: 3, g: 1, h: 1 }
const skillOf = (id: string) => skills[id]

describe('queue', () => {
  it('is first come, first served', () => {
    let q = enqueue([], ['a'])
    q = enqueue(q, ['b'])
    q = enqueue(q, ['c', 'd', 'e'])
    expect(nextFour(q)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('sends finished players to the back', () => {
    const q = enqueue(dequeue(['a', 'b', 'c', 'd', 'e', 'f'], ['a', 'b', 'c', 'd']), ['a', 'b', 'c', 'd'])
    expect(q).toEqual(['e', 'f', 'a', 'b', 'c', 'd'])
  })

  it('returns null when fewer than 4 wait', () => {
    expect(nextFour(['a', 'b', 'c'])).toBeNull()
  })

  it('moves, swaps and pushes to front', () => {
    expect(move(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(move(['a', 'b', 'c'], 'a', -5)).toEqual(['a', 'b', 'c'])
    expect(swap(['a', 'b', 'c', 'd', 'e'], 'b', 'e')).toEqual(['a', 'e', 'c', 'd', 'b'])
    expect(pushFront(['x', 'y'], ['a', 'b'])).toEqual(['a', 'b', 'x', 'y'])
  })
})

describe('balance', () => {
  const pairs = (s: { teamA: [string, string]; teamB: [string, string] }) =>
    [pairKey(s.teamA), pairKey(s.teamB)].sort()
  const used = (...keys: string[]) => new Map(keys.map((k) => [k, 1]))

  it('pairs strongest with weakest', () => {
    const s = splitTeams(['a', 'b', 'c', 'd'], skillOf)
    expect(s.diff).toBe(0)
    expect(pairs(s)).toEqual(['a|d', 'b|c'])
  })

  it('avoids a repeat partnership on ties', () => {
    // e,f are 3 and g,h are 1: (e,g|f,h) and (e,h|f,g) both diff 0
    const s = splitTeams(['e', 'f', 'g', 'h'], skillOf, { partners: used('e|g') })
    expect(s.diff).toBe(0)
    expect(pairs(s)).not.toContain('e|g')
  })

  it('prefers mixed pairs when skill is equally balanced', () => {
    const genders: Record<string, string> = { e: 'M', f: 'F', g: 'M', h: 'F' }
    // (e,g|f,h) and (e,h|f,g) are both diff 0; only the second is mixed
    const s = splitTeams(['e', 'f', 'g', 'h'], skillOf, { genderOf: (id) => genders[id] })
    expect(s.diff).toBe(0)
    expect(pairs(s)).toEqual(['e|h', 'f|g'])
  })

  it('keeps skill balance ahead of mixed pairs', () => {
    const genders: Record<string, string> = { a: 'M', d: 'M', b: 'F', c: 'F' }
    const s = splitTeams(['a', 'b', 'c', 'd'], skillOf, { genderOf: (id) => genders[id] })
    expect(s.diff).toBe(0)
    expect(pairs(s)).toEqual(['a|d', 'b|c'])
  })

  it('prefers fresh partners over mixed pairs', () => {
    const genders: Record<string, string> = { e: 'M', f: 'F', g: 'M', h: 'F' }
    const s = splitTeams(['e', 'f', 'g', 'h'], skillOf, { partners: used('e|h'), genderOf: (id) => genders[id] })
    expect(pairs(s)).toEqual(['e|g', 'f|h'])
  })

  it('accepts a slightly less even game for fresh partners', () => {
    // best is a(5)+d(1) vs b(4)+c(2); a|d already partnered -> a+c vs b+d (diff 2)
    const s = splitTeams(['a', 'b', 'c', 'd'], skillOf, { partners: used('a|d') })
    expect(pairs(s)).toEqual(['a|c', 'b|d'])
    expect(s.repeats).toBe(0)
  })

  it('rotates partners even when it makes a less even game', () => {
    // the only fresh split is a+b vs c+d (diff 6)
    const s = splitTeams(['a', 'b', 'c', 'd'], skillOf, { partners: used('a|d', 'a|c') })
    expect(pairs(s)).toEqual(['a|b', 'c|d'])
  })

  it('can still put skill first with a small slack', () => {
    const s = splitTeams(['a', 'b', 'c', 'd'], skillOf, { partners: used('a|d', 'a|c'), slack: 2 })
    expect(pairs(s)).toEqual(['a|d', 'b|c'])
  })

  it('rotates partners fully when the same four keep playing', () => {
    const four = ['e', 'f', 'g', 'h']
    const games: Session['games'] = []
    for (let i = 0; i < 3; i++) {
      const s = splitTeams(four, skillOf, { partners: partnerCounts(games), slack: 10 })
      games.push({ id: `g${i}`, court: 1, teamA: s.teamA, teamB: s.teamB, startedAt: i, shuttles: 0 })
    }
    const teams = games.flatMap((g) => [pairKey(g.teamA), pairKey(g.teamB)])
    expect(new Set(teams).size).toBe(6) // every possible partnership exactly once
  })

  it('suggests a swap when the next four are lopsided', () => {
    // a(5) d(1) g(1) h(1): best split 5+1 vs 1+1 = diff 4
    const swapIdea = suggestSwap(['a', 'd', 'g', 'h', 'b'], skillOf)
    expect(swapIdea).not.toBeNull()
    expect(swapIdea!.reason).toBe('lopsided')
    expect(swapIdea!.in).toBe('b')
    expect(swapIdea!.split.diff).toBeLessThan(4)
  })

  it('suggests a swap when every split repeats a partnership', () => {
    const swapIdea = suggestSwap(['e', 'f', 'g', 'h', 'a'], skillOf, { partners: used('e|f', 'e|g', 'e|h') })
    expect(swapIdea).toMatchObject({ reason: 'repeat', out: 'e', in: 'a' })
    expect(swapIdea!.split.repeats).toBe(0)
    expect(swapIdea!.repeatedPair).toContain('e')
  })

  it('suggests a swap when the same four would play together again', () => {
    // a,b,c,d already played one game; partners can rotate but it is a rematch
    const prev = [{ id: 'g1', court: 1, teamA: ['a', 'd'], teamB: ['b', 'c'], startedAt: 0, shuttles: 0 }] as Session['games']
    const idea = suggestSwap(['a', 'b', 'c', 'd', 'e', 'f'], skillOf, {
      partners: partnerCounts(prev),
      met: meetCounts(prev),
    })
    expect(idea).toMatchObject({ reason: 'rematch' })
    expect(idea!.group!.sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(['e', 'f']).toContain(idea!.in)
  })

  it('swaps in someone new when two of the four already played together', () => {
    // a,b met before; e hasn't played with anyone
    const prev = [{ id: 'g1', court: 1, teamA: ['a', 'x'], teamB: ['b', 'y'], startedAt: 0, shuttles: 0 }] as Session['games']
    expect(metPairs(['a', 'b', 'c', 'd'], meetCounts(prev))).toBe(1)
    const idea = suggestSwap(['a', 'b', 'c', 'd', 'e'], skillOf, { met: meetCounts(prev) })
    expect(idea).toMatchObject({ reason: 'variety', in: 'e' })
    expect(['a', 'b']).toContain(idea!.out)
  })

  it('swaps two players when one swap still repeats a partnership', () => {
    // e,f,g,h have partnered every possible way; one newcomer can't fix it
    const partners = used('e|f', 'g|h', 'e|g', 'f|h', 'e|h', 'f|g')
    const idea = suggestSwap(['e', 'f', 'g', 'h', 'a', 'b'], skillOf, { partners })
    expect(idea).toMatchObject({ reason: 'repeat' })
    expect(idea!.also).toBeDefined()
    expect([idea!.in, idea!.also!.in].sort()).toEqual(['a', 'b'])
    expect(idea!.split.repeats).toBe(0)
  })

  it('uses a single swap when that is enough', () => {
    const idea = suggestSwap(['e', 'f', 'g', 'h', 'a', 'b'], skillOf, { partners: used('e|f', 'e|g', 'e|h') })
    expect(idea!.also).toBeUndefined()
  })

  it('never moves back a player who was just moved back', () => {
    const prev = [{ id: 'g1', court: 1, teamA: ['a', 'x'], teamB: ['b', 'y'], startedAt: 0, shuttles: 0 }] as Session['games']
    const idea = suggestSwap(['a', 'b', 'c', 'd', 'e'], skillOf, { met: meetCounts(prev), locked: new Set(['a', 'b']) })
    expect(idea).toBeNull()
  })

  it('tracks who was moved back until they play', () => {
    const g = (id: string, four: string[], t: number, out?: string) =>
      ({ id, court: 1, teamA: [four[0], four[1]], teamB: [four[2], four[3]], startedAt: t, shuttles: 0, swap: out ? { in: 'z', out, reason: 'variety' } : undefined }) as Session['games'][number]
    expect([...bumpedPlayers([g('1', ['a', 'b', 'c', 'z'], 0, 'd')])]).toEqual(['d'])
    expect([...bumpedPlayers([g('1', ['a', 'b', 'c', 'z'], 0, 'd'), g('2', ['d', 'e', 'f', 'h'], 1)])]).toEqual([])
  })

  it('does not suggest a swap for a balanced, fresh game', () => {
    expect(suggestSwap(['a', 'b', 'c', 'd', 'e'], skillOf)).toBeNull()
  })
})

describe('planGames', () => {
  it('groups the queue into upcoming games with the rest left waiting', () => {
    const queue = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'x']
    const sk = (id: string) => skills[id] ?? 3
    const { games, rest } = planGames(queue, sk)
    expect(games).toHaveLength(2)
    expect(rest).toEqual(['x'])
    expect(games.flatMap((g) => [...g.teamA, ...g.teamB]).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  })

  it('matches what Next game would start, including the swap', () => {
    const queue = ['e', 'f', 'g', 'h', 'a', 'b']
    const opts = { partners: new Map([['e|f', 1], ['e|g', 1], ['e|h', 1]]) }
    const [first] = planGames(queue, skillOf, opts).games
    expect(first.swap).toMatchObject({ out: 'e', reason: 'repeat' })
    expect([...first.teamA, ...first.teamB]).not.toContain('e')
  })

  it('does not pair the same partners in two planned games', () => {
    // same skills everywhere, so only partner history decides
    const flat = () => 3
    const { games } = planGames(['a', 'b', 'c', 'd', 'a2', 'b2', 'c2', 'd2'], flat)
    const keys = games.flatMap((g) => [pairKey(g.teamA), pairKey(g.teamB)])
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('planGames with teams set by hand', () => {
  it('uses the manual teams while they are the first four', () => {
    const fixed = { teamA: ['c', 'b'] as [string, string], teamB: ['a', 'd'] as [string, string] }
    const { games, order } = planGames(['a', 'b', 'c', 'd', 'e'], skillOf, { fixed }, 1)
    expect(games[0]).toMatchObject({ teamA: ['c', 'b'], teamB: ['a', 'd'], manual: true })
    expect(order).toEqual(['c', 'b', 'a', 'd', 'e'])
  })

  it('falls back to automatic teams once the four change', () => {
    const fixed = { teamA: ['a', 'b'] as [string, string], teamB: ['c', 'd'] as [string, string] }
    const { games } = planGames(['a', 'b', 'c', 'e', 'd'], skillOf, { fixed }, 1)
    expect(games[0].manual).toBeUndefined()
  })
})

describe('planGames with set games', () => {
  const flat = () => 3
  const set = { id: 's1', teamA: ['e', 'f'] as [string, string], teamB: ['g', 'h'] as [string, string], createdAt: 0 }

  it('skips held players while some of the set are still busy', () => {
    // g and h are on court, so e and f wait and the others play.
    const { games, rest, held } = planGames(['e', 'f', 'a', 'b', 'c', 'd', 'x'], flat, { sets: [set] }, 1)
    expect([...games[0].teamA, ...games[0].teamB].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(rest).toEqual(['x'])
    expect(held).toEqual(['e', 'f'])
  })

  it('plays a ready set right after the current next game', () => {
    const queue = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'x']
    const { games, held } = planGames(queue, flat, { sets: [set] }, 1)
    expect([...games[0].teamA, ...games[0].teamB].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(held).toEqual(['e', 'f', 'g', 'h'])
    const two = planGames(queue, flat, { sets: [set] }, 2).games
    expect(two[1]).toMatchObject({ teamA: ['e', 'f'], teamB: ['g', 'h'], set: 's1' })
  })

  it('plays the set first once that game has started', () => {
    const { games, rest } = planGames(['x', 'y', 'z', 'w', 'e', 'f', 'g', 'h'], flat, { sets: [{ ...set, due: true }] }, 1)
    expect(games[0]).toMatchObject({ set: 's1' })
    expect(rest).toEqual(['x', 'y', 'z', 'w'])
  })

  it('plays a ready set first when no one else can make a game', () => {
    const { games } = planGames(['a', 'e', 'f', 'g', 'h'], flat, { sets: [set] }, 1)
    expect(games[0]).toMatchObject({ set: 's1' })
  })

  it('keeps held players in the order so manual moves do not drop them', () => {
    const { order } = planGames(['e', 'a', 'b', 'c', 'd'], flat, { sets: [set] }, 1)
    expect(order.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('stats', () => {
  const game = (teamA: [string, string], teamB: [string, string], winner?: 'A' | 'B', endedAt = 1) =>
    ({ id: Math.random().toString(), court: 1, teamA, teamB, startedAt: 0, endedAt, shuttles: 1, winner }) as Session['games'][number]

  it('counts wins, losses and undecided games', () => {
    const r = playerRecords([
      game(['a', 'b'], ['c', 'd'], 'A'),
      game(['a', 'c'], ['b', 'd'], 'B'),
      game(['a', 'd'], ['b', 'c']),
      game(['a', 'b'], ['c', 'd'], 'A', 0), // still on court
    ])
    expect(r.get('a')).toEqual({ played: 3, wins: 1, losses: 1 })
    expect(r.get('d')).toEqual({ played: 3, wins: 1, losses: 1 })
    expect(r.get('b')).toEqual({ played: 3, wins: 2, losses: 0 })
    expect(winRate(r.get('b')!)).toBe(1)
    expect(winRate({ played: 2, wins: 0, losses: 0 })).toBeNull()
  })
})

describe('parseNames', () => {
  it('strips numbering, blanks and extra spaces', () => {
    const text = '1. Bryan\n2. Ate Queen\n3) Ninong  Aries\n\n22. \n- Sam \n• Lem\nCoach Janner'
    expect(parseNames(text).names).toEqual(['Bryan', 'Ate Queen', 'Ninong Aries', 'Sam', 'Lem', 'Coach Janner'])
  })

  it('skips names that exist or repeat, ignoring case', () => {
    const r = parseNames('1. Tim\n2. tim\n3. Bri\n4. Jim', ['Jim'])
    expect(r.names).toEqual(['Tim', 'Bri'])
    expect(r.duplicates).toEqual(['tim', 'Jim'])
  })
})

describe('cost', () => {
  const base: Session = {
    id: 's',
    date: '2026-10-19',
    courtCount: 3,
    courtFee: 120,
    shuttlePrice: 4,
    extraShuttles: 0,
    attendees: Array.from({ length: 16 }, (_, i) => ({
      playerId: `p${i}`,
      checkedInAt: i,
      gamesPlayed: 0,
      paid: false,
      resting: false,
    })),
    queue: [],
    courts: [null, null, null],
    games: [],
    status: 'open',
  }

  it('splits court fee and shuttles equally', () => {
    const c = costSummary({ ...base, extraShuttles: 10 })
    expect(c.total).toBe(160)
    expect(c.perHead).toBe(10)
    expect(c.surplus).toBe(0)
  })

  it('shows whole pesos without centavos', () => {
    expect(money(78)).toBe('₱78')
    expect(money(1860)).toBe('₱1,860')
    expect(money(77.5)).toBe('₱77.50')
  })

  it('counts shuttles from games and rounds up to a whole peso', () => {
    const games = [
      { id: 'g1', court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], startedAt: 0, shuttles: 2 },
      { id: 'g2', court: 2, teamA: ['a', 'b'], teamB: ['c', 'd'], startedAt: 0, shuttles: 1 },
    ] as Session['games']
    const c = costSummary({ ...base, games, attendees: base.attendees.slice(0, 14) })
    expect(c.shuttlesUsed).toBe(3)
    expect(c.total).toBe(132)
    expect(c.perHeadExact).toBe(9.43)
    expect(c.perHead).toBe(10) // rounded up to a whole peso
    expect(c.surplus).toBe(8)
  })
})
