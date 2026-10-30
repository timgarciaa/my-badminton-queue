import { createContext, useContext } from 'react'
import { usePlayerMap } from '../store/useStore'
import type { Player } from '../types'

/** A player as the public stats page has them: no skill level or gender. */
export interface PublicPlayer {
  id: string
  name: string
}

/** Players to show instead of this iPad's own: the public stats page's. */
export const Roster = createContext<Map<string, Player | PublicPlayer> | null>(null)

/** The players in view: the Roster given, or this iPad's. */
export function useRoster(): Map<string, Player | PublicPlayer> {
  const mine = usePlayerMap()
  return useContext(Roster) ?? mine
}
