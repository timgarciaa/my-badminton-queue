import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { courtBooking, courtFeeOf, gameShuttleType, sessionStarted, shuttlesInStock } from '../lib/cost'
import { heldIds, isSetReady, setIds } from '../lib/plan'
import { applySwap, dequeue, enqueue, move, pushFront, swap } from '../lib/queue'
import type { CourtBooking, Game, GameSwap, Gender, Pair, Player, Session, SetGame, ShuttleType, Skill } from '../types'

const uid = () => crypto.randomUUID()
const today = () => new Date().toLocaleDateString('en-CA')

/** Give an older session (one shuttle price) a shuttle type list. */
export function withShuttleTypes(s: Session): Session {
  if (s.shuttleTypes?.length) return s
  const type: ShuttleType = { id: uid(), name: 'Shuttle', price: s.shuttlePrice, extra: s.extraShuttles }
  return { ...s, shuttleTypes: [type], shuttleTypeId: type.id, extraShuttles: 0 }
}

export function newSession(
  prev?: Pick<
    Session,
    | 'courtCount'
    | 'courtFee'
    | 'courtBooking'
    | 'shuttlePrice'
    | 'shuttleTypes'
    | 'shuttleTypeId'
    | 'skillMatch'
    | 'helpStruggling'
  >,
): Session {
  const courtCount = prev?.courtCount ?? 2
  // Keep the shuttle types and prices; the counts start again, from what was
  // left last time (or the same starting count, if none was entered).
  const shuttleTypes = prev?.shuttleTypes?.length
    ? prev.shuttleTypes.map((t) => ({ ...t, extra: 0, start: t.left ?? t.start, left: undefined }))
    : [{ id: uid(), name: 'Shuttle', price: prev?.shuttlePrice ?? 0, extra: 0 }]
  const shuttleTypeId = shuttleTypes.some((t) => t.id === prev?.shuttleTypeId) ? prev!.shuttleTypeId : shuttleTypes[0].id
  return {
    id: uid(),
    date: today(),
    courtCount,
    courtFee: prev?.courtFee ?? 0,
    // The same booking as last time, until changed.
    ...(prev?.courtBooking && { courtBooking: prev.courtBooking }),
    shuttlePrice: prev?.shuttlePrice ?? 0,
    extraShuttles: 0,
    shuttleTypes,
    shuttleTypeId,
    ...(prev?.skillMatch === false && { skillMatch: false }),
    ...(prev?.helpStruggling === false && { helpStruggling: false }),
    attendees: [],
    queue: [],
    courts: Array(courtCount).fill(null),
    games: [],
    status: 'open',
  }
}

/** Whether a court plays winners stay. Ignores the on/off value an early test build saved. */
export const isWinnersStay = (s: Session, court: number) => Array.isArray(s.winnersStay) && s.winnersStay.includes(court)
/** Whether a winners-stay court keeps its winners together instead of splitting them up. */
export const isWinnersTogether = (s: Session, court: number) => !!s.winnersTogether?.includes(court)

/** A whole, non-negative count; undefined when cleared. */
const count = (n?: number) => (n === undefined || !Number.isFinite(n) ? undefined : Math.max(0, Math.round(n)))

/** Whether games are matched on skill (on unless turned off). */
export const isSkillMatch = (s: Session) => s.skillMatch !== false
/** Whether struggling players are partnered with the player on a win streak (on unless turned off). */
export const isHelpStruggling = (s: Session) => s.helpStruggling !== false

/** Add or remove a court number in a list of courts. */
const withCourt = (list: unknown, court: number, on: boolean) => {
  const rest = (Array.isArray(list) ? (list as number[]) : []).filter((c) => c !== court)
  return on ? [...rest, court].sort((a, b) => a - b) : rest
}

