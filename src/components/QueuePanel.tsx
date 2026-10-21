import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { setIds, type PlannedGame } from '../lib/plan'
import { isSkillMatch, useStore } from '../store/useStore'
import type { GameSwap, Pair, Player, SetGame } from '../types'
import { EmptyState, PlayerTags } from './ui'

const SWAP_REASON: Record<GameSwap['reason'], string> = {
  rematch: " so the same four don't play together again",
  repeat: " so partners don't repeat",
  variety: ' so they play with new people',
  lopsided: ' for a more even game',
}

interface Drag {
  id: string
  x: number
  y: number
  over: string | null
}

/** Player id under a screen point (rows carry data-qid). */
const idAt = (x: number, y: number) =>
  document.elementFromPoint(x, y)?.closest('[data-qid]')?.getAttribute('data-qid') ?? null

/**
 * The queue: the next game as two teams, then the waiting list. Players can
 * be swapped by dragging the grip, by tapping two players, or with the arrows.
 * Any manual change fixes the next game's teams exactly as shown.
 */
export function QueuePanel({
  players,
  plan,
  onGoToCheckIn,
}: {
  players: Map<string, Player>
  plan: { games: PlannedGame[]; rest: string[]; order: string[]; held: string[] }
  onGoToCheckIn: () => void
}) {
  const session = useStore((s) => s.session)
  const setResting = useStore((s) => s.setResting)
  const setManualOrder = useStore((s) => s.setManualOrder)
  const removeSetGame = useStore((s) => s.removeSetGame)
  const clearManual = useStore((s) => s.clearManual)
  const [selected, setSelected] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const resting = session.attendees.filter((a) => a.resting)
  const name = (id: string) => players.get(id)?.name
  const { order } = plan
  const next = plan.games[0]
  const setNext = !!next?.set
  const manual = !setNext && (!!session.nextTeams || !!session.locked?.length)
  // Set game players stay put; everyone else can be moved around them.
  const fixedIds = new Set([...(next && setNext ? setIds(next) : []), ...plan.held])
  const setGames = session.setGames ?? []

  const swapIds = (a: string, b: string) => {
    setSelected(null)
    if (fixedIds.has(a) || fixedIds.has(b)) return
    const i = order.indexOf(a)
    const j = order.indexOf(b)
    if (a === b || i < 0 || j < 0) return
    const o = [...order]
    ;[o[i], o[j]] = [o[j], o[i]]
    setManualOrder(o, [a, b])
  }

  const tap = (id: string) => {
    if (!selected) setSelected(id)
    else if (selected === id) setSelected(null)
    else swapIds(selected, id)
  }

  // Arrows: a next-game player moving down trades places with the first
  // waiting player; waiting players move one spot.
  const movable = order.filter((id) => !fixedIds.has(id))
  const grouped = next && !setNext ? 4 : 0
  const target = (id: string, dir: 1 | -1): string | null => {
    const i = movable.indexOf(id)
    if (i < 0) return null
    if (i < grouped) return dir === 1 ? (movable[grouped] ?? null) : null
    return i + dir >= 0 ? (movable[i + dir] ?? null) : null
  }
  // Dragging uses window listeners so quick drags and lost pointer capture
  // still land; the drop target is whatever row is under the finger.
  const startDrag = (id: string, e: ReactPointerEvent) => {
    e.preventDefault()
    setSelected(null)
    setDrag({ id, x: e.clientX, y: e.clientY, over: null })
    const onMove = (ev: PointerEvent) => setDrag({ id, x: ev.clientX, y: ev.clientY, over: idAt(ev.clientX, ev.clientY) })
    const onEnd = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      setDrag(null)
      const over = ev.type === 'pointerup' ? idAt(ev.clientX, ev.clientY) : null
      if (over && over !== id) swapIds(id, over)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  const rowProps = (id: string) => {
    const up = target(id, -1)
    const down = target(id, 1)
    return {
      id,
      fixed: fixedIds.has(id),
      players,
      selected: selected === id,
      dropTarget: !!drag && drag.over === id && drag.id !== id,
      dragging: drag?.id === id,
      onTap: () => tap(id),
      onUp: up ? () => swapIds(id, up) : undefined,
      onDown: down ? () => swapIds(id, down) : undefined,
      onRest: () => setResting(id, true),
      onGripDown: (e: ReactPointerEvent) => startDrag(id, e),
    }
  }

  if (session.attendees.length === 0) {
    return (
      <EmptyState>
        Nobody checked in yet.{' '}
        <button className="font-semibold text-teal-700 underline" onClick={onGoToCheckIn}>
          Check in players
        </button>
      </EmptyState>
    )
  }

  return (
    <div className="d-card relative block flex-1 overflow-y-auto bg-base-100 shadow-sm">
      {next && (
        <section className="border-b-4 border-slate-100 px-2 pt-2 pb-3">
          <div className="flex items-center gap-2 px-1 pb-1.5">
            <h3 className="text-sm font-bold tracking-wide whitespace-nowrap text-teal-700 uppercase">Next game</h3>
            {setNext && (
              <span className="d-badge d-badge-secondary d-badge-soft d-badge-sm font-semibold">Set game</span>
            )}
            {manual && <span className="d-badge d-badge-ghost d-badge-sm font-semibold whitespace-nowrap">Set by hand</span>}
            <div className="ml-auto flex items-center gap-2">
              {manual && (
                <button className="d-btn d-btn-primary d-btn-soft d-btn-xs" onClick={clearManual}>
                  Auto
                </button>
              )}
              <SkillMatchToggle />
            </div>
          </div>
          <TeamBlock pair={next.teamA} side="A" rowProps={rowProps} />
          <div className="py-1 text-center text-xs font-bold text-slate-400">VS</div>
          <TeamBlock pair={next.teamB} side="B" rowProps={rowProps} />
          {next.swap && (
            <p role="status" className="d-alert d-alert-info d-alert-soft mt-2 block px-2.5 py-1.5 text-xs">
              <strong>{name(next.swap.in)}</strong> moved up for <strong>{name(next.swap.out)}</strong>
              {next.swap.also && (
                <>
                  {' '}
                  and <strong>{name(next.swap.also.in)}</strong> for <strong>{name(next.swap.also.out)}</strong>
                </>
              )}
              {SWAP_REASON[next.swap.reason]}.
            </p>
          )}
          <p className="mt-2 px-1 text-xs text-slate-400">
            {setNext
              ? 'These four asked to play together.'
              : selected
                ? `Tap another player to swap with ${name(selected)}`
                : 'Drag ⠿ or tap two players to swap them'}
          </p>
        </section>
      )}
      {setGames.filter((g) => g.id !== next?.set).length > 0 && (
        <section className="border-b-4 border-slate-100 px-2 pt-2 pb-3">
          <h3 className="px-1 pb-1.5 text-sm font-bold tracking-wide text-violet-700 uppercase">Set games</h3>
          <ul className="space-y-2">
            {setGames
              .filter((g) => g.id !== next?.set)
              .map((g) => (
                <SetGameRow key={g.id} game={g} name={name} onCancel={() => removeSetGame(g.id)} />
              ))}
          </ul>
        </section>
      )}
      {setNext && next && (
        <div className="px-3 pt-2">
          <button className="d-btn d-btn-ghost d-btn-xs text-slate-500" onClick={() => removeSetGame(next.set!)}>
            Cancel set game
          </button>
        </div>
      )}
      {plan.rest.length > 0 && (
        <section className="px-2 pt-2 pb-3">
          <h3 className="px-1 pb-1.5 text-sm font-bold tracking-wide text-slate-400 uppercase">
            {next ? `Waiting (${plan.rest.length})` : `Waiting for ${4 - plan.rest.length} more`}
          </h3>
          <ol className="divide-y divide-slate-100">
            {plan.rest.map((id, i) => (
              <QueueRow key={id} position={i + 1} {...rowProps(id)} />
            ))}
          </ol>
        </section>
      )}
      {resting.length > 0 && (
        <div className="border-t-4 border-slate-100 p-3">
          <p className="mb-2 text-xs font-bold tracking-widest text-slate-400 uppercase">Resting</p>
          <ul className="space-y-1">
            {resting.map((a) => (
              <li key={a.playerId} className="flex items-center gap-2">
                <span className="flex-1 truncate text-slate-500">{name(a.playerId)}</span>
                <button className="d-btn d-btn-sm border-slate-200 bg-white" onClick={() => setResting(a.playerId, false)}>
                  Back in queue
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 rounded-xl bg-white px-4 py-2 text-lg font-semibold shadow-lg ring-2 ring-teal-500"
          style={{ left: drag.x + 14, top: drag.y - 24 }}
        >
          {name(drag.id)}
        </div>
      )}
    </div>
  )
}

type RowProps = Omit<Parameters<typeof QueueRow>[0], 'position'>

function TeamBlock({ pair, side, rowProps }: { pair: Pair; side: 'A' | 'B'; rowProps: (id: string) => RowProps }) {
  return (
    <ul
      className={`space-y-0.5 rounded-xl border-l-4 py-1 ${
        side === 'A' ? 'border-teal-500 bg-teal-50' : 'border-amber-400 bg-amber-50'
      }`}
    >
      {pair.map((id) => (
        <QueueRow key={id} {...rowProps(id)} />
      ))}
    </ul>
  )
}

/** A set game still waiting for some of its players, and why. */
function SetGameRow({ game, name, onCancel }: { game: SetGame; name: (id: string) => string | undefined; onCancel: () => void }) {
  const session = useStore((s) => s.session)
  const status = (id: string) => {
    const court = session.games.find((g) => !g.endedAt && [...g.teamA, ...g.teamB].includes(id))?.court
    if (court) return `on court ${court}`
    const a = session.attendees.find((x) => x.playerId === id)
    if (!a) return 'not checked in'
    if (a.resting) return 'resting'
    return null
  }
  const waitingFor = setIds(game)
    .map((id) => ({ id, why: status(id) }))
    .filter((x) => x.why)
  return (
    <li className="rounded-xl bg-violet-50 px-3 py-2 ring-1 ring-violet-200">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 leading-tight font-semibold">
          <div>{game.teamA.map(name).join(' & ')}</div>
          <div className="text-xs font-bold text-slate-400">VS</div>
          <div>{game.teamB.map(name).join(' & ')}</div>
        </div>
        <button className="d-btn d-btn-xs border-violet-200 bg-white" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="mt-1 text-xs text-violet-800">
        {waitingFor.length
          ? `Waiting for ${waitingFor.map((x) => `${name(x.id)} (${x.why})`).join(', ')}`
          : 'All here · plays after the next game'}
      </p>
    </li>
  )
}

function QueueRow({
  id,
  fixed,
  position,
  players,
  selected,
  dropTarget,
  dragging,
  onTap,
  onUp,
  onDown,
  onRest,
  onGripDown,
}: {
  id: string
  /** Part of a set game: can't be dragged, swapped or moved. */
  fixed: boolean
  /** Place in the waiting list (not shown for the next game). */
  position?: number
  players: Map<string, Player>
  selected: boolean
  dropTarget: boolean
  dragging: boolean
  onTap: () => void
  onUp?: () => void
  onDown?: () => void
  onRest: () => void
  onGripDown: (e: ReactPointerEvent) => void
}) {
  const gamesPlayed = useStore((s) => s.session.attendees.find((a) => a.playerId === id)?.gamesPlayed ?? 0)
  const p = players.get(id)
  return (
    <li
      data-qid={id}
      className={`flex items-center gap-1.5 rounded-lg px-1 py-1.5 transition ${
        selected ? 'bg-sky-100 ring-2 ring-sky-500' : dropTarget ? 'bg-white ring-2 ring-teal-500' : ''
      } ${dragging ? 'opacity-40' : ''}`}
    >
      {fixed ? (
        <span className="w-7 shrink-0" />
      ) : (
        <span
          onPointerDown={onGripDown}
          role="button"
          aria-label={`Drag ${p?.name}`}
          className="flex h-10 w-7 shrink-0 cursor-grab touch-none items-center justify-center text-xl text-slate-400 select-none active:cursor-grabbing"
        >
          ⠿
        </span>
      )}
      {position !== undefined && (
        <span className="w-5 shrink-0 text-right text-sm font-bold text-slate-400 tabular-nums">{position}</span>
      )}
      <button type="button" onClick={fixed ? undefined : onTap} className="min-w-0 flex-1 text-left">
        <div className="text-lg leading-tight font-semibold break-words">{p?.name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
          {p && <PlayerTags player={p} />}
          <span>
            {gamesPlayed} {gamesPlayed === 1 ? 'game' : 'games'}
          </span>
        </div>
      </button>
      {!fixed && (
        <div className="d-join">
          <button
            className="d-btn d-btn-sm d-btn-square d-join-item h-9 w-9 border-slate-200 bg-white"
            onClick={onUp}
            disabled={!onUp}
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            className="d-btn d-btn-sm d-btn-square d-join-item h-9 w-9 border-slate-200 bg-white"
            onClick={onDown}
            disabled={!onDown}
            aria-label="Move down"
          >
            ↓
          </button>
        </div>
      )}
      <button className="d-btn d-btn-sm h-9 border-slate-200 bg-white" onClick={onRest}>
        Rest
      </button>
    </li>
  )
}

/** Off: games ignore skill and only look at fresh partners and new people. */
function SkillMatchToggle() {
  const on = useStore((s) => isSkillMatch(s.session))
  const setSkillMatch = useStore((s) => s.setSkillMatch)
  return (
    <label
      className="flex cursor-pointer items-center gap-1.5 text-xs font-medium whitespace-nowrap text-slate-500"
      title="On: games are evened out by skill. Off: everyone plays with everyone, whatever their skill."
    >
      Match skill
      <input
        type="checkbox"
        className="d-toggle d-toggle-xs d-toggle-primary"
        checked={on}
        onChange={(e) => setSkillMatch(e.target.checked)}
      />
    </label>
  )
}
