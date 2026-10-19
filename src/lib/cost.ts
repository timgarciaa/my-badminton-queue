import type { Session } from '../types'

export interface CostSummary {
  shuttlesUsed: number
  shuttleCost: number
  total: number
  heads: number
  /** Exact share, to the cent. */
  perHeadExact: number
  /** Share rounded up to the nearest roundTo (default: whole peso, no centavos). */
  perHead: number
  /** Extra collected because of rounding. */
  surplus: number
}

export function shuttlesUsed(session: Session): number {
  return session.games.reduce((n, g) => n + g.shuttles, 0) + session.extraShuttles
}

export function costSummary(session: Session, roundTo = 1): CostSummary {
  const used = Math.max(0, shuttlesUsed(session))
  const shuttleCost = used * session.shuttlePrice
  const total = session.courtFee + shuttleCost
  const heads = session.attendees.length
  const perHeadExact = heads ? Math.round((total / heads) * 100) / 100 : 0
  const perHead = heads ? Math.max(0, Math.ceil(total / heads / roundTo - 1e-9) * roundTo) : 0
  return {
    shuttlesUsed: used,
    shuttleCost,
    total,
    heads,
    perHeadExact,
    perHead,
    surplus: Math.round((perHead * heads - total) * 100) / 100,
  }
}

/** Peso amount; whole amounts show without centavos (₱78, ₱1,860). */
export function money(n: number): string {
  const digits = Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}
