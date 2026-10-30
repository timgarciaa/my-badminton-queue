import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { bumpedPlayers, meetCounts, metPairs, pairKey, partnerCounts, splitTeams, suggestSwap } from './balance'
import { costSummary, courtBooking, money, sessionStarted, shuttleCount, shuttlesInStock } from './cost'
import type { Help } from './balance'
import { parseNames } from './importNames'
import { matchSkill, planGames, winnersStayGame } from './plan'
import { arrivals, bestRecord, scoreLeader, checkinPlaces, checkinStandings, duoRecords, form, mateRecords, mostOften, gameExtremes, gameTime, helpFrom, ordinal, places, playedGames, sessionsWithin, standings, playerRecords, rivalries, streaks, winRate, worstRecord } from './stats'
import { dequeue, enqueue, move, nextFour, placeByArrival, pushFront, swap } from './queue'
import { isHelpStruggling, isSkillMatch, migrateStore, newSession, playedOn, redate, useStore } from '../store/useStore'

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

describe('winnersStayGame', () => {
  const skill: Record<string, number> = { w1: 5, w2: 1, a: 4, b: 2 }
  const skillOf = (id: string) => skill[id] ?? 3

  it('splits the winners, each with one of the next two waiting', () => {
    const g = winnersStayGame(['w1', 'w2'], ['a', 'b', 'c'], skillOf)!
    expect([g.teamA, g.teamB].map((t) => t.filter((id) => id.startsWith('w')).length)).toEqual([1, 1])
    expect([...g.teamA, ...g.teamB].sort()).toEqual(['a', 'b', 'w1', 'w2'])
  })

  it('picks the more even pairing', () => {
    // w1+b (7) vs w2+a (5) beats w1+a (9) vs w2+b (3).
    const g = winnersStayGame(['w1', 'w2'], ['a', 'b'], skillOf)!
    expect(g.teamA).toEqual(['w1', 'b'])
    expect(g.teamB).toEqual(['w2', 'a'])
  })

  it('avoids repeat partners before evening skill', () => {
    const partners = new Map([[pairKey(['w1', 'b']), 1]])
    const g = winnersStayGame(['w1', 'w2'], ['a', 'b'], skillOf, partners)!
    expect(g.teamA).toEqual(['w1', 'a'])
  })

  it('needs two waiting players', () => {
    expect(winnersStayGame(['w1', 'w2'], ['a'], skillOf)).toBeNull()
  })

  it('keeps the winners together against the next two when not splitting', () => {
    const g = winnersStayGame(['w1', 'w2'], ['a', 'b', 'c'], skillOf, new Map(), false)!
    expect(g.teamA).toEqual(['w1', 'w2'])
    expect(g.teamB).toEqual(['a', 'b'])
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

  it('prices each shuttle type separately', () => {
    const game = (id: string, shuttles: number, shuttleType?: string) =>
      ({ id, court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], startedAt: 0, shuttles, shuttleType }) as Session['games'][number]
    const c = costSummary({
      ...base,
      shuttleTypes: [
        { id: 'v', name: 'Vortex', price: 80, extra: 1 },
        { id: 'x', name: 'XP2', price: 100, extra: 0 },
      ],
      shuttleTypeId: 'x',
      // A game from before types counts as the first type.
      games: [game('g1', 2, 'v'), game('g2', 1), game('g3', 2, 'x')],
    })
    expect(c.shuttles.map((l) => [l.name, l.fromGames, l.used, l.cost])).toEqual([
      ['Vortex', 3, 4, 320],
      ['XP2', 2, 2, 200],
    ])
    expect(c.shuttlesUsed).toBe(6)
    expect(c.total).toBe(120 + 320 + 200)
  })
})

describe('shuttle count', () => {
  const game = (shuttles: number) =>
    ({ id: `g${shuttles}`, court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], startedAt: 0, shuttles }) as Session['games'][number]

  it('starts once the timer runs or a game is played', () => {
    const s = newSession()
    expect(sessionStarted(s)).toBe(false)
    expect(sessionStarted({ ...s, timer: { startedAt: 0, minutes: 120 } })).toBe(true)
    expect(sessionStarted({ ...s, games: [game(1)] })).toBe(true)
  })

  const typed = (s: Session): Session => ({
    ...s,
    shuttleTypes: [
      { id: 'd', name: 'Dmantis', price: 75, extra: 0 },
      { id: 'x', name: 'XP2', price: 90, extra: 0 },
    ],
    shuttleTypeId: 'd',
  })

  it('shows used as start minus left per type, next to what games recorded', () => {
    const s = typed({ ...newSession(), games: [game(1), { ...game(2), shuttleType: 'x' }] })
    expect(shuttleCount(s)).toMatchObject({ start: undefined, used: undefined, recorded: 0 })
    const types = (d: object, x: object) => [{ ...s.shuttleTypes![0], ...d }, { ...s.shuttleTypes![1], ...x }]
    // Only Dmantis counted: totals cover it alone.
    expect(shuttleCount({ ...s, shuttleTypes: types({ start: 12, left: 10 }, {}) })).toMatchObject({
      start: 12,
      left: 10,
      used: 2,
      recorded: 1,
    })
    // Both counted, XP2 not counted at the end yet: no total used.
    const c = shuttleCount({ ...s, shuttleTypes: types({ start: 12, left: 10 }, { start: 3 }) })
    expect(c.lines.map((l) => [l.name, l.start, l.left, l.used, l.recorded])).toEqual([
      ['Dmantis', 12, 10, 2, 1],
      ['XP2', 3, undefined, undefined, 2],
    ])
    expect(c).toMatchObject({ start: 15, left: undefined, used: undefined, recorded: 3 })
    expect(shuttleCount({ ...s, shuttleTypes: types({ start: 12, left: 10 }, { start: 3, left: 1 }) })).toMatchObject({
      start: 15,
      left: 11,
      used: 4,
      recorded: 3,
    })
  })

  it('locks the starting counts once the session starts', () => {
    const st = useStore.getState()
    st.resetSession()
    useStore.setState({ session: typed(useStore.getState().session) })
    const type = (id: string) => useStore.getState().session.shuttleTypes!.find((t) => t.id === id)
    st.setShuttlesLeft('d', 5) // ignored before the start
    st.setShuttlesStart('d', 12)
    st.setShuttlesStart('x', 3)
    expect(type('d')).toMatchObject({ start: 12, left: undefined })
    st.startTimer(2)
    st.setShuttlesStart('d', 30) // locked
    st.setShuttlesLeft('d', 40) // can't be more than the start
    st.setShuttlesLeft('x', 1)
    expect(type('d')).toMatchObject({ start: 12, left: 12 })
    expect(type('x')).toMatchObject({ start: 3, left: 1 })
    // Still locked after the timer is stopped, once games have been played.
    st.startGame(1, ['a', 'b'], ['c', 'd'])
    st.stopTimer()
    st.setShuttlesStart('x', 30)
    expect(type('x')?.start).toBe(3)
  })

  it("carries what's left over to the next session", () => {
    const prev = typed(newSession())
    prev.shuttleTypes = [
      { ...prev.shuttleTypes![0], start: 12, left: 8 },
      { ...prev.shuttleTypes![1], start: 3 },
    ]
    expect(newSession(prev).shuttleTypes!.map((t) => [t.start, t.left])).toEqual([
      [8, undefined],
      [3, undefined],
    ])
    expect(newSession().shuttleTypes![0].start).toBeUndefined()
  })

  it("can't use more of a type than there was at the start", () => {
    const st = useStore.getState()
    st.resetSession()
    useStore.setState({ session: typed(useStore.getState().session) })
    st.setShuttlesStart('x', 2)
    st.setShuttlesStart('d', 12)
    st.setDefaultShuttleType('x')
    st.startTimer(2)
    const s = () => useStore.getState().session
    const type = (id: string) => s().shuttleTypes!.find((t) => t.id === id)!

    st.startGame(1, ['a', 'b'], ['c', 'd']) // first game on court 1 opens an XP2
    const g1 = s().games[0]
    expect(g1).toMatchObject({ shuttleType: 'x', shuttles: 1 })
    st.addShuttle(g1.id, 2) // only one more XP2 left
    expect(s().games[0].shuttles).toBe(2)
    expect(shuttlesInStock(s(), 'x')).toBe(0)
    expect(shuttlesInStock(s(), 'd')).toBe(12)

    st.updateShuttleType('x', { extra: 1 }) // no XP2 left to adjust up
    expect(type('x').extra).toBe(0)

    // Court 2's first game would open an XP2; there's none, so it opens a Dmantis.
    st.startGame(2, ['e', 'f'], ['g', 'h'])
    expect(s().games[1]).toMatchObject({ shuttleType: 'd', shuttles: 1 })

    // Can't switch the Dmantis game to XP2: none in stock.
    st.setGameShuttleType(s().games[1].id, 'x')
    expect(s().games[1].shuttleType).toBe('d')
    // Moving the XP2 game's two shuttles to Dmantis frees the XP2s.
    st.setGameShuttleType(g1.id, 'd')
    expect(s().games[0].shuttleType).toBe('d')
    expect(shuttlesInStock(s(), 'x')).toBe(2)
    expect(shuttlesInStock(s(), 'd')).toBe(9)
  })

  it('has no limit for a type without a starting count', () => {
    expect(shuttlesInStock(typed(newSession()), 'd')).toBe(Infinity)
  })
})

