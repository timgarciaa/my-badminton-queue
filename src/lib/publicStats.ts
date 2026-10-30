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

/** The link name in a public stats page's address (…/my-badminton-queue/<name>), if this is one. */
export function publicSlug(pathname: string, base: string): string | undefined {
  if (!pathname.startsWith(base)) return undefined
  const rest = pathname.slice(base.length).replace(/\/$/, '').toLowerCase()
  return /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(rest) ? rest : undefined
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
