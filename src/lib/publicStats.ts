import { newSession } from '../store/useStore'
import type { Game, Session } from '../types'
import { CHECKIN_API } from './remoteCheckin'
import type { PublicPlayer } from './roster'

/** A session as the public page gets it: games and check-in times only. */
interface PublicSession {
  id: string
  date: string
  status?: Session['status']
  attendees: { playerId: string; checkedInAt: number }[]
  games: Omit<Game, 'shuttles'>[]
}

export interface PublicStats {
  club: { name: string }
  players: PublicPlayer[]
  session: Session | null
  history: Session[]
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/

/**
 * A public stats page's address: …/my-badminton-queue/<club link name>, or
 * …/<club link name>/<player> to open on that player. Undefined for anything else.
 */
export function publicPath(pathname: string, base: string): { slug: string; player?: string } | undefined {
  if (!pathname.startsWith(base)) return undefined
  const [slug, player, ...more] = pathname.slice(base.length).replace(/\/$/, '').toLowerCase().split('/')
  // assets/ holds the app's own files (and is never a club's link name).
  if (!SLUG.test(slug) || slug === 'assets' || more.length) return undefined
  const name = player && decodeURIComponent(player).trim()
  return name ? { slug, player: name } : { slug }
}

/** A name as it's written in an address: "Tim Garcia" → tim-garcia. */
const urlName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')

/**
 * The player an address names: by full name (tim-garcia), or by first name
 * (tim) when only one player has it.
 */
export function findPlayer(players: PublicPlayer[], wanted: string): PublicPlayer | undefined {
  const want = urlName(wanted)
  const full = players.find((p) => urlName(p.name) === want)
  if (full) return full
  const first = players.filter((p) => urlName(p.name).split('-')[0] === want)
  return first.length === 1 ? first[0] : undefined
}

/** Filled out as a full session, so the stats code can use it as it is. */
const toSession = (s: PublicSession): Session => ({
  ...newSession(),
  id: s.id,
  date: s.date,
  status: s.status ?? 'closed',
  attendees: s.attendees.map((a) => ({ ...a, gamesPlayed: 0, paid: false, resting: false })),
  games: s.games.map((g) => ({ ...g, shuttles: 0 })),
})

/** A club's public stats, or null when no club has that link name. */
export async function fetchPublicStats(slug: string): Promise<PublicStats | null> {
  const res = await fetch(`${CHECKIN_API}/public/${encodeURIComponent(slug)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`public stats: ${res.status}`)
  const data = (await res.json()) as { club: { name: string }; players: PublicPlayer[]; session: PublicSession | null; history: PublicSession[] }
  return {
    club: data.club,
    players: data.players,
    session: data.session && toSession(data.session),
    history: data.history.map(toSession),
  }
}
