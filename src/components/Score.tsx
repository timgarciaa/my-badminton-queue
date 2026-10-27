import { useState } from 'react'
import { parseScore, scoreLeader } from '../lib/stats'
import { NumberField } from './NumberPad'
import { useStore } from '../store/useStore'
import type { Game } from '../types'

/** A team's points, up to 99, typed on the app's number pad. */
export function PointsInput({
  value,
  onChange,
  label,
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  label: string
  className?: string
}) {
  return (
    <NumberField
      className={`w-16 px-1 text-xl font-bold ${className}`}
      maxLength={2}
      label={label}
      value={value}
      onChange={onChange}
    />
  )
}

/** Add, change or clear a finished game's score. */
export function ScoreDialog({
  game,
  title,
  teamName,
  onClose,
}: {
  game: Game
  title: string
  teamName: (side: 'A' | 'B') => string
  onClose: () => void
}) {
  const setScore = useStore((s) => s.setScore)
  const [points, setPoints] = useState<[string, string]>(
    game.score ? [String(game.score[0]), String(game.score[1])] : ['', ''],
  )
  const score = parseScore(points)
  const lead = scoreLeader(score)
  const stopped = game.outOfHours && !game.winner
  const save = (s?: [number, number]) => {
    setScore(game.id, s)
    onClose()
  }

  return (
    <div className="d-modal d-modal-open" role="dialog" aria-modal="true" aria-labelledby="score-title">
      <form
        className="d-modal-box max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (score) save(score)
        }}
      >
        <h2 id="score-title" className="text-xl font-bold">
          {title}
        </h2>
        <div className="space-y-2">
          {(['A', 'B'] as const).map((side, i) => (
            <label
              key={side}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                lead === side && !stopped ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-semibold">{teamName(side)}</span>
              {lead === side && !stopped && <span className="d-badge d-badge-success d-badge-sm font-bold">WIN</span>}
              <PointsInput
                label={`Points for ${teamName(side)}`}
                value={points[i]}
                onChange={(v) => setPoints((p) => (i === 0 ? [v, p[1]] : [p[0], v]))}
              />
            </label>
          ))}
        </div>
        {!stopped && game.winner && lead && lead !== game.winner ? (
          <p className="text-sm font-semibold text-amber-700">
            This changes the winner to {teamName(lead)}.
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            {stopped
              ? 'Out of hours: the score is where the game stopped, with no winner.'
              : score && !lead
                ? 'A tie leaves the game without a winner.'
                : 'The team with more points is the winner.'}
          </p>
        )}
        <div className="d-modal-action mt-0 justify-between">
          {game.score ? (
            <button type="button" className="d-btn d-btn-ghost text-rose-700" onClick={() => save(undefined)}>
              Clear score
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className="d-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="d-btn d-btn-primary" disabled={!score}>
              Save
            </button>
          </div>
        </div>
      </form>
      <button className="d-modal-backdrop" aria-label="Close" onClick={onClose} />
    </div>
  )
}
