import { useEffect, useRef, useState } from 'react'
import { allSplits, bumpedPlayers, meetCounts, partnerCounts } from '../lib/balance'
import { gameShuttleType, shuttlesInStock } from '../lib/cost'
import { matchSkill, planGames, winnersStayGame } from '../lib/plan'
import { QueuePanel } from '../components/QueuePanel'
import { SetGameDialog } from '../components/SetGameDialog'
import { PlayerTags, Stepper, elapsed, useNow } from '../components/ui'
import { gameNumber, helpFrom, playedGames, sessionsWithin } from '../lib/stats'
import { isHelpStruggling, isSkillMatch, isWinnersStay, isWinnersTogether, usePlayerMap, useStore } from '../store/useStore'
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

/**
 * Plan the next game exactly as the queue shows it and Next game starts it.
 * Help for struggling players looks at the last 3 months, today included.
 */
function planNext(session: Session, players: Map<string, Player>, history: Session[]) {
  const help = isHelpStruggling(session) ? helpFrom(playedGames(sessionsWithin([session, ...history], 3))) : undefined
  return planGames(
    session.queue,
    matchSkill((id) => players.get(id)?.skill ?? 3, isSkillMatch(session)),
    {
      partners: partnerCounts(session.games),
      met: meetCounts(session.games),
      genderOf: (id) => players.get(id)?.gender,
      autoSwap: !session.locked?.length,
      locked: bumpedPlayers(session.games),
      fixed: session.nextTeams,
      sets: session.setGames,
      help,
    },
    1,
  )
}

