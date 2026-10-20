import { costSummary, money, type ShuttleLine } from '../lib/cost'
import { useEffect, useState } from 'react'
import { EmptyState, MoneyField, Stepper } from '../components/ui'
import { usePlayerMap, useStore } from '../store/useStore'
import type { ShuttleType } from '../types'

type PayFilter = 'all' | 'unpaid' | 'paid'

export function CostsPage() {
  const session = useStore((s) => s.session)
  const setField = useStore((s) => s.setSessionField)
  const togglePaid = useStore((s) => s.togglePaid)
  const closeSession = useStore((s) => s.closeSession)
  const players = usePlayerMap()
  const [filter, setFilter] = useState<PayFilter>('all')

  const c = costSummary(session)
  const paidCount = session.attendees.filter((a) => a.paid).length
  const collected = paidCount * c.perHead
  const expected = c.heads * c.perHead
  const attendees = [...session.attendees]
    .filter((a) => filter === 'all' || a.paid === (filter === 'paid'))
    // Stay in name order so a row doesn't jump away when it's tapped.
    .sort((a, b) => (players.get(a.playerId)?.name ?? '').localeCompare(players.get(b.playerId)?.name ?? ''))
  const live = session.courts.some(Boolean)

  return (
    <div className="grid h-full grid-cols-[22rem_1fr] gap-5 p-5">
      <div className="space-y-4 overflow-y-auto">
        <PerHeadCard />
        <div className="d-card d-card-border bg-base-100 shadow-sm p-4">
          <MoneyField label="Total court fee" value={session.courtFee} onChange={(n) => setField('courtFee', n)} />
        </div>
        <ShuttlesCard lines={c.shuttles} />
      </div>

      <div className="d-card d-card-border bg-base-100 shadow-sm flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
          <h2 className="text-lg font-bold">Payments</h2>
          <div role="tablist" className="d-tabs d-tabs-box d-tabs-sm ml-2">
            {(
              [
                ['all', 'All', c.heads],
                ['unpaid', 'Unpaid', c.heads - paidCount],
                ['paid', 'Paid', paidCount],
              ] as const
            ).map(([id, label, n]) => (
              <button
                key={id}
                role="tab"
                className={`d-tab gap-1.5 font-semibold ${filter === id ? 'd-tab-active' : ''}`}
                onClick={() => setFilter(id)}
              >
                {label} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>
          <button
            className="d-btn d-btn-error d-btn-soft ml-auto"
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

        <div className="d-stats rounded-none border-b border-slate-100">
          <div className="d-stat py-3">
            <div className="d-stat-title">Collected</div>
            <div className="d-stat-value text-2xl text-emerald-700 tabular-nums">{money(collected)}</div>
            <div className="d-stat-desc">
              <progress className="d-progress d-progress-success w-full" value={paidCount} max={c.heads || 1} />
            </div>
          </div>
          <div className="d-stat py-3">
            <div className="d-stat-title">Still to collect</div>
            <div className="d-stat-value text-2xl tabular-nums">{money(expected - collected)}</div>
            <div className="d-stat-desc">of {money(expected)}</div>
          </div>
          <div className="d-stat py-3">
            <div className="d-stat-title">Paid</div>
            <div className="d-stat-value text-2xl tabular-nums">
              {paidCount}
              <span className="text-base font-semibold text-slate-400"> / {c.heads}</span>
            </div>
            <div className="d-stat-desc">{c.heads - paidCount ? `${c.heads - paidCount} to go` : c.heads ? 'Everyone paid' : '—'}</div>
          </div>
        </div>

        {session.attendees.length === 0 ? (
          <div className="p-5">
            <EmptyState>Check in players to see who owes what.</EmptyState>
          </div>
        ) : attendees.length === 0 ? (
          <div className="p-5">
            <EmptyState>{filter === 'paid' ? 'Nobody has paid yet.' : 'Everyone has paid.'}</EmptyState>
          </div>
        ) : (
          <ul className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-4">
            {attendees.map((a) => (
              <li key={a.playerId}>
                <label
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition active:scale-[0.98] ${
                    a.paid ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="d-checkbox d-checkbox-success"
                    checked={a.paid}
                    onChange={() => togglePaid(a.playerId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg leading-tight font-semibold">
                      {players.get(a.playerId)?.name}
                    </span>
                    <span className="text-xs text-slate-500">
                      {a.gamesPlayed} {a.gamesPlayed === 1 ? 'game' : 'games'}
                      {a.paid && ' · paid'}
                    </span>
                  </span>
                  <span className={`text-lg font-bold tabular-nums ${a.paid ? 'text-emerald-700' : ''}`}>
                    {money(c.perHead)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** What each player pays, split into court fee, each shuttle type, and rounding. */
function PerHeadCard() {
  const session = useStore((s) => s.session)
  const c = costSummary(session)
  const each = (n: number) => (c.heads ? n / c.heads : 0)
  const rounding = c.perHead - each(c.total)
  const lines = [
    { label: 'Court', detail: money(session.courtFee), value: each(session.courtFee) },
    ...c.shuttles.map((l) => ({
      label: c.shuttles.length > 1 ? l.name : 'Shuttles',
      detail: `${l.used} × ${money(l.price)}`,
      value: each(l.cost),
    })),
  ]
  const cents = (n: number) => money(Math.round(n * 100) / 100)

  return (
    <div className="d-card d-card-border bg-base-100 shadow-sm overflow-hidden">
      <div className="bg-teal-700 px-5 py-4 text-white">
        <p className="text-sm font-semibold opacity-80">Per head</p>
        <p className="text-4xl font-black tabular-nums">{money(c.perHead)}</p>
        <p className="text-sm opacity-80">
          {money(c.total)} total · {c.heads} {c.heads === 1 ? 'player' : 'players'}
        </p>
      </div>
      <ul className="space-y-1.5 px-5 py-3 text-sm">
        {lines.map((l) => (
          <li key={l.label} className="flex items-baseline gap-2">
            <span className="font-semibold text-slate-700">{l.label}</span>
            <span className="text-xs text-slate-400">{l.detail}</span>
            <span className="ml-auto font-semibold tabular-nums">{cents(l.value)}</span>
          </li>
        ))}
        {rounding > 0.004 && (
          <li className="flex items-baseline gap-2 text-slate-500">
            <span>Rounded up</span>
            <span className="text-xs text-slate-400">{money(c.surplus)} extra in total</span>
            <span className="ml-auto tabular-nums">+{cents(rounding)}</span>
          </li>
        )}
        <li className="flex items-baseline border-t border-slate-200 pt-1.5 font-bold">
          <span>Each pays</span>
          <span className="ml-auto tabular-nums">{money(c.perHead)}</span>
        </li>
      </ul>
    </div>
  )
}

/** Shuttle types with their prices and counts; tap one to make it the shuttle being opened. */
function ShuttlesCard({ lines }: { lines: ShuttleLine[] }) {
  const types = useStore((s) => s.session.shuttleTypes ?? [])
  const inUse = useStore((s) => s.session.shuttleTypeId)
  const add = useStore((s) => s.addShuttleType)
  const update = useStore((s) => s.updateShuttleType)
  const remove = useStore((s) => s.removeShuttleType)
  const makeDefault = useStore((s) => s.setDefaultShuttleType)
  const games = useStore((s) => s.session.games)
  const lineOf = (t: ShuttleType) => lines.find((l) => l.id === t.id)
  // Only a type no game has picked can be removed (older untyped games count as the first type).
  const picked = (t: ShuttleType, i: number) => games.some((g) => g.shuttleType === t.id || (i === 0 && !g.shuttleType))

  return (
    <div className="d-card d-card-border bg-base-100 shadow-sm space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Shuttlecocks</h2>
        <button className="d-btn d-btn-sm" onClick={() => add('', 0)}>
          + Add type
        </button>
      </div>
      {types.length > 1 && (
        <p className="text-sm text-slate-500">New games start with the default. Change a game's shuttle on its court card.</p>
      )}
      {types.map((t, i) => {
        const line = lineOf(t)
        const fromGames = line?.fromGames ?? 0
        const active = t.id === inUse
        return (
          <div
            key={t.id}
            className={`space-y-3 rounded-xl p-3 ring-1 ${active ? 'bg-teal-50 ring-teal-300' : 'bg-white ring-slate-200'}`}
          >
            <div className="flex items-center gap-2">
              <input
                className="field min-w-0 flex-1 py-2 text-base font-semibold"
                value={t.name}
                placeholder="Name, e.g. Vortex"
                onChange={(e) => update(t.id, { name: e.target.value })}
                onBlur={(e) => !e.target.value.trim() && update(t.id, { name: 'Shuttle' })}
              />
              {types.length > 1 &&
                (active ? (
                  <span className="d-badge d-badge-primary shrink-0 font-semibold">Default</span>
                ) : (
                  <button className="d-btn d-btn-sm shrink-0" onClick={() => makeDefault(t.id)}>
                    Make default
                  </button>
                ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="relative w-32">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400">₱</span>
                <PriceInput value={t.price} onChange={(n) => update(t.id, { price: n })} />
              </label>
              <Stepper label="Adjust" value={t.extra} min={-fromGames} onChange={(n) => update(t.id, { extra: n })} />
            </div>
            <div className="flex items-center justify-between gap-2 text-sm text-slate-600">
              <span>
                <strong className="text-slate-900">{line?.used ?? 0}</strong> used · {fromGames} from games
                {t.extra !== 0 && `, ${t.extra > 0 ? '+' : '−'}${Math.abs(t.extra)} adjusted`}
              </span>
              {types.length > 1 && !picked(t, i) && (
                <button
                  className="font-semibold text-rose-600"
                  onClick={() => confirm(`Remove ${t.name}?`) && remove(t.id)}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Compact peso input; keeps what's typed (e.g. "80.") while editing. */
function PriceInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(value ? String(value) : '')
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : value ? String(value) : ''))
  }, [value])
  return (
    <input
      className="field py-2 pl-7 text-base tabular-nums"
      inputMode="decimal"
      placeholder="Price"
      aria-label="Price each"
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9.]/g, '')
        setText(t)
        onChange(Number(t) || 0)
      }}
    />
  )
}
