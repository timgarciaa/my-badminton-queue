import { costSummary, money, sessionStarted, shuttleCount, shuttlesInStock, type ShuttleLine } from '../lib/cost'
import { Fragment, useEffect, useState } from 'react'
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
  const [ending, setEnding] = useState(false)

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
        <ShuttleCountCard />
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
            onClick={() => setEnding(true)}
          >
            End session
          </button>
        </div>
        {ending && (
          <EndSessionDialog
            unpaid={session.attendees.filter((a) => !a.paid).map((a) => players.get(a.playerId)?.name ?? '?')}
            live={live}
            onCancel={() => setEnding(false)}
            onEnd={() => {
              setEnding(false)
              closeSession()
            }}
          />
        )}

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

/** Confirm ending the session, with who still has to pay. */
function EndSessionDialog({
  unpaid,
  live,
  onCancel,
  onEnd,
}: {
  unpaid: string[]
  live: boolean
  onCancel: () => void
  onEnd: () => void
}) {
  return (
    <div className="d-modal d-modal-open" role="dialog" aria-modal="true" aria-labelledby="end-session-title">
      <div className="d-modal-box max-w-md space-y-4">
        <h2 id="end-session-title" className="text-xl font-bold">
          End session
        </h2>
        <p className="text-lg">
          Are you sure you want to end the session? Is everyone <strong>PAID</strong>?
        </p>
        {unpaid.length > 0 ? (
          <div role="alert" className="d-alert d-alert-warning d-alert-soft block">
            <strong>{unpaid.length} still to pay:</strong>{' '}
            {[...unpaid].sort((a, b) => a.localeCompare(b)).join(', ')}
          </div>
        ) : (
          <div role="status" className="d-alert d-alert-success d-alert-soft block">
            Everyone has paid.
          </div>
        )}
        {live && <p className="text-sm text-slate-500">Games still on court will be ended.</p>}
        <p className="text-sm text-slate-500">The session is saved to history.</p>
        <div className="d-modal-action mt-0">
          <button className="d-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="d-btn d-btn-error" onClick={onEnd}>
            End session
          </button>
        </div>
      </div>
      <button className="d-modal-backdrop" aria-label="Close" onClick={onCancel} />
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
  const session = useStore((s) => s.session)
  const types = session.shuttleTypes ?? []
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
              <Stepper
                label="Adjust"
                value={t.extra}
                min={-fromGames}
                max={Math.min(999, t.extra + shuttlesInStock(session, t.id))}
                onChange={(n) => update(t.id, { extra: n })}
              />
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

/**
 * Shuttles of each type on hand before the session (locked once it starts),
 * and what's left at the end, to see how many were used.
 */
function ShuttleCountCard() {
  const session = useStore((s) => s.session)
  const setStart = useStore((s) => s.setShuttlesStart)
  const setLeft = useStore((s) => s.setShuttlesLeft)
  const started = sessionStarted(session)
  const count = shuttleCount(session)
  const off = count.used === undefined ? 0 : count.used - count.recorded

  return (
    <div className="d-card d-card-border bg-base-100 shadow-sm space-y-3 p-5">
      <h2 className="text-lg font-bold">Shuttle count</h2>
      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_2.5rem] items-center gap-x-2 gap-y-2">
        <span />
        <span className="flex items-center gap-1 text-sm font-medium text-slate-500">
          At start
          {started && (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} aria-label="Locked">
              <path d="M6 11h12v10H6zM8 11V7a4 4 0 018 0v4" />
            </svg>
          )}
        </span>
        <span className="text-sm font-medium text-slate-500">Left</span>
        <span className="text-right text-sm font-medium text-slate-500">Used</span>
        {count.lines.map((l) => (
          <Fragment key={l.id}>
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-semibold">{l.name}</span>
              {started && l.start !== undefined && l.left === undefined && (
                <span className={`block text-xs ${l.start > l.recorded ? 'text-slate-500' : 'font-semibold text-amber-700'}`}>
                  {Math.max(0, l.start - l.recorded)} in stock
                </span>
              )}
            </span>
            <CountInput
              label={`${l.name} at start`}
              value={l.start}
              disabled={started}
              onChange={(n) => setStart(l.id, n)}
            />
            <CountInput
              label={`${l.name} left`}
              value={l.left}
              max={l.start}
              disabled={!started || l.start === undefined}
              onChange={(n) => setLeft(l.id, n)}
            />
            <span
              className={`text-right text-xl font-bold tabular-nums ${l.used !== undefined && l.used !== l.recorded ? 'text-amber-700' : ''}`}
              title={l.used !== undefined ? `${l.recorded} recorded in games` : undefined}
            >
              {l.used ?? '—'}
            </span>
          </Fragment>
        ))}
        {count.lines.length > 1 && (
          <>
            <span className="border-t border-slate-200 pt-2 font-bold">Total</span>
            <span className="border-t border-slate-200 px-3 pt-2 text-xl font-bold tabular-nums">{count.start ?? '—'}</span>
            <span className="border-t border-slate-200 px-3 pt-2 text-xl font-bold tabular-nums">{count.left ?? '—'}</span>
            <span className="border-t border-slate-200 pt-2 text-right text-xl font-bold tabular-nums">{count.used ?? '—'}</span>
          </>
        )}
      </div>
      {count.used !== undefined ? (
        <div className="flex items-baseline gap-2 rounded-xl bg-teal-50 px-3 py-2 ring-1 ring-teal-200">
          <span className="text-sm font-semibold text-teal-900">Used</span>
          <span className="text-2xl font-black text-teal-900 tabular-nums">{count.used}</span>
          <span className="ml-auto text-right text-xs text-slate-500">
            {count.recorded} recorded
            {off !== 0 && (
              <span className="block font-semibold text-amber-700">
                {Math.abs(off)} {off > 0 ? 'more' : 'fewer'} than recorded
              </span>
            )}
          </span>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          {!started
            ? 'Count each type before you start. This locks once the session starts.'
            : count.start !== undefined
              ? 'At the end, count what’s left to see how many were used.'
              : 'No starting count was entered for this session.'}
        </p>
      )}
    </div>
  )
}

/** Whole-number input; empty means not entered. */
function CountInput({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string
  value?: number
  max?: number
  disabled?: boolean
  onChange: (n?: number) => void
}) {
  return (
    <input
      className="field px-3 py-2 text-xl font-bold tabular-nums disabled:bg-slate-100 disabled:text-slate-500"
      inputMode="numeric"
      aria-label={label}
      placeholder="—"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9]/g, '')
        onChange(t ? Math.min(Number(t), max ?? Infinity) : undefined)
      }}
    />
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
