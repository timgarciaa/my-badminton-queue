import { useState } from 'react'
import { finishedGames, playerRecords, winRate } from '../lib/stats'
import { EmptyState, PlayerTags } from '../components/ui'
import { usePlayerMap, useStore } from '../store/useStore'
import type { Game, Pair, Player } from '../types'

type Scope = 'today' | 'all'

export function GamesPage() {
  const session = useStore((s) => s.session)
  const history = useStore((s) => s.history)
  const players = usePlayerMap()
  const [scope, setScope] = useState<Scope>('today')

  const games = finishedGames(scope === 'today' ? [session] : [session, ...history])
  const standings = [...playerRecords(games)]
    .map(([id, r]) => ({ id, player: players.get(id), ...r, rate: winRate(r) }))
    .filter((s) => s.player)
    .sort((a, b) => b.wins - a.wins || (b.rate ?? -1) - (a.rate ?? -1) || a.played - b.played)

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <div className="inline-flex rounded-xl bg-white p-1 ring-1 ring-slate-200">
          {(['today', 'all'] as Scope[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`rounded-lg px-5 py-2 font-semibold transition ${
                scope === s ? 'bg-teal-700 text-white' : 'text-slate-500'
              }`}
            >
              {s === 'today' ? 'This session' : 'All time'}
            </button>
          ))}
        </div>
        <p className="text-slate-500">
          {games.length} games · tap a team to change the winner
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_24rem] gap-5">
        <div className="card overflow-y-auto">
          {games.length === 0 ? (
            <div className="p-5">
              <EmptyState>Finished games will show up here.</EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {games.map((g) => (
                <GameRow key={g.id} game={g} players={players} showDate={scope === 'all'} />
              ))}
            </ul>
          )}
        </div>

        <div className="card flex flex-col overflow-hidden">
          <h2 className="border-b border-slate-100 px-5 py-4 text-lg font-bold">Win / loss</h2>
          {standings.length === 0 ? (
            <p className="p-5 text-slate-500">No records yet.</p>
          ) : (
            <div className="overflow-y-auto">
              <table className="w-full text-left tabular-nums">
                <thead className="sticky top-0 bg-white text-xs text-slate-500 uppercase">
                  <tr>
                    <th className="py-2 pl-5">#</th>
                    <th>Player</th>
                    <th className="text-center">P</th>
                    <th className="text-center">W</th>
                    <th className="text-center">L</th>
                    <th className="pr-5 text-right">Win %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {standings.map((s, i) => (
                    <tr key={s.id}>
                      <td className="py-2 pl-5 text-sm text-slate-400">{i + 1}</td>
                      <td>
                        <span className="flex items-center gap-2 font-semibold">
                          <span className="truncate">{s.player!.name}</span>
                          <PlayerTags player={s.player!} />
                        </span>
                      </td>
                      <td className="text-center text-slate-500">{s.played}</td>
                      <td className="text-center font-bold text-emerald-700">{s.wins}</td>
                      <td className="text-center font-bold text-rose-600">{s.losses}</td>
                      <td className="pr-5 text-right">{s.rate === null ? '–' : `${Math.round(s.rate * 100)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function GameRow({
  game,
  players,
  showDate,
}: {
  game: Game & { date: string; number: number }
  players: Map<string, Player>
  showDate: boolean
}) {
  const setWinner = useStore((s) => s.setWinner)
  const mins = Math.round(((game.endedAt ?? game.startedAt) - game.startedAt) / 60_000)
  const time = new Date(game.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  const team = (side: 'A' | 'B', pair: Pair) => {
    const won = game.winner === side
    const lost = game.winner && !won
    return (
      <button
        onClick={() => setWinner(game.id, won ? undefined : side)}
        className={`flex flex-1 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left ring-1 transition active:scale-[0.98] ${
          won ? 'bg-emerald-50 ring-emerald-300' : lost ? 'bg-white opacity-60 ring-slate-200' : 'bg-white ring-slate-200'
        }`}
      >
        <span className="min-w-0 truncate font-semibold">
          {pair.map((id) => players.get(id)?.name ?? '?').join(' & ')}
        </span>
        {won && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">WIN</span>}
      </button>
    )
  }

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="w-28 shrink-0 text-xs text-slate-500">
        <div className="text-sm font-bold text-slate-700">Game {game.number}</div>
        {showDate && <div>{game.date}</div>}
        <div>
          Court {game.court} · {time}
        </div>
        <div>
          {mins} min
          {game.shuttles > 0 && ` · ${game.shuttles} new shuttle${game.shuttles === 1 ? '' : 's'}`}
        </div>
        {game.swap && (
          <div className="text-sky-700">
            {players.get(game.swap.in)?.name} in for {players.get(game.swap.out)?.name}
            {game.swap.also && `, ${players.get(game.swap.also.in)?.name} for ${players.get(game.swap.also.out)?.name}`}
          </div>
        )}
      </div>
      {team('A', game.teamA)}
      <span className="text-xs font-bold text-slate-400">VS</span>
      {team('B', game.teamB)}
    </li>
  )
}
