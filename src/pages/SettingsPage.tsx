import { useRef, useState } from 'react'
import { exportBackup, LAST_BACKUP_KEY } from '../lib/backup'
import { costSummary, courtBooking, dueFor, money, pricingOf } from '../lib/cost'
import { longDate } from '../lib/stats'
import { ClubAccountCard } from '../components/Cloud'
import { EmptyState, MoneyField, Stepper } from '../components/ui'
import { useCloud } from '../lib/cloud'
import { usePlayerMap, useStore } from '../store/useStore'
import type { PricingStyle, Session } from '../types'

const STYLES: { id: PricingStyle; label: string; hint: string }[] = [
  { id: 'split', label: 'Split', hint: 'Costs shared equally' },
  { id: 'perGame', label: 'Per game', hint: 'Court fee + each game' },
  { id: 'flat', label: 'Fixed', hint: 'One fee, unli games' },
]

/** How players pay (split, per game or a fixed fee) and the amounts. */
function PricingCard() {
  const session = useStore((s) => s.session)
  const setPricing = useStore((s) => s.setPricing)
  const p = pricingOf(session)

  return (
    <div className="d-card d-card-border bg-base-100 shadow-sm">
      <div className="d-card-body gap-3 p-4">
        <h2 className="d-card-title text-lg">How players pay</h2>
        <div role="radiogroup" aria-label="How players pay" className="grid grid-cols-3 gap-1.5">
          {STYLES.map((o) => {
            const on = p.style === o.id
            return (
              <button
                key={o.id}
                role="radio"
                aria-checked={on}
                className={`rounded-xl px-2 py-2 text-left ring-1 transition active:scale-[0.97] ${
                  on ? 'bg-teal-50 ring-2 ring-teal-600' : 'bg-white ring-slate-200'
                }`}
                onClick={() => setPricing({ style: o.id })}
              >
                <span className={`block text-sm font-bold ${on ? 'text-teal-800' : 'text-slate-800'}`}>{o.label}</span>
                <span className="block text-xs leading-snug text-slate-500">{o.hint}</span>
              </button>
            )
          })}
        </div>
        {p.style === 'split' && (
          <p className="text-sm text-slate-600">The court fee and shuttles are shared equally by everyone checked in.</p>
        )}
        {p.style === 'perGame' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <MoneyField label="Court fee, once" value={p.entry} onChange={(n) => setPricing({ entry: n })} />
              <MoneyField label="Each game" value={p.perGame} onChange={(n) => setPricing({ perGame: n })} />
            </div>
            <p className="text-sm text-slate-500 tabular-nums">
              {[2, 4, 6].map((n) => `${n} games ${money(dueFor(p, n))}`).join(' · ')}
            </p>
          </>
        )}
        {p.style === 'flat' && (
          <MoneyField label="Per player, unlimited games" value={p.flat} onChange={(n) => setPricing({ flat: n })} />
        )}
        <p className="text-xs text-slate-500">
          Applies to today&apos;s session; the next session starts with the same style and amounts.
        </p>
      </div>
    </div>
  )
}

const readLastBackup = () => {
  try {
    return Number(localStorage.getItem(LAST_BACKUP_KEY)) || null
  } catch {
    return null
  }
}


