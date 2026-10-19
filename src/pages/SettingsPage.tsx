import { useRef } from 'react'
import { costSummary, money } from '../lib/cost'
import { EmptyState } from '../components/ui'
import { useStore } from '../store/useStore'

export function SettingsPage() {
  const history = useStore((s) => s.history)
  const resetSession = useStore((s) => s.resetSession)
  const importData = useStore((s) => s.importData)
  const fileRef = useRef<HTMLInputElement>(null)

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

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="card space-y-3 p-5">
        <h2 className="text-lg font-bold">Backup</h2>
        <p className="text-slate-600">Data is stored on this iPad only. Export a backup to keep it safe or move it to another device.</p>
        <div className="flex gap-3">
          <button className="btn-primary" onClick={exportData}>
            Export backup
          </button>
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
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

      <div className="card space-y-3 p-5">
        <h2 className="text-lg font-bold">Current session</h2>
        <p className="text-slate-600">Clear today&apos;s check-ins, queue and games without saving to history. Players are kept.</p>
        <button className="btn-danger" onClick={() => confirm('Discard the current session?') && resetSession()}>
          Discard session
        </button>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-lg font-bold">History</h2>
        {history.length === 0 ? (
          <EmptyState>Closed sessions will appear here.</EmptyState>
        ) : (
          <table className="w-full text-left">
            <thead className="text-sm text-slate-500">
              <tr>
                <th className="py-2">Date</th>
                <th>Players</th>
                <th>Games</th>
                <th>Shuttles</th>
                <th>Total</th>
                <th>Per head</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {history.map((s) => {
                const c = costSummary(s)
                return (
                  <tr key={s.id}>
                    <td className="py-2 font-semibold">{s.date}</td>
                    <td>{c.heads}</td>
                    <td>{s.games.length}</td>
                    <td>{c.shuttlesUsed}</td>
                    <td>{money(c.total)}</td>
                    <td>{money(c.perHead)}</td>
                    <td>
                      {s.attendees.filter((a) => a.paid).length}/{c.heads}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