export function SessionPage({ onGoToCheckIn }: { onGoToCheckIn: () => void }) {
  const session = useStore((s) => s.session)
  const setCourtCount = useStore((s) => s.setCourtCount)
  const players = usePlayerMap()
  const [setting, setSetting] = useState(false)

  const history = useStore((s) => s.history)
  const plan = planNext(session, players, history)
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
  const rotateWinners = useStore((s) => s.rotateWinners)
  const winnersStay = useStore((s) => isWinnersStay(s.session, number))
  const together = useStore((s) => isWinnersTogether(s.session, number))
  const cancelGame = useStore((s) => s.cancelGame)
  const addShuttle = useStore((s) => s.addShuttle)
  const now = useNow()
  const session = useStore((s) => s.session)
  const shuttleTypes = session.shuttleTypes
  const setGameShuttleType = useStore((s) => s.setGameShuttleType)
  const [askWinner, setAskWinner] = useState(false)
  const skillOf = (id: string) => players.get(id)?.skill ?? 3
  const teamName = (t: Pair) => t.map((id) => players.get(id)?.name ?? '?').join(' & ')

  const finish = (winner?: 'A' | 'B', outOfHours = false) => {
    setAskWinner(false)
    if (!game) return
    const s = useStore.getState().session
    if (winner && isWinnersStay(s, game.court)) {
      // Winners stay on, split up, each with one of the next two in line.
      const winners = winner === 'A' ? game.teamA : game.teamB
      const resting = winners.some((id) => s.attendees.find((a) => a.playerId === id)?.resting)
      const plan = planNext(s, players, useStore.getState().history)
      const waiting = plan.order.filter((id) => !plan.held.includes(id))
      const split = !isWinnersTogether(s, game.court)
      const skill = matchSkill(skillOf, isSkillMatch(s))
      const next = !resting && winnersStayGame(winners, waiting, skill, partnerCounts(s.games), split)
      if (next) return rotateWinners(game.id, winner, next.teamA, next.teamB)
    }
    endGame(game.id, winner, outOfHours)
  }

  const start = () => {
    // Same plan the queue previews, including any automatic swap or manual teams.
    const { session: current, history } = useStore.getState()
    const [next] = planNext(current, players, history).games
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
        <WinnersStayToggle court={number} className="relative flex-col gap-1.5 rounded-xl bg-slate-50 px-3 py-1.5" />
      </div>
    )
  }

  const total = (t: Pair) => t.reduce((n, id) => n + skillOf(id), 0)
  const fresh = now - game.startedAt < 2 * 60_000
  const timer = session.timer
  const timeUp = !!timer && now >= timer.startedAt + timer.minutes * 60_000

  return (
    <div className="d-card relative overflow-hidden bg-gradient-to-b from-emerald-600 to-emerald-700 text-white shadow-sm">
      <div className="flex h-12 items-center justify-between gap-2 px-4">
        <span className="flex min-w-0 items-center gap-1.5">
          <MoveCourt game={game} number={number} />
          <span className="d-badge border-0 bg-white/20 font-black text-white">Game {gameNo}</span>
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums opacity-90">{elapsed(game.startedAt, now)}</span>
      </div>

      {/* Teams centred; the note slot below has a fixed height so all courts line up. */}
      <div className="relative flex flex-1 flex-col justify-center gap-2 px-4">
        <CourtLines className="inset-x-4 inset-y-1 text-white/45" />
        {/* Before the teams so it flies under their names. */}
        <FlyingShuttle />
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
        {game.stayed && (
          <p className="line-clamp-2 w-full rounded-lg bg-amber-400/25 px-3 py-1.5 text-xs leading-snug">
            <strong>{teamName(game.stayed)}</strong> won and stayed on
            {game.teamA.every((id) => game.stayed!.includes(id)) || game.teamB.every((id) => game.stayed!.includes(id))
              ? ' together'
              : ', split up'}
          </p>
        )}
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
            {winnersStay && (
              <p className="-mt-1 text-center text-xs text-slate-500">
                {together ? 'Winners stay on together' : 'Winners stay on and split up'}; losers go to the queue.
              </p>
            )}
            {(['A', 'B'] as const).map((side) => (
              <button key={side} className="d-btn d-btn-primary w-full" onClick={() => finish(side)}>
                <span className="truncate">{teamName(side === 'A' ? game.teamA : game.teamB)}</span>
              </button>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <button className="d-btn" onClick={() => finish()}>
                No result
              </button>
              <button
                className={`d-btn ${timeUp ? 'd-btn-warning' : ''}`}
                onClick={() => finish(undefined, true)}
                title="The game didn't finish because the court time ran out"
              >
                Out of hours
              </button>
            </div>
            <button className="d-btn d-btn-ghost d-btn-sm w-full" onClick={() => setAskWinner(false)}>
              Back
            </button>
          </>
        ) : (
          <>
            {shuttleTypes && shuttleTypes.length > 1 && (
              <label className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-500">Shuttle</span>
                <select
                  className="d-select w-36 min-w-0 font-semibold"
                  // Older games have no type; they count as the first one.
                  value={gameShuttleType(session, game)}
                  onChange={(e) => setGameShuttleType(game.id, e.target.value)}
                >
                  {shuttleTypes.map((t) => {
                    // The game's shuttles move with it, so the type needs that many in stock.
                    const out = t.id !== gameShuttleType(session, game) && shuttlesInStock(session, t.id) < game.shuttles
                    return (
                      <option key={t.id} value={t.id} disabled={out}>
                        {t.name}
                        {out && ' (out)'}
                      </option>
                    )
                  })}
                </select>
              </label>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 text-sm leading-tight font-medium text-slate-500">New shuttles</span>
              <Stepper
                value={game.shuttles}
                max={Math.min(999, game.shuttles + shuttlesInStock(session, gameShuttleType(session, game)))}
                onChange={(n) => addShuttle(game.id, n - game.shuttles)}
              />
            </div>
            {/* Game format sits apart from the shuttle settings above. */}
            <WinnersStayToggle court={number} className="w-full justify-between border-t border-slate-100 pt-2" />
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

/** Random number between a and b. */
const between = (a: number, b: number) => a + Math.random() * (b - a)

/**
 * A shuttlecock rallying over a court with a game on. Every shot goes to a
 * random spot on the other side (straight, cross-court, short or deep), cork
 * first, growing near the top of its arc. Off when Reduce Motion is on.
 */
function FlyingShuttle() {
  const box = useRef<HTMLDivElement>(null)
  const shuttle = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const el = shuttle.current
    const area = box.current
    if (!el || !area || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let x = between(20, 80)
    let y = between(10, 30)
    let stopped = false
    let current: Animation | undefined
    const shot = () => {
      if (stopped) return
      // Land anywhere on the far half: near the net for a drop, deep for a clear.
      const toTop = y > 50
      const nx = between(10, 90)
      const ny = toTop ? between(6, 44) : between(56, 94)
      const { width, height } = area.getBoundingClientRect()
      const dx = ((nx - x) / 100) * width
      const dy = ((ny - y) / 100) * height
      // The cork points down at 0°; turn it to face where it's going.
      const angle = (Math.atan2(-dx, dy) * 180) / Math.PI
      const at = (px: number, py: number, scale: number) => ({
        left: `${px}%`,
        top: `${py}%`,
        transform: `translate(-50%, -50%) rotate(${angle}deg) scale(${scale})`,
      })
      // Higher, slower shots for long ones; a little random either way.
      const long = Math.abs(ny - y) / 88
      current = el.animate(
        [at(x, y, 0.85), { ...at((x + nx) / 2, (y + ny) / 2, 1.1 + long * 0.4), offset: 0.45 }, at(nx, ny, 0.85)],
        { duration: between(700, 1000) + long * 700, easing: 'cubic-bezier(.3,.6,.6,1)', fill: 'forwards' },
      )
      x = nx
      y = ny
      // A short pause while the player gets to it, then the return.
      current.onfinish = () => window.setTimeout(shot, between(80, 260))
    }
    shot()
    return () => {
      stopped = true
      current?.cancel()
    }
  }, [])
  return (
    <div ref={box} className="pointer-events-none absolute inset-x-4 inset-y-1" aria-hidden>
      <svg
        ref={shuttle}
        viewBox="0 0 20 28"
        className="absolute h-7 w-5 drop-shadow-[0_3px_3px_rgba(0,0,0,0.35)] motion-reduce:hidden"
      >
        {/* Feather skirt, then the cork at the front */}
        <path d="M4 1h12l-3.5 17h-5z" fill="white" />
        <path d="M7 1.5l1.6 16.5M10 1v17M13 1.5l-1.6 16.5" stroke="#cbd5e1" strokeWidth="0.8" />
        <path d="M4.6 6h10.8M5.6 11h8.8" stroke="#cbd5e1" strokeWidth="0.8" />
        <rect x="7.6" y="17" width="4.8" height="2" rx="0.5" fill="#0f766e" />
        <path d="M7.6 19h4.8v3.5a2.4 2.4 0 0 1-4.8 0z" fill="#fef3c7" />
      </svg>
    </div>
  )
}

/**
 * The court label on a game in progress. Tap it to move the game to another
 * court when players went to the wrong one; a game already there swaps over.
 */
function MoveCourt({ game, number }: { game: Game; number: number }) {
  const session = useStore((s) => s.session)
  const moveGame = useStore((s) => s.moveGame)
  const [open, setOpen] = useState(false)
  const label = 'text-sm font-semibold tracking-wide whitespace-nowrap uppercase'
  if (session.courts.length < 2) return <span className={`${label} opacity-80`}>Court {number}</span>

  return (
    <>
      <button
        className={`${label} -ml-2 flex h-10 items-center gap-1.5 rounded-lg bg-white/15 px-2 ring-1 ring-white/25 active:bg-white/30`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Court ${number}: move this game to another court`}
        title="Move this game to another court"
      >
        Court {number}
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 8h15l-4-4M20 16H5l4 4" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Spans the card, so it fits however narrow the court is. */}
          <div role="menu" className="d-card absolute inset-x-2 top-12 z-50 bg-base-100 p-2 text-slate-900 shadow-lg">
            <p className="px-2 pt-1 pb-1.5 text-xs font-semibold text-slate-500">Move this game to</p>
            {session.courts.map((id, i) => {
              const court = i + 1
              if (court === number) return null
              const there = id ? session.games.find((g) => g.id === id) : undefined
              return (
                <button
                  key={court}
                  role="menuitem"
                  className="flex min-h-12 w-full items-center gap-2 rounded-lg px-2 text-left active:bg-slate-200"
                  onClick={() => {
                    moveGame(game.id, court)
                    setOpen(false)
                  }}
                >
                  <span className="font-bold whitespace-nowrap">Court {court}</span>
                  <span className="ml-auto text-right text-sm text-slate-500">
                    {there ? `Swap with Game ${gameNumber(session.games, there)}` : 'Free'}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </>
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
    <div className="flex items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 ring-1 ring-white/25">
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

/** Turn winners stay on or off for one court. */
function WinnersStayToggle({ court, className = '' }: { court: number; className?: string }) {
  const on = useStore((s) => isWinnersStay(s.session, court))
  const together = useStore((s) => isWinnersTogether(s.session, court))
  const setWinnersStay = useStore((s) => s.setWinnersStay)
  const setWinnersSplit = useStore((s) => s.setWinnersSplit)
  return (
    <div className={`flex items-center gap-3 text-sm font-medium text-slate-500 ${className}`}>
      <label
        className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap"
        title="After a game, the losers go to the queue and the winners stay on"
      >
        Winners stay
        <input
          type="checkbox"
          className="d-toggle d-toggle-sm d-toggle-primary"
          checked={on}
          onChange={(e) => setWinnersStay(court, e.target.checked)}
        />
      </label>
      {on && (
        <label
          className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap"
          title="On: the winners split up, each with one of the next two players. Off: they stay together and the next two challenge them."
        >
          Split up
          <input
            type="checkbox"
            className="d-toggle d-toggle-sm d-toggle-primary"
            checked={!together}
            onChange={(e) => setWinnersSplit(court, e.target.checked)}
          />
        </label>
      )}
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
