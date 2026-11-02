import { useState, type CSSProperties } from 'react'
import { clock, dayLabel, dueGame, sameDay, timeRange, upcoming } from '../lib/schedule'
import { useStore } from '../store/useStore'
import { useNow } from './ui'

const WARN_MS = 10 * 60_000
const DAY_MS = 24 * 60 * 60_000

/** One rolling daisyUI countdown digit group. */
function Digits({ value, digits = 2 }: { value: number; digits?: number }) {
  return (
    <span className="d-countdown">
      <span style={{ '--d-value': value, '--d-digits': digits } as CSSProperties} aria-hidden>
        {value}
      </span>
    </span>
  )
}

/** h:mm:ss, never below 0:00:00. */
function Clock({ ms }: { ms: number }) {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(sec / 3600)
  return (
    <span className="inline-flex items-baseline font-mono tabular-nums" aria-label={`${h}h ${Math.floor(sec / 60) % 60}m`}>
      <Digits value={h} digits={1} />:<Digits value={Math.floor(sec / 60) % 60} />:<Digits value={sec % 60} />
    </span>
  )
}

function Label({ children }: { children: [string, string] }) {
  return (
    <span className="text-left text-[11px] leading-tight font-semibold uppercase opacity-80">
      {children[0]}
      <br />
      {children[1]}
    </span>
  )
}

/**
 * The session clock in the header. Before play: the next scheduled game,
 * counting down on the day (the session starts by itself then). During play:
 * time left until the booking ends, stopping at 0:00:00. Tap for more.
 */
export function SessionTimer({ onSchedule, onCosts }: { onSchedule: () => void; onCosts: () => void }) {
  const timer = useStore((s) => s.session.timer)
  const schedule = useStore((s) => s.schedule)
  const adjustTimer = useStore((s) => s.adjustTimer)
  const stopTimer = useStore((s) => s.stopTimer)
  const [open, setOpen] = useState(false)
  const now = useNow()

  if (!timer) {
    const next = upcoming(schedule, now)[0]
    if (!next) {
      return (
        <button className="d-btn d-btn-primary h-11 whitespace-nowrap" onClick={onSchedule}>
          <CalendarIcon />
          Schedule a game
        </button>
      )
    }
    const soon = next.start - now < DAY_MS
    return (
      <button
        className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-1.5 text-slate-800 ring-1 ring-slate-200"
        onClick={onSchedule}
        title={`${dayLabel(next.start)}, ${timeRange(next.start, next.end)}. Starts by itself.`}
      >
        {soon ? (
          <>
            <Label>{['Starts', 'in']}</Label>
            <span className="text-2xl font-bold">
              <Clock ms={next.start - now} />
            </span>
          </>
        ) : (
          <>
            <Label>{['Next', 'game']}</Label>
            <span className="text-left leading-tight">
              <span className="block font-bold">{dayLabel(next.start)}</span>
              <span className="block text-sm text-slate-500">{timeRange(next.start, next.end)}</span>
            </span>
          </>
        )}
      </button>
    )
  }

  const endsAt = timer.startedAt + timer.minutes * 60_000
  const left = endsAt - now
  const over = left <= 0
  // A booked game that can't start until this (finished) session is ended.
  const waiting = over && dueGame(schedule, now)
  const tone = waiting
    ? 'bg-amber-100 text-amber-900 ring-amber-300'
    : over
      ? 'bg-rose-600 text-white ring-rose-700'
      : left <= WARN_MS
        ? 'bg-amber-100 text-amber-900 ring-amber-300'
        : 'bg-teal-50 text-teal-900 ring-teal-200'
  const end = clock(endsAt)

  return (
    <div className="relative">
      <button
        className={`flex items-center gap-2 rounded-xl px-3 py-1.5 ring-1 ${tone}`}
        onClick={() => setOpen((o) => !o)}
        title={`Ends at ${end}`}
      >
        <Label>{waiting ? ['Next game', 'waiting'] : over ? ["Time's", 'up'] : ['Time', 'left']}</Label>
        <span className="text-2xl font-bold">
          <Clock ms={left} />
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="d-card absolute top-full left-1/2 z-50 mt-2 w-64 -translate-x-1/2 space-y-2 bg-base-100 p-3 shadow-lg">
            {waiting ? (
              <>
                <p className="text-sm text-slate-600">
                  The {sameDay(new Date(waiting.start), new Date(now)) ? '' : `${dayLabel(waiting.start)} `}
                  {timeRange(waiting.start, waiting.end)} game starts once this session is ended on Costs.
                </p>
                <button
                  className="d-btn d-btn-primary d-btn-sm w-full"
                  onClick={() => {
                    setOpen(false)
                    onCosts()
                  }}
                >
                  Go to Costs
                </button>
              </>
            ) : (
              <p className="text-center text-sm text-slate-500">
                {over ? 'Ended' : 'Ends'} at <strong className="text-slate-900">{end}</strong>
              </p>
            )}
            <div className="flex gap-2">
              <button className="d-btn d-btn-sm flex-1" disabled={timer.minutes <= 30} onClick={() => adjustTimer(-30)}>
                −30 min
              </button>
              <button className="d-btn d-btn-sm flex-1" onClick={() => adjustTimer(30)}>
                +30 min
              </button>
            </div>
            <button
              className="d-btn d-btn-error d-btn-soft d-btn-sm w-full"
              onClick={() => {
                if (confirm('Stop the session clock? Games can’t start until it runs again.')) {
                  stopTimer()
                  setOpen(false)
                }
              }}
            >
              Stop clock
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function CalendarIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />
    </svg>
  )
}