describe('skill matching off', () => {
  const flat = matchSkill(skillOf, false)

  it("doesn't move players up just to even out skill", () => {
    // Lopsided a(5) d(1) g(1) h(1) would bring b up with skill matching on.
    expect(planGames(['a', 'd', 'g', 'h', 'b'], skillOf).games[0].swap?.reason).toBe('lopsided')
    expect(planGames(['a', 'd', 'g', 'h', 'b'], flat).games[0].swap).toBeUndefined()
  })

  it('still moves players up to avoid a repeat partner', () => {
    const partners = new Map([
      ['e|f', 1],
      ['e|g', 1],
      ['e|h', 1],
    ])
    expect(planGames(['e', 'f', 'g', 'h', 'a'], flat, { partners }).games[0].swap).toMatchObject({ reason: 'repeat' })
  })

  it('splits teams by fresh partners, then mixed pairs, ignoring skill', () => {
    // a(5) b(4) c(2) d(1): skill pairs a+d and b+c (6 v 6), both same-gender here.
    const genders: Record<string, string> = { a: 'M', b: 'F', c: 'F', d: 'M' }
    const teams = (s: ReturnType<typeof splitTeams>) => [pairKey(s.teamA), pairKey(s.teamB)].sort()
    const genderOf = (id: string) => genders[id]
    expect(teams(splitTeams(['a', 'b', 'c', 'd'], skillOf, { genderOf }))).toEqual(['a|d', 'b|c'])
    const split = splitTeams(['a', 'b', 'c', 'd'], flat, { genderOf })
    expect(split.repeatedPairs).toEqual([])
    expect(teams(split)).not.toEqual(['a|d', 'b|c'])
  })

  it('is on by default and carries over to the next session', () => {
    expect(isSkillMatch(newSession())).toBe(true)
    const off = newSession({ ...newSession(), skillMatch: false })
    expect(isSkillMatch(off)).toBe(false)
    expect(isSkillMatch(newSession(off))).toBe(false)
  })
})

