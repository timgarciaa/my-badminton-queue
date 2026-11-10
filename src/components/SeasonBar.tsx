import { useState } from 'react'
import { seasonScope, type DateRange, type Scope } from '../lib/scope'
import { useStore } from '../store/useStore'
import type { Season } from '../types'

/**
 * Under the stats picker when dates are picked or a season is open: the
 * dates, and saving them as a season, or renaming and deleting the season.
 */
export function SeasonBar({
  scope,
  range,
  onRange,
  season,
  onScope,
}: {
  scope: Scope
  range: DateRange
  onRange: (range: DateRange) => void
  season?: Season
  onScope: (scope: Scope) => void
}) {
  const seasons = useStore((s) => s.seasons)
  const addSeason = useStore((s) => s.addSeason)
  const updateSeason = useStore((s) => s.updateSeason)
  const deleteSeason = useStore((s) => s.deleteSeason)
  const [name, setName] = useState('')
  const [confirming, setConfirming] = useState(false)
  if (scope !== 'range' && !season) return null

  const dates = season ?? range
  const setDates = (patch: Partial<DateRange>) => {
    const next = { ...dates, ...patch }
    // Keep the range the right way round.
    if (next.from > next.to) Object.assign(next, patch.from ? { to: next.from } : { from: next.to })
    if (season) updateSeason(season.id, next)
    else onRange(next)
  }
  const suggested = `Season ${seasons.length + 1}`
  const save = () => {
    const id = addSeason({ name: name.trim() || suggested, ...range })
    setName('')
    onScope(seasonScope(id))
  }
  const date = 'd-input w-40 font-semibold tabular-nums'

  return (
    <div className="mx-5 mb-4 flex flex-wrap items-end gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
      {season && (
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-slate-500">Season</span>
          <input
            className="d-input w-48 font-semibold"
            value={season.name}
            aria-label="Season name"
            onChange={(e) => updateSeason(season.id, { name: e.target.value })}
            onBlur={(e) => !e.target.value.trim() && updateSeason(season.id, { name: suggested })}
          />
        </label>
      )}
      <label className="space-y-1">
        <span className="block text-xs font-semibold text-slate-500">From</span>
        <input type="date" className={date} value={dates.from} required onChange={(e) => e.target.value && setDates({ from: e.target.value })} />
      </label>
      <label className="space-y-1">
        <span className="block text-xs font-semibold text-slate-500">To</span>
        <input type="date" className={date} value={dates.to} required onChange={(e) => e.target.value && setDates({ to: e.target.value })} />
      </label>

      {season ? (
        <div className="ml-auto flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-sm text-slate-600">Delete {season.name}? Games are kept.</span>
              <button className="d-btn h-11 border-slate-200 bg-white" onClick={() => setConfirming(false)}>
                Keep
              </button>
              <button
                className="d-btn d-btn-error h-11"
                onClick={() => {
                  deleteSeason(season.id)
                  setConfirming(false)
                  onScope('all')
                }}
              >
                Delete
              </button>
            </>
          ) : (
            <button className="d-btn d-btn-ghost h-11 text-rose-700" onClick={() => setConfirming(true)}>
              Delete season
            </button>
          )}
        </div>
      ) : (
        <form
          className="ml-auto flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <label className="space-y-1">
            <span className="block text-xs font-semibold text-slate-500">Save these dates as</span>
            <input className="d-input w-44" placeholder={suggested} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" className="d-btn d-btn-primary h-10">
            Save season
          </button>
        </form>
      )}
    </div>
  )
}
