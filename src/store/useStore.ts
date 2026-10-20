import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { heldIds, isSetReady, setIds } from '../lib/plan'
import { applySwap, dequeue, enqueue, move, pushFront, swap } from '../lib/queue'
import type { Game, GameSwap, Gender, Pair, Player, Session, SetGame, ShuttleType, Skill } from '../types'

const uid = () => crypto.randomUUID()
const today = () => new Date().toLocaleDateString('en-CA')

/** Give an older session (one shuttle price) a shuttle type list. */
export function withShuttleTypes(s: Session): Session {
  if (s.shuttleTypes?.length) return s
  const type: ShuttleType = { id: uid(), name: 'Shuttle', price: s.shuttlePrice, extra: s.extraShuttles }
  return { ...s, shuttleTypes: [type], shuttleTypeId: type.id, extraShuttles: 0 }
}

export function newSession(
  prev?: Pick<Session, 'courtCount' | 'courtFee' | 'shuttlePrice' | 'shuttleTypes' | 'shuttleTypeId'>,
): Session {
  const courtCount = prev?.courtCount ?? 2
  // Keep the shuttle types and prices; the counts start again.
  const shuttleTypes = prev?.shuttleTypes?.length
    ? prev.shuttleTypes.map((t) => ({ ...t, extra: 0 }))
    : [{ id: uid(), name: 'Shuttle', price: prev?.shuttlePrice ?? 0, extra: 0 }]
  const shuttleTypeId = shuttleTypes.some((t) => t.id === prev?.shuttleTypeId) ? prev!.shuttleTypeId : shuttleTypes[0].id
  return {
    id: uid(),
    date: today(),
    courtCount,
    courtFee: prev?.courtFee ?? 0,
    shuttlePrice: prev?.shuttlePrice ?? 0,
    extraShuttles: 0,
    shuttleTypes,
    shuttleTypeId,
    attendees: [],
    queue: [],
    courts: Array(courtCount).fill(null),
    games: [],
    status: 'open',
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

  /** Hold four players for a game together; they play next once all four are free. */
  addSetGame: (teamA: Pair, teamB: Pair) => void
  removeSetGame: (id: string) => void

  /** Start a game; `swap` (if any) is applied to the queue first. `setId` marks a set game being played. */
  startGame: (court: number, teamA: Pair, teamB: Pair, swap?: GameSwap, setId?: string) => void
  addShuttle: (gameId: string, delta: number) => void
  endGame: (gameId: string, winner?: 'A' | 'B') => void
  /** Set or clear the winner of a finished game, in this session or history. */
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

        addShuttleType: (name, price) =>
          updateSession((s) => {
            const types = s.shuttleTypes ?? []
            const type: ShuttleType = { id: uid(), name: name.trim() || `Shuttle ${types.length + 1}`, price, extra: 0 }
            return { ...s, shuttleTypes: [...types, type] }
          }),
        updateShuttleType: (id, patch) =>
          updateSession((s) => ({
            ...s,
            shuttleTypes: s.shuttleTypes?.map((t) => (t.id === id ? { ...t, ...patch } : t)),
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
          updateSession((s) => ({
            ...s,
            games: s.games.map((g) => (g.id === gameId ? { ...g, shuttleType: typeId } : g)),
          })),

        startTimer: (hours) =>
          updateSession((s) => ({ ...s, timer: { startedAt: Date.now(), minutes: Math.round(hours * 60) } })),
        adjustTimer: (minutes) =>
          updateSession((s) =>
            s.timer ? { ...s, timer: { ...s.timer, minutes: Math.max(30, s.timer.minutes + minutes) } } : s,
          ),
        stopTimer: () => updateSession((s) => ({ ...s, timer: undefined })),

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
          updateSession((s) => {
            if (s.courts[court - 1]) return s
            const number = Math.max(0, ...s.games.map((g, i) => g.number ?? i + 1)) + 1
            // Shuttles are reused, but a court's first game needs a new one.
            const firstOnCourt = !s.games.some((g) => g.court === court)
            const game: Game = { id: uid(), number, court, teamA, teamB, startedAt: Date.now(), shuttles: firstOnCourt ? 1 : 0 }
            if (s.shuttleTypeId) game.shuttleType = s.shuttleTypeId
            if (gameSwap) game.swap = gameSwap
            if (setId) game.set = true
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
          }),

        addShuttle: (gameId, delta) =>
          updateSession((s) => ({
            ...s,
            games: s.games.map((g) => (g.id === gameId ? { ...g, shuttles: Math.max(0, g.shuttles + delta) } : g)),
          })),

        endGame: (gameId, winner) =>
          updateSession((s) => {
            const game = s.games.find((g) => g.id === gameId)
            if (!game || game.endedAt) return s
            const ids = [...game.teamA, ...game.teamB]
            const back = ids.filter((id) => s.attendees.some((a) => a.playerId === id && !a.resting))
            return {
              ...s,
              games: s.games.map((g) => (g.id === gameId ? { ...g, endedAt: Date.now(), winner } : g)),
              courts: s.courts.map((c) => (c === gameId ? null : c)),
              attendees: s.attendees.map((a) =>
                ids.includes(a.playerId) ? { ...a, gamesPlayed: a.gamesPlayed + 1 } : a,
              ),
              queue: enqueue(s.queue, back),
            }
          }),

        setWinner: (gameId, winner) =>
          set((st) => {
            const fix = (s: Session): Session =>
              s.games.some((g) => g.id === gameId)
                ? { ...s, games: s.games.map((g) => (g.id === gameId ? { ...g, winner } : g)) }
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
