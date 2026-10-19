import { costSummary, money, shuttlesUsed } from '../lib/cost'
import { EmptyState, MoneyField, Stepper } from '../components/ui'
import { usePlayerMap, useStore } from '../store/useStore'

export function CostsPage() {
  const session = useStore((s) => s.session)
  const setField = useStore((s) => s.setSessionField)
  const togglePaid = useStore((s) => s.togglePaid)
  const closeSession = useStore((s) => s.closeSession)
  const players = usePlayerMap()

  const c = costSummary(session)
  const fromGames = shuttlesUsed(session) - session.extraShuttles
  const paidCount = session.attendees.filter((a) => a.paid).length
  const attendees = [...session.attendees].sort((a, b) =>
    (players.get(a.playerId)?.name ?? '').localeCompare(players.get(b.playerId)?.name ?? ''),
  )
  const live = session.courts.some(Boolean)

  return (
    <div className="grid h-full grid-cols-[22rem_1fr] gap-5 p-5">
      <div className="space-y-4 overflow-y-auto">
        <div className="card space-y-4 p-5">
          <h2 className="text-lg font-bold">Session costs</h2>
          <MoneyField label="Total court fee" value={session.courtFee} onChange={(n) => setField('courtFee', n)} />
          <MoneyField label="Price per shuttlecock" value={session.shuttlePrice} onChange={(n) => setField('shuttlePrice', n)} />
          <div>
            <p className="mb-1 text-sm font-medium text-slate-500">Shuttlecocks used</p>
            <p className="text-sm text-slate-600">
              {fromGames} opened during games
              {session.extraShuttles !== 0 && ` ${session.extraShuttles > 0 ? '+' : '−'} ${Math.abs(session.extraShuttles)} adjustment`}
            </p>
            <div className="mt-2">
              <Stepper
                label="Adjust"
                value={session.extraShuttles}
                min={-fromGames}
                onChange={(n) => setField('extraShuttles', n)}
              />
            </div>
          </div>
        </div>

        <div className="card space-y-2 p-5 text-lg">
          <Row label="Court fee" value={money(session.courtFee)} />
          <Row label={`Shuttles (${c.shuttlesUsed} × ${money(session.shuttlePrice)})`} value={money(c.shuttleCost)} />
          <Row label="Total" value={money(c.total)} strong />
          <Row label="Players" value={String(c.heads)} />
          <div className="mt-3 rounded-2xl bg-teal-700 p-4 text-center text-white">
            <p className="text-sm font-semibold opacity-80">Per head</p>
            <p className="text-4xl font-black tabular-nums">{money(c.perHead)}</p>
            {c.surplus > 0 && (
              <p className="mt-1 text-xs opacity-80">
                exact {money(c.perHeadExact)} · rounded up, {money(c.surplus)} extra
              </p>
            )}
          </div>
        </div>

      </div>

      <div className="card flex flex-col overflow-hidden">
        <div className="flex items-center border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-bold">Payments</h2>
          <span className="ml-auto text-slate-600">
            <strong className="text-teal-700">{paidCount}</strong> / {session.attendees.length} paid ·{' '}
            {money(paidCount * c.perHead)} collected
          </span>
          <button
            className="btn-danger ml-4 py-2"
            disabled={session.attendees.length === 0}
            onClick={() => {
              const msg = live
                ? 'Games are still on court. End them and end this session?'
                : 'End this session and save it to history?'
              if (confirm(msg)) closeSession()
            }}
          >
            End session
          </button>
        </div>
        {attendees.length === 0 ? (
          <div className="p-5">
            <EmptyState>Check in players to see who owes what.</EmptyState>
          </div>
        ) : (
          <ul className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-4">
            {attendees.map((a) => (
              <li key={a.playerId}>
                <button
                  onClick={() => togglePaid(a.playerId)}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left ring-1 transition active:scale-[0.98] ${
                    a.paid ? 'bg-emerald-50 ring-emerald-300' : 'bg-white ring-slate-200'
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                      a.paid ? 'bg-emerald-600 text-white' : 'ring-2 ring-slate-300'
                    }`}
                  >
                    {a.paid ? '✓' : ''}
                  </span>
                  <span className="flex-1 truncate text-lg font-semibold">{players.get(a.playerId)?.name}</span>
                  <span className="text-xs text-slate-500">{a.gamesPlayed} games</span>
                  <span className={`font-bold tabular-nums ${a.paid ? 'text-emerald-700' : ''}`}>{money(c.perHead)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'border-t border-slate-200 pt-2 font-bold' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
