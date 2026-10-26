import type { CourtBooking, Game, Session } from '../types'

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

/**
 * The court booking behind the court fee. Older sessions only have a total,
 * shown as one court for one hour at that price.
 */
export function courtBooking(session: Session): CourtBooking {
  if (session.courtBooking) return session.courtBooking
  if (session.courtFee) return { courts: 1, hours: 1, rate: session.courtFee }
  return { courts: session.courtCount, hours: 2, rate: 0 }
}

/** Courts × hours × rate, to the cent. */
export function courtFeeOf({ courts, hours, rate }: CourtBooking): number {
  return Math.round(courts * hours * rate * 100) / 100
}

/** The shuttle type a game counts towards; games from before types, or of a removed type, count as the first. */
export function gameShuttleType(session: Session, game: Game): string | undefined {
  const types = session.shuttleTypes ?? []
  return types.some((t) => t.id === game.shuttleType) ? game.shuttleType : types[0]?.id
}

/** Unopened shuttles of a type: its starting count less those recorded. Unlimited without a starting count. */
export function shuttlesInStock(session: Session, typeId?: string): number {
  const type = session.shuttleTypes?.find((t) => t.id === typeId)
  if (type?.start === undefined) return Infinity
  const used = shuttleLines(session).find((l) => l.id === typeId)?.used ?? 0
  return Math.max(0, type.start - used)
}

/** Started: the timer was started or a game was played. The starting shuttle count is locked from then. */
export function sessionStarted(session: Session): boolean {
  return !!session.timer || session.games.length > 0
}

export interface CountLine {
  id: string
  name: string
  start?: number
  left?: number
  /** Start minus left, once both are entered. */
  used?: number
  /** Shuttles recorded in games plus adjustments, to check the count against. */
  recorded: number
}

export interface ShuttleCount {
  /** One line per shuttle type. */
  lines: CountLine[]
  /** Totals over the types with a starting count; undefined while none has one. */
  start?: number
  /** Undefined until every counted type has its count left. */
  left?: number
  used?: number
  recorded: number
}

/** Shuttles on hand at the start against what's left, per shuttle type. */
export function shuttleCount(session: Session): ShuttleCount {
  const recorded = new Map(shuttleLines(session).map((l) => [l.id, l.used]))
  const lines: CountLine[] = (session.shuttleTypes ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    start: t.start,
    left: t.left,
    used: t.start === undefined || t.left === undefined ? undefined : Math.max(0, t.start - t.left),
    recorded: recorded.get(t.id) ?? 0,
  }))
  const counted = lines.filter((l) => l.start !== undefined)
  const sum = (key: 'start' | 'left' | 'used') =>
    counted.length && counted.every((l) => l[key] !== undefined) ? counted.reduce((n, l) => n + l[key]!, 0) : undefined
  return {
    lines,
    start: sum('start'),
    left: sum('left'),
    used: sum('used'),
    recorded: counted.reduce((n, l) => n + l.recorded, 0),
  }
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
