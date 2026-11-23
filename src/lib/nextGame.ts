import { bumpedPlayers, fairShare, idleTimes, meetCounts, partnerCounts, playStreaks } from './balance'
import { matchSkill, planGames } from './plan'
import { helpFrom, playedGames, sessionsWithin } from './stats'
import { isHelpStruggling, isSkillMatch } from '../store/useStore'
import type { Player, Session } from '../types'

/** The latest finished session before this one with games in it. */
function lastSession(session: Session, history: Session[]): Session | undefined {
  return history
    .filter((s) => s.id !== session.id && s.games.some((g) => g.endedAt))
    .reduce<Session | undefined>((a, s) => (!a || s.date > a.date ? s : a), undefined)
}

/**
 * Plan the next game exactly as the queue shows it and Next game starts it.
 * Help for struggling players looks at last session and the last 3 months, today included.
 */
export function planNext(
  session: Session,
  players: Map<string, Player>,
  history: Session[],
  /** waits: false plans as before swaps checked how long players waited (to compare, see scripts/replay-sessions.ts). */
  { waits = true }: { waits?: boolean } = {},
) {
  const last = lastSession(session, history)
  const lastGames = last ? playedGames([last]) : []
  const help = isHelpStruggling(session)
    ? helpFrom(playedGames(sessionsWithin([session, ...history], 3)), lastGames, playedGames([session]))
    : undefined
  const played = new Set(session.games.flatMap((g) => [...g.teamA, ...g.teamB]))
  return planGames(
    session.queue,
    matchSkill((id) => players.get(id)?.skill ?? 3, isSkillMatch(session)),
    {
      partners: partnerCounts(session.games),
      lastPartners: partnerCounts(lastGames),
      met: meetCounts(session.games),
      played: playStreaks(session.games),
      games: fairShare(session.games, session.attendees),
      idle: waits ? idleTimes(session.games, session.attendees, Date.now()) : undefined,
      // Early arrivals who haven't played yet keep their place.
      keep: new Set(session.queue.filter((id) => !played.has(id))),
      genderOf: (id) => players.get(id)?.gender,
      autoSwap: !session.locked?.length,
      locked: bumpedPlayers(session.games),
      fixed: session.nextTeams,
      sets: session.setGames,
      help,
    },
    1,
  )
}
