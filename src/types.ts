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
  reason: 'rematch' | 'repeat' | 'lopsided'
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
  swap?: GameSwap
  /** Winning team; missing if not recorded. */
  winner?: 'A' | 'B'
}

export interface Session {
  id: string
  date: string
  courtCount: number
  courtFee: number
  shuttlePrice: number
  /** Manual adjustment on top of shuttles counted from games. */
  extraShuttles: number
  attendees: Attendee[]
  queue: string[]
  /** Game id currently on each court, index = court number - 1. */
  courts: (string | null)[]
  games: Game[]
  /** Players moved by hand since the last game started; auto-swap is paused while set. */
  locked?: string[]
  /** Teams for the next game set by hand; used while they are still the first four in the queue. */
  nextTeams?: { teamA: Pair; teamB: Pair }
  status: 'open' | 'closed'
}