describe('moving a game to another court', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
  const setup = () => {
    const st = useStore.getState()
    // A fresh session: earlier tests leave shuttle stock behind.
    useStore.setState({ session: newSession() })
    st.setCourtCount(3)
    ids.forEach((id) => st.checkIn(id))
    st.startTimer(2)
    st.startGame(1, ['a', 'b'], ['c', 'd'])
    st.startGame(2, ['e', 'f'], ['g', 'h'])
    return st
  }
  const s = () => useStore.getState().session
  const gameOn = (court: number) => s().games.find((g) => g.id === s().courts[court - 1])

  it('swaps two games, keeping players, teams and shuttles', () => {
    const st = setup()
    const [g1, g2] = s().games
    st.addShuttle(g1.id, 1)
    const queue = s().queue
    st.moveGame(g1.id, 2)
    expect(gameOn(1)).toMatchObject({ id: g2.id, court: 1, teamA: ['e', 'f'], teamB: ['g', 'h'], shuttles: 1 })
    expect(gameOn(2)).toMatchObject({ id: g1.id, court: 2, teamA: ['a', 'b'], teamB: ['c', 'd'], shuttles: 2 })
    expect(s().queue).toEqual(queue)
    expect(s().games.map((g) => g.number)).toEqual([1, 2])
  })

  it('moves a game to a free court', () => {
    const st = setup()
    const g1 = s().games[0]
    st.moveGame(g1.id, 3)
    expect(s().courts).toEqual([null, s().games[1].id, g1.id])
    expect(gameOn(3)?.court).toBe(3)
  })

  it('ignores finished games, the same court and courts that do not exist', () => {
    const st = setup()
    const [g1, g2] = s().games
    const before = s()
    st.moveGame(g1.id, 1)
    st.moveGame(g1.id, 4)
    st.moveGame(g1.id, 0)
    st.moveGame('nope', 3)
    expect(s()).toBe(before)
    st.endGame(g2.id, 'A')
    st.moveGame(g2.id, 3)
    expect(s().games[1].court).toBe(2)
  })

  it('keeps stats and costs the same, and records the court the game was really on', () => {
    const st = setup()
    const [g1, g2] = s().games
    const cost = costSummary(s())
    st.moveGame(g1.id, 2)
    st.endGame(g1.id, 'A')
    st.endGame(g2.id, 'B')
    const after = useStore.getState().session
    expect(after.games.find((g) => g.id === g1.id)?.court).toBe(2)
    expect(after.courts).toEqual([null, null, null])
    expect(costSummary(after)).toEqual(cost)
    expect(playerRecords(after.games).get('a')).toEqual({ played: 1, wins: 1, losses: 0 })
    expect(playerRecords(after.games).get('e')).toEqual({ played: 1, wins: 0, losses: 1 })
    expect(after.attendees.find((a) => a.playerId === 'a')?.gamesPlayed).toBe(1)
  })

  it('opens a new shuttle on a court the moved game left empty', () => {
    // The shuttle goes with the players, so the court they left has none.
    const st = setup()
    st.moveGame(s().games[0].id, 3)
    st.startGame(1, ['i', 'j'], ['k', 'l'])
    expect(gameOn(1)?.shuttles).toBe(1)
  })

  it('keeps winners stay on the court the game moved to', () => {
    const st = setup()
    const g1 = s().games[0]
    st.moveGame(g1.id, 3)
    st.rotateWinners(g1.id, 'A', ['a', 'i'], ['b', 'j'])
    expect(gameOn(3)).toMatchObject({ court: 3, teamA: ['a', 'i'], teamB: ['b', 'j'], stayed: ['a', 'b'] })
    expect(gameOn(1)).toBeUndefined()
  })
})

describe('court fee from the booking', () => {
  it('works out the fee as courts × hours × rate, as each changes', () => {
    const st = useStore.getState()
    useStore.setState({ session: newSession() })
    st.setCourtBooking({ courts: 3, hours: 2, rate: 400 })
    expect(useStore.getState().session.courtFee).toBe(2400)
    st.setCourtBooking({ hours: 1.5 })
    expect(useStore.getState().session).toMatchObject({ courtFee: 1800, courtBooking: { courts: 3, hours: 1.5, rate: 400 } })
    st.setCourtBooking({ rate: 333.33 })
    expect(useStore.getState().session.courtFee).toBe(1499.99)
    expect(costSummary(useStore.getState().session).total).toBe(1499.99)
  })

  it('starts from the court count and 2 hours, or shows an old total as one court for an hour', () => {
    const s = { ...newSession(), courtCount: 3 }
    expect(courtBooking(s)).toEqual({ courts: 3, hours: 2, rate: 0 })
    expect(courtBooking({ ...s, courtFee: 1860 })).toEqual({ courts: 1, hours: 1, rate: 1860 })
  })

  it('keeps the booking for the next session', () => {
    const prev = { ...newSession(), courtFee: 2400, courtBooking: { courts: 3, hours: 2, rate: 400 } }
    expect(newSession(prev)).toMatchObject({ courtFee: 2400, courtBooking: { courts: 3, hours: 2, rate: 400 } })
  })
})

