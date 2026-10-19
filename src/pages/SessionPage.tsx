import { useState } from 'react'
import { allSplits, meetCounts, partnerCounts } from '../lib/balance'
import { planGames } from '../lib/plan'
import { QueuePanel } from '../components/QueuePanel'
import { nextFour } from '../lib/queue'
import { PlayerTags, Stepper, elapsed, useNow } from '../components/ui'
import { gameNumber } from '../lib/stats'
import { usePlayerMap, useStore } from '../store/useStore'
import type { Game, GameSwap, Pair, Player, Session } from '../types'

const SWAP_REASON_SHORT: Record<GameSwap['reason'], string> = {
  rematch: ' · avoids a rematch',
  repeat: ' · fresh partners',
  lopsided: ' · more even game',
}


/** Plan the next game exactly as the queue shows it and Next game starts it. */
function planNext(session: Session, players: Map<string, Player>) {
  return planGames(
    session.queue,
    (id) => players.get(id)?.skill ?? 3,
    {
      partners: partnerCounts(session.games),
      met: meetCounts(session.games),
      genderOf: (id) => players.get(id)?.gender,
      autoSwap: !session.locked?.length,
      fixed: session.nextTeams,
    },
    1,
  )
}

export function SessionPage({ onGoToCheckIn }: { onGoToCheckIn: () => void }) {
  const session = useStore((s) => s.session)
  const setCourtCount = useStore((s) => s.setCourtCount)
  const players = usePlayerMap()

  const four = nextFour(session.queue)
  const plan = planNext(session, players)

  return (
    <div className="flex h-full gap-5 p-5">
      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Courts</h2>
          <Stepper label="Courts" value={session.courtCount} min={1} max={6} onChange={setCourtCount} />
        </div>
        <div
          className="grid flex-1 auto-rows-fr gap-4"
          style={{ gridTemplateColumns: `repeat(${Math.min(session.courtCount, 3)}, minmax(0, 1fr))` }}
        >
          {session.courts.map((gameId, i) => (
            <CourtCard
              key={i}
              number={i + 1}
              game={session.games.find((g) => g.id === gameId)}
              gameNo={gameId ? gameNumber(session.games, session.games.find((g) => g.id === gameId)!) : 0}
              canStart={!!four}
              players={players}
            />
          ))}
        </div>
      </section>

      <aside className="flex w-[22rem] shrink-0 flex-col gap-3">
        <h2 className="text-xl font-bold">
          Queue <span className="text-base font-medium text-slate-500">({session.queue.length} waiting)</span>
        </h2>
        <QueuePanel players={players} plan={plan} onGoToCheckIn={onGoToCheckIn} />
      </aside>
    </div>
  )
}