function ago(ms: number) {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export function SettingsPage() {
  const players = useStore((s) => s.players)
  const history = useStore((s) => s.history)
  const resetSession = useStore((s) => s.resetSession)
  const clearAll = useStore((s) => s.clearAll)
  const importData = useStore((s) => s.importData)
  const fileRef = useRef<HTMLInputElement>(null)
  const [lastBackup, setLastBackup] = useState(readLastBackup)
  const club = useCloud((s) => s.club)

  const exportData = () => setLastBackup(exportBackup())

  const onImport = async (file: File) => {
    try {
      const data = JSON.parse(await file.text())
      if (!Array.isArray(data.players)) throw new Error('missing players')
      if (confirm(`Replace data with backup (${data.players.length} players)?`)) importData(data)
    } catch {
      alert('That file is not a valid MBQ backup.')
    }
  }

  const stale = !lastBackup || Date.now() - lastBackup > 7 * 86_400_000

  const clear = () => {
    const justBackedUp = !!lastBackup && Date.now() - lastBackup < 60 * 60_000
    const what = `${players.length} players, ${history.length} past ${history.length === 1 ? 'session' : 'sessions'} and today's session`
    const warn = justBackedUp ? '' : "\n\nYou haven't exported a backup in the last hour. Export one first if you want to keep this data."
    const cloud = club ? `\n\nThis also deletes it from ${club.name} in the cloud.` : ''
    if (confirm(`Delete all data on this iPad: ${what}?${warn}${cloud}\n\nThis cannot be undone.`)) clearAll()
  }

  return (
    <div className="grid h-full grid-cols-[22rem_1fr] gap-5 p-5">
      <div className="space-y-4 overflow-y-auto">
        <ClubAccountCard />
        <PricingCard />
        <div className="d-card d-card-border bg-base-100 shadow-sm">
          <div className="d-card-body gap-3 p-4">
            <h2 className="d-card-title text-lg">Backup</h2>
            <p className="text-sm text-slate-600">
              {club
                ? `Data is on this iPad and saved to ${club.name}. A backup file is still handy to keep a copy of your own.`
                : 'Data is stored on this iPad only. Export a backup to keep it safe or move it to another device.'}
            </p>
            <ul className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ['Players', players.length],
                  ['Sessions', history.length],
                  ['Games', history.reduce((n, s) => n + s.games.length, 0)],
                ] as const
              ).map(([label, n]) => (
                <li key={label} className="rounded-xl bg-slate-50 py-2">
                  <p className="text-xl font-bold tabular-nums">{n}</p>
                  <p className="text-xs text-slate-500">{label}</p>
                </li>
              ))}
            </ul>
            <div role="status" className={`d-alert d-alert-soft py-2 text-sm ${stale ? 'd-alert-warning' : 'd-alert-success'}`}>
              {lastBackup ? `Last backup ${ago(lastBackup)}` : 'No backup from this iPad yet'}
              {stale && ' · export one soon'}
            </div>
            <button className="d-btn d-btn-primary w-full" onClick={exportData}>
              Export backup
            </button>
            <button className="d-btn w-full border-slate-200 bg-white" onClick={() => fileRef.current?.click()}>
              Import backup
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onImport(f)
                e.target.value = ''
              }}
            />
          </div>
        </div>

        <div className="d-card d-card-border border-rose-200 bg-base-100 shadow-sm">
          <div className="d-card-body gap-3 p-4">
            <h2 className="d-card-title text-lg">Current session</h2>
            <p className="text-sm text-slate-600">
              Clear today&apos;s check-ins, queue and games without saving to history. Players are kept.
            </p>
            <p className="text-xs text-slate-500">
              To keep today in history, use <strong>End session</strong> on the Costs tab instead.
            </p>
            <button
              className="d-btn d-btn-error d-btn-soft w-full"
              onClick={() => confirm('Discard the current session? This cannot be undone.') && resetSession()}
            >
              Discard session
            </button>
          </div>
        </div>

        <div className="d-card d-card-border border-rose-200 bg-base-100 shadow-sm">
          <div className="d-card-body gap-3 p-4">
            <h2 className="d-card-title text-lg">Clear all data</h2>
            <p className="text-sm text-slate-600">
              Delete players, today&apos;s session and history from this iPad, for example before importing a backup.
            </p>
            <p className="text-xs text-slate-500">Export a backup first if you want to keep anything.</p>
            <button className="d-btn d-btn-error w-full" onClick={clear}>
              Clear all data
            </button>
          </div>
        </div>
      </div>

      <History sessions={history} />
    </div>
  )
}

