import { useEffect, useMemo, useState } from 'react'
import { PlayerStats } from '../components/PlayerStats'
import { SessionSelect } from '../components/SessionSelect'
import { EmptyState } from '../components/ui'
import { fetchPublicStats, findPlayer, type PublicStats } from '../lib/publicStats'
import { Roster } from '../lib/roster'
import { useScope } from '../lib/scope'
import { newSession } from '../store/useStore'

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'failed' } | { state: 'ready'; data: PublicStats }

/**
 * A club's player stats for anyone with the link (…/my-badminton-queue/<name>,
 * or …/<name>/<player> to open on a player): read-only, no sign-in, and
 * separate from the app (nothing on this device changes).
 */
export function PublicStatsPage({ slug, player }: { slug: string; player?: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    fetchPublicStats(slug).then(
      (data) => live && setLoad(data ? { state: 'ready', data } : { state: 'missing' }),
      () => live && setLoad({ state: 'failed' }),
    )
    return () => {
      live = false
    }
  }, [slug, attempt])

  const club = load.state === 'ready' ? load.data.club.name : undefined
  useEffect(() => {
    document.title = club ? `${club} · Player stats` : 'Player stats'
  }, [club])

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <header className="bg-gradient-to-br from-teal-800 via-teal-700 to-teal-600 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-4 text-white lg:px-5">
        <div className="text-xs font-bold tracking-wide text-teal-100 uppercase">My Badminton Queue</div>
        <h1 className="text-2xl font-black tracking-tight">{club ?? 'Player stats'}</h1>
        {club && <p className="text-sm text-teal-50">Player stats</p>}
      </header>
      {load.state === 'loading' && (
        <div className="flex flex-1 items-center justify-center p-8">
          <span className="d-loading d-loading-spinner d-loading-lg text-teal-700" aria-label="Loading" />
        </div>
      )}
      {load.state === 'missing' && (
        <div className="p-4 lg:p-5">
          <EmptyState>No club has this link. Check the address with your club&apos;s organizer.</EmptyState>
        </div>
      )}
      {load.state === 'failed' && (
        <div className="space-y-3 p-4 text-center lg:p-5">
          <EmptyState>Couldn&apos;t load the stats. Check the internet connection.</EmptyState>
          <button
            className="d-btn d-btn-primary"
            onClick={() => {
              setLoad({ state: 'loading' })
              setAttempt((n) => n + 1)
            }}
          >
            Try again
          </button>
        </div>
      )}
      {load.state === 'ready' && <Stats data={load.data} player={player} />}
    </div>
  )
}

function Stats({ data, player }: { data: PublicStats; player?: string }) {
  const players = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data.players])
  const empty = useMemo(() => newSession(), [])
  const session = data.session ?? empty
  const { scope, setScope, all, recent, sessions, span, label } = useScope(session, data.history)
  const wanted = useMemo(() => (player ? findPlayer(data.players, player) : undefined), [data.players, player])
  const [chosen, setChosen] = useState<string | null>(wanted?.id ?? null)

  return (
    <Roster.Provider value={players}>
      <div className="flex flex-col gap-4 py-4 lg:min-h-0 lg:flex-1 lg:gap-5 lg:py-5">
        <div className="space-y-2 px-4 lg:px-5">
          {player && !wanted && (
            <p className="text-sm text-amber-700">No player called “{player}” here. Pick one below.</p>
          )}
          <SessionSelect
            className="w-full lg:w-72"
            scope={scope}
            onChange={setScope}
            session={session}
            history={data.history}
            all={all}
            recent={recent}
            current={session.games.length ? 'Current session' : null}
          />
        </div>
        <PlayerStats sessions={sessions} scope={label} showDate={span} chosen={chosen} onChoose={setChosen} />
      </div>
    </Roster.Provider>
  )
}
