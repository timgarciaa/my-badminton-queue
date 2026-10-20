import { useEffect, useRef, useState } from 'react'
import { allSplits, bumpedPlayers, meetCounts, partnerCounts } from '../lib/balance'
import { planGames } from '../lib/plan'
import { QueuePanel } from '../components/QueuePanel'
import { SetGameDialog } from '../components/SetGameDialog'
import { PlayerTags, Stepper, elapsed, useNow } from '../components/ui'
import { gameNumber } from '../lib/stats'
import { usePlayerMap, useStore } from '../store/useStore'
import type { Game, GameSwap, Pair, Player, Session } from '../types'

const SWAP_REASON_SHORT: Record<GameSwap['reason'], string> = {
  rematch: ' · avoids a rematch',
  repeat: ' · fresh partners',
  variety: ' · new people',
  lopsided: ' · more even game',
}


/** Courts shown full size at once at most; the rest fold into strips. */
const MAX_OPEN = 3
/** Narrowest a full court card gets before another court folds. */
const MIN_CARD = 215
const STRIP = 56
const GAP = 16

/** How many courts fit at full size in a row this wide, with the rest as strips. */
function fitCourts(width: number, count: number): number {
  if (!width) return Math.min(MAX_OPEN, count)
  for (let k = Math.min(MAX_OPEN, count); k > 1; k--) {
    if ((width - (count - k) * STRIP - (count - 1) * GAP) / k >= MIN_CARD) return k
  }
  return 1
}

