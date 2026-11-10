import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { bumpedPlayers, fairShare, meetCounts, metPairs, pairKey, partnerCounts, playStreaks, splitTeams, suggestSwap } from './balance'
import { byName, costSummary, courtBooking, money, sessionStarted, shuttleCount, shuttleLines, shuttlesInStock } from './cost'
import type { Help } from './balance'
import { parseNames } from './importNames'
import { clash, dueGame, timeRange, upcoming, weekly } from './schedule'
import { checkSchedule } from './useScheduleClock'
import { findPlayer, publicPath } from './publicStats'
import { matchSkill, planGames, winnersStayGame } from './plan'
import { arrivals, bestRecord, blowoutGames, deuceGames, scoreLeader, checkinPlaces, checkinStandings, duoRecords, form, mateRecords, mostOften, gameExtremes, gameTime, helpFrom, ordinal, places, playedGames, sessionsWithin, standings, playerRecords, rivalries, streaks, winRate, winsPlaces, winsStandings, worstRecord } from './stats'
import { dequeue, enqueue, move, nextFour, placeByArrival, pushFront, swap } from './queue'
import { gapCounts, niceTicks, overall, playerDays, sessionTrend, sessionTrends } from './trends'
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

describe('payment styles', () => {
  const attendee = (playerId: string, paid = false) => ({ playerId, checkedInAt: 0, gamesPlayed: 0, paid, resting: false })
  const game = (id: string, teamA: string[], teamB: string[], endedAt?: number) =>
    ({ id, court: 1, teamA, teamB, startedAt: 0, endedAt, shuttles: 1 }) as Session['games'][number]
  const base = (): Session => ({
    ...newSession(),
    courtFee: 400,
    shuttleTypes: [{ id: 't', name: 'Shuttle', price: 80, extra: 0 }],
    shuttleTypeId: 't',
    attendees: ['a', 'b', 'c', 'd', 'e'].map((id) => attendee(id)),
    // a plays 2 games (one still on court), e none.
    games: [game('g1', ['a', 'b'], ['c', 'd'], 1), game('g2', ['a', 'b'], ['c', 'd'])],
  })

  it('splits equally when no style is picked', () => {
    const c = costSummary(base())
    expect(c.pricing.style).toBe('split')
    expect(c.total).toBe(560)
    expect(c.dues.map((d) => d.amount)).toEqual([112, 112, 112, 112, 112])
    expect(c.margin).toBe(0)
  })

  it('charges a court fee plus each game played, the one on court included', () => {
    const c = costSummary({ ...base(), pricing: { style: 'perGame', entry: 125, perGame: 35, flat: 200 } })
    expect(c.dues.map((d) => [d.playerId, d.games, d.amount])).toEqual([
      ['a', 2, 195],
      ['b', 2, 195],
      ['c', 2, 195],
      ['d', 2, 195],
      ['e', 0, 125],
    ])
    expect(c.expected).toBe(905)
    expect(c.perHead).toBe(181) // the average
    expect(c.margin).toBe(905 - 560)
  })

  it('charges one fee for unlimited games', () => {
    const c = costSummary({ ...base(), pricing: { style: 'flat', entry: 0, perGame: 0, flat: 100 } })
    expect(c.dues.every((d) => d.amount === 100)).toBe(true)
    expect(c.perHead).toBe(100)
    expect(c.margin).toBe(-60) // short of the court and shuttles
  })

  it('keeps a per game player owing for games after they paid, until they settle up', () => {
    useStore.setState({ session: { ...base(), pricing: { style: 'perGame', entry: 125, perGame: 35, flat: 0 } } })
    const st = useStore.getState()
    const due = () => costSummary(useStore.getState().session).dues.find((d) => d.playerId === 'e')!
    st.togglePaid('e')
    expect(due()).toMatchObject({ amount: 125, paid: 125, owing: 0 })
    useStore.setState((x) => ({ session: { ...x.session, games: [...x.session.games, game('g3', ['e', 'a'], ['b', 'c'])] } }))
    expect(due()).toMatchObject({ amount: 160, paid: 125, owing: 35 })
    expect(costSummary(useStore.getState().session).paidCount).toBe(0)
    st.togglePaid('e') // settles up
    expect(due()).toMatchObject({ paid: 160, owing: 0 })
    st.togglePaid('e') // not paid after all
    expect(due()).toMatchObject({ paid: 0, owing: 160 })
    expect(useStore.getState().session.attendees.find((a) => a.playerId === 'e')!.paidAmount).toBeUndefined()
  })

  it('keeps the court booking in step with the courts used', () => {
    const booked = { ...base(), games: [], courtCount: 2, courts: [null, null], courtBooking: { courts: 2, hours: 2, rate: 300 }, courtFee: 1200 }
    useStore.setState({ session: booked })
    const st = useStore.getState()
    const fee = () => useStore.getState().session.courtFee
    // Before play: either way (this week only 2 booked, or 3).
    st.setCourtCount(3)
    expect(fee()).toBe(1800)
    st.setCourtCount(2)
    expect(fee()).toBe(1200)
    // Once games start, opening a third court adds it; letting one go early does not take it off.
    st.setCourtCount(3)
    useStore.setState((x) => ({ session: { ...x.session, games: [game('g1', ['a', 'b'], ['c', 'd'], 1)] } }))
    st.setCourtCount(2)
    expect(fee()).toBe(1800)
    // A session with only a fee keeps it.
    useStore.setState({ session: { ...booked, courtBooking: undefined, courtFee: 1000 } })
    st.setCourtCount(3)
    expect(fee()).toBe(1000)
  })

  it('corrects a past session court booking, and its share', () => {
    const past = { ...base(), id: 'nov8', courtCount: 3, courtBooking: { courts: 2, hours: 2, rate: 300 }, courtFee: 1200 }
    useStore.setState({ history: [past] })
    expect(costSummary(useStore.getState().history[0]).perHead).toBe(272) // (1200 + 160 shuttles) / 5
    useStore.getState().setHistoryCourtBooking('nov8', { courts: 3 })
    const fixed = useStore.getState().history[0]
    expect(fixed).toMatchObject({ courtFee: 1800, courtBooking: { courts: 3, hours: 2, rate: 300 } })
    expect(costSummary(fixed).perHead).toBe(392) // (1800 + 160) / 5
  })

  it('marks a player paid in a past session, e.g. a day later, and back', () => {
    const past = { ...base(), id: 'past', status: 'closed' as const }
    const other = { ...base(), id: 'other' }
    useStore.setState({ history: [past, other] })
    useStore.getState().togglePaidInHistory('past', 'e')
    const paid = () => useStore.getState().history.find((s) => s.id === 'past')!
    expect(costSummary(paid()).dues.find((d) => d.playerId === 'e')).toMatchObject({ owing: 0 })
    expect(costSummary(paid()).paidCount).toBe(1)
    // Other sessions are left alone.
    expect(useStore.getState().history[1]).toBe(other)
    useStore.getState().togglePaidInHistory('past', 'e')
    expect(costSummary(paid()).paidCount).toBe(0)
  })

  it('switching to per game keeps what players already paid, and owes the rest', () => {
    // Split two ways: 280 each.
    useStore.setState({ session: { ...base(), attendees: [attendee('a', true), attendee('e')] } })
    useStore.getState().setPricing({ style: 'perGame', entry: 250, perGame: 30 })
    const c = costSummary(useStore.getState().session)
    expect(c.dues.map((d) => [d.playerId, d.amount, d.paid, d.owing])).toEqual([
      ['a', 310, 280, 30],
      ['e', 250, 0, 250],
    ])
  })

  it('switching to a fixed fee keeps what was paid per game', () => {
    useStore.setState({ session: { ...base(), pricing: { style: 'perGame', entry: 125, perGame: 35, flat: 200 } } })
    useStore.getState().togglePaid('a') // 195
    useStore.getState().setPricing({ style: 'flat' })
    expect(costSummary(useStore.getState().session).dues[0]).toMatchObject({ amount: 200, paid: 195, owing: 5 })
    useStore.getState().setPricing({ style: 'split' })
    expect(costSummary(useStore.getState().session).dues[0]).toMatchObject({ amount: 112, owing: 0 })
  })

  it('keeps the amounts of other styles when switching, and carries the style to the next session', () => {
    useStore.setState({ session: base() })
    const st = useStore.getState()
    st.setPricing({ style: 'flat', flat: 200 })
    st.setPricing({ style: 'perGame', entry: 125, perGame: 35 })
    st.setPricing({ style: 'flat' })
    expect(useStore.getState().session.pricing).toEqual({ style: 'flat', entry: 125, perGame: 35, flat: 200 })
    expect(newSession(useStore.getState().session).pricing).toEqual({ style: 'flat', entry: 125, perGame: 35, flat: 200 })
    expect(newSession().pricing).toBeUndefined()
  })
})

