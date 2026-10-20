import { useState } from 'react'
import { heldIds } from '../lib/plan'
import { useStore } from '../store/useStore'
import type { Player } from '../types'
import { PlayerTags } from './ui'

/**
 * Pick four players who asked to play together: the first two tapped are one
 * team, the next two the other.
 */
export function SetGameDialog({ players, onClose }: { players: Map<string, Player>; onClose: () => void }) {
  const session = useStore((s) => s.session)
  const addSetGame = useStore((s) => s.addSetGame)
  const [picked, setPicked] = useState<string[]>([])
  const held = heldIds(session.setGames)
  const choices = session.attendees
    .map((a) => players.get(a.playerId))
    .filter((p): p is Player => !!p && !held.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  const toggle = (id: string) =>
    setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < 4 ? [...ids, id] : ids))

  const save = () => {
    if (picked.length !== 4) return
    addSetGame([picked[0], picked[1]], [picked[2], picked[3]])
    onClose()
  }

  const slot = (i: number) => {
    const p = picked[i] ? players.get(picked[i]) : undefined
    return (
      <span className={`min-w-0 flex-1 truncate ${p ? 'font-semibold' : 'text-slate-400'}`}>{p?.name ?? 'Tap a player'}</span>
    )
  }

  return (
    <div className="d-modal d-modal-open" role="dialog" aria-modal="true">
      <div className="d-modal-box flex max-h-[calc(100%-3rem)] w-full max-w-3xl flex-col gap-4">
        <div>
          <h2 className="text-xl font-bold">Set a game</h2>
          <p className="text-sm text-slate-500">
            Tap the first team, then the second. They skip other games and play next once all four are free.
          </p>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex gap-2 rounded-xl border-l-4 border-teal-500 bg-teal-50 px-3 py-2">
            {slot(0)}
            <span className="text-slate-400">&amp;</span>
            {slot(1)}
          </div>
          <span className="text-xs font-bold text-slate-400">VS</span>
          <div className="flex gap-2 rounded-xl border-l-4 border-amber-400 bg-amber-50 px-3 py-2">
            {slot(2)}
            <span className="text-slate-400">&amp;</span>
            {slot(3)}
          </div>
        </div>
        <div className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2 overflow-y-auto">
          {choices.map((p) => {
            const i = picked.indexOf(p.id)
            const tone =
              i < 0 ? 'border-slate-200 bg-white' : i < 2 ? 'border-teal-500 bg-teal-100' : 'border-amber-400 bg-amber-100'
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                className={`d-btn h-auto min-h-14 justify-between gap-2 rounded-xl border-2 px-3 py-2 text-left font-semibold ${tone}`}
              >
                <span className="leading-tight">{p.name}</span>
                <PlayerTags player={p} />
              </button>
            )
          })}
        </div>
        <div className="d-modal-action mt-0">
          <button className="d-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="d-btn d-btn-primary" disabled={picked.length !== 4} onClick={save}>
            Set game
          </button>
        </div>
      </div>
      <button className="d-modal-backdrop" aria-label="Close" onClick={onClose} />
    </div>
  )
}