/** A past session's court fee, with its booking, which can be corrected (e.g. 3 courts, not 2). */
function HistoryCourt({ session }: { session: Session }) {
  const setBooking = useStore((s) => s.setHistoryCourtBooking)
  const [editing, setEditing] = useState(false)
  const b = courtBooking(session)
  const set = (patch: Parameters<typeof setBooking>[1]) => setBooking(session.id, patch)
  const booked = session.courtBooking && `${b.courts} ${b.courts === 1 ? 'court' : 'courts'} × ${b.hours} h × ${money(b.rate)}`

  if (!editing) {
    return (
      <p>
        Court {money(session.courtFee)}
        {booked && <span className="ml-1.5 text-xs text-slate-500">({booked})</span>}
        <button className="ml-2 text-sm font-semibold text-teal-700 underline-offset-2 hover:underline" onClick={() => setEditing(true)}>
          Edit
        </button>
      </p>
    )
  }
  return (
    <div className="my-1 w-64 space-y-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-500">Courts</span>
        <Stepper value={b.courts} min={1} max={12} onChange={(n) => set({ courts: n })} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-500">Hours</span>
        <Stepper value={b.hours} min={0.5} max={12} step={0.5} onChange={(n) => set({ hours: n })} />
      </div>
      <MoneyField label="Per court, per hour" value={b.rate} onChange={(n) => set({ rate: n })} />
      <div className="flex items-center gap-2 border-t border-slate-200 pt-2">
        <span className="font-bold tabular-nums">Court {money(session.courtFee)}</span>
        <button className="d-btn d-btn-sm d-btn-primary ml-auto" onClick={() => setEditing(false)}>
          Done
        </button>
      </div>
    </div>
  )
}

