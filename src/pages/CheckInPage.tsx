import { useEffect, useState } from 'react'
import { EmptyState, PlayerTags } from '../components/ui'
import { useStore } from '../store/useStore'
import type { Player } from '../types'

/**
 * Check-in is one-way: tapping a name only ever checks the player in.
 * Checking out (for mistakes) is a separate, confirmed button, so a double
 * tap can never drop someone to the back of the queue.
 */
export function CheckInPage({ onGoToPlayers }: { onGoToPlayers: () => void }) {
  const players = useStore((s) => s.players)
  const session = useStore((s) => s.session)
  const checkIn = useStore((s) => s.checkIn)
  const checkOut = useStore((s) => s.checkOut)
  const [query, setQuery] = useState('')
  const [justIn, setJustIn] = useState<Player | null>(null)

  // Hide the undo bar after a few seconds.
  useEffect(() => {
    if (!justIn) return
    const t = setTimeout(() => setJustIn(null), 6000)
    return () => clearTimeout(t)
  }, [justIn])

  const attendees = new Map(session.attendees.map((a) => [a.playerId, a]))
  const courtOf = new Map(
    session.games.filter((g) => !g.endedAt).flatMap((g) => [...g.teamA, ...g.teamB].map((id) => [id, g.court])),
  )
  const matches = (p: Player) => p.active && p.name.toLowerCase().includes(query.toLowerCase())
  const byName = (a: Player, b: Player) => a.name.localeCompare(b.name)
  const notHere = players.filter((p) => matches(p) && !attendees.has(p.id)).sort(byName)
  const here = players.filter((p) => matches(p) && attendees.has(p.id)).sort(byName)
  const presentPlayers = players.filter((p) => attendees.has(p.id))
  const males = presentPlayers.filter((p) => p.gender === 'M').length
  const females = presentPlayers.filter((p) => p.gender === 'F').length

  const status = (p: Player) => {
    const court = courtOf.get(p.id)
    if (court) return `On court ${court}`
    if (attendees.get(p.id)?.resting) return 'Resting'
    return 'In queue'
  }

  if (players.length === 0) {
    return (
      <div className="p-6">
        <EmptyState>
          No players yet.{' '}
          <button className="font-semibold text-teal-700 underline" onClick={onGoToPlayers}>
            Add players
          </button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6 pb-24">
      <div className="flex items-center gap-4">
        <input
          className="field max-w-md"
          placeholder="Find player"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="text-lg text-slate-600">
          <strong className="text-2xl text-teal-700">{presentPlayers.length}</strong> present
          {presentPlayers.length > 0 && ` (${males} male, ${females} female)`}
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-bold tracking-wide text-slate-500 uppercase">
          Not here yet ({notHere.length}) · tap to check in
        </h2>
        {notHere.length === 0 ? (
          <p className="text-slate-500">{query ? 'No one matches.' : 'Everyone is checked in.'}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
            {notHere.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  checkIn(p.id)
                  setJustIn(p)
                }}
                className="flex min-h-20 items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 text-left text-lg font-semibold text-slate-700 ring-1 ring-slate-200 transition active:scale-[0.97] active:bg-teal-50"
              >
                <span className="leading-tight">{p.name}</span>
                <PlayerTags player={p} />
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold tracking-wide text-slate-500 uppercase">Checked in ({here.length})</h2>
        {here.length === 0 ? (
          <p className="text-slate-500">{query ? 'No one matches.' : 'Nobody yet.'}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
            {here.map((p) => {
              const a = attendees.get(p.id)!
              const canCheckOut = !courtOf.has(p.id) && a.gamesPlayed === 0
              return (
                <div
                  key={p.id}
                  className="flex min-h-20 flex-col justify-between gap-1 rounded-2xl bg-teal-50 px-4 py-3 ring-1 ring-teal-200"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-lg leading-tight font-semibold text-teal-900">{p.name}</span>
                    <PlayerTags player={p} />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-teal-800">
                    <span>
                      {status(p)} · {a.gamesPlayed} {a.gamesPlayed === 1 ? 'game' : 'games'}
                    </span>
                    {canCheckOut && (
                      <button
                        className="shrink-0 rounded-md px-2 py-1 font-semibold whitespace-nowrap text-slate-500 ring-1 ring-slate-300 hover:bg-white"
                        onClick={() => confirm(`Check out ${p.name}? They will be removed from the queue.`) && checkOut(p.id)}
                      >
                        Check out
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <p className="mt-3 text-sm text-slate-500">
          Leaving early or taking a break? Use <strong>Rest</strong> in the queue on the Courts tab — they keep their
          games and still share the cost.
        </p>
      </section>

      {justIn && (
        <div className="fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-2xl bg-slate-900 px-5 py-3 text-white shadow-lg">
          <span>
            Checked in <strong>{justIn.name}</strong>
          </span>
          <button
            className="font-semibold text-teal-300 underline"
            onClick={() => {
              checkOut(justIn.id)
              setJustIn(null)
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