/** Start a game on a court, taking its players out of the queue. Unchanged if the court is busy. */
function beginGame(
  s: Session,
  court: number,
  teamA: Pair,
  teamB: Pair,
  { swap: gameSwap, setId, stayed, shuttleType }: { swap?: GameSwap; setId?: string; stayed?: Pair; shuttleType?: string } = {},
): Session {
  if (s.courts[court - 1]) return s
  const number = Math.max(0, ...s.games.map((g, i) => g.number ?? i + 1)) + 1
  // Shuttles are reused, but a court's first game needs a new one.
  const firstOnCourt = !s.games.some((g) => g.court === court)
  let type = shuttleType ?? s.shuttleTypeId
  let shuttles = firstOnCourt ? 1 : 0
  // None of this type left: open one of the next type that has some, or none.
  if (shuttles && shuttlesInStock(s, type) < 1) {
    const other = s.shuttleTypes?.find((t) => shuttlesInStock(s, t.id) >= 1)
    if (other) type = other.id
    else shuttles = 0
  }
  const game: Game = { id: uid(), number, court, teamA, teamB, startedAt: Date.now(), shuttles }
  if (type) game.shuttleType = type
  if (gameSwap) game.swap = gameSwap
  if (setId) game.set = true
  if (stayed) game.stayed = stayed
  const ids = [...teamA, ...teamB]
  // The swapped-out player takes the swapped-in player's place in line.
  const queue = gameSwap ? applySwap(s.queue, gameSwap) : s.queue
  // Ready sets were waiting behind this game; they play next.
  const setGames = s.setGames
    ?.filter((g) => g.id !== setId)
    .map((g) => (!setId && isSetReady(g, queue) ? { ...g, due: true } : g))
  return {
    ...s,
    games: [...s.games, game],
    courts: s.courts.map((g, i) => (i === court - 1 ? game.id : g)),
    queue: dequeue(queue, ids),
    setGames,
    // Manual queue changes only hold until the next game starts
    // (a set game doesn't use them, so they carry over).
    ...(setId ? {} : { locked: [], nextTeams: undefined }),
  }
}

/**
 * End a game: record the winner (or that the court time ran out), count the
 * game, and send players (except `keep`) to the queue.
 */
function finishGame(s: Session, gameId: string, winner?: 'A' | 'B', keep: string[] = [], outOfHours = false): Session {
  const game = s.games.find((g) => g.id === gameId)
  if (!game || game.endedAt) return s
  const ids = [...game.teamA, ...game.teamB]
  const back = ids.filter((id) => !keep.includes(id) && s.attendees.some((a) => a.playerId === id && !a.resting))
  return {
    ...s,
    games: s.games.map((g) =>
      g.id === gameId ? { ...g, endedAt: Date.now(), winner, ...(outOfHours && !winner && { outOfHours: true }) } : g,
    ),
    courts: s.courts.map((c) => (c === gameId ? null : c)),
    attendees: s.attendees.map((a) => (ids.includes(a.playerId) ? { ...a, gamesPlayed: a.gamesPlayed + 1 } : a)),
    queue: enqueue(s.queue, back),
  }
}

interface State {
  players: Player[]
  session: Session
  history: Session[]

  addPlayer: (name: string, skill: Skill, gender: Gender) => void
  /** Bulk add (import); gender left unset and skill Intermediate until edited. */
  addPlayers: (names: string[]) => void
  updatePlayer: (id: string, patch: Partial<Pick<Player, 'name' | 'skill' | 'gender' | 'active'>>) => void
  deletePlayer: (id: string) => void

  checkIn: (playerId: string) => void
  /** Undo a check-in made by mistake; ignored once the player has played or is on court. */
  checkOut: (playerId: string) => void
  setResting: (playerId: string, resting: boolean) => void
  togglePaid: (playerId: string) => void
  moveInQueue: (playerId: string, delta: number) => void
  /**
   * Apply a manual change to the queue as shown: the first four become the
   * next game's teams exactly as ordered (A, A, B, B).
   */
  setManualOrder: (order: string[], movedIds: string[]) => void
  /** Drop manual changes and let the app pick the next game again. */
  clearManual: () => void
  swapInQueue: (outId: string, inId: string) => void