describe('stats dashboard', () => {
  let t = 0
  const g = (teamA: string, teamB: string, winner?: 'A' | 'B') =>
    ({
      id: `g${++t}`,
      court: 1,
      teamA: teamA.split(''),
      teamB: teamB.split(''),
      startedAt: t * 1000,
      endedAt: t * 1000 + 600,
      shuttles: 0,
      winner,
    }) as Session['games'][number]
  // ab: 3-0 together; cd: 0-2; ef: 1-1 and a game with no result.
  const games = [g('ab', 'cd', 'A'), g('ab', 'ef', 'A'), g('ab', 'cd', 'A'), g('ef', 'gh', 'A'), g('ac', 'bd', 'B'), g('ef', 'gh')]

  it('records each duo on the same team', () => {
    const ab = duoRecords(games).find((d) => d.pair.join() === 'a,b')
    expect(ab).toMatchObject({ played: 3, wins: 3, losses: 0 })
    expect(duoRecords(games).find((d) => d.pair.join() === 'c,d')).toMatchObject({ played: 2, wins: 0, losses: 2 })
    // A game without a result counts as played only.
    expect(duoRecords(games).find((d) => d.pair.join() === 'e,f')).toMatchObject({ played: 3, wins: 1, losses: 1 })
  })

  it('names the unbeatable and worst duos, needing 2 decided games when anyone has them', () => {
    const duos = duoRecords(games)
    expect(bestRecord(duos)?.pair).toEqual(['a', 'b'])
    expect(worstRecord(duos)?.pair).toEqual(['c', 'd'])
    // One game each (a single session rarely repeats a pair): 1 game qualifies.
    const once = duoRecords([g('ab', 'cd', 'A')])
    expect(bestRecord(once)?.pair).toEqual(['a', 'b'])
    expect(worstRecord(once)?.pair).toEqual(['c', 'd'])
    // No results yet: no awards.
    expect(bestRecord(duoRecords([g('ab', 'cd')]))).toBeUndefined()
    expect(worstRecord(duoRecords([g('ab', 'cd')]))).toBeUndefined()
  })

  it('tracks win and losing streaks in play order, skipping games with no result', () => {
    const runs = streaks([...games].reverse()) // order comes from start time
    expect(runs.get('a')).toEqual({ wins: 3, losses: 1, current: -1 })
    expect(runs.get('b')).toEqual({ wins: 4, losses: 0, current: 4 })
    expect(runs.get('c')).toEqual({ wins: 0, losses: 3, current: -3 })
    expect(runs.get('e')).toEqual({ wins: 1, losses: 1, current: 1 })
  })

  it('finds the biggest rivalry, with head-to-head wins', () => {
    // a v d and b v c both met 3 times; a v d (2-1) is closer than b v c (3-0).
    const [top, next] = rivalries(games)
    expect(top).toEqual({ pair: ['a', 'd'], met: 3, wins: [2, 1] })
    expect(next).toEqual({ pair: ['b', 'c'], met: 3, wins: [3, 0] })
  })

  it('takes finished games from the chosen sessions in play order', () => {
    const s1 = { ...newSession(), games: [games[2], games[0]] }
    const s2 = { ...newSession(), games: [games[1], { ...games[3], endedAt: undefined }] }
    expect(playedGames([s1, s2]).map((x) => x.id)).toEqual([games[0].id, games[1].id, games[2].id])
  })

  it('finds the longest and shortest games, ignoring ones ended within a minute', () => {
    const timed = (id: string, ms: number, endedAt = true) =>
      ({ ...g('ab', 'cd', 'A'), id, startedAt: 0, endedAt: endedAt ? ms : undefined }) as Session['games'][number]
    const list = [timed('mid', 15 * 60_000), timed('long', 32 * 60_000 + 5000), timed('short', 4 * 60_000), timed('oops', 20_000), timed('on', 60 * 60_000, false)]
    const { longest, shortest } = gameExtremes(list)
    expect(longest?.id).toBe('long')
    expect(shortest?.id).toBe('short')
    expect(gameTime(longest!)).toBe('32:05')
    expect(gameExtremes([timed('oops', 20_000)])).toMatchObject({ longest: { id: 'oops' }, shortest: undefined })
  })

  it('ranks standings by wins, then win rate, then fewest games', () => {
    const rows = standings(games)
    expect(rows.slice(0, 2).map((r) => [r.id, r.wins, r.losses])).toEqual([
      ['b', 4, 0],
      ['a', 3, 1],
    ])
    expect(rows.find((r) => r.id === 'e')).toMatchObject({ played: 3, wins: 1, losses: 1, rate: 0.5 })
    // No wins and a 0% rate either way: fewer games ranks higher (g: 0-1 in 2 games, c: 0-3 in 3).
    const order = rows.map((r) => r.id)
    expect(order.indexOf('g')).toBeLessThan(order.indexOf('c'))
  })

  it('gives tied players the same place, then the next place', () => {
    const r = (wins: number, losses: number, played = wins + losses) => ({ wins, losses, played })
    // Two tied 1st, then 2nd, three tied 3rd (one with a no-result game), then 4th.
    expect(places([r(3, 0), r(3, 0), r(2, 1), r(1, 2), r(1, 2), r(1, 2, 4), r(0, 3)])).toEqual([1, 1, 2, 3, 3, 3, 4])
    // Same win rate but different wins is not a tie.
    expect(places([r(2, 2), r(1, 1)])).toEqual([1, 2])
    expect(places([])).toEqual([])
    expect(places(standings(games))[0]).toBe(1)
  })

  it('writes places as 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th',
    ])
  })

  it("records one player's partners and opponents", () => {
    // a: with b 3-0, with c 0-1; faced d 3 times (2-1), c twice (2-0).
    const partners = mateRecords(games, 'a', 'partner')
    expect(partners).toEqual([
      { id: 'b', played: 3, wins: 3, losses: 0 },
      { id: 'c', played: 1, wins: 0, losses: 1 },
    ])
    const opponents = mateRecords(games, 'a', 'opponent')
    expect(opponents[0]).toEqual({ id: 'd', played: 3, wins: 2, losses: 1 })
    expect(opponents.find((r) => r.id === 'c')).toEqual({ id: 'c', played: 2, wins: 2, losses: 0 })
    // A game with no result counts as played only.
    expect(mateRecords(games, 'e', 'partner')).toEqual([{ id: 'f', played: 3, wins: 1, losses: 1 }])
    expect(mateRecords(games, 'z', 'partner')).toEqual([])
  })

  it("lists a player's recent results in play order, skipping games with no result", () => {
    expect(form([...games].reverse(), 'a')).toEqual(['W', 'W', 'W', 'L'])
    expect(form(games, 'e')).toEqual(['L', 'W'])
    expect(form(games, 'a', 2)).toEqual(['W', 'L'])
  })

  it('keeps sessions from the last 3 months', () => {
    const on = (date: string) => ({ ...newSession(), id: date, date })
    const all = ['2026-10-26', '2026-07-26', '2026-07-25', '2025-12-01'].map(on)
    const ids = (today: Date) => sessionsWithin(all, 3, today).map((s) => s.id)
    expect(ids(new Date(2026, 9, 26))).toEqual(['2026-10-26', '2026-07-26'])
    // 31 May goes back to the end of February, not into March.
    const may = ['2026-05-31', '2026-02-28', '2026-02-27', '2026-03-01'].map(on)
    expect(sessionsWithin(may, 3, new Date(2026, 4, 31)).map((s) => s.id)).toEqual(['2026-05-31', '2026-02-28', '2026-03-01'])
    // Across the new year: 15 Feb goes back to 15 Nov.
    const nov = ['2025-11-15', '2025-11-14'].map(on)
    expect(sessionsWithin(nov, 3, new Date(2026, 1, 15)).map((s) => s.id)).toEqual(['2025-11-15'])
  })
})