/** Past sessions, newest first; tap one to see its cost breakdown and who didn't pay. */
function History({ sessions }: { sessions: Session[] }) {
  const players = usePlayerMap()
  const togglePaid = useStore((s) => s.togglePaidInHistory)
  const [open, setOpen] = useState<string | null>(null)
  const summaries = sessions.map((s) => ({ s, c: costSummary(s) }))
  const collected = summaries.reduce((n, { c }) => n + c.collected, 0)
  const avg = (f: (x: (typeof summaries)[number]) => number) =>
    summaries.length ? summaries.reduce((n, x) => n + f(x), 0) / summaries.length : 0

  return (
    <section className="d-card d-card-border flex flex-col overflow-hidden bg-base-100 shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-lg font-bold">History</h2>
      </div>
      {sessions.length === 0 ? (
        <div className="p-5">
          <EmptyState>Sessions you end on the Costs tab will appear here.</EmptyState>
        </div>
      ) : (
        <>
          <div className="d-stats rounded-none border-b border-slate-100">
            <div className="d-stat py-3">
              <div className="d-stat-title">Sessions</div>
              <div className="d-stat-value text-2xl tabular-nums">{sessions.length}</div>
            </div>
            <div className="d-stat py-3">
              <div className="d-stat-title">Avg players</div>
              <div className="d-stat-value text-2xl tabular-nums">{Math.round(avg(({ c }) => c.heads))}</div>
            </div>
            <div className="d-stat py-3">
              <div className="d-stat-title">Avg per head</div>
              <div className="d-stat-value text-2xl tabular-nums">{money(Math.round(avg(({ c }) => c.perHead)))}</div>
            </div>
            <div className="d-stat py-3">
              <div className="d-stat-title">Collected</div>
              <div className="d-stat-value text-2xl text-emerald-700 tabular-nums">{money(collected)}</div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="d-table d-table-pin-rows tabular-nums">
              <thead>
                <tr className="bg-white">
                  <th>Date</th>
                  <th className="text-right">Players</th>
                  <th className="text-right">Games</th>
                  <th className="text-right">Shuttles</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Per head</th>
                  <th className="text-right">Paid</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map(({ s, c }) => {
                  const paid = c.paidCount
                  const expanded = open === s.id
                  const nameOf = (id: string) => players.get(id)?.name ?? '?'
                  const byPlayer = (a: { playerId: string }, b: { playerId: string }) => nameOf(a.playerId).localeCompare(nameOf(b.playerId))
                  const unpaid = c.dues
                    .filter((d) => d.owing > 0 || !s.attendees.find((a) => a.playerId === d.playerId)?.paid)
                    .sort(byPlayer)
                  const paidUp = c.dues.filter((d) => !unpaid.includes(d)).sort(byPlayer)
                  return [
                    <tr
                      key={s.id}
                      className={`cursor-pointer ${expanded ? 'bg-teal-50' : 'hover:bg-slate-50'}`}
                      onClick={() => setOpen(expanded ? null : s.id)}
                    >
                      <td className="font-semibold whitespace-nowrap">
                        <span className="mr-1.5 inline-block w-3 text-slate-400">{expanded ? '▾' : '▸'}</span>
                        {longDate(s.date)}
                      </td>
                      <td className="text-right">{c.heads}</td>
                      <td className="text-right">{s.games.length}</td>
                      <td className="text-right">{c.shuttlesUsed}</td>
                      <td className="text-right">{money(c.total)}</td>
                      <td className="text-right font-semibold">
                        {c.pricing.style === 'perGame' && <span className="mr-1 text-xs font-normal text-slate-400">avg</span>}
                        {money(c.perHead)}
                      </td>
                      <td className="text-right">
                        <span className={`d-badge d-badge-sm d-badge-soft ${paid === c.heads ? 'd-badge-success' : 'd-badge-warning'}`}>
                          {paid}/{c.heads}
                        </span>
                      </td>
                    </tr>,
                    expanded && (
                      <tr key={s.id + '-detail'} className="bg-teal-50/50">
                        <td colSpan={7} className="pt-0">
                          <div className="flex flex-wrap gap-x-8 gap-y-2 py-2 pl-5 text-sm">
                            <div>
                              <p className="text-xs font-semibold text-slate-500 uppercase">Costs</p>
                              <HistoryCourt session={s} />
                              {c.shuttles.map((l) => (
                                <p key={l.id}>
                                  {c.shuttles.length > 1 ? l.name : 'Shuttles'}: {l.used} × {money(l.price)} = {money(l.cost)}
                                </p>
                              ))}
                            </div>
                            {c.pricing.style !== 'split' && (
                              <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase">Players paid</p>
                                <p>
                                  {c.pricing.style === 'perGame'
                                    ? `${money(c.pricing.entry)} + ${money(c.pricing.perGame)} a game`
                                    : `${money(c.pricing.flat)} each, unlimited games`}
                                </p>
                                <p>Due {money(c.expected)}</p>
                                <p className={c.margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                                  {money(Math.abs(c.margin))} {c.margin >= 0 ? 'over' : 'short of'} costs
                                </p>
                              </div>
                            )}
                            <div className="min-w-0 flex-1 space-y-2">
                              <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase">
                                  {unpaid.length ? `Not paid (${unpaid.length})` : 'Payments'}
                                </p>
                                {unpaid.length ? (
                                  <>
                                    <p className="text-xs text-slate-500">Tap a name once they've paid.</p>
                                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                                      {unpaid.map((d) => (
                                        <li key={d.playerId}>
                                          <button
                                            className="rounded-full bg-rose-50 px-3 py-1.5 font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 active:scale-95"
                                            title={`Mark ${nameOf(d.playerId)} paid`}
                                            onClick={() => togglePaid(s.id, d.playerId)}
                                          >
                                            {nameOf(d.playerId)}
                                            <span className="ml-1.5 font-normal tabular-nums">{money(d.owing)}</span>
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  </>
                                ) : (
                                  <p className="text-emerald-700">Everyone paid</p>
                                )}
                              </div>
                              {paidUp.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-slate-500 uppercase">Paid ({paidUp.length})</p>
                                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                                    {paidUp.map((d) => (
                                      <li key={d.playerId}>
                                        <button
                                          className="rounded-full bg-emerald-50 px-2.5 py-1 text-sm text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-100 active:scale-95"
                                          title={`Mark ${nameOf(d.playerId)} not paid`}
                                          onClick={() => togglePaid(s.id, d.playerId)}
                                        >
                                          ✓ {nameOf(d.playerId)}
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
