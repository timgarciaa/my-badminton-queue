import type { AwardArt, AwardTone } from './shareImage'
import {
  arrivals,
  bestRecord,
  BLOWOUT,
  blowoutGames,
  deuceGames,
  duoRecords,
  finishedGames,
  gameExtremes,
  gameTime,
  longDate,
  mostOften,
  places,
  playedGames,
  playerRecords,
  rivalries,
  standings,
  streaks,
  winRate,
  worstRecord,
  type PlayerRecord,
} from './stats'
import type { Pair, Session } from '../types'

/** One award card: who won it and the number, or why nobody has yet (`empty`). */
export interface Award {
  key: string
  title: string
  art: AwardArt
  tone: AwardTone
  who?: string
  value?: string
  /** What the value means, e.g. "in a row". */
  detail?: string
  empty?: string
}

const pct = (r: PlayerRecord) => {
  const rate = winRate(r)
  return rate === null ? '–' : `${Math.round(rate * 100)}%`
}
const record = (r: PlayerRecord) => `${r.wins}–${r.losses}`
const games = (n: number) => `${n} ${n === 1 ? 'game' : 'games'}`

export interface AwardNames {
  name: (id: string) => string
  /** A pair, in name order: "Ana & Tim". */
  names: (p: Pair) => string
  /** Several sessions: say which day a game was played. */
  showDate: boolean
}

/** Champion, Runner-up and Third place: the top of the standings (with a win); the same record shares a card. */
export function podiumAwards(sessions: Session[], { name }: Pick<AwardNames, 'name'>): Award[] {
  const ranked = standings(playedGames(sessions))
  const place = places(ranked)
  const who = whoOf(name)
  return [
    { title: 'Champion', tone: 'amber', place: '1st place' },
    { title: 'Runner-up', tone: 'slate', place: '2nd place' },
    { title: 'Third place', tone: 'orange', place: '3rd place' },
  ].map((p, i): Award => {
    const top = ranked.filter((x, j) => place[j] === i + 1 && x.wins > 0)
    const r = top[0]
    return {
      key: p.title,
      title: p.title,
      art: 'trophy',
      tone: p.tone as AwardTone,
      who: top.length ? who(top.map((x) => x.id)) : undefined,
      value: r && record(r),
      detail: r && `${p.place}${top.length > 1 ? ` · ${top.length} tied` : ''} · ${pct(r)} · ${games(r.played)}`,
      empty: `No ${p.place.replace(' place', '')} yet`,
    }
  })
}

/** "Ana & Tim", or "Ana, Ben +3" for many. */
const whoOf = (name: (id: string) => string) => (ids: string[]) =>
  ids.length > 2 ? `${name(ids[0])}, ${name(ids[1])} +${ids.length - 2}` : ids.map(name).join(' & ')

