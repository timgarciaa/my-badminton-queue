import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { dueGame } from './schedule'

/**
 * Starts the session when a booked game's time comes (also when the app opens
 * late, or the iPad wakes up mid-game), and forgets booked games that ended
 * without starting.
 */
export function useScheduleClock() {
  useEffect(() => {
    const tick = () => checkSchedule(Date.now())
    tick()
    const every = window.setInterval(tick, 5000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(every)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
}

/** One check: start the game that's due (unless a session clock is already running), drop ended ones. */
export function checkSchedule(now: number) {
  const { schedule, session, startScheduled, dropEnded } = useStore.getState()
  const due = dueGame(schedule, now)
  if (due && !session.timer) startScheduled(due.id)
  dropEnded(now)
}