describe('helping players without a win', () => {
  let t = 0
  const game = (teamA: string, teamB: string, winner?: 'A' | 'B') =>
    ({
      id: `h${++t}`,
      court: 1,
      teamA: teamA.split(''),
      teamB: teamB.split(''),
      startedAt: t * 1000,
      endedAt: t * 1000 + 500,
      shuttles: 0,
      winner,
    }) as Session['games'][number]
  const help = (struggling: string[], streak: Record<string, number>): Help => ({
    struggling: new Set(struggling),
    streak: new Map(Object.entries(streak)),
  })

  it('finds players who lost their last 5 decided games, and current win streaks', () => {
    // s loses 5 in a row (a game with no result in between is skipped); w wins the last 3.
    const games = [
      game('sx', 'wy', 'A'),
      game('sx', 'wy', 'B'),
      game('sx', 'wy', 'B'),
      game('sx', 'wy'),
      game('sx', 'wy', 'B'),
      game('sx', 'wy', 'B'),
      game('sz', 'wy', 'B'),
    ]
    const h = helpFrom(games)
    expect([...h.struggling]).toEqual(['s'])
    expect(h.streak.get('w')).toBe(5)
    expect(h.streak.has('s')).toBe(false)
    // 4 losses in a row is not enough.
    expect(helpFrom(games.slice(0, 6)).struggling.has('s')).toBe(false)
    // A win ends it.
    expect(helpFrom([...games, game('sw', 'xy', 'A')]).struggling.has('s')).toBe(false)
  })

  it('partners a struggling player with the player on the best win streak, over even skill', () => {
    // a(5) b(4) c(2) d(1): skill alone pairs a+d, b+c. d is struggling, b is on 3 wins, a on 1.
    const split = splitTeams(['a', 'b', 'c', 'd'], skillOf, { help: help(['d'], { a: 1, b: 3 }) })
    expect([pairKey(split.teamA), pairKey(split.teamB)].sort()).toEqual(['a|c', 'b|d'])
    expect(split.helped).toEqual({ player: 'd', partner: 'b', streak: 3 })
    // No one on a streak, or nobody struggling: skill decides as before.
    for (const h of [help(['d'], {}), help([], { b: 3 })]) {
      const s = splitTeams(['a', 'b', 'c', 'd'], skillOf, { help: h })
      expect([pairKey(s.teamA), pairKey(s.teamB)].sort()).toEqual(['a|d', 'b|c'])
      expect(s.helped).toBeUndefined()
    }
  })

  it('never repeats a partner to help', () => {
    const split = splitTeams(['a', 'b', 'c', 'd'], skillOf, {
      help: help(['d'], { b: 3 }),
      partners: new Map([['b|d', 1]]),
    })
    expect(split.repeats).toBe(0)
    expect(split.helped).toBeUndefined()
  })

  it('leaves the queue order and swaps alone, only choosing partners', () => {
    // Lopsided: b moves up for d with or without help; g, still in the four, is helped.
    const queue = ['a', 'd', 'g', 'h', 'b']
    const h = help(['g'], { b: 2 })
    const without = planGames(queue, skillOf)
    const withHelp = planGames(queue, skillOf, { help: h })
    expect(withHelp.games[0].swap).toEqual(without.games[0].swap)
    expect(withHelp.order.slice(4)).toEqual(without.order.slice(4))
    expect(withHelp.games[0].swap).toMatchObject({ in: 'b', out: 'd' })
    expect(withHelp.games[0].help).toEqual({ player: 'g', partner: 'b', streak: 2 })
    expect(without.games[0].help).toBeUndefined()
  })

  it('is on by default and carries over when turned off', () => {
    expect(isHelpStruggling(newSession())).toBe(true)
    const off = { ...newSession(), helpStruggling: false }
    expect(isHelpStruggling(newSession(off))).toBe(false)
  })
})

describe('data saved by the app already in use', () => {
  // A session as the deployed version saves it: no court booking, no help setting.
  const saved = JSON.parse(
    JSON.stringify({
      id: 'old',
      date: '2026-10-21',
      courtCount: 3,
      courtFee: 1860,
      shuttlePrice: 0,
      extraShuttles: 0,
      shuttleTypes: [{ id: 'x', name: 'XP2', price: 90, extra: 0, start: 12, left: 4 }],
      shuttleTypeId: 'x',
      skillMatch: false,
      attendees: ['a', 'b', 'c', 'd'].map((playerId, i) => ({ playerId, checkedInAt: i, gamesPlayed: 1, paid: true, resting: false })),
      queue: [],
      courts: [null, null, null],
      games: [{ id: 'g', number: 1, court: 2, teamA: ['a', 'b'], teamB: ['c', 'd'], startedAt: 0, endedAt: 900_000, shuttles: 1, shuttleType: 'x', winner: 'A' }],
      status: 'closed',
    }),
  ) as Session

  it('still works everywhere: costs, counts, stats, settings and the next session', () => {
    expect(costSummary(saved)).toMatchObject({ total: 1860 + 90, heads: 4 })
    expect(courtBooking(saved)).toEqual({ courts: 1, hours: 1, rate: 1860 })
    expect(shuttleCount(saved)).toMatchObject({ start: 12, left: 4, used: 8 })
    expect(isHelpStruggling(saved)).toBe(true)
    expect(isSkillMatch(saved)).toBe(false)
    expect(standings(playedGames([saved])).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(helpFrom(playedGames([saved])).streak.get('a')).toBe(1)
    const next = newSession(saved)
    expect(next).toMatchObject({ courtFee: 1860, skillMatch: false })
    expect(next.courtBooking).toBeUndefined()
    expect(next.shuttleTypes?.[0]).toMatchObject({ name: 'XP2', start: 4, left: undefined })
  })
})

describe('out of hours', () => {
  it('ends a game with no winner, marked out of hours, players back in the queue', () => {
    const st = useStore.getState()
    useStore.setState({ session: newSession() })
    ;['a', 'b', 'c', 'd', 'e'].forEach((id) => st.checkIn(id))
    st.startTimer(2)
    st.startGame(1, ['a', 'b'], ['c', 'd'])
    const id = useStore.getState().session.games[0].id
    st.endGame(id, undefined, true)
    const s = useStore.getState().session
    expect(s.games[0]).toMatchObject({ outOfHours: true, winner: undefined })
    expect(s.games[0].endedAt).toBeDefined()
    expect(s.courts[0]).toBeNull()
    expect(s.queue).toEqual(['e', 'a', 'b', 'c', 'd'])
    expect(s.attendees.find((a) => a.playerId === 'a')?.gamesPlayed).toBe(1)
    // Played, but not a win or a loss; streaks skip it.
    expect(playerRecords(s.games).get('a')).toEqual({ played: 1, wins: 0, losses: 0 })
    expect(streaks(s.games).size).toBe(0)
  })

  it('is dropped when a winner is set later, and kept when the winner is only cleared', () => {
    const st = useStore.getState()
    const id = useStore.getState().session.games[0].id
    st.setWinner(id, 'A')
    expect(useStore.getState().session.games[0]).toMatchObject({ winner: 'A', outOfHours: undefined })
    useStore.setState((x) => ({ session: { ...x.session, games: [{ ...x.session.games[0], winner: undefined, outOfHours: true }] } }))
    st.setWinner(id, undefined)
    expect(useStore.getState().session.games[0].outOfHours).toBe(true)
  })

  it('never ends a game that has a winner as out of hours', () => {
    const st = useStore.getState()
    useStore.setState({ session: newSession() })
    ;['a', 'b', 'c', 'd'].forEach((id) => st.checkIn(id))
    st.startTimer(2)
    st.startGame(1, ['a', 'b'], ['c', 'd'])
    st.endGame(useStore.getState().session.games[0].id, 'B', true)
    expect(useStore.getState().session.games[0].outOfHours).toBeUndefined()
  })

  it("doesn't count as the shortest game, since it was cut short", () => {
    const g = (id: string, mins: number, outOfHours?: boolean) =>
      ({ id, court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], startedAt: 0, endedAt: mins * 60_000, shuttles: 0, outOfHours }) as Session['games'][number]
    expect(gameExtremes([g('cut', 3, true), g('full', 12), g('long', 25)])).toMatchObject({
      shortest: { id: 'full' },
      longest: { id: 'long' },
    })
  })

  it('can mark a finished game with no result as out of hours later, in history too, and undo it', () => {
    const st = useStore.getState()
    useStore.setState({ session: newSession(), history: [] })
    ;['a', 'b', 'c', 'd'].forEach((id) => st.checkIn(id))
    st.startTimer(2)
    st.startGame(1, ['a', 'b'], ['c', 'd'])
    const id = useStore.getState().session.games[0].id
    st.setOutOfHours(id, true) // still on court: ignored
    expect(useStore.getState().session.games[0].outOfHours).toBeUndefined()
    st.endGame(id)
    st.closeSession()
    st.setOutOfHours(id, true)
    expect(useStore.getState().history[0].games[0].outOfHours).toBe(true)
    st.setOutOfHours(id, false)
    expect(useStore.getState().history[0].games[0].outOfHours).toBeUndefined()
    // A game with a winner can't be out of hours.
    st.setWinner(id, 'A')
    st.setOutOfHours(id, true)
    expect(useStore.getState().history[0].games[0].outOfHours).toBeUndefined()
  })
})

