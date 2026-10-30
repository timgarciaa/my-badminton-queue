import { useState } from 'react'
import type { Session } from '../types'
import { longDate, sessionsWithin } from './stats'

/** 'all', the last three months ('3m'), or a session id. */
export type Scope = string

/** Which sessions the stats cover: all time, the last 3 months, or one session. */
export function useScope(session: Session, history: Session[]) {
  const [scope, setScope] = useState<Scope>('all')
  const all = [session, ...history]
  const recent = sessionsWithin(all, 3)
  const sessions = scope === 'all' ? all : scope === '3m' ? recent : all.filter((s) => s.id === scope)
  /** More than one session: show which one a game was in. */
  const span = scope === 'all' || scope === '3m'
  const label =
    scope === 'all'
      ? 'All time'
      : scope === '3m'
        ? 'Last 3 months'
        : `${longDate(sessions[0]?.date ?? session.date)}${scope === session.id ? ' · today' : ''}`
  return { scope, setScope, all, recent, sessions, span, label }
}
