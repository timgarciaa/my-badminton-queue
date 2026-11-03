import { useEffect, useRef, useState, type ReactNode } from 'react'
import { niceTicks } from '../lib/trends'

/** Chart colours: one teal for the data, slate for the frame. */
const MARK = '#0d9488'
const MARK_HOVER = '#0f766e'
const GRID = '#e2e8f0'
const AXIS = '#94a3b8'
const INK = '#475569'

export interface Datum {
  key: string
  label: string
  value: number | null
  /** Shown on hover or tap, under the value. */
  tip?: string
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** The value and its detail, floating over the hovered mark. */
function Tip({ x, y, value, tip, flip }: { x: number; y: number; value: string; tip?: string; flip?: boolean }) {
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg"
      style={{ left: x, top: y, transform: `translate(${flip ? '-100%' : '-50%'}, calc(-100% - 8px))` }}
    >
      <div className="text-sm font-bold tabular-nums">{value}</div>
      {tip && <div className="text-slate-300">{tip}</div>}
    </div>
  )
}

/** A rounded-top column (or rounded-bottom, below zero), square at the baseline. */
function column(x: number, w: number, y0: number, y1: number) {
  const r = Math.min(4, w / 2, Math.abs(y1 - y0))
  if (y1 <= y0) {
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`
}

/**
 * Columns along a category axis (sessions or games), with an optional average
 * line. Values can go below zero. Tap or hover a column for its value.
 */
export function Columns({
  data,
  format,
  average,
  height = 190,
}: {
  data: Datum[]
  format: (v: number) => string
  /** Draws a reference line, labelled "avg". */
  average?: number | null
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<string | null>(null)
  const values = data.map((d) => d.value).filter((v): v is number => v !== null)
  const ticks = niceTicks(Math.min(...values, 0), Math.max(...values, 0))
  const top = 14
  const bottom = 24
  const left = 40
  // Room on the right for the average's label.
  const right = average === undefined || average === null ? 4 : 56
  const plotH = height - top - bottom
  const plotW = Math.max(0, width - left - right)
  const lo = ticks[0]
  const hi = ticks.at(-1)!
  const y = (v: number) => top + ((hi - v) / (hi - lo)) * plotH
  const band = data.length ? plotW / data.length : 0
  const barW = Math.max(2, Math.min(24, band * 0.6))
  // Label every nth category so labels never collide (about 48px each).
  const every = Math.max(1, Math.ceil(48 / Math.max(1, band)))
  const shown = data.find((d) => d.key === active)
  const i = shown ? data.indexOf(shown) : -1

  return (
    <div ref={ref} className="relative" onPointerLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={data.map((d) => `${d.label}: ${d.value === null ? 'none' : format(d.value)}`).join(', ')}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
              <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK} className="tabular-nums">
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, k) => {
            const cx = left + band * k + band / 2
            return (
              <g
                key={d.key}
                tabIndex={0}
                role="button"
                aria-label={`${d.label}: ${d.value === null ? 'none' : format(d.value)}`}
                onPointerEnter={() => setActive(d.key)}
                onPointerDown={() => setActive(d.key)}
                onFocus={() => setActive(d.key)}
                onBlur={() => setActive(null)}
                className="cursor-pointer outline-none"
              >
                {/* The hit area is the whole band, not just the column. */}
                <rect x={left + band * k} y={top} width={band} height={plotH} fill="transparent" />
                {d.value !== null && (
                  <path d={column(cx - barW / 2, barW, y(0), y(d.value))} fill={active === d.key ? MARK_HOVER : MARK} />
                )}
                {k % every === 0 && (
                  <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill={INK}>
                    {d.label}
                  </text>
                )}
              </g>
            )
          })}
          {average !== undefined && average !== null && (
            <g pointerEvents="none">
              <line x1={left} x2={left + plotW + 4} y1={y(average)} y2={y(average)} stroke="#0f172a" strokeWidth={1} strokeOpacity={0.55} />
              <text x={left + plotW + 8} y={y(average)} dy="0.32em" fontSize={11} fontWeight={600} fill="#0f172a">
                <tspan>avg</tspan>
                <tspan x={left + plotW + 8} dy="1.2em">
                  {format(average)}
                </tspan>
              </text>
            </g>
          )}
        </svg>
      )}
      {shown && shown.value !== null && (
        <Tip
          x={left + band * i + band / 2}
          y={y(Math.max(0, shown.value))}
          value={format(shown.value)}
          tip={shown.tip ?? shown.label}
          flip={left + band * i + band / 2 > width - 80}
        />
      )}
    </div>
  )
}

/** Horizontal bars, one row per item (players), values can go below zero. */
export function Bars({ data, format, average }: { data: Datum[]; format: (v: number) => string; average?: number | null }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<string | null>(null)
  const values = data.map((d) => d.value).filter((v): v is number => v !== null)
  const ticks = niceTicks(Math.min(...values, 0), Math.max(...values, 0))
  const row = 26
  const left = 104
  const right = 56
  const top = 18
  const height = top + data.length * row + 4
  const lo = ticks[0]
  const hi = ticks.at(-1)!
  const plotW = Math.max(0, width - left - right)
  const x = (v: number) => left + ((v - lo) / (hi - lo)) * plotW
  const barH = 14
  const rounded = (x0: number, x1: number, yy: number) => {
    const r = Math.min(4, Math.abs(x1 - x0), barH / 2)
    if (x1 >= x0) return `M${x0},${yy}H${x1 - r}Q${x1},${yy} ${x1},${yy + r}V${yy + barH - r}Q${x1},${yy + barH} ${x1 - r},${yy + barH}H${x0}Z`
    return `M${x0},${yy}H${x1 + r}Q${x1},${yy} ${x1},${yy + r}V${yy + barH - r}Q${x1},${yy + barH} ${x1 + r},${yy + barH}H${x0}Z`
  }
  return (
    <div ref={ref} className="relative" onPointerLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={data.map((d) => `${d.label}: ${d.value === null ? 'none' : format(d.value)}`).join(', ')}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={top - 4} y2={height} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
              <text x={x(t)} y={10} textAnchor="middle" fontSize={11} fill={INK} className="tabular-nums">
                {format(t)}
              </text>
            </g>
          ))}
          {average !== undefined && average !== null && (
            <line x1={x(average)} x2={x(average)} y1={top - 4} y2={height} stroke="#0f172a" strokeWidth={1} strokeOpacity={0.55} />
          )}
          {data.map((d, k) => {
            const yy = top + k * row + (row - barH) / 2
            return (
              <g
                key={d.key}
                tabIndex={0}
                role="button"
                aria-label={`${d.label}: ${d.value === null ? 'none' : format(d.value)}`}
                onPointerEnter={() => setActive(d.key)}
                onPointerDown={() => setActive(d.key)}
                onFocus={() => setActive(d.key)}
                onBlur={() => setActive(null)}
                className="cursor-pointer outline-none"
              >
                <rect x={0} y={top + k * row} width={width} height={row} fill={active === d.key ? '#f1f5f9' : 'transparent'} />
                <text x={left - 8} y={yy + barH / 2} dy="0.32em" textAnchor="end" fontSize={12} fill="#0f172a">
                  {d.label.length > 14 ? `${d.label.slice(0, 13)}…` : d.label}
                </text>
                {d.value !== null && (
                  <>
                    <path d={rounded(x(0), x(d.value), yy)} fill={active === d.key ? MARK_HOVER : MARK} />
                    <text
                      x={d.value >= 0 ? x(d.value) + 6 : x(0) + 6}
                      y={yy + barH / 2}
                      dy="0.32em"
                      fontSize={11}
                      fill={INK}
                      className="tabular-nums"
                    >
                      {format(d.value)}
                    </text>
                  </>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {active && data.find((d) => d.key === active)?.tip && (
        <Tip
          x={width - right}
          y={top + data.findIndex((d) => d.key === active) * row}
          value={data.find((d) => d.key === active)!.label}
          tip={data.find((d) => d.key === active)!.tip}
          flip
        />
      )}
    </div>
  )
}

/** Fewest to most per category, with the average as a dot. */
export function Ranges({
  data,
  format,
  height = 190,
}: {
  data: { key: string; label: string; min: number; avg: number; max: number; tip?: string }[]
  format: (v: number) => string
  height?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<string | null>(null)
  const ticks = niceTicks(0, Math.max(1, ...data.map((d) => d.max)))
  const top = 14
  const bottom = 24
  const left = 40
  const plotH = height - top - bottom
  const plotW = Math.max(0, width - left - 4)
  const hi = ticks.at(-1)!
  const y = (v: number) => top + ((hi - v) / hi) * plotH
  const band = data.length ? plotW / data.length : 0
  const every = Math.max(1, Math.ceil(48 / Math.max(1, band)))
  const i = data.findIndex((d) => d.key === active)
  const shown = data[i]
  return (
    <div ref={ref} className="relative" onPointerLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={data.map((d) => `${d.label}: ${format(d.min)} to ${format(d.max)}, average ${format(d.avg)}`).join(', ')}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width} y1={y(t)} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
              <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK} className="tabular-nums">
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, k) => {
            const cx = left + band * k + band / 2
            const on = active === d.key
            return (
              <g
                key={d.key}
                tabIndex={0}
                role="button"
                aria-label={`${d.label}: ${format(d.min)} to ${format(d.max)}`}
                onPointerEnter={() => setActive(d.key)}
                onPointerDown={() => setActive(d.key)}
                onFocus={() => setActive(d.key)}
                onBlur={() => setActive(null)}
                className="cursor-pointer outline-none"
              >
                <rect x={left + band * k} y={top} width={band} height={plotH} fill="transparent" />
                <line x1={cx} x2={cx} y1={y(d.min)} y2={y(d.max)} stroke={on ? MARK_HOVER : MARK} strokeWidth={2} strokeLinecap="round" strokeOpacity={0.45} />
                {[d.min, d.max].map((v, j) => (
                  <line key={j} x1={cx - 6} x2={cx + 6} y1={y(v)} y2={y(v)} stroke={on ? MARK_HOVER : MARK} strokeWidth={2} strokeLinecap="round" />
                ))}
                <circle cx={cx} cy={y(d.avg)} r={5} fill={on ? MARK_HOVER : MARK} stroke="#ffffff" strokeWidth={2} />
                {k % every === 0 && (
                  <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill={INK}>
                    {d.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {shown && (
        <Tip
          x={left + band * i + band / 2}
          y={y(shown.max)}
          value={`${format(shown.min)}–${format(shown.max)}`}
          tip={shown.tip}
          flip={left + band * i + band / 2 > width - 80}
        />
      )}
    </div>
  )
}

/** A chart card: title and what it shows, with a switch to the numbers as a table. */
export function ChartCard({
  title,
  subtitle,
  table,
  children,
  className = '',
}: {
  title: string
  subtitle: string
  /** Rows for the table view: label, value. */
  table: [string, string][]
  children: ReactNode
  className?: string
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={`d-card bg-base-100 p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>
      <div className="mb-2 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{title}</h3>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <button className="d-btn d-btn-ghost d-btn-xs text-slate-500" onClick={() => setAsTable((t) => !t)}>
          {asTable ? 'Chart' : 'Table'}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="d-table d-table-sm">
            <tbody>
              {table.map(([label, value], k) => (
                <tr key={k}>
                  <td>{label}</td>
                  <td className="text-right font-semibold tabular-nums">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  )
}