describe('scores', () => {
  const play = () => {
    const st = useStore.getState()
    useStore.setState({ session: newSession(), history: [] })
    ;['a', 'b', 'c', 'd'].forEach((id) => st.checkIn(id))
    st.startGame(1, ['a', 'b'], ['c', 'd'])
    return useStore.getState().session.games[0].id
  }
  const game = () => useStore.getState().session.games[0]

  it('names the team ahead on points', () => {
    expect(scoreLeader([21, 15])).toBe('A')
    expect(scoreLeader([19, 21])).toBe('B')
    expect(scoreLeader([20, 20])).toBeUndefined()
    expect(scoreLeader(undefined)).toBeUndefined()
  })

  it('are optional when a game ends', () => {
    const st = useStore.getState()
    st.endGame(play(), 'A', false, [21, 17])
    expect(game()).toMatchObject({ winner: 'A', score: [21, 17] })
    st.endGame(play(), 'B')
    expect(game().winner).toBe('B')
    expect('score' in game()).toBe(false)
    // Out of hours keeps the score where it stopped, with no winner.
    st.endGame(play(), undefined, true, [15, 12])
    expect(game()).toMatchObject({ winner: undefined, outOfHours: true, score: [15, 12] })
  })

  it('set the winner when added later, in history too', () => {
    const st = useStore.getState()
    const id = play()
    st.setScore(id, [21, 10]) // still on court: ignored
    expect(game().score).toBeUndefined()
    st.endGame(id)
    st.closeSession()
    const past = () => useStore.getState().history[0].games[0]
    st.setScore(id, [18, 21])
    expect(past()).toMatchObject({ score: [18, 21], winner: 'B' })
    st.setScore(id, [22, 20])
    expect(past()).toMatchObject({ score: [22, 20], winner: 'A' })
    // A tie leaves no winner; clearing the score keeps the winner.
    st.setScore(id, [20, 20])
    expect(past().winner).toBeUndefined()
    st.setScore(id, [21, 19])
    st.setScore(id, undefined)
    expect(past()).toMatchObject({ score: undefined, winner: 'A' })
  })

  it('stay where they stood in a game out of hours', () => {
    const st = useStore.getState()
    const id = play()
    st.endGame(id, undefined, true)
    st.setScore(id, [14, 9])
    expect(game()).toMatchObject({ score: [14, 9], winner: undefined, outOfHours: true })
  })

  it('are cleared when the winner is changed to the other team, and kept otherwise', () => {
    const st = useStore.getState()
    const id = play()
    st.endGame(id, 'A', false, [21, 15])
    st.setWinner(id, undefined)
    expect(game()).toMatchObject({ winner: undefined, score: [21, 15] })
    st.setWinner(id, 'A')
    expect(game().score).toEqual([21, 15])
    st.setWinner(id, 'B')
    expect(game()).toMatchObject({ winner: 'B', score: undefined })
  })

  it('carry over when winners stay on', () => {
    const st = useStore.getState()
    const id = play()
    ;['e', 'f'].forEach((x) => st.checkIn(x))
    st.rotateWinners(id, 'A', ['a', 'e'], ['b', 'f'], [21, 8])
    expect(useStore.getState().session.games.find((g) => g.id === id)).toMatchObject({ winner: 'A', score: [21, 8] })
  })
})

