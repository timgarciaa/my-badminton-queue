import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { dequeue, enqueue, move, pushFront, swap } from '../lib/queue'
import type { Game, GameSwap, Gender, Pair, Player, Session, Skill } from '../types'

const uid = () => crypto.randomUUID()
const today = () => new Date().toLocaleDateString('en-CA')

export function newSession(prev?: Pick<Session, 'courtCount' | 'courtFee' | 'shuttlePrice'>): Session {
  const courtCount = prev?.courtCount ?? 2
  return {
    id: uid(),
    date: today(),
    courtCount,
    courtFee: prev?.courtFee ?? 0,
    shuttlePrice: prev?.shuttlePrice ?? 0,
    extraShuttles: 0,
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

  /** Start a game; `swap` (if any) is applied to the queue first. */
  startGame: (court: number, teamA: Pair, teamB: Pair, swap?: GameSwap) => void
  addShuttle: (gameId: string, delta: number) => void
  endGame: (gameId: string, winner?: 'A' | 'B') => void
  /** Set or clear the winner of a finished game, in this session or history. */
  setWinner: (gameId: string, winner?: 'A' | 'B') => void
  cancelGame: (gameId: string) => void

  closeSession: () => void
  resetSession: () => void
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
            return {
              ...s,
              queue,
              locked: [...new Set([...(s.locked ?? []), ...movedIds])],
              nextTeams: queue.length >= 4 ? { teamA: [queue[0], queue[1]], teamB: [queue[2], queue[3]] } : undefined,
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

        startGame: (court, teamA, teamB, gameSwap) =>
          updateSession((s) => {
            if (s.courts[court - 1]) return s
            const number = Math.max(0, ...s.games.map((g, i) => g.number ?? i + 1)) + 1
            const game: Game = { id: uid(), number, court, teamA, teamB, startedAt: Date.now(), shuttles: 0 }
            if (gameSwap) game.swap = gameSwap
            const ids = [...teamA, ...teamB]
            // The swapped-out player takes the swapped-in player's place in line.
            const queue = gameSwap ? swap(s.queue, gameSwap.out, gameSwap.in) : s.queue
            return {
              ...s,
              games: [...s.games, game],
              courts: s.courts.map((g, i) => (i === court - 1 ? game.id : g)),
              queue: dequeue(queue, ids),
              // Manual queue changes only hold until the next game starts.
              locked: [],
              nextTeams: undefined,
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
            // Skip if the swapped-out player has since gone on another court.
            if (game.swap && s.queue.includes(game.swap.out)) {
              // Undo the swap too: the original four go back to the front,
              // and the swapped-in player returns to right behind them.
              const { in: inId, out } = game.swap
              ids = [...ids.map((id) => (id === inId ? out : id)), inId]
              queue = dequeue(queue, [out])
            }
            return {
              ...s,
              games: s.games.filter((g) => g.id !== gameId),
              courts: s.courts.map((c) => (c === gameId ? null : c)),
              queue: pushFront(queue, ids.filter(active)),
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

        importData: (data) =>
          set((st) => ({
            players: data.players ?? st.players,
            session: data.session ?? st.session,
            history: data.history ?? st.history,
          })),
      }
    },
    { name: 'mbq-store', version: 1 },
  ),
)

export function usePlayerMap() {
  const players = useStore((s) => s.players)
  return useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
}