/** Every other award on the stats dashboard, in its order. */
export function awardList(sessions: Session[], { name, names, showDate }: AwardNames): Award[] {
  const played = playedGames(sessions)
  const who = whoOf(name)
  const duos = duoRecords(played)
  const runs = streaks(played)
  const records = [...playerRecords(played)].map(([id, r]) => ({ id, ...r }))
  const rival = rivalries(played).find((r) => r.met >= 2)
  const bestDuo = bestRecord(duos)
  const worstDuo = worstRecord(duos)
  const topBy = (f: (id: string) => number) => {
    const ids = [...runs.keys()]
    const top = Math.max(0, ...ids.map(f))
    return { top, ids: ids.filter((id) => f(id) === top) }
  }
  const winRun = topBy((id) => runs.get(id)!.wins)
  const lossRun = topBy((id) => runs.get(id)!.losses)
  const hot = topBy((id) => runs.get(id)!.current)
  const mostPlayed = Math.max(0, ...records.map((r) => r.played))
  const iron = records.filter((r) => r.played === mostPlayed).map((r) => r.id)
  const bestPlayer = bestRecord(records, 3)
  const finished = finishedGames(sessions)
  const { longest, shortest } = gameExtremes(finished)
  const deuce = deuceGames(finished)[0]
  const blowout = blowoutGames(finished)[0]
  type G = NonNullable<typeof deuce>
  // The winners and their score first: Tim & Ana, 29–27, beat Ben & Carla.
  const sides = (g: G) => (g.winner === 'A' ? [g.teamA, g.teamB] : [g.teamB, g.teamA])
  const points = (g: G) => (g.winner === 'A' ? g.score! : [g.score![1], g.score![0]])
  const shortDate = (iso: string) =>
    new Date(iso + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const which = (g: G) => `Game ${g.number} · Court ${g.court}`
  const teams = (g: G) => `${names(g.teamA)} vs ${names(g.teamB)}${showDate ? ` · ${longDate(g.date)}` : ''}`
  // Arrivals: one session shows times; several show who was first or last most often.
  const arrived = arrivals(sessions)
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const early = mostOften(arrived.map((a) => a.first))
  const late = mostOften(arrived.map((a) => a.last))
  const often = (times: number, what: string) => `${what} in ${times} of ${arrived.length} sessions`
  const two = 'Needs at least two players checked in'

  return [
    {
      key: 'best-duo', title: 'Unbeatable duo', art: 'trophy', tone: 'emerald',
      who: bestDuo && names(bestDuo.pair), value: bestDuo && record(bestDuo),
      detail: bestDuo && `${pct(bestDuo)} · ${games(bestDuo.played)} together`,
    },
    {
      key: 'worst-duo', title: 'Worst duo', art: 'net', tone: 'rose',
      who: worstDuo && names(worstDuo.pair), value: worstDuo && record(worstDuo),
      detail: worstDuo && `${pct(worstDuo)} · ${games(worstDuo.played)} together`,
    },
    {
      key: 'win-run', title: 'Longest win streak', art: 'flame', tone: 'amber',
      who: winRun.top ? who(winRun.ids) : undefined,
      value: winRun.top ? `${winRun.top} ${winRun.top === 1 ? 'win' : 'wins'}` : undefined,
      detail: 'in a row',
    },
    {
      key: 'loss-run', title: 'Longest losing run', art: 'rain', tone: 'slate',
      who: lossRun.top ? who(lossRun.ids) : undefined,
      value: lossRun.top ? `${lossRun.top} ${lossRun.top === 1 ? 'loss' : 'losses'}` : undefined,
      detail: 'in a row',
    },
    {
      key: 'hot', title: 'On a roll', art: 'rocket', tone: 'orange',
      who: hot.top >= 2 ? who(hot.ids) : undefined, value: hot.top >= 2 ? `${hot.top} wins` : undefined,
      detail: 'and counting', empty: 'Nobody has won 2 in a row lately',
    },
    {
      key: 'best-rate', title: 'Best win rate', art: 'target', tone: 'violet',
      who: bestPlayer && name(bestPlayer.id), value: bestPlayer && pct(bestPlayer),
      detail: bestPlayer && `${record(bestPlayer)} in ${bestPlayer.wins + bestPlayer.losses} decided games`,
    },
    {
      key: 'most-games', title: 'Most games', art: 'tube', tone: 'sky',
      who: iron.length ? who(iron) : undefined, value: iron.length ? `${mostPlayed} games` : undefined,
      detail: iron.length > 1 ? `${iron.length} players tied` : 'played',
    },
    {
      key: 'rivalry', title: 'Biggest rivalry', art: 'clash', tone: 'teal',
      who: rival && `${name(rival.pair[0])} vs ${name(rival.pair[1])}`, value: rival && `${rival.wins[0]}–${rival.wins[1]}`,
      detail: rival && `Met ${rival.met} times`, empty: 'No two players have faced each other twice',
    },
    {
      key: 'longest', title: 'Longest game', art: 'hourglass', tone: 'indigo',
      who: longest && which(longest), value: longest && gameTime(longest), detail: longest && teams(longest),
    },
    {
      key: 'shortest', title: 'Shortest game', art: 'stopwatch', tone: 'lime',
      who: shortest && which(shortest), value: shortest && gameTime(shortest), detail: shortest && teams(shortest),
      empty: 'No game lasted over a minute',
    },
    {
      key: 'deuce', title: 'Highest deuce', art: 'deuce', tone: 'blue',
      who: deuce && names(sides(deuce)[0]), value: deuce && points(deuce).join('–'),
      detail: deuce && `beat ${names(sides(deuce)[1])} · ${showDate ? shortDate(deuce.date) : which(deuce)}`,
      empty: 'No scored game has gone to deuce (20 all) yet',
    },
    {
      key: 'blowout', title: 'Biggest blowout', art: 'blowout', tone: 'red',
      who: blowout && names(sides(blowout)[0]), value: blowout && points(blowout).join('–'),
      detail:
        blowout &&
        `beat ${names(sides(blowout)[1])} by ${Math.abs(blowout.score![0] - blowout.score![1])} · ${showDate ? shortDate(blowout.date) : which(blowout)}`,
      empty: `No scored game has been won by ${BLOWOUT} or more yet`,
    },
    {
      key: 'early', title: 'Early bird', art: 'sunrise', tone: 'cyan',
      who: arrived.length ? who(early.ids) : undefined,
      value: arrived.length === 1 ? clock(arrived[0].firstAt) : arrived.length ? `${early.times}×` : undefined,
      detail: arrived.length === 1 ? 'first to check in' : often(early.times, 'first to arrive'),
      empty: two,
    },
    {
      key: 'late', title: 'Last to arrive', art: 'moon', tone: 'fuchsia',
      who: arrived.length ? who(late.ids) : undefined,
      value: arrived.length === 1 ? clock(arrived[0].lastAt) : arrived.length ? `${late.times}×` : undefined,
      detail:
        arrived.length === 1
          ? `${Math.round((arrived[0].lastAt - arrived[0].firstAt) / 60_000)} min after the first`
          : often(late.times, 'last to arrive'),
      empty: two,
    },
  ]
}

/** Awards worth celebrating on a shared season recap, best first (no worst duo or losing runs). */
export const HIGHLIGHTS = ['best-duo', 'win-run', 'best-rate', 'most-games', 'rivalry', 'deuce', 'blowout', 'early', 'longest']