describe('arrivals', () => {
  const session = (checkIns: Record<string, number>) => ({
    ...newSession(),
    attendees: Object.entries(checkIns).map(([playerId, checkedInAt]) => ({
      playerId,
      checkedInAt,
      gamesPlayed: 0,
      paid: false,
      resting: false,
    })),
  })

  it('finds who checked in first and last in each session, skipping sessions with fewer than two', () => {
    const list = arrivals([session({ b: 300, a: 100, c: 200 }), session({ a: 50 }), session({ c: 10, b: 20 })])
    expect(list).toEqual([
      { first: 'a', last: 'b', firstAt: 100, lastAt: 300 },
      { first: 'c', last: 'b', firstAt: 10, lastAt: 20 },
    ])
  })

  it('counts who was first or last most often, with ties', () => {
    expect(mostOften(['a', 'c', 'a'])).toEqual({ ids: ['a'], times: 2 })
    expect(mostOften(['a', 'c'])).toEqual({ ids: ['a', 'c'], times: 1 })
    expect(mostOften([])).toEqual({ ids: [], times: 0 })
  })

  it('ranks one session by check-in time, minutes after the first', () => {
    const rows = checkinStandings([session({ b: 3 * 60_000, a: 0, c: 20_000, d: 10 * 60_000 })])
    expect(rows.map((r) => [r.id, Math.round(r.after), r.at])).toEqual([
      ['a', 0, 0],
      ['c', 0, 20_000],
      ['b', 3, 3 * 60_000],
      ['d', 10, 10 * 60_000],
    ])
    // a and c checked in within the same minute: both 1st.
    expect(checkinPlaces(rows)).toEqual([1, 1, 2, 3])
  })

  it('ranks several sessions by average minutes after the first, then most firsts', () => {
    const min = 60_000
    const rows = checkinStandings([
      session({ a: 0, b: 10 * min, c: 4 * min }),
      session({ b: 0, a: 2 * min, c: 6 * min }),
      session({ c: 0 }), // only one player: skipped
    ])
    expect(rows.map((r) => [r.id, r.sessions, r.firsts, r.after])).toEqual([
      ['a', 2, 1, 1],
      ['b', 2, 1, 5],
      ['c', 2, 0, 5],
    ])
    expect(rows[0].at).toBeUndefined()
    expect(checkinPlaces(rows)).toEqual([1, 2, 2])
  })
})

describe('phone check-in', () => {
  const player = (id: string, name: string) => ({ id, name, skill: 3 as const, active: true, createdAt: 0 })
  const start = () => {
    useStore.setState({ players: [player('a', 'Ana'), player('b', 'Ben'), player('c', 'Cy')], session: newSession() })
    useStore.getState().openRemote('4821')
  }
  const st = () => useStore.getState()

  it('opens under a six-character code with its own key', () => {
    start()
    expect(st().session.remote).toMatchObject({ code: expect.stringMatching(/^[A-HJ-NP-Z2-9]{6}$/), pin: '4821', handled: [] })
    expect(st().session.remote!.key.length).toBeGreaterThan(20)
    st().setRemotePin('0007')
    expect(st().session.remote!.pin).toBe('0007')
  })

  it('checks players in at the time they arrived, in arrival order, once', () => {
    start()
    st().checkIn('c', 50)
    st().applyRemote([
      { id: 'b', at: 100 },
      { id: 'a', at: 200 },
      { id: 'c', at: 300 },
      { id: 'gone', at: 400 },
    ])
    expect(st().session.attendees.map((a) => [a.playerId, a.checkedInAt])).toEqual([
      ['c', 50],
      ['b', 100],
      ['a', 200],
    ])
    expect(st().session.queue).toEqual(['c', 'b', 'a'])
    // Checked out by the host: the next poll doesn't bring them back.
    st().checkOut('a')
    st().applyRemote([{ id: 'b', at: 100 }, { id: 'a', at: 200 }])
    expect(st().session.attendees.map((a) => a.playerId)).toEqual(['c', 'b'])
  })

  it('leaves new names for the host: add, match or dismiss', () => {
    start()
    const cara = { id: 'new-1', name: 'Cara', at: 500 }
    st().applyRemote([cara])
    expect(st().session.attendees).toHaveLength(0)
    st().admitNewcomer(cara)
    const added = st().players.find((p) => p.name === 'Cara')!
    expect(added).toMatchObject({ skill: 3, active: true })
    expect(st().session.attendees).toEqual([expect.objectContaining({ playerId: added.id, checkedInAt: 500 })])
    // Only once.
    st().admitNewcomer(cara)
    expect(st().players).toHaveLength(4)

    st().admitNewcomer({ id: 'new-2', name: 'Benny', at: 600 }, 'b')
    expect(st().session.attendees.map((a) => a.playerId)).toEqual([added.id, 'b'])
    st().dismissRemote('new-3')
    expect(st().session.remote!.handled).toEqual(['new-1', added.id, 'new-2', 'b', 'new-3'])
  })

  it('does nothing once turned off, and ends with the session', () => {
    start()
    st().closeRemote()
    st().applyRemote([{ id: 'a', at: 1 }])
    expect(st().session.attendees).toHaveLength(0)
    st().openRemote('1234')
    st().closeSession()
    expect(st().session.remote).toBeUndefined()
    expect(st().history[0].remote).toBeUndefined()
  })
})

describe('changing a check-in time', () => {
  const player = (id: string) => ({ id, name: id, skill: 3 as const, active: true, createdAt: 0 })
  const st = () => useStore.getState()

  it('places a player who has not played by arrival time', () => {
    const newcomers = new Map([['a', 10], ['b', 20], ['c', 30], ['d', 40]])
    // x has played: only newcomers count, and x keeps its place.
    expect(placeByArrival(['x', 'a', 'b', 'c', 'd'], 'a', new Map([...newcomers, ['a', 35]]))).toEqual(['x', 'b', 'c', 'a', 'd'])
    expect(placeByArrival(['a', 'b', 'c', 'd'], 'd', new Map([...newcomers, ['d', 5]]))).toEqual(['d', 'a', 'b', 'c'])
    expect(placeByArrival(['a', 'b', 'x'], 'a', new Map([...newcomers, ['a', 99]]))).toEqual(['b', 'x', 'a'])
    // Not waiting (on court or resting): the queue stays as it is.
    expect(placeByArrival(['b', 'c'], 'a', newcomers)).toEqual(['b', 'c'])
  })

  it('moves a phone check-in back when they arrive later', () => {
    useStore.setState({ players: ['a', 'b', 'c', 'd'].map(player), session: newSession() })
    st().checkIn('a', 100)
    st().checkIn('b', 200)
    st().checkIn('c', 300)
    st().setCheckinTime('a', 250)
    expect(st().session.attendees.find((a) => a.playerId === 'a')!.checkedInAt).toBe(250)
    expect(st().session.queue).toEqual(['b', 'a', 'c'])
  })

  it("only changes the time for someone who has played", () => {
    useStore.setState({ players: ['a', 'b', 'c', 'd', 'e'].map(player), session: newSession() })
    for (const [i, id] of ['a', 'b', 'c', 'd', 'e'].entries()) st().checkIn(id, i * 100)
    st().startTimer(2)
    st().startGame(1, ['a', 'b'], ['c', 'd'])
    st().endGame(st().session.games[0].id, 'A')
    const queue = st().session.queue
    st().setCheckinTime('a', 999)
    expect(st().session.queue).toEqual(queue)
    expect(st().session.attendees.find((a) => a.playerId === 'a')!.checkedInAt).toBe(999)
  })
})

