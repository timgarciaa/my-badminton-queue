// Waiting times and back-to-back games per session, from a club backup
// (Settings → Export backup, or data/ from the cloud).
// Usage: node scripts/analyze-waits.mjs data/serve-n-shout-backup.json [date]
import { readFileSync } from 'node:fs'

const [file = 'data/serve-n-shout-backup.json', only] = process.argv.slice(2)
const data = JSON.parse(readFileSync(file, 'utf8'))
const name = new Map(data.players.map((p) => [p.id, p.name]))
const who = (id) => name.get(id) ?? '?'
const min = (ms) => Math.round(ms / 60_000)
const clock = (ms) => new Date(ms).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })
/** Back on court within this long of their last game ending: no rest at all. */
const BACK_TO_BACK = 2 * 60_000

const sessions = [data.session, ...data.history].filter((s) => s?.games.length && (!only || s.date === only))
for (const s of sessions.sort((a, b) => a.date.localeCompare(b.date))) {
  const games = [...s.games].filter((g) => g.endedAt).sort((a, b) => a.startedAt - b.startedAt)
  const len = games.map((g) => g.endedAt - g.startedAt).sort((a, b) => a - b)
  const median = len[len.length >> 1]
  const players = s.attendees.map((a) => {
    const mine = games.filter((g) => [...g.teamA, ...g.teamB].includes(a.playerId))
    const waits = []
    // Arriving before play starts isn't waiting.
    let prevEnd = Math.max(a.checkedInAt, games[0].startedAt)
    let first = true
    const runs = []
    for (const g of mine) {
      const wait = g.startedAt - prevEnd
      waits.push({ wait, first, at: g.startedAt, game: g.number })
      if (!first && wait < BACK_TO_BACK) {
        const why = g.set ? 'set game' : g.swap?.in === a.playerId || g.swap?.also?.in === a.playerId ? `moved up (${g.swap.reason})` : g.stayed?.includes(a.playerId) ? 'winners stay' : 'queue'
        runs.push({ game: g.number, why })
      }
      prevEnd = g.endedAt
      first = false
    }
    const between = waits.filter((w) => !w.first).map((w) => w.wait)
    return {
      id: a.playerId,
      name: who(a.playerId),
      in: a.checkedInAt,
      played: mine.length,
      firstWait: waits[0]?.wait,
      avg: between.length ? between.reduce((x, y) => x + y, 0) / between.length : undefined,
      longest: waits.reduce((m, w) => (w.wait > (m?.wait ?? -1) ? w : m), undefined),
      runs,
    }
  })
  const courts = s.courtCount
  const ideal = Math.max(0, (players.length / (4 * courts) - 1) * median)
  console.log(`\n=== ${s.date} · ${games.length} games · ${players.length} players · ${courts} courts · games take ~${min(median)} min`)
  console.log(`    Fair wait between games with ${players.length} players on ${courts} courts: ~${min(ideal)} min`)
  console.log('    player            in      games  1st wait  avg wait  longest wait          back-to-back')
  for (const p of players.sort((a, b) => (b.longest?.wait ?? 0) - (a.longest?.wait ?? 0))) {
    const l = p.longest
    console.log(
      `    ${p.name.padEnd(16).slice(0, 16)}  ${clock(p.in).padStart(8)}  ${String(p.played).padStart(3)}  ${String(p.firstWait === undefined ? '–' : min(p.firstWait)).padStart(7)}m ${String(p.avg === undefined ? '–' : min(p.avg)).padStart(8)}m  ${l ? `${min(l.wait)}m before #${l.game}${l.first ? ' (1st)' : ''}`.padEnd(20) : '–'.padEnd(20)}  ${p.runs.map((r) => `#${r.game} ${r.why}`).join(', ')}`,
    )
  }
}
