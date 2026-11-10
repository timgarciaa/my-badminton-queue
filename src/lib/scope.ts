import { useState } from 'react'
import type { Season, Session } from '../types'
import { longDate, sessionsWithin } from './stats'

/** 'all', the last three months ('3m'), dates picked ('range'), 'season:<id>', or a session id. */
export type Scope = string

/** A date range, YYYY-MM-DD, both days included. */
export interface DateRange {
  from: string
  to: string
}

export const seasonScope = (id: string) => `season:${id}`

/** Sessions on the days from `from` to `to`, both included. */
export const sessionsBetween = (sessions: Session[], { from, to }: DateRange) =>
  sessions.filter((s) => s.date >= from && s.date <= to)

/** 1 Sep 2026 – 30 Nov 2026; the year once when both are in the same one. */
export function rangeLabel({ from, to }: DateRange): string {
  const d = (iso: string, year: boolean) =>
    new Date(iso + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(year && { year: 'numeric' }) })
  return `${d(from, from.slice(0, 4) !== to.slice(0, 4))} – ${d(to, true)}`
}

/** The first of the month two months back, to today: a season-sized default. */
function defaultRange(today = new Date()): DateRange {
  const iso = (d: Date) => d.toLocaleDateString('en-CA')
  return { from: iso(new Date(today.getFullYear(), today.getMonth() - 2, 1)), to: iso(today) }
}

/** Which sessions the stats cover: all time, the last 3 months, dates, a season, or one session. */
export function useScope(session: Session, history: Session[], seasons: Season[] = []) {
  const [scope, setScope] = useState<Scope>('all')
  const [range, setRange] = useState<DateRange>(defaultRange)
  const all = [session, ...history]
  const recent = sessionsWithin(all, 3)
  const season = scope.startsWith('season:') ? seasons.find((x) => seasonScope(x.id) === scope) : undefined
  const sessions =
    scope === 'all'
      ? all
      : scope === '3m'
        ? recent
        : scope === 'range'
          ? sessionsBetween(all, range)
          : season
            ? sessionsBetween(all, season)
            : all.filter((s) => s.id === scope)
  /** More than one session: show which one a game was in. */
  const span = scope === 'all' || scope === '3m' || scope === 'range' || !!season
  const label =
    scope === 'all'
      ? 'All time'
      : scope === '3m'
        ? 'Last 3 months'
        : scope === 'range'
          ? rangeLabel(range)
          : season
            ? season.name
            : `${longDate(sessions[0]?.date ?? session.date)}${scope === session.id ? ' · today' : ''}`
  return { scope, setScope, range, setRange, season, all, recent, sessions, span, label }
}