describe('club cloud documents', async () => {
  const { changes, fromDocs, hashOf, toDocs } = await import('./cloud')
  const s1 = { ...newSession(), id: 's1', date: '2026-10-19' }
  const s2 = { ...newSession(), id: 's2', date: '2026-10-26' }
  const data = {
    players: [{ id: 'a', name: 'Ana', skill: 3 as const, active: true, createdAt: 0 }],
    session: newSession(),
    history: [s2, s1],
  }

  it('splits the data into documents and back, newest past session first', () => {
    const docs = toDocs(data)
    expect(Object.keys(docs).sort()).toEqual(['h#s1', 'h#s2', 'players', 'session'])
    const back = fromDocs({ ...docs })
    expect(back.players).toEqual(data.players)
    expect(back.session).toEqual(data.session)
    expect(back.history.map((s) => s.id)).toEqual(['s2', 's1'])
  })

  it('sends only what changed, and removes what is gone', () => {
    const docs = toDocs(data)
    const saved = Object.fromEntries(Object.entries(docs).map(([id, json]) => [id, hashOf(json)]))
    expect(changes(docs, saved)).toEqual([])
    const next = toDocs({ ...data, players: [], history: [s2] })
    expect(changes(next, saved)).toEqual([{ put: { players: '[]' }, remove: ['h#s1'] }])
  })

  it('splits a big first save into parts', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...s1, id: `s${i}` }))
    const batches = changes(toDocs({ ...data, history: many }), {})
    expect(batches.length).toBe(3)
    expect(batches.every((b) => Object.keys(b.put).length <= 80)).toBe(true)
    expect(batches.reduce((n, b) => n + Object.keys(b.put).length, 0)).toBe(202)
  })
})

describe('session dates', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime()

  it('dates a session the day play starts, not the day it was set up', () => {
    vi.useFakeTimers()
    // Monday: a session is closed, so the next one is set up straight away.
    vi.setSystemTime(at(26, 22))
    useStore.setState({ session: newSession(), history: [] })
    const st = useStore.getState()
    expect(useStore.getState().session.date).toBe('2026-10-26')
    // Settings changed during the week don't count as playing.
    st.setCourtCount(3)
    expect(useStore.getState().session.date).toBe('2026-10-26')
    // Friday: opening phone check-in dates it, so players' phones show the right day.
    vi.setSystemTime(at(30, 15, 45))
    st.openRemote('1234')
    expect(useStore.getState().session.date).toBe('2026-10-30')
    // Without phone check-in, the first check-in dates it.
    vi.setSystemTime(at(26, 22))
    useStore.setState({ session: newSession() })
    vi.setSystemTime(at(30, 16, 1))
    st.checkIn('a')
    expect(useStore.getState().session.date).toBe('2026-10-30')
    // Later check-ins don't move it, even past midnight.
    vi.setSystemTime(at(31, 0, 30))
    st.checkIn('b')
    expect(useStore.getState().session.date).toBe('2026-10-30')
  })

  it('dates a closed session by its first game', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at(30, 21))
    const game = (startedAt: number) =>
      ({ id: `g${startedAt}`, court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], startedAt, endedAt: startedAt + 600_000, shuttles: 0 }) as Session['games'][number]
    useStore.setState({
      // Set up Monday and played Friday, from before this was fixed.
      session: { ...newSession(), date: '2026-10-26', attendees: [{ playerId: 'a', checkedInAt: at(30, 15, 50), gamesPlayed: 1, paid: false, resting: false }], games: [game(at(30, 16, 6)), game(at(30, 20, 30))] },
      history: [],
    })
    useStore.getState().closeSession()
    expect(useStore.getState().history[0].date).toBe('2026-10-30')
  })

  it('repairs past sessions: by the first game, else the first check-in, else left alone', () => {
    const base = { ...newSession(), date: '2026-10-26' }
    const played = { ...base, games: [{ id: 'g', court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], startedAt: at(30, 16, 6), endedAt: at(30, 16, 17), shuttles: 0 }] } as Session
    const checkedIn = { ...base, attendees: [{ playerId: 'a', checkedInAt: at(29, 18), gamesPlayed: 0, paid: false, resting: false }] }
    expect(playedOn(played)).toBe('2026-10-30')
    expect(redate(played).date).toBe('2026-10-30')
    expect(redate(checkedIn).date).toBe('2026-10-29')
    expect(redate(base)).toBe(base)
    // Already right: the same object back, so nothing is saved again.
    const right = { ...played, date: '2026-10-30' }
    expect(redate(right)).toBe(right)
  })

  it('repairs saved data once, when the app updates', () => {
    const stale = { ...newSession(), date: '2026-10-26', games: [{ id: 'g', court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], startedAt: at(30, 16, 6), endedAt: at(30, 16, 17), shuttles: 0 }] } as Session
    const fixed = migrateStore({ players: [], session: newSession(), history: [stale] }, 2)
    expect(fixed.history[0].date).toBe('2026-10-30')
    // Data downloaded from the club is repaired too.
    useStore.getState().importData({ players: [], history: [stale] })
    expect(useStore.getState().history[0].date).toBe('2026-10-30')
  })
})
