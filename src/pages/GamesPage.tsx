import { useState } from 'react'
import { Standings } from '../components/Standings'
import { finishedGames, longDate } from '../lib/stats'
import { EmptyState } from '../components/ui'
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
  // Games still missing a winner; out-of-hours games have their result.
  const pending = (g: Game) => !g.winner && !g.outOfHours
  const noResult = games.filter(pending).length
  const shown = games
    .filter((g) => show === 'all' || pending(g))
    .filter((g) => !focus || [...g.teamA, ...g.teamB].includes(focus))
  const focused = focus ? players.get(focus) : undefined
  const sessions = history.filter((h) => h.games.length).length + (session.games.length ? 1 : 0)

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

      <Standings
        games={games}
        title={scope === 'today' ? 'Standings' : 'All-time standings'}
        subtitle={
          scope === 'today'
            ? `${longDate(session.date)} · ${games.length} ${games.length === 1 ? 'game' : 'games'}`
            : `${sessions} ${sessions === 1 ? 'session' : 'sessions'} · ${games.length} games`
        }
        filename={`standings-${scope === 'today' ? session.date : 'all-time'}.png`}
        focus={focus}
        onFocus={setFocus}
      />
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
  const setOutOfHours = useStore((s) => s.setOutOfHours)
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
      className={`d-card d-card-border bg-base-100 px-3 py-2.5 ${
        game.winner ? '' : game.outOfHours ? 'border-l-4 border-l-slate-300' : 'border-l-4 border-l-amber-400'
      }`}
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
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-31 text-xs">
          {!game.winner &&
            (game.outOfHours ? (
              <span className="font-semibold text-slate-500">Out of hours · no winner</span>
            ) : (
              <span className="font-semibold text-amber-700">No result yet</span>
            ))}
          {!game.winner && (
            <button
              className={`d-btn d-btn-sm ${game.outOfHours ? 'd-btn-ghost text-slate-500' : 'd-btn-warning d-btn-soft'}`}
              onClick={() => setOutOfHours(game.id, !game.outOfHours)}
              title={game.outOfHours ? 'Back to no result' : 'The court time ran out before this game finished'}
            >
              {game.outOfHours ? 'Undo' : 'Mark out of hours'}
            </button>
          )}
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
