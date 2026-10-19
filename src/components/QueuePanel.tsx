import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { PlannedGame } from '../lib/plan'
import { useStore } from '../store/useStore'
import type { GameSwap, Pair, Player } from '../types'
import { EmptyState, PlayerTags } from './ui'

const SWAP_REASON: Record<GameSwap['reason'], string> = {
  rematch: " so the same four don't play together again",
  repeat: " so partners don't repeat",
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
  plan: { games: PlannedGame[]; rest: string[]; order: string[] }
  onGoToCheckIn: () => void
}) {
  const session = useStore((s) => s.session)
  const setResting = useStore((s) => s.setResting)
  const setManualOrder = useStore((s) => s.setManualOrder)
  const clearManual = useStore((s) => s.clearManual)
  const [selected, setSelected] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const resting = session.attendees.filter((a) => a.resting)
  const name = (id: string) => players.get(id)?.name
  const { order } = plan
  const next = plan.games[0]
  const manual = !!session.nextTeams || !!session.locked?.length

  const swapIds = (a: string, b: string) => {
    setSelected(null)
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
  const grouped = next ? 4 : 0
  const target = (id: string, dir: 1 | -1): string | null => {
    const i = order.indexOf(id)
    if (i < 0) return null
    if (i < grouped) return dir === 1 ? (order[grouped] ?? null) : null
    return i + dir >= 0 ? (order[i + dir] ?? null) : null
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
    <div className="card relative flex-1 overflow-y-auto">
      {next && (
        <section className="border-b-4 border-slate-100 px-2 pt-2 pb-3">
          <div className="flex items-center gap-2 px-1 pb-1.5">
            <h3 className="text-sm font-bold tracking-wide text-teal-700 uppercase">Next game</h3>
            {manual && (
              <>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  Set by hand
                </span>
                <button className="ml-auto text-sm font-semibold text-teal-700 underline" onClick={clearManual}>
                  Auto
                </button>
              </>
            )}
          </div>
          <TeamBlock pair={next.teamA} side="A" rowProps={rowProps} />
          <div className="py-1 text-center text-xs font-bold text-slate-400">VS</div>
          <TeamBlock pair={next.teamB} side="B" rowProps={rowProps} />
          {next.swap && (
            <p className="mt-2 rounded-lg bg-sky-50 px-2.5 py-1.5 text-xs text-sky-800 ring-1 ring-sky-200">
              <strong>{name(next.swap.in)}</strong> moved up for <strong>{name(next.swap.out)}</strong>
              {SWAP_REASON[next.swap.reason]}.
            </p>
          )}
          <p className="mt-2 px-1 text-xs text-slate-400">
            {selected ? `Tap another player to swap with ${name(selected)}` : 'Drag ⠿ or tap two players to swap them'}
          </p>
        </section>
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
                <button className="btn-ghost h-9 px-3 py-0 text-xs" onClick={() => setResting(a.playerId, false)}>
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

function QueueRow({
  id,
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
      <span
        onPointerDown={onGripDown}
        role="button"
        aria-label={`Drag ${p?.name}`}
        className="flex h-10 w-7 shrink-0 cursor-grab touch-none items-center justify-center text-xl text-slate-400 select-none active:cursor-grabbing"
      >
        ⠿
      </span>
      {position !== undefined && (
        <span className="w-5 shrink-0 text-right text-sm font-bold text-slate-400 tabular-nums">{position}</span>
      )}
      <button type="button" onClick={onTap} className="min-w-0 flex-1 text-left">
        <div className="text-lg leading-tight font-semibold break-words">{p?.name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
          {p && <PlayerTags player={p} />}
          <span>
            {gamesPlayed} {gamesPlayed === 1 ? 'game' : 'games'}
          </span>
        </div>
      </button>
      <button className="btn-ghost h-9 w-9 p-0" onClick={onUp} disabled={!onUp} aria-label="Move up">
        ↑
      </button>
      <button className="btn-ghost h-9 w-9 p-0" onClick={onDown} disabled={!onDown} aria-label="Move down">
        ↓
      </button>
      <button className="btn-ghost h-9 px-2 py-0 text-xs" onClick={onRest}>
        Rest
      </button>
    </li>
  )
}
