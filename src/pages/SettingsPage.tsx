import { useRef, useState } from 'react'
import { costSummary, money } from '../lib/cost'
import { longDate } from '../lib/stats'
import { EmptyState } from '../components/ui'
import { usePlayerMap, useStore } from '../store/useStore'
import type { Session } from '../types'

/** When this iPad last exported a backup (per device, so browser storage is enough). */
const LAST_BACKUP_KEY = 'mbq-last-backup'
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

  const exportData = () => {
    const { players, session, history } = useStore.getState()
    const blob = new Blob([JSON.stringify({ app: 'mbq', version: 1, players, session, history }, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `mbq-backup-${new Date().toLocaleDateString('en-CA')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    const now = Date.now()
    try {
      localStorage.setItem(LAST_BACKUP_KEY, String(now))
    } catch {
      // Private mode: just don't remember it.
    }
    setLastBackup(now)
  }

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
    if (confirm(`Delete all data on this iPad: ${what}?${warn}\n\nThis cannot be undone.`)) clearAll()
  }

  return (
    <div className="grid h-full grid-cols-[22rem_1fr] gap-5 p-5">
      <div className="space-y-4 overflow-y-auto">
        <div className="d-card d-card-border bg-base-100 shadow-sm">
          <div className="d-card-body gap-3 p-4">
            <h2 className="d-card-title text-lg">Backup</h2>
            <p className="text-sm text-slate-600">
              Data is stored on this iPad only. Export a backup to keep it safe or move it to another device.
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

/** Past sessions, newest first; tap one to see its cost breakdown and who didn't pay. */
function History({ sessions }: { sessions: Session[] }) {
  const players = usePlayerMap()
  const [open, setOpen] = useState<string | null>(null)
  const summaries = sessions.map((s) => ({ s, c: costSummary(s) }))
  const collected = summaries.reduce((n, { s, c }) => n + s.attendees.filter((a) => a.paid).length * c.perHead, 0)
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
                  const paid = s.attendees.filter((a) => a.paid).length
                  const expanded = open === s.id
                  const unpaid = s.attendees.filter((a) => !a.paid).map((a) => players.get(a.playerId)?.name ?? '?')
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
                      <td className="text-right font-semibold">{money(c.perHead)}</td>
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
                              <p>Court {money(s.courtFee)}</p>
                              {c.shuttles.map((l) => (
                                <p key={l.id}>
                                  {c.shuttles.length > 1 ? l.name : 'Shuttles'}: {l.used} × {money(l.price)} = {money(l.cost)}
                                </p>
                              ))}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-slate-500 uppercase">
                                {unpaid.length ? `Not paid (${unpaid.length})` : 'Payments'}
                              </p>
                              <p className={unpaid.length ? 'text-rose-700' : 'text-emerald-700'}>
                                {unpaid.length ? unpaid.join(', ') : 'Everyone paid'}
                              </p>
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
