import type { ScheduledGame } from '../types'

export const MINUTE = 60_000
/** Times offered for a game: every 30 minutes. */
export const STEP_MINUTES = 30

/** Upcoming games, soonest first (and not ended). */
export const upcoming = (schedule: ScheduledGame[], now: number) =>
  schedule.filter((g) => g.end > now).sort((a, b) => a.start - b.start)

/** The game that should be on now: started and not yet over. */
export const dueGame = (schedule: ScheduledGame[], now: number) =>
  upcoming(schedule, now).find((g) => g.start <= now)

/** A game in the schedule that shares any time with start–end (other than `except`). */
export const clash = (schedule: ScheduledGame[], start: number, end: number, except?: string) =>
  schedule.find((g) => g.id !== except && g.start < end && start < g.end)

/** The same time on each of the next `weeks` weeks, starting with this one (local time, so daylight saving is kept). */
export function weekly(start: number, end: number, weeks: number): { start: number; end: number }[] {
  return Array.from({ length: weeks }, (_, i) => {
    const s = new Date(start)
    s.setDate(s.getDate() + 7 * i)
    return { start: s.getTime(), end: s.getTime() + (end - start) }
  })
}

/** Midnight (local) of the day `ms` falls on, plus `minutes`. */
export function at(day: Date, minutes: number): number {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  d.setMinutes(minutes)
  return d.getTime()
}

/** Minutes after midnight of a time. */
export const minutesOf = (ms: number) => {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** "4:00 – 6:00 PM", or with both halves of the day when they differ. */
export function timeRange(start: number, end: number): string {
  const [a, b] = [clock(start), clock(end)]
  const suffix = (s: string) => s.match(/\s?[AP]M$/i)?.[0] ?? ''
  return suffix(a) && suffix(a) === suffix(b) ? `${a.replace(suffix(a), '')} – ${b}` : `${a} – ${b}`
}

/** "Mon, Nov 2". */
export const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/** Hours and minutes, e.g. "2 h" or "1 h 30 min". */
export function duration(ms: number): string {
  const m = Math.round(ms / MINUTE)
  const h = Math.floor(m / 60)
  return `${h ? `${h} h` : ''}${h && m % 60 ? ' ' : ''}${m % 60 ? `${m % 60} min` : ''}` || '0 min'
}
