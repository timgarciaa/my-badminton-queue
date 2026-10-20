import type { Session } from '../types'

export interface ShuttleLine {
  id: string
  name: string
  price: number
  /** Opened during games. */
  fromGames: number
  /** Opened during games plus the manual adjustment. */
  used: number
  cost: number
}

export interface CostSummary {
  shuttlesUsed: number
  /** Shuttles and cost per shuttle type. */
  shuttles: ShuttleLine[]
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

/** Shuttles used and their cost, per shuttle type. Older sessions have one unnamed type. */
export function shuttleLines(session: Session): ShuttleLine[] {
  const types = session.shuttleTypes?.length
    ? session.shuttleTypes
    : [{ id: '', name: 'Shuttles', price: session.shuttlePrice, extra: session.extraShuttles }]
  const known = new Set(types.map((t) => t.id))
  return types.map((t, i) => {
    // Games from before types, or of a removed type, count as the first type.
    const fromGames = session.games
      .filter((g) => (g.shuttleType && known.has(g.shuttleType) ? g.shuttleType === t.id : i === 0))
      .reduce((n, g) => n + g.shuttles, 0)
    const used = Math.max(0, fromGames + t.extra)
    return { id: t.id, name: t.name, price: t.price, fromGames, used, cost: used * t.price }
  })
}

export function shuttlesUsed(session: Session): number {
  return shuttleLines(session).reduce((n, l) => n + l.used, 0)
}

export function costSummary(session: Session, roundTo = 1): CostSummary {
  const shuttles = shuttleLines(session)
  const used = shuttles.reduce((n, l) => n + l.used, 0)
  const shuttleCost = shuttles.reduce((n, l) => n + l.cost, 0)
  const total = session.courtFee + shuttleCost
  const heads = session.attendees.length
  const perHeadExact = heads ? Math.round((total / heads) * 100) / 100 : 0
  const perHead = heads ? Math.max(0, Math.ceil(total / heads / roundTo - 1e-9) * roundTo) : 0
  return {
    shuttlesUsed: used,
    shuttles,
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
