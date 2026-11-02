import { useState } from 'react'
import { CalendarIcon } from '../components/SessionTimer'
import { EmptyState, Stepper, useNow } from '../components/ui'
import { at, clash, clock, dayLabel, duration, minutesOf, sameDay, STEP_MINUTES, timeRange, upcoming, weekly } from '../lib/schedule'
import { useStore } from '../store/useStore'
import type { ScheduledGame } from '../types'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Start times offered: 6:00 AM to 11:30 PM. */
const STARTS = Array.from({ length: (24 * 60 - 6 * 60) / STEP_MINUTES }, (_, i) => 6 * 60 + i * STEP_MINUTES)
const LENGTHS = [60, 90, 120, 150, 180, 240]
const REPEATS = [1, 4, 8, 12]
const DEFAULT_START = 16 * 60

const minuteLabel = (m: number) => clock(at(new Date(2026, 0, 1), m))
const monthOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)

/**
 * Book games ahead: each one starts the session by itself at its time and
 * counts down to its end. A month calendar to pick the day, the games coming
 * up, and Start now for a game that wasn't booked.
 */
export function SchedulePage() {
  const schedule = useStore((s) => s.schedule)
  const now = useNow(30_000)
  const [day, setDay] = useState(() => new Date())
  const [month, setMonth] = useState(() => monthOf(new Date()))
  const [editing, setEditing] = useState<ScheduledGame | null>(null)
  const coming = upcoming(schedule, now)

  // Weeks of the month shown, Sunday first.
  const first = new Date(month)
  first.setDate(1 - first.getDay())
  const days = Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i))
  const weeks = days[35].getMonth() === month.getMonth() ? 6 : 5
  const gamesOn = (d: Date) => coming.filter((g) => sameDay(new Date(g.start), d))
  const today = new Date(now)

  const move = (delta: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1))

  return (
    <div className="grid h-full grid-cols-[1fr_24rem] gap-5 p-5">
      <section className="d-card d-card-border flex min-h-0 flex-col overflow-hidden bg-base-100 shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="flex-1 text-xl font-bold">
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <button
            className="d-btn d-btn-sm d-btn-ghost"
            onClick={() => {
              setMonth(monthOf(today))
              setDay(today)
            }}
          >
            Today
          </button>
          <button className="d-btn d-btn-square d-btn-sm" aria-label="Previous month" onClick={() => move(-1)}>
            ‹
          </button>
          <button className="d-btn d-btn-square d-btn-sm" aria-label="Next month" onClick={() => move(1)}>
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 border-b border-slate-100 text-center text-xs font-bold tracking-wide text-slate-500 uppercase">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
          {days.slice(0, weeks * 7).map((d) => {
            const inMonth = d.getMonth() === month.getMonth()
            const past = d < new Date(today.getFullYear(), today.getMonth(), today.getDate())
            const chosen = sameDay(d, day)
            const games = gamesOn(d)
            return (
              <button
                key={d.toISOString()}
                className={`flex min-h-0 flex-col items-start gap-1 overflow-hidden border-r border-b border-slate-100 p-1.5 text-left transition ${
                  chosen ? 'bg-teal-50 ring-2 ring-teal-600 ring-inset' : 'hover:bg-slate-50'
                } ${inMonth ? '' : 'bg-slate-50/60'}`}
                aria-pressed={chosen}
                aria-label={`${dayLabel(d.getTime())}${games.length ? `, ${games.length} ${games.length === 1 ? 'game' : 'games'}` : ''}`}
                onClick={() => {
                  setDay(d)
                  setEditing(null)
                }}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                    sameDay(d, today) ? 'bg-teal-700 text-white' : past || !inMonth ? 'text-slate-300' : 'text-slate-700'
                  }`}
                >
                  {d.getDate()}
                </span>
                {games.slice(0, 2).map((g) => (
                  <span
                    key={g.id}
                    className="w-full truncate rounded-md bg-teal-600 px-1.5 py-0.5 text-[11px] font-semibold text-white"
                    title={timeRange(g.start, g.end)}
                  >
                    {clock(g.start)}
                  </span>
                ))}
                {games.length > 2 && <span className="text-[11px] text-slate-500">+{games.length - 2} more</span>}
              </button>
            )
          })}
        </div>
      </section>

      <div className="min-h-0 space-y-4 overflow-y-auto">
        <GameForm
          key={`${day.toDateString()}-${editing?.id ?? 'new'}`}
          day={day}
          now={now}
          editing={editing}
          onDone={() => setEditing(null)}
        />

        <section className="d-card d-card-border bg-base-100 shadow-sm">
          <div className="d-card-body gap-2 p-4">
            <h2 className="d-card-title text-lg">Coming up</h2>
            {coming.length === 0 ? (
              <EmptyState>No games booked. Pick a day on the calendar to add one.</EmptyState>
            ) : (
              <ul className="-mx-1 divide-y divide-slate-100">
                {coming.slice(0, 12).map((g) => (
                  <Upcoming
                    key={g.id}
                    game={g}
                    now={now}
                    editing={editing?.id === g.id}
                    onEdit={() => {
                      setDay(new Date(g.start))
                      setMonth(monthOf(new Date(g.start)))
                      setEditing(g)
                    }}
                  />
                ))}
              </ul>
            )}
            {coming.length > 12 && <p className="text-xs text-slate-500">+{coming.length - 12} more later on the calendar</p>}
          </div>
        </section>

        <StartNow />
      </div>
    </div>
  )
}

/** Add a game on the chosen day (optionally every week), or change a booked one. */
function GameForm({
  day,
  now,
  editing,
  onDone,
}: {
  day: Date
  now: number
  editing: ScheduledGame | null
  onDone: () => void
}) {
  const schedule = useStore((s) => s.schedule)
  const scheduleGames = useStore((s) => s.scheduleGames)
  const rescheduleGame = useStore((s) => s.rescheduleGame)
  const [start, setStart] = useState(() => (editing ? minutesOf(editing.start) : DEFAULT_START))
  const [length, setLength] = useState(() => (editing ? Math.round((editing.end - editing.start) / 60_000) : 120))
  const [weeks, setWeeks] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)

  const from = at(day, start)
  const to = from + length * 60_000
  const games = editing ? [{ start: from, end: to }] : weekly(from, to, weeks)
  const ended = to <= now
  const lengths = LENGTHS.includes(length) ? LENGTHS : [...LENGTHS, length].sort((a, b) => a - b)

  const submit = () => {
    setAdded(null)
    if (ended) return setError('That time has already passed.')
    const other = games.map((g) => clash(schedule, g.start, g.end, editing?.id)).find(Boolean)
    if (other) return setError(`It overlaps the ${dayLabel(other.start)} ${timeRange(other.start, other.end)} game.`)
    const ok = editing ? rescheduleGame(editing.id, from, to) : scheduleGames(games)
    if (!ok) return setError('It overlaps another game.')
    setError(null)
    if (editing) onDone()
    else setAdded(weeks > 1 ? `Added ${weeks} games, every ${day.toLocaleDateString(undefined, { weekday: 'long' })}.` : 'Added.')
  }

  return (
    <section className="d-card d-card-border bg-base-100 shadow-sm">
      <div className="d-card-body gap-3 p-4">
        <h2 className="d-card-title text-lg">
          <CalendarIcon className="h-5 w-5 text-teal-700" />
          {editing ? 'Change game' : 'Add a game'} · {dayLabel(day.getTime())}
        </h2>
        <label className="block">
          <span className="text-sm font-semibold text-slate-600">Starts</span>
          <select className="d-select mt-1 w-full font-semibold" value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {!STARTS.includes(start) && <option value={start}>{minuteLabel(start)}</option>}
            {STARTS.map((m) => (
              <option key={m} value={m}>
                {minuteLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="text-sm font-semibold text-slate-600">Court time</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {lengths.map((m) => (
              <button
                key={m}
                type="button"
                className={`d-btn d-btn-sm ${m === length ? 'd-btn-primary' : 'border-slate-200 bg-white'}`}
                aria-pressed={m === length}
                onClick={() => setLength(m)}
              >
                {duration(m * 60_000)}
              </button>
            ))}
          </div>
        </div>
        {!editing && (
          <label className="block">
            <span className="text-sm font-semibold text-slate-600">Repeat</span>
            <select className="d-select mt-1 w-full font-semibold" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
              {REPEATS.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? 'Just this day' : `Every ${day.toLocaleDateString(undefined, { weekday: 'long' })} for ${n} weeks`}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-900">
          <strong>{timeRange(from, to)}</strong>. The session starts by itself at {clock(from)} and counts down to {clock(to)}
          {weeks > 1 && !editing ? `, each week until ${dayLabel(games[games.length - 1].start)}` : ''}.
        </p>
        {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
        {added && <p className="text-sm font-semibold text-teal-700">{added}</p>}
        <div className="flex gap-2">
          <button className="d-btn d-btn-primary flex-1" disabled={ended} onClick={submit}>
            {editing ? 'Save changes' : weeks > 1 ? `Add ${weeks} games` : 'Add game'}
          </button>
          {editing && (
            <button className="d-btn d-btn-ghost" onClick={onDone}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function Upcoming({ game, now, editing, onEdit }: { game: ScheduledGame; now: number; editing: boolean; onEdit: () => void }) {
  const unscheduleGame = useStore((s) => s.unscheduleGame)
  const live = game.start <= now
  return (
    <li className={`flex items-center gap-2 px-1 py-2 ${editing ? 'rounded-lg bg-teal-50' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">
          {sameDay(new Date(game.start), new Date(now)) ? 'Today' : dayLabel(game.start)}
          {live && <span className="d-badge d-badge-sm d-badge-success d-badge-soft ml-2 font-bold">Waiting to start</span>}
        </div>
        <div className="text-sm text-slate-500">
          {timeRange(game.start, game.end)} · {duration(game.end - game.start)}
        </div>
      </div>
      <button className="d-btn d-btn-ghost d-btn-sm" onClick={onEdit}>
        Change
      </button>
      <button
        className="d-btn d-btn-ghost d-btn-sm text-rose-700"
        onClick={() => confirm(`Delete the ${dayLabel(game.start)} ${timeRange(game.start, game.end)} game?`) && unscheduleGame(game.id)}
      >
        Delete
      </button>
    </li>
  )
}

/** For a game that wasn't booked: start the session now for some hours. */
function StartNow() {
  const timer = useStore((s) => s.session.timer)
  const startTimer = useStore((s) => s.startTimer)
  const [hours, setHours] = useState(2)
  if (timer) return null
  return (
    <section className="d-card d-card-border bg-base-100 shadow-sm">
      <div className="d-card-body gap-2 p-4">
        <h2 className="d-card-title text-lg">Playing now?</h2>
        <p className="text-sm text-slate-500">Start a game that wasn&apos;t booked, right away.</p>
        <div className="flex items-center justify-between gap-2">
          <Stepper value={hours} min={0.5} max={8} step={0.5} onChange={setHours} label="Hours" />
          <button className="d-btn d-btn-primary" onClick={() => startTimer(hours)}>
            Start now
          </button>
        </div>
      </div>
    </section>
  )
}
