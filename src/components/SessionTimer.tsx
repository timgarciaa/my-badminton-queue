import { useState, type CSSProperties } from 'react'
import { useStore } from '../store/useStore'
import { useNow } from './ui'

const WARN_MS = 10 * 60_000

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

function Clock({ ms }: { ms: number }) {
  const sec = Math.floor(ms / 1000)
  const h = Math.floor(sec / 3600)
  return (
    <span className="inline-flex items-baseline font-mono tabular-nums" aria-label={`${h}h ${Math.floor(sec / 60) % 60}m`}>
      <Digits value={h} digits={1} />:<Digits value={Math.floor(sec / 60) % 60} />:<Digits value={sec % 60} />
    </span>
  )
}

/**
 * Start the session for the booked hours (2 by default), then count down to
 * the end of the court booking. Tap the clock to add time or stop it.
 */
export function SessionTimer() {
  const timer = useStore((s) => s.session.timer)
  const startTimer = useStore((s) => s.startTimer)
  const adjustTimer = useStore((s) => s.adjustTimer)
  const stopTimer = useStore((s) => s.stopTimer)
  const [hours, setHours] = useState(2)
  const [open, setOpen] = useState(false)
  const now = useNow()

  if (!timer) {
    return (
      <div className="flex items-center gap-2">
        <div className="d-join">
          <button
            className="d-btn d-join-item h-11 w-10 border-slate-200 bg-white px-0 text-xl"
            disabled={hours <= 0.5}
            onClick={() => setHours((h) => h - 0.5)}
            aria-label="Fewer hours"
          >
            −
          </button>
          <span className="d-join-item flex h-11 min-w-12 items-center justify-center border-y border-slate-200 bg-white font-bold tabular-nums">
            {hours} h
          </span>
          <button
            className="d-btn d-join-item h-11 w-10 border-slate-200 bg-white px-0 text-xl"
            disabled={hours >= 8}
            onClick={() => setHours((h) => h + 0.5)}
            aria-label="More hours"
          >
            +
          </button>
        </div>
        <button className="d-btn d-btn-primary h-11 whitespace-nowrap" onClick={() => startTimer(hours)}>
          Start session
        </button>
      </div>
    )
  }

  const left = timer.startedAt + timer.minutes * 60_000 - now
  const over = left <= 0
  const tone = over
    ? 'bg-rose-600 text-white ring-rose-700 animate-pulse'
    : left <= WARN_MS
      ? 'bg-amber-100 text-amber-900 ring-amber-300'
      : 'bg-teal-50 text-teal-900 ring-teal-200'
  const end = new Date(timer.startedAt + timer.minutes * 60_000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div className="relative">
      <button
        className={`flex items-center gap-2 rounded-xl px-3 py-1.5 ring-1 ${tone}`}
        onClick={() => setOpen((o) => !o)}
        title={`Ends at ${end}`}
      >
        <span className="text-left text-[11px] leading-tight font-semibold uppercase opacity-80">
          {over ? (
            "Time's up"
          ) : (
            <>
              Time
              <br />
              left
            </>
          )}
        </span>
        <span className="text-2xl font-bold">
          {over && '+'}
          <Clock ms={Math.abs(left)} />
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="d-card absolute top-full left-1/2 z-50 mt-2 w-60 -translate-x-1/2 space-y-2 bg-base-100 p-3 shadow-lg">
            <p className="text-center text-sm text-slate-500">
              Ends at <strong className="text-slate-900">{end}</strong>
            </p>
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
                if (confirm('Stop the session timer?')) {
                  stopTimer()
                  setOpen(false)
                }
              }}
            >
              Stop timer
            </button>
          </div>
        </>
      )}
    </div>
  )
}
