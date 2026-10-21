export type Skill = 1 | 2 | 3 | 4 | 5

export const SKILL_LABELS: Record<Skill, string> = {
  1: 'Beginner',
  2: 'Low-Int',
  3: 'Intermediate',
  4: 'High-Int',
  5: 'Advanced',
}

export type Gender = 'M' | 'F'

export const GENDER_LABELS: Record<Gender, string> = { M: 'Male', F: 'Female' }

export interface Player {
  id: string
  name: string
  skill: Skill
  /** Missing on players created before gender was added. */
  gender?: Gender
  active: boolean
  createdAt: number
}

export interface Attendee {
  playerId: string
  checkedInAt: number
  gamesPlayed: number
  paid: boolean
  /** Present but sitting out (resting or left early); still pays. */
  resting: boolean
}

export type Pair = [string, string]

/** A queue swap applied automatically when the game started. */
export interface GameSwap {
  /** Player moved up from further back in the queue. */
  in: string
  /** Player who was next up and now waits for the following game. */
  out: string
  reason: 'rematch' | 'repeat' | 'variety' | 'lopsided'
  /** A second player swapped in, when one swap couldn't avoid a repeat partnership. */
  also?: { in: string; out: string }
}

/** A kind of shuttlecock used in a session (e.g. Vortex, XP2), with its own price. */
export interface ShuttleType {
  id: string
  name: string
  price: number
  /** Manual adjustment on top of shuttles counted from games. */
  extra: number
  /** On hand before the session; locked once it starts. */
  start?: number
  /** Left at the end, counted to see how many were used. */
  left?: number
}

export interface Game {
  id: string
  /** Game number within the session, in start order (missing on older games). */
  number?: number
  court: number
  teamA: Pair
  teamB: Pair
  startedAt: number
  endedAt?: number
  /** New shuttlecocks opened during this game (shuttles are reused until worn out). */
  shuttles: number
  /** Shuttle type opened in this game; missing on older games (first type). */
  shuttleType?: string
  swap?: GameSwap
  /** Winning team; missing if not recorded. */
  winner?: 'A' | 'B'
  /** Started from a set game (four players who asked to play together). */
  set?: boolean
  /** Winners of the previous game on this court, who stayed on and split up. */
  stayed?: Pair
}

/**
 * Four players who asked to play together, with their teams. They are held
 * out of other games until all four are free, then play next.
 */
export interface SetGame {
  id: string
  teamA: Pair
  teamB: Pair
  createdAt: number
  /**
   * The game that was next when this set became ready has started, so the
   * set plays next. Until then it waits behind that game.
   */
  due?: boolean
}

export interface Session {
  id: string
  date: string
  courtCount: number
  courtFee: number
  /** Price per shuttle on sessions from before shuttle types; see shuttleTypes. */
  shuttlePrice: number
  /** Manual adjustment on sessions from before shuttle types; see ShuttleType.extra. */
  extraShuttles: number
  /** Shuttle types with their prices. Missing on older sessions, which use shuttlePrice. */
  shuttleTypes?: ShuttleType[]
  /**
   * Courts playing winners stay: after a game with a winner, the losers go to
   * the queue and the two winners stay on, split up, each with a player from
   * the queue.
   */
  winnersStay?: number[]
  /** Winners-stay courts where the winners stay together as a team (beat the winners) instead of splitting up. */
  winnersTogether?: number[]
  /**
   * Even out skill when picking and splitting games (on unless false). Off,
   * games only look at fresh partners and new people, then mixed pairs.
   */
  skillMatch?: boolean
  /** Default shuttle type; new games start with it. */
  shuttleTypeId?: string
  attendees: Attendee[]
  queue: string[]
  /** Game id currently on each court, index = court number - 1. */
  courts: (string | null)[]
  games: Game[]
  /** Players moved by hand since the last game started; auto-swap is paused while set. */
  locked?: string[]
  /** Teams for the next game set by hand; used while they are still the first four in the queue. */
  nextTeams?: { teamA: Pair; teamB: Pair }
  /** Set games waiting to be played, oldest first. */
  setGames?: SetGame[]
  /** Booked court time, counted down once the session is started. */
  timer?: { startedAt: number; minutes: number }
  status: 'open' | 'closed'
}
