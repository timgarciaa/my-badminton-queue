import { useState } from 'react'
import { rangeLabel, seasonScope, type DateRange, type Scope } from '../lib/scope'
import { seasonImage, shareImage } from '../lib/shareImage'
import { places, playedGames, standings, winRate } from '../lib/stats'
import { usePlayerMap, useStore } from '../store/useStore'
import type { Season, Session } from '../types'
import { ShareIcon } from './Standings'

function TrashIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
    </svg>
  )
}

/** Shares the season as one image: name, dates, totals, the top three and the standings. */
function useShareSeason(season: Season | undefined, sessions: Session[]) {
  const players = usePlayerMap()
  return () => {
    if (!season) return
    const games = playedGames(sessions)
    const ranked = standings(games)
      .filter((r) => players.has(r.id))
      .map((r) => ({ ...r, name: players.get(r.id)!.name }))
    const place = places(ranked)
    const rows = ranked.map((r, i) => ({ ...r, place: place[i] }))
    const minutes = games.length
      ? Math.round(games.reduce((n, g) => n + (g.endedAt! - g.startedAt), 0) / games.length / 60_000)
      : 0
    const pct = (r: (typeof rows)[number]) => {
      const rate = winRate(r)
      return rate === null ? '–' : `${Math.round(rate * 100)}%`
    }
    const podium = [1, 2, 3].flatMap((n) => {
      const top = rows.filter((r) => r.place === n && r.wins > 0)
      if (!top.length) return []
      const r = top[0]
      return [{ place: n, names: top.map((x) => x.name), record: `${r.wins}–${r.losses}`, detail: `${pct(r)} · ${r.played} games` }]
    })
    const image = seasonImage({
      name: season.name,
      dates: rangeLabel(season),
      totals: [
        ['Sessions', String(sessions.filter((x) => x.games.length).length)],
        ['Games', String(games.length)],
        ['Players', String(new Set(sessions.flatMap((x) => x.attendees.map((a) => a.playerId))).size)],
        ['Avg game', `${minutes} min`],
      ],
      podium,
      rows,
    })
    const slug = season.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'season'
    void shareImage(image, `${slug}.png`, season.name)
  }
}

/** Asks before a season is deleted. */
function DeleteSeasonDialog({ season, onCancel, onDelete }: { season: Season; onCancel: () => void; onDelete: () => void }) {
  return (
    <div className="d-modal d-modal-open" role="dialog" aria-modal="true" aria-labelledby="delete-season-title">
      <div className="d-modal-box max-w-md space-y-4">
        <h2 id="delete-season-title" className="text-xl font-bold">
          Delete {season.name}?
        </h2>
        <p className="text-slate-600">
          {season.name} ({rangeLabel(season)}) is removed from the stats picker. The sessions and games in it are kept.
        </p>
        <div className="d-modal-action mt-0">
          <button className="d-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="d-btn d-btn-error" onClick={onDelete}>
            <TrashIcon />
            Delete season
          </button>
        </div>
      </div>
      <button className="d-modal-backdrop" aria-label="Close" onClick={onCancel} />
    </div>
  )
}

/**
 * Under the stats picker when dates are picked or a season is open: the
 * dates, and saving them as a season, or renaming and deleting the season.
 */
export function SeasonBar({
  scope,
  range,
  onRange,
  season,
  sessions,
  onScope,
}: {
  scope: Scope
  range: DateRange
  onRange: (range: DateRange) => void
  season?: Season
  /** The season's sessions, for sharing it. */
  sessions: Session[]
  onScope: (scope: Scope) => void
}) {
  const shareSeason = useShareSeason(season, sessions)
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
          <button
            className="d-btn d-btn-primary d-btn-soft h-11"
            disabled={!sessions.some((x) => x.games.length)}
            onClick={shareSeason}
          >
            <ShareIcon />
            Share season
          </button>
          <button
            className="d-btn d-btn-square d-btn-ghost h-11 w-11 text-rose-700"
            aria-label={`Delete ${season.name}`}
            title={`Delete ${season.name}`}
            onClick={() => setConfirming(true)}
          >
            <TrashIcon />
          </button>
          {confirming && (
            <DeleteSeasonDialog
              season={season}
              onCancel={() => setConfirming(false)}
              onDelete={() => {
                deleteSeason(season.id)
                setConfirming(false)
                onScope('all')
              }}
            />
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
