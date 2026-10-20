import { useState } from 'react'
import { finishedGames, playerRecords, winRate } from '../lib/stats'
import { EmptyState, PlayerTags } from '../components/ui'
import { usePlayerMap, useStore } from '../store/useStore'
import type { Game, GameSwap, Pair, Player } from '../types'

type Scope = 'today' | 'all'
type Show = 'all' | 'noresult'

const SWAP_REASON: Record<GameSwap['reason'], string> = {
  rematch: 'avoids a rematch',
  repeat: 'fresh partners',
  variety: 'new people',
  lopsided: 'more even game',
}

export function GamesPage() {
  const session = useStore((s) => s.session)
  const history = useStore((s) => s.history)
  const players = usePlayerMap()
  const [scope, setScope] = useState<Scope>('today')
  const [show, setShow] = useState<Show>('all')
  const [focus, setFocus] = useState<string | null>(null)

  const games = finishedGames(scope === 'today' ? [session] : [session, ...history])
  const noResult = games.filter((g) => !g.winner).length
  const shown = games
    .filter((g) => show === 'all' || !g.winner)
    .filter((g) => !focus || [...g.teamA, ...g.teamB].includes(focus))
  const standings = [...playerRecords(games)]
    .map(([id, r]) => ({ id, player: players.get(id), ...r, rate: winRate(r) }))
    .filter((s) => s.player)
    .sort((a, b) => b.wins - a.wins || (b.rate ?? -1) - (a.rate ?? -1) || a.played - b.played)
  const focused = focus ? players.get(focus) : undefined

  return (
    <div className="grid h-full grid-cols-[1fr_24rem] gap-5 p-5">
      <section className="d-card d-card-border bg-base-100 shadow-sm flex min-w-0 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div role="tablist" className="d-tabs d-tabs-box d-tabs-sm">
            {(['today', 'all'] as Scope[]).map((s) => (
              <button
                key={s}
                role="tab"
                className={`d-tab font-semibold ${scope === s ? 'd-tab-active' : ''}`}
                onClick={() => setScope(s)}
              >
                {s === 'today' ? 'This session' : 'All time'}
              </button>
            ))}
          </div>
          <div role="tablist" className="d-tabs d-tabs-border">
            <button
              role="tab"
              className={`d-tab gap-1.5 font-semibold ${show === 'all' ? 'd-tab-active' : ''}`}
              onClick={() => setShow('all')}
            >
              All games <span className="d-badge d-badge-sm d-badge-ghost">{games.length}</span>
            </button>
            <button
              role="tab"
              className={`d-tab gap-1.5 font-semibold ${show === 'noresult' ? 'd-tab-active' : ''}`}
              onClick={() => setShow('noresult')}
            >
              No result
              <span className={`d-badge d-badge-sm ${noResult ? 'd-badge-warning' : 'd-badge-ghost'}`}>{noResult}</span>
            </button>
          </div>
          {focused && (
            <button className="d-btn d-btn-sm d-btn-primary d-btn-soft ml-auto" onClick={() => setFocus(null)}>
              {focused.name}&apos;s games
              <span aria-hidden>✕</span>
            </button>
          )}
        </div>
        <p className="px-4 pt-3 text-xs text-slate-500">Tap a team to set or change the winner. Tap it again to clear.</p>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2">
          {shown.length === 0 ? (
            <EmptyState>
              {games.length === 0
                ? 'Finished games will show up here.'
                : show === 'noresult'
                  ? 'Every game has a result.'
                  : 'No games match.'}
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {shown.map((g) => (
                <GameRow key={g.id} game={g} players={players} showDate={scope === 'all'} focus={focus} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="d-card d-card-border bg-base-100 shadow-sm flex flex-col overflow-hidden">
        <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-lg font-bold">Standings</h2>
          <span className="text-xs text-slate-500">Tap a player to see their games</span>
        </div>
        {standings.length === 0 ? (
          <p className="p-5 text-slate-500">No records yet.</p>
        ) : (
          <div className="overflow-y-auto">
            <table className="d-table d-table-pin-rows d-table-sm tabular-nums">
              <thead>
                <tr className="bg-white">
                  <th className="w-8">#</th>
                  <th>Player</th>
                  <th className="text-center">W</th>
                  <th className="text-center">L</th>
                  <th className="text-right">Win %</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => (
                  <tr
                    key={s.id}
                    className={`cursor-pointer ${focus === s.id ? 'bg-teal-50' : 'hover:bg-slate-50'}`}
                    onClick={() => setFocus(focus === s.id ? null : s.id)}
                  >
                    <td>
                      <span
                        className={`d-badge d-badge-sm w-6 font-bold ${
                          i === 0
                            ? 'bg-amber-300 text-amber-950'
                            : i === 1
                              ? 'bg-slate-300 text-slate-800'
                              : i === 2
                                ? 'bg-orange-200 text-orange-900'
                                : 'd-badge-ghost'
                        }`}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 truncate text-base font-semibold">{s.player!.name}</span>
                        <PlayerTags player={s.player!} />
                      </span>
                      <span className="text-xs text-slate-400">{s.played} played</span>
                    </td>
                    <td className="text-center text-base font-bold text-emerald-700">{s.wins}</td>
                    <td className="text-center text-base font-bold text-rose-600">{s.losses}</td>
                    <td className="text-right">
                      <span className="font-semibold">{s.rate === null ? '–' : `${Math.round(s.rate * 100)}%`}</span>
                      {s.rate !== null && (
                        <progress className="d-progress d-progress-success block h-1 w-14" value={s.rate} max={1} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function GameRow({
  game,
  players,
  showDate,
  focus,
}: {
  game: Game & { date: string; number: number }
  players: Map<string, Player>
  showDate: boolean
  focus: string | null
}) {
  const setWinner = useStore((s) => s.setWinner)
  const shuttleTypes = useStore((s) => s.session.shuttleTypes)
  const mins = Math.round(((game.endedAt ?? game.startedAt) - game.startedAt) / 60_000)
  const time = new Date(game.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const name = (id: string) => players.get(id)?.name ?? '?'
  const shuttle =
    shuttleTypes && shuttleTypes.length > 1 ? shuttleTypes.find((t) => t.id === game.shuttleType)?.name : undefined

  const team = (side: 'A' | 'B', pair: Pair) => {
    const won = game.winner === side
    const lost = !!game.winner && !won
    return (
      <button
        onClick={() => setWinner(game.id, won ? undefined : side)}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left transition active:scale-[0.98] ${
          won
            ? 'border-emerald-300 bg-emerald-50'
            : lost
              ? 'border-slate-200 bg-white text-slate-400'
              : 'border-slate-200 bg-white'
        }`}
      >
        <span className="min-w-0 flex-1 leading-tight">
          {pair.map((id) => (
            <span key={id} className={`block truncate font-semibold ${id === focus ? 'text-teal-700 underline' : ''}`}>
              {name(id)}
            </span>
          ))}
        </span>
        {won && <span className="d-badge d-badge-success d-badge-sm font-bold">WIN</span>}
      </button>
    )
  }

  return (
    <li
      className={`d-card d-card-border bg-base-100 px-3 py-2.5 ${game.winner ? '' : 'border-l-4 border-l-amber-400'}`}
    >
      <div className="flex items-center gap-3">
        <div className="w-28 shrink-0">
          <p className="font-bold text-slate-800">Game {game.number}</p>
          <p className="text-xs text-slate-500">
            {showDate && `${game.date} · `}Court {game.court} · {time}
          </p>
          <p className="text-xs text-slate-500">
            {mins} min
            {game.shuttles > 0 && ` · ${game.shuttles} ${shuttle ?? 'new'}`}
          </p>
        </div>
        {team('A', game.teamA)}
        <span className="text-xs font-bold text-slate-400">VS</span>
        {team('B', game.teamB)}
      </div>
      {(game.swap || game.set || !game.winner) && (
        <p className="mt-1.5 flex flex-wrap gap-x-3 pl-31 text-xs">
          {!game.winner && <span className="font-semibold text-amber-700">No result yet</span>}
          {game.set && <span className="font-semibold text-violet-700">Set game</span>}
          {game.swap && (
            <span className="text-sky-700">
              {name(game.swap.in)} in for {name(game.swap.out)}
              {game.swap.also && `, ${name(game.swap.also.in)} for ${name(game.swap.also.out)}`} ·{' '}
              {SWAP_REASON[game.swap.reason]}
            </span>
          )}
        </p>
      )}
    </li>
  )
}