  setSessionField: (field: 'courtFee' | 'shuttlePrice' | 'extraShuttles', value: number) => void
  setCourtCount: (n: number) => void
  /** Change the court booking; the court fee is worked out from it. */
  setCourtBooking: (patch: Partial<CourtBooking>) => void
  addShuttleType: (name: string, price: number) => void
  updateShuttleType: (id: string, patch: Partial<Pick<ShuttleType, 'name' | 'price' | 'extra'>>) => void
  /** Remove a shuttle type that no game used. */
  removeShuttleType: (id: string) => void
  /** Shuttle type new games start with. */
  setDefaultShuttleType: (id: string) => void
  /** Change which shuttle type a game is using. */
  setGameShuttleType: (gameId: string, typeId: string) => void
  /** Start the session countdown for the booked hours. */
  startTimer: (hours: number) => void
  /** Add or take away booked minutes. */
  adjustTimer: (minutes: number) => void
  stopTimer: () => void
  /** Shuttles of a type on hand at the start; ignored once the session has started. */
  setShuttlesStart: (typeId: string, n?: number) => void
  /** Shuttles of a type left, counted at the end; only once the session has started. */
  setShuttlesLeft: (typeId: string, n?: number) => void

  /** Hold four players for a game together; they play next once all four are free. */
  addSetGame: (teamA: Pair, teamB: Pair) => void
  removeSetGame: (id: string) => void

  /** Start a game; `swap` (if any) is applied to the queue first. `setId` marks a set game being played. */
  startGame: (court: number, teamA: Pair, teamB: Pair, swap?: GameSwap, setId?: string) => void
  addShuttle: (gameId: string, delta: number) => void
  /**
   * Move a game in progress to another court (players went to the wrong one).
   * A game already there trades courts with it. Only the court changes.
   */
  moveGame: (gameId: string, court: number) => void
  /** End a game with a winner, no result, or out of hours (the court booking ran out). */
  endGame: (gameId: string, winner?: 'A' | 'B', outOfHours?: boolean) => void
  /**
   * Winners stay: end the game, send the losers to the queue, and start the
   * next game on the same court with the winners split up (teamA/teamB).
   */
  rotateWinners: (gameId: string, winner: 'A' | 'B', teamA: Pair, teamB: Pair) => void
  /** Turn winners stay on or off for one court. */
  setWinnersStay: (court: number, on: boolean) => void
  /** On a winners-stay court, split the winners up (default) or keep them together. */
  setWinnersSplit: (court: number, split: boolean) => void
  /** Turn skill matching on or off for picking and splitting games. */
  setSkillMatch: (on: boolean) => void
  /** Turn helping struggling players on or off. */
  setHelpStruggling: (on: boolean) => void
  /** Mark a finished game with no winner as out of hours (court time ran out), or undo it; this session or history. */
  setOutOfHours: (gameId: string, on: boolean) => void
  /** Set or clear the winner of a finished game, in this session or history. A winner replaces "out of hours". */
  setWinner: (gameId: string, winner?: 'A' | 'B') => void
  cancelGame: (gameId: string) => void

  closeSession: () => void
  resetSession: () => void
  /** Delete everything on this device: players, the current session and history. */
  clearAll: () => void
  importData: (data: { players: Player[]; session?: Session; history?: Session[] }) => void
}

