import { useState } from 'react'
import { costSummary, money } from './lib/cost'
import { SessionTimer } from './components/SessionTimer'
import { CheckInPage } from './pages/CheckInPage'
import { CostsPage } from './pages/CostsPage'
import { GamesPage } from './pages/GamesPage'
import { PlayersPage } from './pages/PlayersPage'
import { SessionPage } from './pages/SessionPage'
import { SettingsPage } from './pages/SettingsPage'
import { useStore } from './store/useStore'

// Simple stroke icons (24x24 viewBox path data)
const TABS = [
  { id: 'session', label: 'Courts', icon: 'M3 5h18v14H3zM12 5v14M3 12h18' },
  { id: 'games', label: 'Games', icon: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3' },
  { id: 'checkin', label: 'Check-in', icon: 'M5 12l4 4L19 6' },
  { id: 'players', label: 'Players', icon: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M16 3.5a4 4 0 010 7M22 21v-1a6 6 0 00-4-5.6' },
  { id: 'costs', label: 'Costs', icon: 'M8 21V3h5a4.5 4.5 0 010 9H8M5 6h14M5 9h14' },
  { id: 'settings', label: 'Settings', icon: 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4' },
] as const

type Tab = (typeof TABS)[number]['id']

export default function App() {
  const [tab, setTab] = useState<Tab>('session')
  const session = useStore((s) => s.session)
  const c = costSummary(session)

  return (
    <div className="flex h-full flex-col pt-[env(safe-area-inset-top)]">
      <header className="flex items-center gap-6 border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-baseline gap-6">
          <h1 className="text-2xl font-black tracking-tight whitespace-nowrap text-teal-700">
            My Badminton Queue{' '}
            <span className="text-base font-semibold tracking-normal text-teal-600/80">by Serve N&apos; Shout</span>
          </h1>
          <span className="whitespace-nowrap text-slate-500">
            {new Date(session.date + 'T00:00').toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'short',
            })}
          </span>
        </div>
        <div className="ml-auto">
          <SessionTimer />
        </div>
        <div className="flex gap-6 text-sm text-slate-600">
          <Stat label="Present" value={session.attendees.length} />
          <Stat label="Waiting" value={session.queue.length} />
          <Stat label="Playing" value={session.courts.filter(Boolean).length * 4} />
          <Stat label="Shuttles" value={c.shuttlesUsed} />
          <Stat label="Per head" value={money(c.perHead)} />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'session' && <SessionPage onGoToCheckIn={() => setTab('checkin')} />}
        {tab === 'games' && <GamesPage />}
        {tab === 'checkin' && <CheckInPage onGoToPlayers={() => setTab('players')} />}
        {tab === 'players' && <PlayersPage />}
        {tab === 'costs' && <CostsPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>

      <nav className="flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-sm font-semibold transition ${
              tab === t.id ? 'text-teal-700' : 'text-slate-400'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d={t.icon} />
            </svg>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-right">
      <div className="text-lg leading-tight font-bold text-slate-900 tabular-nums">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  )
}