function CourtCard({
  number,
  game,
  gameNo,
  canStart,
  players,
}: {
  number: number
  game?: Game
  gameNo: number
  canStart: boolean
  players: Map<string, Player>
}) {
  const startGame = useStore((s) => s.startGame)
  const endGame = useStore((s) => s.endGame)
  const cancelGame = useStore((s) => s.cancelGame)
  const addShuttle = useStore((s) => s.addShuttle)
  const now = useNow()
  const [askWinner, setAskWinner] = useState(false)
  const skillOf = (id: string) => players.get(id)?.skill ?? 3
  const teamName = (t: Pair) => t.map((id) => players.get(id)?.name ?? '?').join(' & ')

  const finish = (winner?: 'A' | 'B') => {
    if (game) endGame(game.id, winner)
    setAskWinner(false)
  }

  const start = () => {
    // Same plan the queue previews, including any automatic swap or manual teams.
    const [next] = planNext(useStore.getState().session, players).games
    if (next) startGame(number, next.teamA, next.teamB, next.swap)
  }

  // Cycle to the next of the 3 possible pairings for these four players.
  const repair = () => {
    if (!game) return
    const four = [...game.teamA, ...game.teamB]
    const splits = allSplits(four, skillOf).sort((a, b) => a.diff - b.diff)
    const key = (p: Pair) => [...p].sort().join('|')
    const idx = splits.findIndex((s) => key(s.teamA) === key(game.teamA) || key(s.teamB) === key(game.teamA))
    const next = splits[(idx + 1) % splits.length]
    useStore.setState((st) => ({
      session: {
        ...st.session,
        games: st.session.games.map((g) => (g.id === game.id ? { ...g, teamA: next.teamA, teamB: next.teamB } : g)),
      },
    }))
  }

  if (!game) {
    return (
      <div className="card flex flex-col items-center justify-center gap-4 border-2 border-dashed border-slate-200 p-6 shadow-none">
        <p className="text-sm font-bold tracking-widest text-slate-400 uppercase">Court {number}</p>
        <button className="btn-primary px-8 py-4 text-lg" disabled={!canStart} onClick={start}>
          Next game
        </button>
        {!canStart && <p className="text-sm text-slate-500">Need 4 players in the queue</p>}
      </div>
    )
  }

  const total = (t: Pair) => t.reduce((n, id) => n + skillOf(id), 0)
  const fresh = now - game.startedAt < 2 * 60_000

  return (
    <div className="card flex flex-col overflow-hidden bg-gradient-to-b from-emerald-600 to-emerald-700 text-white ring-emerald-800">
      <div className="flex items-center justify-between px-4 pt-3 text-sm font-semibold">
        <span className="flex items-center gap-2">
          <span className="tracking-widest uppercase opacity-80">Court {number}</span>
          <span className="rounded-lg bg-white/20 px-2.5 py-0.5 text-base font-black">Game {gameNo}</span>
        </span>
        <span className="tabular-nums opacity-90">{elapsed(game.startedAt, now)}</span>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-2 px-4 py-3">
        <Team pair={game.teamA} players={players} total={total(game.teamA)} />
        <div className="flex items-center gap-2 text-xs font-bold opacity-70">
          <div className="h-px flex-1 bg-white/40" /> VS <div className="h-px flex-1 bg-white/40" />
        </div>
        <Team pair={game.teamB} players={players} total={total(game.teamB)} />
        {game.swap && (
          <p className="rounded-lg bg-white/10 px-3 py-1.5 text-xs leading-snug">
            <strong>{players.get(game.swap.in)?.name}</strong> swapped in for{' '}
            <strong>{players.get(game.swap.out)?.name}</strong>
            {SWAP_REASON_SHORT[game.swap.reason]}
          </p>
        )}
      </div>
      {askWinner ? (
        <div className="space-y-2 bg-white p-3 text-slate-900">
          <p className="text-center text-sm font-bold text-slate-500">Who won?</p>
          {(['A', 'B'] as const).map((side) => (
            <button key={side} className="btn-primary w-full py-2.5" onClick={() => finish(side)}>
              <span className="truncate">{teamName(side === 'A' ? game.teamA : game.teamB)}</span>
            </button>
          ))}
          <div className="flex gap-2">
            <button className="btn-ghost flex-1 py-2 text-sm" onClick={() => finish()}>
              No result
            </button>
            <button className="btn-ghost flex-1 py-2 text-sm" onClick={() => setAskWinner(false)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 bg-white p-3 text-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-x-2">
            <span className="text-sm font-medium whitespace-nowrap text-slate-500">New shuttles</span>
            <Stepper value={game.shuttles} onChange={(n) => addShuttle(game.id, n - game.shuttles)} />
          </div>
          <button className="btn-primary w-full" onClick={() => setAskWinner(true)}>
            End game
          </button>
          {fresh && (
            <div className="flex gap-2">
              <button className="btn-ghost flex-1 py-2 text-sm whitespace-nowrap" onClick={repair} title="Try another pairing">
                Re-pair
              </button>
              <button
                className="btn-ghost flex-1 py-2 text-sm whitespace-nowrap"
                onClick={() => cancelGame(game.id)}
                title="Send players back to the front of the queue"
              >
                Undo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Team({ pair, players, total }: { pair: Pair; players: Map<string, Player>; total: number }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2">
      <div className="min-w-0 flex-1 space-y-1">
        {pair.map((id) => {
          const p = players.get(id)
          return (
            <div key={id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-lg leading-tight font-semibold break-words">{p?.name ?? '?'}</span>
              {p && <PlayerTags player={p} />}
            </div>
          )
        })}
      </div>
      <span className="text-xs font-semibold opacity-75">Σ {total}</span>
    </div>
  )
}
