// Replays real sessions through the app's own queue (Next game, swaps and
// all): the same players checking in and leaving at the same times, games
// taking as long as they did, courts as booked. Reports back-to-back games
// and waits, to compare queue rules on real nights.
// Usage: npx vite-node scripts/replay-sessions.ts [data/serve-n-shout-backup.json]
// OLD=1 replays with the queue as it was before swaps checked waiting times.
import { readFileSync } from 'node:fs'
import { planNext } from '../src/lib/nextGame'
import { newSession, useStore } from '../src/store/useStore'
import type { Player, Session } from '../src/types'

const file = process.argv[2] ?? 'data/serve-n-shout-backup.json'
const data = JSON.parse(readFileSync(file, 'utf8')) as { players: Player[]; history: Session[] }
const BACK_TO_BACK = 2 * 60_000
let now = 0
Date.now = () => now

const players = new Map(data.players.map((p) => [p.id, p]))
const st = () => useStore.getState()
const total = { games: 0, b2b: 0, unfair: 0, samePartners: 0, sameCourt: 0, menVsWomen: 0, waits: [] as number[], pushed: 0 }

for (const real of [...data.history].sort((a, b) => a.date.localeCompare(b.date))) {
  const games = real.games.filter((g) => g.endedAt).sort((a, b) => a.startedAt - b.startedAt)
  if (games.length < 4) continue
  const start = games[0].startedAt
  const end = Math.max(...games.map((g) => g.endedAt!))
  const lengths = games.map((g) => g.endedAt! - g.startedAt)
  // Everyone leaves when they did: after their last real game.
  const leaves = new Map(
    real.attendees.map((a) => [a.playerId, Math.max(...games.filter((g) => [...g.teamA, ...g.teamB].includes(a.playerId)).map((g) => g.endedAt!), a.checkedInAt)]),
  )
  useStore.setState({
    players: data.players,
    history: [],
    session: { ...newSession(), id: real.id, date: real.date, courtCount: real.courtCount, skillMatch: real.skillMatch, helpStruggling: real.helpStruggling },
  })
  const arrivals = [...real.attendees].sort((a, b) => a.checkedInAt - b.checkedInAt)
  const ends = new Map<string, number>() // game id → when it ends
  let n = 0
  for (now = Math.min(start, arrivals[0].checkedInAt); now <= end; now += 15_000) {
    for (const a of arrivals) {
      if (a.checkedInAt <= now && !st().session.attendees.some((x) => x.playerId === a.playerId)) st().checkIn(a.playerId, a.checkedInAt)
    }
    for (const [id, at] of ends) {
      if (at > now) continue
      st().endGame(id, 'A')
      ends.delete(id)
    }
    // Players who have gone home leave the queue.
    for (const id of [...st().session.queue]) if ((leaves.get(id) ?? Infinity) < now) st().checkOut(id)
    if (now < start) continue
    for (let court = 1; court <= real.courtCount; court++) {
      const busy = st().session.games.some((g) => g.court === court && !g.endedAt)
      if (busy) continue
      const [next] = planNext(st().session, players, [], { waits: !process.env.OLD }).games
      if (!next) break
      st().startGame(court, next.teamA, next.teamB, next.swap, next.set)
      const g = st().session.games[st().session.games.length - 1]
      ends.set(g.id, now + lengths[n++ % lengths.length])
    }
  }
  for (const id of ends.keys()) st().endGame(id, 'A')

  // Back-to-back games and waits, as in scripts/analyze-waits.mjs.
  const played = st().session.games.filter((g) => g.endedAt)
  let b2b = 0
  /** Back-to-back while someone else there had been waiting longer: the unfair kind. */
  let unfair = 0
  const waits: number[] = []
  const ids = (g: (typeof played)[number]) => [...g.teamA, ...g.teamB]
  /** How long a player had been off court when a game started (since arriving or play began). */
  const idle = (id: string, at: number) => {
    const before = played.filter((g) => ids(g).includes(id) && g.endedAt! <= at).map((g) => g.endedAt!)
    const arrived = real.attendees.find((a) => a.playerId === id)!.checkedInAt
    return at - Math.max(start, arrived, ...before)
  }
  for (const a of st().session.attendees) {
    const mine = played.filter((g) => ids(g).includes(a.playerId))
    for (let i = 1; i < mine.length; i++) {
      const g = mine[i]
      const gap = g.startedAt - mine[i - 1].endedAt!
      waits.push(gap)
      if (gap >= BACK_TO_BACK) continue
      b2b++
      const there = real.attendees.filter(
        (x) =>
          x.checkedInAt <= g.startedAt &&
          (leaves.get(x.playerId) ?? 0) >= g.startedAt &&
          !played.some((o) => ids(o).includes(x.playerId) && o.startedAt <= g.startedAt && o.endedAt! > g.startedAt),
      )
      const longer = there.filter((x) => idle(x.playerId, g.startedAt) > gap + BACK_TO_BACK)
      if (longer.length) {
        unfair++
        if (process.env.WHY) {
          const name = (id: string) => players.get(id)?.name ?? id
          console.log(`  ${real.date} #${g.number} c${g.court} ${name(a.playerId)} rested ${Math.round(gap / 1000)}s${g.swap ? ` swap(${g.swap.reason}) in=${name(g.swap.in)}` : ''}${g.set ? ' set' : ''}; waiting longer: ${longer.map((x) => `${name(x.playerId)} ${Math.round(idle(x.playerId, g.startedAt) / 60000)}m`).join(', ')}`)
        }
      }
    }
  }
  const counts = st().session.attendees.map((a) => played.filter((g) => [...g.teamA, ...g.teamB].includes(a.playerId)).length)
  const pushed = played.filter((g) => g.swap).length
  // Variety: the same two partners again, and the same two players on court together again.
  const seen = new Map<string, number>()
  const met = new Map<string, number>()
  let samePartners = 0
  let sameCourt = 0
  // Two men and two women split men vs women instead of mixed doubles.
  const gender = (id: string) => players.get(id)?.gender
  const menVsWomen = played.filter((g) => {
    const four = ids(g).map(gender)
    const mvw = four.filter((x) => x === 'M').length === 2 && four.filter((x) => x === 'F').length === 2 && gender(g.teamA[0]) === gender(g.teamA[1])
    if (mvw && process.env.WHY) {
      // Were both mixed splits partnerships already played earlier that day?
      const before = played.filter((o) => o.startedAt < g.startedAt).flatMap((o) => [o.teamA, o.teamB].map((t) => [...t].sort().join()))
      const [m1, m2] = [...g.teamA].map((x) => x)
      const [w1, w2] = [...g.teamB]
      const options = [[[m1, w1], [m2, w2]], [[m1, w2], [m2, w1]]].map((o) => o.some((t) => before.includes([...t].sort().join())))
      console.log(`  ${real.date} #${g.number}: mixed options repeat a partner today: ${options.join(', ')}${g.set ? ' (set game)' : ''}`)
    }
    return mvw
  }).length
  for (const g of played) {
    for (const t of [g.teamA, g.teamB]) {
      const k = [...t].sort().join()
      if (seen.has(k)) samePartners++
      seen.set(k, 1)
    }
    const four = ids(g)
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        const k = [four[i], four[j]].sort().join()
        if ((met.get(k) ?? 0) >= 2) sameCourt++
        met.set(k, (met.get(k) ?? 0) + 1)
      }
  }
  const min = (ms: number) => Math.round(ms / 60_000)
  const avg = waits.reduce((x, y) => x + y, 0) / (waits.length || 1)
  console.log(
    `${real.date}  ${String(real.attendees.length).padStart(2)} players ${real.courtCount} courts  ${String(played.length).padStart(2)} games  back-to-back ${String(b2b).padStart(2)} (unfair ${String(unfair).padStart(2)})  swaps ${String(pushed).padStart(2)}  repeat partners ${samePartners}, met 3+ times ${sameCourt}  men v women ${menVsWomen}  wait avg ${min(avg)}m, longest ${min(Math.max(...waits))}m  games each ${Math.min(...counts)}–${Math.max(...counts)}`,
  )
  total.games += played.length
  total.b2b += b2b
  total.unfair += unfair
  total.pushed += pushed
  total.samePartners += samePartners
  total.sameCourt += sameCourt
  total.menVsWomen += menVsWomen
  total.waits.push(...waits)
}
const avg = total.waits.reduce((x, y) => x + y, 0) / total.waits.length
console.log(`All      ${total.games} games  back-to-back ${total.b2b} (unfair ${total.unfair})  swaps ${total.pushed}  repeat partners ${total.samePartners}, met 3+ times ${total.sameCourt}  men v women ${total.menVsWomen}  wait avg ${Math.round(avg / 60_000)}m, longest ${Math.round(Math.max(...total.waits) / 60_000)}m`)
