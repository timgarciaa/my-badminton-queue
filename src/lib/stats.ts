import type { Game, Session } from '../types'

export interface PlayerRecord {
  played: number
  wins: number
  losses: number
}

export const emptyRecord = (): PlayerRecord => ({ played: 0, wins: 0, losses: 0 })

/** Game number within its session (older games fall back to start order). */
export function gameNumber(games: Game[], game: Game): number {
  return game.number ?? games.findIndex((g) => g.id === game.id) + 1
}

/** Finished games, newest first, each with its session date and game number. */
export function finishedGames(sessions: Session[]): (Game & { date: string; number: number })[] {
  return sessions
    .flatMap((s) =>
      s.games.filter((g) => g.endedAt).map((g) => ({ ...g, date: s.date, number: gameNumber(s.games, g) })),
    )
    .sort((a, b) => b.startedAt - a.startedAt)
}

/** Win/loss per player. Games without a recorded winner count as played only. */
export function playerRecords(games: Game[]): Map<string, PlayerRecord> {
  const records = new Map<string, PlayerRecord>()
  const get = (id: string) => {
    let r = records.get(id)
    if (!r) records.set(id, (r = emptyRecord()))
    return r
  }
  for (const g of games) {
    if (!g.endedAt) continue
    for (const [team, ids] of [['A', g.teamA], ['B', g.teamB]] as const) {
      for (const id of ids) {
        const r = get(id)
        r.played++
        if (g.winner === team) r.wins++
        else if (g.winner) r.losses++
      }
    }
  }
  return records
}

export function winRate(r: PlayerRecord): number | null {
  const decided = r.wins + r.losses
  return decided ? r.wins / decided : null
}