export const useStore = create<State>()(
  persist(
    (set) => {
      const updateSession = (fn: (s: Session) => Session) => set((st) => ({ session: fn(st.session) }))

      return {
        players: [],
        session: newSession(),
        history: [],

        addPlayer: (name, skill, gender) =>
          set((st) => ({
            players: [...st.players, { id: uid(), name: name.trim(), skill, gender, active: true, createdAt: Date.now() }],
          })),

        addPlayers: (names) =>
          set((st) => {
            const now = Date.now()
            const added: Player[] = names.map((name, i) => ({
              id: uid(),
              name: name.trim(),
              skill: 3,
              active: true,
              createdAt: now + i,
            }))
            return { players: [...st.players, ...added] }
          }),

        updatePlayer: (id, patch) =>
          set((st) => ({ players: st.players.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

        deletePlayer: (id) => set((st) => ({ players: st.players.filter((p) => p.id !== id) })),

        checkIn: (playerId) =>
          updateSession((s) =>
            s.attendees.some((a) => a.playerId === playerId)
              ? s
              : {
                  ...s,
                  attendees: [
                    ...s.attendees,
                    { playerId, checkedInAt: Date.now(), gamesPlayed: 0, paid: false, resting: false },
                  ],
                  queue: enqueue(s.queue, [playerId]),
                },
          ),

        checkOut: (playerId) =>
          updateSession((s) => {
            const attendee = s.attendees.find((a) => a.playerId === playerId)
            const onCourt = s.games.some((g) => !g.endedAt && [...g.teamA, ...g.teamB].includes(playerId))
            // Only for mistakes: someone who has played stays on the list (and pays).
            if (!attendee || onCourt || attendee.gamesPlayed > 0) return s
            return {
              ...s,
              attendees: s.attendees.filter((a) => a.playerId !== playerId),
              queue: dequeue(s.queue, [playerId]),
              setGames: s.setGames?.filter((g) => !setIds(g).includes(playerId)),
            }
          }),

        setResting: (playerId, resting) =>
          updateSession((s) => {
            const onCourt = s.games.some((g) => !g.endedAt && [...g.teamA, ...g.teamB].includes(playerId))
            return {
              ...s,
              attendees: s.attendees.map((a) => (a.playerId === playerId ? { ...a, resting } : a)),
              queue: resting ? dequeue(s.queue, [playerId]) : onCourt ? s.queue : enqueue(s.queue, [playerId]),
            }
          }),

        togglePaid: (playerId) =>
          updateSession((s) => ({
            ...s,
            attendees: s.attendees.map((a) => (a.playerId === playerId ? { ...a, paid: !a.paid } : a)),
          })),

        setManualOrder: (order, movedIds) =>
          updateSession((s) => {
            const queue = order.filter((id) => s.queue.includes(id))
            // Players held for a set game don't count towards the next normal game.
            const held = heldIds(s.setGames)
            const free = queue.filter((id) => !held.has(id))
            return {
              ...s,
              queue,
              locked: [...new Set([...(s.locked ?? []), ...movedIds])],
              nextTeams: free.length >= 4 ? { teamA: [free[0], free[1]], teamB: [free[2], free[3]] } : undefined,
            }
          }),

        clearManual: () => updateSession((s) => ({ ...s, locked: [], nextTeams: undefined })),

        moveInQueue: (playerId, delta) => updateSession((s) => ({ ...s, queue: move(s.queue, playerId, delta) })),
        swapInQueue: (outId, inId) => updateSession((s) => ({ ...s, queue: swap(s.queue, outId, inId) })),

        setSessionField: (field, value) =>
          updateSession((s) => ({ ...s, [field]: Number.isFinite(value) ? value : 0 })),

        setCourtCount: (n) =>
          updateSession((s) => {
            const lastBusy = s.courts.reduce((max, g, i) => (g ? i + 1 : max), 0)
            const count = Math.max(1, lastBusy, Math.min(6, n))
            const courts = Array.from({ length: count }, (_, i) => s.courts[i] ?? null)
            return { ...s, courtCount: count, courts }
          }),

        setCourtBooking: (patch) =>
          updateSession((s) => {
            const booking = { ...courtBooking(s), ...patch }
            return { ...s, courtBooking: booking, courtFee: courtFeeOf(booking) }
          }),

        addShuttleType: (name, price) =>
          updateSession((s) => {
            const types = s.shuttleTypes ?? []
            const type: ShuttleType = { id: uid(), name: name.trim() || `Shuttle ${types.length + 1}`, price, extra: 0 }
            return { ...s, shuttleTypes: [...types, type] }
          }),
        updateShuttleType: (id, patch) =>
          updateSession((s) => ({
            ...s,
            shuttleTypes: s.shuttleTypes?.map((t) => {
              if (t.id !== id) return t
              // Can't adjust up past the shuttles of this type still in stock.
              const extra = patch.extra === undefined ? t.extra : Math.min(patch.extra, t.extra + shuttlesInStock(s, id))
              return { ...t, ...patch, extra }
            }),
          })),
        removeShuttleType: (id) =>
          updateSession((s) => {
            const types = s.shuttleTypes ?? []
            if (types.length <= 1 || s.games.some((g) => g.shuttleType === id)) return s
            const rest = types.filter((t) => t.id !== id)
            return {
              ...s,
              shuttleTypes: rest,
              shuttleTypeId: s.shuttleTypeId === id ? rest[0].id : s.shuttleTypeId,
              games: s.games.map((g) => (g.shuttleType === id ? { ...g, shuttleType: undefined } : g)),
            }
          }),
        setDefaultShuttleType: (id) => updateSession((s) => ({ ...s, shuttleTypeId: id })),
        setGameShuttleType: (gameId, typeId) =>
          updateSession((s) => {
            const game = s.games.find((g) => g.id === gameId)
            // The game's shuttles move to the new type, which must have that many in stock.
            if (!game || gameShuttleType(s, game) === typeId || shuttlesInStock(s, typeId) < game.shuttles) return s
            return { ...s, games: s.games.map((g) => (g.id === gameId ? { ...g, shuttleType: typeId } : g)) }
          }),

        startTimer: (hours) =>
          updateSession((s) => ({ ...s, timer: { startedAt: Date.now(), minutes: Math.round(hours * 60) } })),
        adjustTimer: (minutes) =>
          updateSession((s) =>
            s.timer ? { ...s, timer: { ...s.timer, minutes: Math.max(30, s.timer.minutes + minutes) } } : s,
          ),
        stopTimer: () => updateSession((s) => ({ ...s, timer: undefined })),
        setShuttlesStart: (typeId, n) =>
          updateSession((s) =>
            sessionStarted(s)
              ? s
              : {
                  ...s,
                  shuttleTypes: s.shuttleTypes?.map((t) => (t.id === typeId ? { ...t, start: count(n), left: undefined } : t)),
                },
          ),
        setShuttlesLeft: (typeId, n) =>
          updateSession((s) => {
            if (!sessionStarted(s)) return s
            const left = count(n)
            return {
              ...s,
              shuttleTypes: s.shuttleTypes?.map((t) =>
                // Can't have more left than there were at the start.
                t.id === typeId && t.start !== undefined
                  ? { ...t, left: left === undefined ? undefined : Math.min(left, t.start) }
                  : t,
              ),
            }
          }),

        addSetGame: (teamA, teamB) =>
          updateSession((s) => {
            const ids = [...teamA, ...teamB]
            const set: SetGame = { id: uid(), teamA, teamB, createdAt: Date.now() }
            const overlaps = (t?: { teamA: Pair; teamB: Pair }) => !!t && setIds(t).some((id) => ids.includes(id))
            return {
              ...s,
              // A player can only be in one set game.
              setGames: [...(s.setGames ?? []).filter((g) => !overlaps(g)), set],
              nextTeams: overlaps(s.nextTeams) ? undefined : s.nextTeams,
            }
          }),

        removeSetGame: (id) => updateSession((s) => ({ ...s, setGames: s.setGames?.filter((g) => g.id !== id) })),

        startGame: (court, teamA, teamB, gameSwap, setId) =>
          updateSession((s) => beginGame(s, court, teamA, teamB, { swap: gameSwap, setId })),

        addShuttle: (gameId, delta) =>
          updateSession((s) => ({
            ...s,
            games: s.games.map((g) => {
              if (g.id !== gameId) return g
              // Only as many as are left of the game's shuttle type.
              const add = Math.min(delta, shuttlesInStock(s, gameShuttleType(s, g)))
              return { ...g, shuttles: Math.max(0, g.shuttles + add) }
            }),
          })),

        moveGame: (gameId, court) =>
          updateSession((s) => {
            const game = s.games.find((g) => g.id === gameId)
            if (!game || game.endedAt || court === game.court || !(court >= 1 && court <= s.courts.length)) return s
            const other = s.courts[court - 1]
            return {
              ...s,
              games: s.games.map((g) =>
                g.id === gameId ? { ...g, court } : g.id === other ? { ...g, court: game.court } : g,
              ),
              courts: s.courts.map((id, i) => (i === court - 1 ? gameId : i === game.court - 1 ? other : id)),
            }
          }),

        endGame: (gameId, winner, outOfHours) => updateSession((s) => finishGame(s, gameId, winner, [], outOfHours)),

        rotateWinners: (gameId, winner, teamA, teamB) =>
          updateSession((s) => {
            const game = s.games.find((g) => g.id === gameId)
            if (!game || game.endedAt) return s
            const winners = winner === 'A' ? game.teamA : game.teamB
            const ended = finishGame(s, gameId, winner, winners)
            const next = beginGame(ended, game.court, teamA, teamB, { stayed: winners, shuttleType: game.shuttleType })
            // Couldn't start (e.g. a player left): winners go back in line instead.
            return next === ended ? { ...ended, queue: enqueue(ended.queue, winners) } : next
          }),

        setWinnersStay: (court, on) => updateSession((s) => ({ ...s, winnersStay: withCourt(s.winnersStay, court, on) })),
        setWinnersSplit: (court, split) =>
          updateSession((s) => ({ ...s, winnersTogether: withCourt(s.winnersTogether, court, !split) })),

        setSkillMatch: (on) => updateSession((s) => ({ ...s, skillMatch: on })),
        setHelpStruggling: (on) => updateSession((s) => ({ ...s, helpStruggling: on })),

        setOutOfHours: (gameId, on) =>
          set((st) => {
            const fix = (s: Session): Session =>
              s.games.some((g) => g.id === gameId && g.endedAt && !g.winner)
                ? { ...s, games: s.games.map((g) => (g.id === gameId ? { ...g, outOfHours: on || undefined } : g)) }
                : s
            return { session: fix(st.session), history: st.history.map(fix) }
          }),

        setWinner: (gameId, winner) =>
          set((st) => {
            const fix = (s: Session): Session =>
              s.games.some((g) => g.id === gameId)
                ? {
                    ...s,
                    games: s.games.map((g) =>
                      g.id === gameId ? { ...g, winner, outOfHours: winner ? undefined : g.outOfHours } : g,
                    ),
                  }
                : s
            return { session: fix(st.session), history: st.history.map(fix) }
          }),

        cancelGame: (gameId) =>
          updateSession((s) => {
            const game = s.games.find((g) => g.id === gameId)
            if (!game || game.endedAt) return s
            const active = (id: string) => s.attendees.some((a) => a.playerId === id && !a.resting)
            let ids = [...game.teamA, ...game.teamB]
            let queue = s.queue
            // Undo the swaps too: the original four go back to the front, and
            // the swapped-in players return to right behind them. Skipped for
            // a swapped-out player who has since gone on another court.
            const moves = game.swap ? [game.swap, ...(game.swap.also ? [game.swap.also] : [])] : []
            for (const { in: inId, out } of moves) {
              if (!s.queue.includes(out)) continue
              ids = [...ids.map((id) => (id === inId ? out : id)), inId]
              queue = dequeue(queue, [out])
            }
            // A cancelled set game goes back to waiting as a set.
            const setGames = game.set
              ? [{ id: uid(), teamA: game.teamA, teamB: game.teamB, createdAt: game.startedAt, due: true }, ...(s.setGames ?? [])]
              : s.setGames
            return {
              ...s,
              games: s.games.filter((g) => g.id !== gameId),
              courts: s.courts.map((c) => (c === gameId ? null : c)),
              queue: pushFront(queue, ids.filter(active)),
              setGames,
            }
          }),

        closeSession: () =>
          set((st) => {
            const now = Date.now()
            const closed: Session = {
              ...st.session,
              status: 'closed',
              games: st.session.games.map((g) => (g.endedAt ? g : { ...g, endedAt: now })),
              courts: st.session.courts.map(() => null),
              queue: [],
            }
            return { history: [closed, ...st.history], session: newSession(st.session) }
          }),

        resetSession: () => set((st) => ({ session: newSession(st.session) })),

        clearAll: () => set({ players: [], session: newSession(), history: [] }),

        importData: (data) =>
          set((st) => ({
            players: data.players ?? st.players,
            session: data.session ? withShuttleTypes(data.session) : st.session,
            history: data.history ?? st.history,
          })),
      }
    },
    {
      name: 'mbq-store',
      version: 2,
      migrate: (state, version) => {
        const st = state as State
        // v2: shuttle types with their own prices.
        if (version < 2 && st?.session) st.session = withShuttleTypes(st.session)
        return st
      },
    },
  ),
)

export function usePlayerMap() {
  const players = useStore((s) => s.players)
  return useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
}