/** Width of an element, kept up to date as it resizes. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
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
      locked: bumpedPlayers(session.games),
      fixed: session.nextTeams,
      sets: session.setGames,
    },
    1,
  )
}

export function SessionPage({ onGoToCheckIn }: { onGoToCheckIn: () => void }) {
  const session = useStore((s) => s.session)
  const setCourtCount = useStore((s) => s.setCourtCount)
  const players = usePlayerMap()
  const [setting, setSetting] = useState(false)

  const plan = planNext(session, players)
  const started = !!session.timer

  // Courts that don't fit at full size fold into narrow strips (an accordion),
  // so court cards keep their size whatever the count.
  const [courtsRef, courtsWidth] = useWidth<HTMLDivElement>()
  const [opened, setOpened] = useState<number[]>([1, 2, 3])
  const count = session.courtCount
  const fits = fitCourts(courtsWidth, count)
  const open = opened.filter((c) => c <= count).slice(-fits)
  for (let c = 1; open.length < fits && c <= count; c++) if (!open.includes(c)) open.push(c)
  // Opening a court folds the one opened longest ago.
  const openCourt = (c: number) => setOpened([...open.filter((x) => x !== c), c].slice(-fits))
  const gameOn = (gameId: string | null) => session.games.find((g) => g.id === gameId)

  return (
    <div className="flex h-full gap-5 p-5">
      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex h-11 items-center justify-between">
          <h2 className="text-xl font-bold">
            Courts
            {fits < count && (
              <span className="ml-3 text-sm font-medium text-slate-500">Tap a folded court to open it</span>
            )}
          </h2>
          <Stepper label="Courts" value={session.courtCount} min={1} max={6} onChange={setCourtCount} />
        </div>
        <div ref={courtsRef} className="flex min-h-0 flex-1 gap-4">
          {session.courts.map((gameId, i) => {
            const game = gameOn(gameId)
            const gameNo = game ? gameNumber(session.games, game) : 0
            return open.includes(i + 1) ? (
              <div key={i} className="flex min-w-0 flex-1 *:flex-1">
                <CourtCard
                  number={i + 1}
                  game={game}
                  gameNo={gameNo}
                  canStart={started && plan.games.length > 0}
                  blocked={!started ? 'Start the session first' : 'Need 4 free players in the queue'}
                  players={players}
                />
              </div>
            ) : (
              <CourtStrip key={i} number={i + 1} game={game} gameNo={gameNo} onOpen={() => openCourt(i + 1)} />
            )
          })}
        </div>
      </section>

      <aside className="flex w-[22rem] shrink-0 flex-col gap-4">
        <div className="flex h-11 items-center justify-between gap-2">
          <h2 className="text-xl font-bold">
            Queue <span className="text-base font-medium text-slate-500">({session.queue.length} waiting)</span>
          </h2>
          {session.attendees.length >= 4 && (
            <button
              className="d-btn h-11 border-slate-200 bg-white whitespace-nowrap"
              disabled={!started}
              title={started ? undefined : 'Start the session first'}
              onClick={() => setSetting(true)}
            >
              Set a game
            </button>
          )}
        </div>
        {setting && <SetGameDialog players={players} onClose={() => setSetting(false)} />}
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
  blocked,
  players,
}: {
  number: number
  game?: Game
  gameNo: number
  canStart: boolean
  /** Why Next game is disabled. */
  blocked: string
  players: Map<string, Player>
}) {
  const startGame = useStore((s) => s.startGame)
  const endGame = useStore((s) => s.endGame)
  const cancelGame = useStore((s) => s.cancelGame)
  const addShuttle = useStore((s) => s.addShuttle)
  const now = useNow()
  const shuttleTypes = useStore((s) => s.session.shuttleTypes)
  const setGameShuttleType = useStore((s) => s.setGameShuttleType)
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
    if (next) startGame(number, next.teamA, next.teamB, next.swap, next.set)
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
      <div className="d-card relative items-center justify-center gap-4 border-2 border-dashed border-slate-300 bg-white/60 p-6">
        <CourtLines className="inset-6 text-slate-300/70" />
        <p className="relative rounded-full bg-slate-50 px-2 text-sm font-bold tracking-widest text-slate-400 uppercase">
          Court {number}
        </p>
        <button className="d-btn d-btn-primary d-btn-lg relative px-8" disabled={!canStart} onClick={start}>
          Next game
        </button>
        <p className={`text-sm text-slate-500 ${canStart ? 'invisible' : ''}`}>{blocked}</p>
      </div>
    )
  }

  const total = (t: Pair) => t.reduce((n, id) => n + skillOf(id), 0)
  const fresh = now - game.startedAt < 2 * 60_000

  return (
    <div className="d-card overflow-hidden bg-gradient-to-b from-emerald-600 to-emerald-700 text-white shadow-sm">
      <div className="flex h-12 items-center justify-between gap-2 px-4">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-sm font-semibold tracking-wide whitespace-nowrap uppercase opacity-80">Court {number}</span>
          <span className="d-badge border-0 bg-white/20 font-black text-white">Game {gameNo}</span>
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums opacity-90">{elapsed(game.startedAt, now)}</span>
      </div>

      {/* Teams centred; the note slot below has a fixed height so all courts line up. */}
      <div className="relative flex flex-1 flex-col justify-center gap-2 px-4">
        <CourtLines className="inset-x-4 inset-y-1 text-white/45" />
        <div className="relative">
          <Team pair={game.teamA} players={players} total={total(game.teamA)} />
        </div>
        <div className="relative flex justify-center">
          <span className="rounded-full bg-emerald-700 px-2 text-xs font-bold text-white/80">VS</span>
        </div>
        <div className="relative">
          <Team pair={game.teamB} players={players} total={total(game.teamB)} />
        </div>
      </div>
      <div className="flex h-16 items-center px-4">
        {game.set && (
          <p className="w-full rounded-lg bg-violet-500/30 px-3 py-1.5 text-xs leading-snug">
            <strong>Set game</strong> · these four asked to play together
          </p>
        )}
        {game.swap && (
          <p className="line-clamp-2 w-full rounded-lg bg-white/10 px-3 py-1.5 text-xs leading-snug">
            <strong>{players.get(game.swap.in)?.name}</strong> in for <strong>{players.get(game.swap.out)?.name}</strong>
            {game.swap.also && (
              <>
                , <strong>{players.get(game.swap.also.in)?.name}</strong> for{' '}
                <strong>{players.get(game.swap.also.out)?.name}</strong>
              </>
            )}
            {SWAP_REASON_SHORT[game.swap.reason]}
          </p>
        )}
      </div>

      <div className="space-y-2 bg-white p-3 text-slate-900">
        {askWinner ? (
          <>
            <p className="text-center text-sm font-bold text-slate-500">Who won?</p>
            {(['A', 'B'] as const).map((side) => (
              <button key={side} className="d-btn d-btn-primary w-full" onClick={() => finish(side)}>
                <span className="truncate">{teamName(side === 'A' ? game.teamA : game.teamB)}</span>
              </button>
            ))}
            <div className="flex gap-2">
              <button className="d-btn flex-1" onClick={() => finish()}>
                No result
              </button>
              <button className="d-btn flex-1" onClick={() => setAskWinner(false)}>
                Back
              </button>
            </div>
          </>
        ) : (
          <>
            {shuttleTypes && shuttleTypes.length > 1 && (
              <label className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-500">Shuttle</span>
                <select
                  className="d-select w-36 min-w-0 font-semibold"
                  // Older games have no type; they count as the first one.
                  value={shuttleTypes.some((t) => t.id === game.shuttleType) ? game.shuttleType : shuttleTypes[0].id}
                  onChange={(e) => setGameShuttleType(game.id, e.target.value)}
                >
                  {shuttleTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 text-sm leading-tight font-medium text-slate-500">New shuttles</span>
              <Stepper value={game.shuttles} onChange={(n) => addShuttle(game.id, n - game.shuttles)} />
            </div>
            <button className="d-btn d-btn-primary d-btn-lg w-full" onClick={() => setAskWinner(true)}>
              End game
            </button>
            {/* Always takes the same space so the cards stay the same shape. */}
            <div className={`flex gap-2 ${fresh ? '' : 'invisible'}`}>
              <button className="d-btn d-btn-sm flex-1" onClick={repair} title="Try another pairing">
                Re-pair
              </button>
              <button
                className="d-btn d-btn-sm flex-1"
                onClick={() => cancelGame(game.id)}
                title="Send players back to the front of the queue"
              >
                Undo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** A folded court: number, game and time on court. Tap to open it. */
function CourtStrip({
  number,
  game,
  gameNo,
  onOpen,
}: {
  number: number
  game?: Game
  gameNo: number
  onOpen: () => void
}) {
  const now = useNow()
  return (
    <button
      onClick={onOpen}
      aria-label={`Open court ${number}`}
      className={`d-card w-16 shrink-0 items-center gap-3 py-4 transition active:scale-[0.97] ${
        game
          ? 'bg-gradient-to-b from-emerald-600 to-emerald-700 text-white shadow-sm'
          : 'border-2 border-dashed border-slate-300 bg-white/60 text-slate-500'
      }`}
    >
      <span className="text-2xl font-black">{number}</span>
      <span className="text-xs font-bold tracking-widest uppercase [writing-mode:vertical-rl]">
        Court {number} · {game ? `Game ${gameNo}` : 'Free'}
      </span>
      {game && (
        <span className="font-mono text-sm font-semibold tabular-nums [writing-mode:vertical-rl]">
          {elapsed(game.startedAt, now)}
        </span>
      )}
      <svg viewBox="0 0 24 24" className="mt-auto h-6 w-6 opacity-70" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}

function Team({ pair, players, total }: { pair: Pair; players: Map<string, Player>; total: number }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-emerald-700/90 px-3 py-2 ring-1 ring-white/25">
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
      <span className="text-xs font-semibold whitespace-nowrap opacity-75" title="Team skill total">
        Σ {total}
      </span>
    </div>
  )
}

/**
 * Badminton doubles court markings (13.4 m × 6.1 m), seen from above with the
 * net across the middle. Stretched to fill its box; lines keep their width.
 */
function CourtLines({ className = '' }: { className?: string }) {
  const line = { vectorEffect: 'non-scaling-stroke' as const }
  return (
    // An SVG doesn't stretch to absolute insets on its own, so a box sets its size.
    <div className={`pointer-events-none absolute ${className}`} aria-hidden>
      <svg
        viewBox="0 0 610 1340"
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <rect x="0" y="0" width="610" height="1340" {...line} />
        {/* Singles sidelines */}
        <path d="M46 0V1340M564 0V1340" {...line} />
        {/* Long service lines for doubles, and short service lines */}
        <path d="M0 76H610M0 1264H610M0 472H610M0 868H610" {...line} />
        {/* Centre lines */}
        <path d="M305 0V472M305 868V1340" {...line} />
        {/* Net */}
        <path d="M-12 670H622" strokeWidth={4} strokeDasharray="6 3" {...line} />
      </svg>
    </div>
  )
}