describe('shuttle type order', () => {
  it('lists shuttle types by name, numbers in order and unnamed last', () => {
    const t = (name: string) => ({ name })
    expect(byName([t('XP2'), t(''), t('Vortex'), t('Dmantis 2'), t('dmantis'), t('Dmantis 10')]).map((x) => x.name)).toEqual([
      'dmantis', 'Dmantis 2', 'Dmantis 10', 'Vortex', 'XP2', '',
    ])
  })

  it('still counts games without a type as the first type, whatever its name', () => {
    const session: Session = {
      ...newSession(),
      shuttleTypes: [
        { id: 'x', name: 'XP2', price: 90, extra: 0 },
        { id: 'd', name: 'Dmantis', price: 80, extra: 0 },
      ],
      games: [{ id: 'g', court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], startedAt: 0, shuttles: 2 }],
    }
    expect(shuttleLines(session).map((l) => [l.name, l.used])).toEqual([
      ['Dmantis', 0],
      ['XP2', 2],
    ])
    expect(shuttleCount(session).lines.map((l) => l.name)).toEqual(['Dmantis', 'XP2'])
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

  it('ranks the wins leaderboard by wins alone, ties by name, no winless players', () => {
    const rows = winsStandings(games, (id) => id)
    expect(rows.slice(0, 2)).toEqual([
      { id: 'b', wins: 4 },
      { id: 'a', wins: 3 },
    ])
    expect(rows.every((r) => r.wins > 0)).toBe(true)
    expect(rows.some((r) => r.id === 'g' || r.id === 'c')).toBe(false)
    // Same wins tie and are in name order, whatever their losses.
    const tied = rows.filter((r) => r.wins === rows[rows.length - 1].wins).map((r) => r.id)
    expect(tied).toEqual([...tied].sort())
    expect(winsPlaces([{ id: 'x', wins: 3 }, { id: 'y', wins: 3 }, { id: 'z', wins: 1 }])).toEqual([1, 1, 2])
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
  const help = (struggling: string[], strength: Record<string, number>): Help => ({
    struggling: new Set(struggling),
    strength: new Map(Object.entries(strength)),
  })

  it('finds players who lost their last 5 decided games, and strong players', () => {
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
    // w won 5 of 6 decided games; s is struggling, so never a helper.
    expect(h.strength.get('w')).toBeCloseTo(5 / 6)
    expect(h.strength.has('s')).toBe(false)
    // 4 losses in a row is not enough.
    expect(helpFrom(games.slice(0, 6)).struggling.has('s')).toBe(false)
    // A win ends it.
    expect(helpFrom([...games, game('sw', 'xy', 'A')]).struggling.has('s')).toBe(false)
  })

  it('finds players who lost most games last session, until they win more than they lose today', () => {
    // Last session: s won 1 of 4 (25%), x 2 of 4 (50%).
    const last = [game('sx', 'wy', 'B'), game('sx', 'wy', 'B'), game('sx', 'wy', 'A'), game('sy', 'wx', 'B')]
    expect([...helpFrom(last, last).struggling]).toEqual(['s'])
    // Too few games last session to tell.
    expect(helpFrom(last.slice(0, 2), last.slice(0, 2)).struggling.size).toBe(0)
    // Today: a loss and a win still needs help; two wins and a loss doesn't.
    const today = [game('sz', 'wy', 'B'), game('sz', 'wy', 'A')]
    expect(helpFrom([...last, ...today], last, today).struggling.has('s')).toBe(true)
    const better = [...today, game('sz', 'wy', 'A')]
    expect(helpFrom([...last, ...better], last, better).struggling.has('s')).toBe(false)
  })

  it('partners a struggling player with the strongest player in the four, over even skill', () => {
    // a(5) b(4) c(2) d(1): skill alone pairs a+d, b+c. d is struggling, b wins 80%, a 60%.
    const split = splitTeams(['a', 'b', 'c', 'd'], skillOf, { help: help(['d'], { a: 0.6, b: 0.8 }) })
    expect([pairKey(split.teamA), pairKey(split.teamB)].sort()).toEqual(['a|c', 'b|d'])
    expect(split.helped).toEqual({ player: 'd', partner: 'b', rate: 0.8 })
    // No one on a streak, or nobody struggling: skill decides as before.
    for (const h of [help(['d'], {}), help([], { b: 3 })]) {
      const s = splitTeams(['a', 'b', 'c', 'd'], skillOf, { help: h })
      expect([pairKey(s.teamA), pairKey(s.teamB)].sort()).toEqual(['a|d', 'b|c'])
      expect(s.helped).toBeUndefined()
    }
  })

  it('never repeats a partner to help', () => {
    const split = splitTeams(['a', 'b', 'c', 'd'], skillOf, {
      help: help(['d'], { b: 0.8 }),
      partners: new Map([['b|d', 1]]),
    })
    expect(split.repeats).toBe(0)
    expect(split.helped).toBeUndefined()
  })

  it('leaves the queue order and swaps alone, only choosing partners', () => {
    // Lopsided: b moves up for d with or without help; g, still in the four, is helped.
    const queue = ['a', 'd', 'g', 'h', 'b']
    const h = help(['g'], { b: 0.7 })
    const without = planGames(queue, skillOf)
    const withHelp = planGames(queue, skillOf, { help: h })
    expect(withHelp.games[0].swap).toEqual(without.games[0].swap)
    expect(withHelp.order.slice(4)).toEqual(without.order.slice(4))
    expect(withHelp.games[0].swap).toMatchObject({ in: 'b', out: 'd' })
    expect(withHelp.games[0].help).toEqual({ player: 'g', partner: 'b', rate: 0.7 })
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
    expect(helpFrom(playedGames([saved])).struggling.size).toBe(0)
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

describe('signing in on another device', async () => {
  const { choose, hashOf, toDocs, useCloud } = await import('./cloud')
  const club = { id: 'c1', name: 'Club' }
  const players = [{ id: 'a', name: 'Ana', skill: 3 as const, active: true, createdAt: 0 }]
  const local = { players, session: newSession(), history: [], schedule: [], seasons: [] }
  const hashes = (d: Record<string, string>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, hashOf(v)]))
  const snap = (players: unknown[], rev: number) => ({ club, user: 'u', rev, docs: { players: JSON.stringify(players), session: JSON.stringify(local.session) } })

  it('takes the club data when this device has not changed since it last synced', () => {
    useStore.setState(local)
    useCloud.setState({ lastClubId: 'c1' })
    const saved = hashes(toDocs(local))
    // Another device added a player since (rev 5 to 7).
    const newer = snap([...players, { ...players[0], id: 'b', name: 'Ben' }], 7)
    expect(choose(newer, { clubId: 'c1', rev: 5, saved })).toBe('download')
  })

  it('still asks when both this device and the club changed', () => {
    useStore.setState({ ...local, players: [...players, { ...players[0], id: 'z', name: 'Zed' }] })
    const saved = hashes(toDocs(local))
    expect(choose(snap([...players, { ...players[0], id: 'b', name: 'Ben' }], 7), { clubId: 'c1', rev: 5, saved })).toBe('ask')
    // Only this device changed: send its changes up.
    expect(choose(snap(players, 5), { clubId: 'c1', rev: 5, saved })).toBe('upload')
  })

  it('asks for data that went to another club, and downloads onto an empty device', () => {
    useStore.setState(local)
    useCloud.setState({ lastClubId: 'other' })
    expect(choose(snap(players, 3), { clubId: 'other', rev: 3, saved: hashes(toDocs(local)) })).toBe('upload')
    expect(choose({ ...snap(players, 3), docs: { players: '[]' } }, { clubId: 'other', rev: 1 })).toBe('ask')
    useStore.setState({ ...local, players: [] })
    expect(choose(snap(players, 3), { rev: 0 })).toBe('download')
    useCloud.setState({ lastClubId: undefined })
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

describe('public stats page address', () => {
  const base = '/my-badminton-queue/'
  it('takes the club link name after the app path, and a player after that', () => {
    expect(publicPath('/my-badminton-queue/tim', base)).toEqual({ slug: 'tim' })
    expect(publicPath('/my-badminton-queue/serve-n-shout/', base)).toEqual({ slug: 'serve-n-shout' })
    expect(publicPath('/my-badminton-queue/TIM', base)).toEqual({ slug: 'tim' })
    expect(publicPath('/my-badminton-queue/serve-n-shout/tim', base)).toEqual({ slug: 'serve-n-shout', player: 'tim' })
    expect(publicPath('/my-badminton-queue/serve-n-shout/Tim%20Garcia/', base)).toEqual({ slug: 'serve-n-shout', player: 'tim garcia' })
  })
  it("isn't the app itself, its files, or another page", () => {
    expect(publicPath('/my-badminton-queue/', base)).toBeUndefined()
    expect(publicPath('/my-badminton-queue/index.html', base)).toBeUndefined()
    expect(publicPath('/my-badminton-queue/assets/index.js', base)).toBeUndefined()
    expect(publicPath('/my-badminton-queue/a', base)).toBeUndefined()
    expect(publicPath('/my-badminton-queue/club/tim/more', base)).toBeUndefined()
    expect(publicPath('/other/tim', base)).toBeUndefined()
  })
  it('finds a player by full name, or by first name when only one has it', () => {
    const players = [
      { id: '1', name: 'Tim Garcia' },
      { id: '2', name: 'Ana Reyes' },
      { id: '3', name: 'Ana Cruz' },
      { id: '4', name: 'Ninong Aries' },
    ]
    expect(findPlayer(players, 'tim')?.id).toBe('1')
    expect(findPlayer(players, 'tim garcia')?.id).toBe('1')
    expect(findPlayer(players, 'tim-garcia')?.id).toBe('1')
    expect(findPlayer(players, 'ana reyes')?.id).toBe('2')
    // Two Anas: the first name alone doesn't say which.
    expect(findPlayer(players, 'ana')).toBeUndefined()
    expect(findPlayer(players, 'ninong-aries')?.id).toBe('4')
    expect(findPlayer(players, 'bob')).toBeUndefined()
  })
})

describe('deuce games', () => {
  let t = 0
  const g = (score?: [number, number], extra: Partial<Session['games'][number]> = {}) =>
    ({ id: `d${++t}`, court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], startedAt: t * 1000, endedAt: t * 1000 + 600, shuttles: 0, winner: score && score[0] > score[1] ? 'A' : 'B', score, ...extra }) as Session['games'][number]

  it('takes games where both teams reached 20, most points first', () => {
    const games = [g([21, 19]), g([22, 20]), g([27, 29]), g([30, 29]), g([21, 10]), g()]
    expect(deuceGames(games).map((x) => x.score)).toEqual([[30, 29], [27, 29], [22, 20]])
  })

  it('breaks ties by the most recent, and skips games with no winner', () => {
    const older = g([24, 22])
    const newer = g([22, 24])
    const unfinished = g([20, 20], { winner: undefined, outOfHours: true })
    expect(deuceGames([older, newer, unfinished]).map((x) => x.id)).toEqual([newer.id, older.id])
    expect(deuceGames([g([21, 18])])).toEqual([])
  })
})

describe('scheduled games', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime()
  const fresh = () => useStore.setState({ session: { ...newSession(), courtBooking: { courts: 3, hours: 1, rate: 300 } }, history: [], schedule: [] })

  it('books games, refusing ones that overlap or end before they start', () => {
    fresh()
    const st = useStore.getState()
    expect(st.scheduleGames([{ start: at(2, 16), end: at(2, 18) }])).toBe(true)
    expect(st.scheduleGames([{ start: at(2, 17), end: at(2, 19) }])).toBe(false)
    expect(st.scheduleGames([{ start: at(2, 18), end: at(2, 16) }])).toBe(false)
    // Back to back is fine.
    expect(st.scheduleGames([{ start: at(2, 18), end: at(2, 20) }])).toBe(true)
    // A batch that clashes with itself books nothing.
    expect(st.scheduleGames([{ start: at(3, 9), end: at(3, 11) }, { start: at(3, 10), end: at(3, 12) }])).toBe(false)
    expect(useStore.getState().schedule).toHaveLength(2)
    const [first] = useStore.getState().schedule
    expect(st.rescheduleGame(first.id, at(2, 19), at(2, 21))).toBe(false)
    expect(st.rescheduleGame(first.id, at(2, 15), at(2, 17))).toBe(true)
    st.unscheduleGame(first.id)
    expect(useStore.getState().schedule.map((g) => g.start)).toEqual([at(2, 18)])
  })

  it('repeats a game weekly at the same time', () => {
    const weeks = weekly(at(2, 16), at(2, 18), 4)
    expect(weeks.map((g) => new Date(g.start).getDate())).toEqual([2, 9, 16, 23])
    expect(weeks.every((g) => g.end - g.start === 2 * 3600_000 && new Date(g.start).getHours() === 16)).toBe(true)
  })

  it('finds the game on now and the ones coming up', () => {
    const games = [
      { id: 'b', start: at(9, 16), end: at(9, 18) },
      { id: 'a', start: at(2, 16), end: at(2, 18) },
      { id: 'old', start: at(1, 16), end: at(1, 18) },
    ]
    expect(upcoming(games, at(2, 12)).map((g) => g.id)).toEqual(['a', 'b'])
    expect(dueGame(games, at(2, 15, 59))).toBeUndefined()
    expect(dueGame(games, at(2, 16))?.id).toBe('a')
    expect(dueGame(games, at(2, 18))).toBeUndefined()
    expect(clash(games, at(9, 17), at(9, 19))?.id).toBe('b')
    expect(clash(games, at(9, 17), at(9, 19), 'b')).toBeUndefined()
    expect(timeRange(at(2, 16), at(2, 18))).toMatch(/^4:00\s?–\s?6:00\sPM$|^16:00 – 18:00$/)
  })

  it('starts the session by itself at the game time, counting from the booked start', () => {
    vi.useFakeTimers()
    fresh()
    useStore.getState().scheduleGames([{ start: at(2, 16), end: at(2, 18) }, { start: at(9, 16), end: at(9, 18) }])
    checkSchedule(at(2, 15, 59))
    expect(useStore.getState().session.timer).toBeUndefined()
    // The iPad wakes up at 4:20: the clock still ends at 6.
    vi.setSystemTime(at(2, 16, 20))
    checkSchedule(at(2, 16, 20))
    const { session, schedule } = useStore.getState()
    expect(session.timer).toEqual({ startedAt: at(2, 16), minutes: 120 })
    expect(session.scheduled).toEqual({ start: at(2, 16), end: at(2, 18) })
    expect(session.date).toBe('2026-11-02')
    // The court booking takes the game's hours.
    expect(session.courtBooking).toEqual({ courts: 3, hours: 2, rate: 300 })
    expect(session.courtFee).toBe(1800)
    expect(schedule.map((g) => g.start)).toEqual([at(9, 16)])
  })

  it("doesn't start over a running clock, and forgets games that ended unstarted", () => {
    fresh()
    const st = useStore.getState()
    st.startTimer(2)
    st.scheduleGames([{ start: at(2, 16), end: at(2, 18) }])
    const timer = useStore.getState().session.timer
    checkSchedule(at(2, 17))
    expect(useStore.getState().session.timer).toBe(timer)
    expect(useStore.getState().schedule).toHaveLength(1)
    checkSchedule(at(2, 18))
    expect(useStore.getState().schedule).toEqual([])
  })

  it('saves the schedule to the club only when there is one', async () => {
    const { fromDocs, toDocs } = await import('./cloud')
    const base = { players: [], session: newSession(), history: [] }
    expect(Object.keys(toDocs({ ...base, schedule: [] }))).not.toContain('schedule')
    const schedule = [{ id: 'g', start: at(2, 16), end: at(2, 18) }]
    const docs = toDocs({ ...base, schedule })
    expect(fromDocs(docs).schedule).toEqual(schedule)
    expect(fromDocs(toDocs(base)).schedule).toEqual([])
  })
})

describe('blowout games', () => {
  let t = 0
  const g = (score?: [number, number], extra: Partial<Session['games'][number]> = {}) =>
    ({ id: `b${++t}`, court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], startedAt: t * 1000, endedAt: t * 1000 + 600, shuttles: 0, winner: score && score[0] > score[1] ? 'A' : 'B', score, ...extra }) as Session['games'][number]

  it('takes games won by 10 or more, biggest gap first', () => {
    const games = [g([21, 12]), g([21, 11]), g([4, 21]), g([21, 0]), g([22, 20]), g()]
    expect(blowoutGames(games).map((x) => x.score)).toEqual([[21, 0], [4, 21], [21, 11]])
  })

  it('breaks ties by the most recent, and skips games with no winner', () => {
    const older = g([21, 5])
    const newer = g([5, 21])
    const unfinished = g([15, 2], { winner: undefined, outOfHours: true })
    expect(blowoutGames([older, newer, unfinished]).map((x) => x.id)).toEqual([newer.id, older.id])
    expect(blowoutGames([g([21, 12])])).toEqual([])
  })
})

describe('rest, early arrivals and last session', () => {
  let t = 0
  // Games 10 minutes long; `at` is the start in minutes.
  const game = (teamA: string, teamB: string, at: number, ended = true) =>
    ({ id: `r${++t}`, court: 1, teamA: teamA.split(''), teamB: teamB.split(''), startedAt: at * 60_000, ...(ended && { endedAt: (at + 10) * 60_000 }), shuttles: 0 }) as Session['games'][number]
  const even = () => 3

  it('counts games played in a row, until a game starts without the player', () => {
    // a plays at 0 and 10 with no game starting in between: 2 in a row. e rested (sat out 10).
    const games = [game('ab', 'cd', 0), game('ef', 'gh', 5), game('ai', 'jk', 15), game('ej', 'lm', 25)]
    const runs = playStreaks(games)
    expect(runs.get('a')).toBeUndefined() // e's game at 25 started after a's ended: a has rested
    expect(runs.get('e')).toBe(1)
    const back = [game('ab', 'cd', 0), game('ab', 'ef', 10)]
    expect(playStreaks(back).get('a')).toBe(2)
    expect(playStreaks([...back, game('gh', 'ij', 20)]).has('a')).toBe(false)
  })

  it('rests a player after 2 games in a row when someone else can play', () => {
    const played = new Map([['a', 2]])
    const idea = suggestSwap(['a', 'b', 'c', 'd', 'e'], even, { played })
    expect(idea).toMatchObject({ out: 'a', in: 'e', reason: 'rest' })
    // Never moved up while tired; with nobody else, they play.
    expect(suggestSwap(['b', 'c', 'd', 'e', 'a'], even, { played, met: new Map([['b|c', 1]]) })?.in).not.toBe('a')
    expect(suggestSwap(['a', 'b', 'c', 'd'], even, { played })).toBeNull()
  })

  it('prefers moving up someone who has rested', () => {
    // b and c met before; e just played, f has rested.
    const idea = suggestSwap(['a', 'b', 'c', 'd', 'e', 'f'], even, { met: new Map([['b|c', 1]]), played: new Map([['e', 1]]) })
    expect(idea?.in).toBe('f')
  })

  it("never moves back players who haven't played yet", () => {
    const met = new Map([['b|c', 1]])
    expect(suggestSwap(['a', 'b', 'c', 'd', 'e'], even, { met })).not.toBeNull()
    expect(suggestSwap(['a', 'b', 'c', 'd', 'e'], even, { met, keep: new Set(['a', 'b', 'c', 'd']) })).toBeNull()
  })

  it('never moves someone up for a player who has played fewer games', () => {
    // b and c met before, so a swap helps; only e and f are further back.
    const met = new Map([['b|c', 1]])
    const games = new Map([['a', 3], ['b', 3], ['c', 3], ['d', 3], ['e', 5], ['f', 4]])
    expect(suggestSwap(['a', 'b', 'c', 'd', 'e', 'f'], even, { met, games })).toBeNull()
    // With someone on fewer games further back, they move up.
    games.set('f', 2)
    expect(suggestSwap(['a', 'b', 'c', 'd', 'e', 'f'], even, { met, games })?.in).toBe('f')
    // A rest still comes first: a played 2 in a row, e moves up though on more games.
    const rest = suggestSwap(['a', 'b', 'c', 'd', 'e'], even, { games, played: new Map([['a', 2]]) })
    expect(rest).toMatchObject({ out: 'a', in: 'e', reason: 'rest' })
  })

  it('moves up a player 2 games behind, even when nothing else needs a swap', () => {
    const games = new Map([['a', 4], ['b', 4], ['c', 4], ['d', 4], ['e', 3], ['f', 2]])
    expect(suggestSwap(['a', 'b', 'c', 'd', 'e', 'f'], even, { games })).toMatchObject({ in: 'f', reason: 'fair' })
    // One game behind is the normal rotation.
    games.set('f', 3)
    expect(suggestSwap(['a', 'b', 'c', 'd', 'e', 'f'], even, { games })).toBeNull()
  })

  it('credits late arrivals with their share of the games before they came', () => {
    // 8 players; 4 games started before l arrived at minute 35: 4 × 4 / 8 = 2 games' worth.
    const games = [game('ab', 'cd', 0), game('ef', 'gh', 0), game('ab', 'cd', 15), game('ef', 'gh', 15)]
    const at = (id: string, min: number) => ({ playerId: id, checkedInAt: min * 60_000 })
    const share = fairShare(games, [...'abcdefg'].map((id) => at(id, 0)).concat(at('l', 35)))
    expect(share.get('a')).toBe(2)
    expect(share.get('l')).toBe(2)
  })

  it('prefers moving up whoever has played fewest', () => {
    const met = new Map([['b|c', 1]])
    const games = new Map([['a', 3], ['b', 3], ['c', 3], ['d', 3], ['e', 3], ['f', 1]])
    expect(suggestSwap(['a', 'b', 'c', 'd', 'e', 'f'], even, { met, games })?.in).toBe('f')
  })

  it("prefers partners who weren't teammates last session", () => {
    // Even skill: any split works; a+b and a+c were partners last session.
    const split = splitTeams(['a', 'b', 'c', 'd'], even, { lastPartners: new Map([['a|b', 1], ['a|c', 1]]) })
    expect([pairKey(split.teamA), pairKey(split.teamB)].sort()).toEqual(['a|d', 'b|c'])
    expect(split.lastRepeats).toBe(0)
    // A repeat partner today still matters more.
    const today = splitTeams(['a', 'b', 'c', 'd'], even, { lastPartners: new Map([['a|b', 1], ['a|c', 1]]), partners: new Map([['a|d', 1]]) })
    expect(today.repeats).toBe(0)
  })

  it('queues players by arrival time until they play', () => {
    const s = useStore.getState()
    s.clearAll()
    const ids = ['p', 'q', 'r'].map((n) => {
      useStore.getState().addPlayer(n, 3, 'M')
      return useStore.getState().players.at(-1)!.id
    })
    const [p, q, r] = ids
    useStore.getState().checkIn(p, 3000)
    useStore.getState().checkIn(q, 2000) // accepted later, arrived earlier
    useStore.getState().checkIn(r, 1000)
    expect(useStore.getState().session.queue).toEqual([r, q, p])
    // Back from a rest before playing: their place, not the back.
    useStore.getState().setResting(r, true)
    useStore.getState().setResting(r, false)
    expect(useStore.getState().session.queue).toEqual([r, q, p])
    useStore.getState().clearAll()
  })
})

describe('graph numbers', () => {
  const M = 60_000
  const start = new Date('2026-11-02T16:00').getTime()
  let n = 0
  const game = (teamA: string, teamB: string, at: number, len: number, score?: [number, number]) =>
    ({ id: `t${++n}`, court: 1, teamA: teamA.split(''), teamB: teamB.split(''), startedAt: start + at * M, endedAt: start + (at + len) * M, shuttles: 0, ...(score && { score, winner: score[0] > score[1] ? 'A' : 'B' }) }) as Session['games'][number]
  const att = (id: string, min: number) => ({ playerId: id, checkedInAt: start + min * M, gamesPlayed: 0, paid: false, resting: false })
  // a..d play at 0 (10 min, 21-15); a,b,e,f at 15 (20 min, 23-21); e,f arrived late.
  const session = {
    ...newSession(),
    id: 's',
    date: '2026-11-02',
    attendees: [att('a', -10), att('b', -6), att('c', -2), att('d', 0), att('e', 5), att('f', 10)],
    games: [game('ab', 'cd', 0, 10, [21, 15]), game('ab', 'ef', 15, 20, [21, 23]), game('cd', 'xy', 40, 5)],
    status: 'closed',
  } as Session

  it('averages a session', () => {
    const t = sessionTrend(session)
    expect(t.gameMin).toBeCloseTo(35 / 3)
    expect(t.earlyMin).toBeCloseTo((10 + 6 + 2 + 0 - 5 - 10) / 6)
    expect(t.gap).toBe(4) // 6 and 2
    expect(t.scored).toBe(2)
    // 2, 2, 2, 2, 1 and 1 games.
    expect(t.perPlayer).toEqual({ avg: 10 / 6, min: 1, max: 2 })
    // a and b waited 5 min (10 to 15); c and d 30 min (10 to 40).
    expect(t.waitMin).toBeCloseTo(17.5)
  })

  it('lists players in check-in order, and sessions oldest first', () => {
    const days = playerDays(session)
    expect(days.map((d) => d.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(days[5]).toMatchObject({ games: 1, earlyMin: -10, waitMin: null })
    const older = { ...session, id: 'o', date: '2026-10-30' }
    const empty = { ...session, id: 'none', date: '2026-11-03', games: [] }
    expect(sessionTrends([session, empty, older]).map((t) => t.id)).toEqual(['o', 's'])
    expect(overall([session, older])).toMatchObject({ sessions: 2, scored: 4, gap: 4 })
  })

  it('groups score gaps and picks round axis ticks', () => {
    expect(gapCounts(session.games)).toEqual([
      { label: '1–2', count: 1 },
      { label: '3–5', count: 0 },
      { label: '6–9', count: 1 },
      { label: '10+', count: 0 },
    ])
    expect(niceTicks(0, 17)).toEqual([0, 5, 10, 15, 20])
    expect(niceTicks(-7, 12)).toEqual([-10, -5, 0, 5, 10, 15])
    expect(niceTicks(0, 0)).toEqual([0, 1])
  })
})

describe('seasons', () => {
  const day = (id: string, date: string) => ({ ...newSession(), id, date })
  const list = [day('aug', '2026-08-31'), day('sep', '2026-09-01'), day('oct', '2026-10-15'), day('nov', '2026-11-30'), day('dec', '2026-12-01')]

  it('covers sessions from the first day to the last, both included', async () => {
    const { sessionsBetween } = await import('./scope')
    expect(sessionsBetween(list, { from: '2026-09-01', to: '2026-11-30' }).map((s) => s.id)).toEqual(['sep', 'oct', 'nov'])
    expect(sessionsBetween(list, { from: '2026-12-02', to: '2026-12-31' })).toEqual([])
  })

  it('writes the year once when both days are in the same year', async () => {
    const { rangeLabel } = await import('./scope')
    expect(rangeLabel({ from: '2026-09-01', to: '2026-11-30' })).not.toMatch(/2026.*2026/)
    expect(rangeLabel({ from: '2025-12-01', to: '2026-02-28' })).toMatch(/2025.*2026/)
  })

  it('saves, renames and deletes a season, and clears them with all data', () => {
    useStore.setState({ seasons: [] })
    const st = useStore.getState()
    const id = st.addSeason({ name: ' Season 1 ', from: '2026-09-01', to: '2026-11-30' })
    expect(useStore.getState().seasons).toEqual([{ id, name: 'Season 1', from: '2026-09-01', to: '2026-11-30' }])
    st.updateSeason(id, { name: 'Spring', to: '2026-11-15' })
    expect(useStore.getState().seasons[0]).toMatchObject({ name: 'Spring', to: '2026-11-15' })
    st.deleteSeason(id)
    expect(useStore.getState().seasons).toEqual([])
    st.addSeason({ name: 'S2', from: '2026-12-01', to: '2027-02-28' })
    st.clearAll()
    expect(useStore.getState().seasons).toEqual([])
  })

  it('saves seasons to the club only when there are any', async () => {
    const { fromDocs, toDocs } = await import('./cloud')
    const base = { players: [], session: newSession(), history: [] }
    expect(Object.keys(toDocs({ ...base, seasons: [] }))).not.toContain('seasons')
    const seasons = [{ id: 's', name: 'Season 1', from: '2026-09-01', to: '2026-11-30' }]
    expect(fromDocs(toDocs({ ...base, seasons })).seasons).toEqual(seasons)
    expect(fromDocs(toDocs(base)).seasons).toEqual([])
  })
})

describe('awards', async () => {
  const { awardList, HIGHLIGHTS, podiumAwards } = await import('./awards')
  const g = (id: string, teamA: string[], teamB: string[], winner: 'A' | 'B') =>
    ({ id, court: 1, teamA, teamB, startedAt: 0, endedAt: 600_000, winner, shuttles: 1 }) as Session['games'][number]
  const session: Session = {
    ...newSession(),
    games: [g('1', ['a', 'b'], ['c', 'd'], 'A'), g('2', ['a', 'c'], ['b', 'd'], 'A'), g('3', ['a', 'd'], ['b', 'c'], 'A')],
  }
  const name = (id: string) => id.toUpperCase()

  it('puts the top of the standings on the podium, sharing a place on the same record', () => {
    const [first, second, third] = podiumAwards([session], { name })
    expect(first).toMatchObject({ title: 'Champion', who: 'A', value: '3–0' })
    // b, c and d are all 1–2: one card, the first two named.
    expect(second).toMatchObject({ title: 'Runner-up', who: 'B, C +1', value: '1–2' })
    expect(second.detail).toContain('3 tied')
    expect(third.who).toBeUndefined()
  })

  it('has every highlight a season recap picks from', () => {
    const keys = awardList([session], { name, names: (p) => p.map(name).join(' & '), showDate: true }).map((a) => a.key)
    expect(HIGHLIGHTS.every((k) => keys.includes(k))).toBe(true)
    expect(keys).toHaveLength(14)
  })
})
