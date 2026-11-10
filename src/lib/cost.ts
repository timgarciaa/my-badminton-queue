import type { Attendee, CourtBooking, Game, Pricing, Session } from '../types'

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

/** What one player owes and has paid. */
export interface Due {
  playerId: string
  /** Games they've been on court for, the one they're playing included. */
  games: number
  /** What they owe in all. */
  amount: number
  /** What they've paid so far. */
  paid: number
  /** Still to pay. */
  owing: number
}

export interface CostSummary {
  pricing: Pricing
  shuttlesUsed: number
  /** Shuttles and cost per shuttle type. */
  shuttles: ShuttleLine[]
  shuttleCost: number
  /** What the session costs the club: court fee and shuttles. */
  total: number
  heads: number
  /** Exact share, to the cent. */
  perHeadExact: number
  /**
   * What each player pays. Split: the share rounded up to the nearest roundTo
   * (default: whole peso, no centavos). Flat: the fee. Per game: the average.
   */
  perHead: number
  /** Extra collected because of rounding (split). */
  surplus: number
  /** Each checked-in player's amount, in check-in order. */
  dues: Due[]
  /** What players pay in all. */
  expected: number
  /** Paid so far. */
  collected: number
  /** Players who've paid everything they owe. */
  paidCount: number
  /** What players pay less what the session costs: kept by the club, or short when negative. */
  margin: number
}

/** Split equally until a club picks another style. */
export const SPLIT: Pricing = { style: 'split', entry: 0, perGame: 0, flat: 0 }

export function pricingOf(session: Session): Pricing {
  return session.pricing ?? SPLIT
}

/** Games each player has been on court for, the ones still on court included. */
export function gamesOnCourt(session: Session): Map<string, number> {
  const n = new Map<string, number>()
  for (const g of session.games) for (const id of [...g.teamA, ...g.teamB]) n.set(id, (n.get(id) ?? 0) + 1)
  return n
}

/** What a player owes under per game or flat pricing. */
export function dueFor(pricing: Pricing, games: number): number {
  return pricing.style === 'flat' ? pricing.flat : pricing.entry + games * pricing.perGame
}

/**
 * What a paid player has handed over. A split share moves as shuttles are
 * used, so paid there is paid in full; otherwise what they owed when marked paid.
 */
function paidOf(a: Attendee, amount: number, pricing: Pricing): number {
  if (!a.paid) return 0
  return pricing.style !== 'split' && a.paidAmount !== undefined ? a.paidAmount : amount
}

/**
 * Shuttle types in name order (Dmantis, Dmantis 2, Vortex, XP2), unnamed ones
 * last. Only for showing them: the first type in the session keeps its meaning.
 */
export function byName<T extends { name: string }>(list: T[]): T[] {
  const blank = (t: T) => (t.name.trim() ? 0 : 1)
  return [...list].sort(
    (a, b) => blank(a) - blank(b) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  )
}

/** Shuttles used and their cost, per shuttle type, in name order. Older sessions have one unnamed type. */
export function shuttleLines(session: Session): ShuttleLine[] {
  const types = session.shuttleTypes?.length
    ? session.shuttleTypes
    : [{ id: '', name: 'Shuttles', price: session.shuttlePrice, extra: session.extraShuttles }]
  const known = new Set(types.map((t) => t.id))
  const lines = types.map((t, i) => {
    // Games from before types, or of a removed type, count as the first type.
    const fromGames = session.games
      .filter((g) => (g.shuttleType && known.has(g.shuttleType) ? g.shuttleType === t.id : i === 0))
      .reduce((n, g) => n + g.shuttles, 0)
    const used = Math.max(0, fromGames + t.extra)
    return { id: t.id, name: t.name, price: t.price, fromGames, used, cost: used * t.price }
  })
  return byName(lines)
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

/** Shuttles on hand at the start against what's left, per shuttle type, in name order. */
export function shuttleCount(session: Session): ShuttleCount {
  const recorded = new Map(shuttleLines(session).map((l) => [l.id, l.used]))
  const lines: CountLine[] = byName(session.shuttleTypes ?? []).map((t) => ({
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
  const pricing = pricingOf(session)
  const shuttles = shuttleLines(session)
  const used = shuttles.reduce((n, l) => n + l.used, 0)
  const shuttleCost = shuttles.reduce((n, l) => n + l.cost, 0)
  const total = session.courtFee + shuttleCost
  const heads = session.attendees.length
  const perHeadExact = heads ? Math.round((total / heads) * 100) / 100 : 0
  const share = heads ? Math.max(0, Math.ceil(total / heads / roundTo - 1e-9) * roundTo) : 0
  const games = gamesOnCourt(session)
  const dues = session.attendees.map((a): Due => {
    const n = games.get(a.playerId) ?? 0
    const amount = pricing.style === 'split' ? share : dueFor(pricing, n)
    const paid = paidOf(a, amount, pricing)
    return { playerId: a.playerId, games: n, amount, paid, owing: Math.max(0, amount - paid) }
  })
  const sum = (f: (d: Due) => number) => Math.round(dues.reduce((n, d) => n + f(d), 0) * 100) / 100
  const expected = sum((d) => d.amount)
  const perHead =
    pricing.style === 'split' ? share : pricing.style === 'flat' ? pricing.flat : heads ? Math.round(expected / heads) : 0
  return {
    pricing,
    shuttlesUsed: used,
    shuttles,
    shuttleCost,
    total,
    heads,
    perHeadExact,
    perHead,
    surplus: pricing.style === 'split' ? Math.round((share * heads - total) * 100) / 100 : 0,
    dues,
    expected,
    collected: sum((d) => d.paid),
    paidCount: session.attendees.filter((a, i) => a.paid && dues[i].owing === 0).length,
    margin: Math.round((expected - total) * 100) / 100,
  }
}

/** Peso amount; whole amounts show without centavos (₱78, ₱1,860). */
export function money(n: number): string {
  const digits = Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}
