import { shareImage, standingsImage } from '../lib/shareImage'
import { ordinal, places, standings } from '../lib/stats'
import { usePlayerMap } from '../store/useStore'
import type { Game } from '../types'
import { PlayerTags } from './ui'

/** Colours for 1st, 2nd and 3rd place: the badge and the bracket joining ties. */
const MEDAL: Record<number, { badge: string; bracket: string }> = {
  1: { badge: 'bg-amber-300 text-amber-950', bracket: 'border-amber-400' },
  2: { badge: 'bg-slate-300 text-slate-800', bracket: 'border-slate-400' },
  3: { badge: 'bg-orange-200 text-orange-900', bracket: 'border-orange-300' },
}

export function ShareIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
    </svg>
  )
}

/**
 * Standings for the given games, with a Share button that sends them as an
 * image (instead of a screenshot). Tapping a player calls onFocus, if given.
 */
export function Standings({
  games,
  title,
  subtitle,
  filename,
  focus,
  onFocus,
  className = '',
}: {
  games: Game[]
  /** For the shared image, e.g. "All-time standings". */
  title: string
  subtitle: string
  filename: string
  focus?: string | null
  onFocus?: (id: string | null) => void
  className?: string
}) {
  const players = usePlayerMap()
  const ranked = standings(games)
    .map((s) => ({ ...s, player: players.get(s.id) }))
    .filter((s) => s.player)
  const place = places(ranked)
  /** How many players share the place of row i. */
  const tied = (i: number) => place.filter((p) => p === place[i]).length

  const share = () => {
    const rows = ranked.map((s, i) => ({ ...s, name: s.player!.name, place: place[i] }))
    void shareImage(standingsImage(rows, { title, subtitle }), filename, title)
  }

  return (
    <section className={`d-card d-card-border bg-base-100 shadow-sm flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-lg font-bold">Standings</h2>
          {onFocus && <p className="text-xs text-slate-500">Tap a player to see their games</p>}
        </div>
        <button className="d-btn d-btn-primary d-btn-soft h-11" disabled={ranked.length === 0} onClick={share}>
          <ShareIcon />
          Share
        </button>
      </div>
      {ranked.length === 0 ? (
        <p className="p-5 text-slate-500">No records yet.</p>
      ) : (
        <div className="overflow-y-auto">
          {/* Fixed columns: a long name is shortened instead of pushing W, L and Win % off the panel. */}
          <table className="d-table d-table-pin-rows d-table-sm w-full table-fixed tabular-nums">
            <thead>
              <tr className="bg-white">
                <th className="w-16">#</th>
                <th>Player</th>
                <th className="w-11 text-center">W</th>
                <th className="w-11 text-center">L</th>
                <th className="w-[4.5rem] text-right">Win %</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((s, i) => (
                <tr
                  key={s.id}
                  className={onFocus ? `cursor-pointer ${focus === s.id ? 'bg-teal-50' : 'hover:bg-slate-50'}` : ''}
                  onClick={onFocus && (() => onFocus(focus === s.id ? null : s.id))}
                >
                  {/* One place per tie, bracketing the tied rows. */}
                  {place[i] !== place[i - 1] && (
                    <td rowSpan={tied(i)} className="relative px-2">
                      <span className={`d-badge d-badge-sm w-10 font-bold ${MEDAL[place[i]]?.badge ?? 'd-badge-ghost'}`}>
                        {ordinal(place[i])}
                      </span>
                      {tied(i) > 1 && (
                        <span
                          aria-label={`${tied(i)} tied`}
                          className={`absolute top-3 right-1 bottom-3 w-2 rounded-l-md border-y-2 border-l-2 ${
                            MEDAL[place[i]]?.bracket ?? 'border-slate-300'
                          }`}
                        />
                      )}
                    </td>
                  )}
                  <td>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-base font-semibold" title={s.player!.name}>
                        {s.player!.name}
                      </span>
                      <PlayerTags player={s.player!} />
                    </span>
                    <span className="text-xs text-slate-400">{s.played} played</span>
                  </td>
                  <td className="text-center text-base font-bold text-emerald-700">{s.wins}</td>
                  <td className="text-center text-base font-bold text-rose-600">{s.losses}</td>
                  <td className="text-right">
                    <span className="font-semibold">{s.rate === null ? '–' : `${Math.round(s.rate * 100)}%`}</span>
                    {s.rate !== null && (
                      <progress className="d-progress d-progress-success ml-auto block h-1 w-full" value={s.rate} max={1} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
