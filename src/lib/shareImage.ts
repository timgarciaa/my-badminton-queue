import { useCloud } from './cloud'
import { ordinal, type PlayerRecord } from './stats'

export interface StandingRow extends PlayerRecord {
  name: string
  rate: number | null
  /** Place, shared by tied players (1, 1, 2...). */
  place: number
}

/** The line at the top of a shared image: the app, and the club when signed in. */
const brand = () => {
  const club = useCloud.getState().club?.name
  return club ? `My Badminton Queue · ${club}` : 'My Badminton Queue'
}

const W = 1080
const PAD = 56
const HEAD = 260
const ROW = 72
const FOOT = 110
const FONT = 'ui-rounded, -apple-system, "SF Pro Rounded", system-ui, sans-serif'
/** Badge and bracket colours for 1st, 2nd and 3rd place. */
const MEDALS: Record<number, [string, string]> = {
  1: ['#fcd34d', '#f59e0b'],
  2: ['#cbd5e1', '#94a3b8'],
  3: ['#fed7aa', '#fb923c'],
}

type Ctx = CanvasRenderingContext2D

function canvas(width: number, height: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return [c, c.getContext('2d')!]
}

/** PNG of the canvas. toDataURL is synchronous (unlike toBlob), so the share sheet can open straight from the tap. */
function png(c: HTMLCanvasElement): Blob {
  const bytes = atob(c.toDataURL('image/png').split(',')[1])
  const buf = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
  return new Blob([buf], { type: 'image/png' })
}

function writer(ctx: Ctx) {
  return (s: string, x: number, y: number, size: number, color: string, weight = 600, align: CanvasTextAlign = 'left') => {
    ctx.font = `${weight} ${size}px ${FONT}`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(s, x, y)
  }
}

/** Shorten with an ellipsis to fit, in the current font. */
function fit(ctx: Ctx, s: string, max: number) {
  if (ctx.measureText(s).width <= max) return s
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1)
  return s + '…'
}

/** Split into at most `lines` lines that fit, in the current font; the last one is shortened if needed. */
function wrap(ctx: Ctx, s: string, max: number, lines: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of s.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= max || !line) line = next
    else {
      out.push(line)
      line = word
    }
  }
  out.push(line)
  return out.length <= lines ? out : [...out.slice(0, lines - 1), fit(ctx, out.slice(lines - 1).join(' '), max)]
}

/** Repeatable pseudo-random numbers, so the same image comes out every time. */
function random(seed: number) {
  return () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
}

/** A shuttlecock pointing up from (x, y) at its cork, `size` tall, turned by `angle` radians. */
function shuttle(ctx: Ctx, x: number, y: number, size: number, angle: number, band = '#0d9488') {
  const s = size
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.lineJoin = 'round'
  // Feather skirt, widening away from the cork, with a scalloped rim.
  const base = 0.17 * s
  const rim = 0.46 * s
  const top = -0.95 * s
  ctx.beginPath()
  ctx.moveTo(-base, -0.04 * s)
  ctx.lineTo(-rim, top)
  const scallops = 8
  for (let i = 0; i < scallops; i++) {
    const x0 = -rim + ((2 * rim) / scallops) * i
    const x1 = x0 + (2 * rim) / scallops
    ctx.quadraticCurveTo((x0 + x1) / 2, top - 0.07 * s, x1, top)
  }
  ctx.lineTo(base, -0.04 * s)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(15,23,42,0.18)'
  ctx.lineWidth = s * 0.012
  ctx.stroke()
  // Feather shafts.
  ctx.strokeStyle = 'rgba(15,23,42,0.16)'
  ctx.lineWidth = s * 0.008
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath()
    ctx.moveTo((i / 3) * base * 0.8, -0.05 * s)
    ctx.lineTo((i / 3) * rim * 0.92, top + 0.02 * s)
    ctx.stroke()
  }
  // Two threads binding the feathers.
  ctx.strokeStyle = band
  ctx.lineWidth = s * 0.02
  for (const t of [0.32, 0.6]) {
    const yy = -0.04 * s + (top + 0.04 * s) * t
    const half = base + (rim - base) * t
    ctx.beginPath()
    ctx.moveTo(-half, yy)
    ctx.lineTo(half, yy)
    ctx.stroke()
  }
  // Cork with a coloured band.
  ctx.beginPath()
  ctx.arc(0, 0, base * 1.12, 0, Math.PI)
  ctx.closePath()
  ctx.fillStyle = '#f5f5f4'
  ctx.fill()
  ctx.strokeStyle = 'rgba(15,23,42,0.2)'
  ctx.lineWidth = s * 0.012
  ctx.stroke()
  ctx.fillStyle = band
  ctx.fillRect(-base * 1.12, -0.06 * s, base * 2.24, 0.07 * s)
  ctx.restore()
}

/** A badminton court seen from above: doubles and singles lines, service lines and the net. */
function court(ctx: Ctx, x: number, y: number, w: number, h: number, angle: number, color: string, lineWidth: number) {
  ctx.save()
  ctx.translate(x + w / 2, y + h / 2)
  ctx.rotate(angle)
  ctx.translate(-w / 2, -h / 2)
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
  ctx.strokeRect(0, 0, w, h)
  const side = w * 0.075
  line(side, 0, side, h)
  line(w - side, 0, w - side, h)
  const back = h * 0.057
  line(0, back, w, back)
  line(0, h - back, w, h - back)
  const short = h * 0.148
  line(0, h / 2 - short, w, h / 2 - short)
  line(0, h / 2 + short, w, h / 2 + short)
  line(w / 2, 0, w / 2, h / 2 - short)
  line(w / 2, h / 2 + short, w / 2, h)
  ctx.lineWidth = lineWidth * 2
  line(-w * 0.03, h / 2, w * 1.03, h / 2)
  ctx.restore()
}

/** Confetti: little ribbons and dots scattered over an area. */
function confetti(ctx: Ctx, x: number, y: number, w: number, h: number, colors: string[], count: number, seed: number) {
  const rnd = random(seed)
  for (let i = 0; i < count; i++) {
    ctx.save()
    ctx.translate(x + rnd() * w, y + rnd() * h)
    ctx.rotate(rnd() * Math.PI)
    ctx.fillStyle = colors[i % colors.length]
    ctx.globalAlpha = 0.55 + rnd() * 0.45
    if (i % 3) ctx.fillRect(-9, -3.5, 18, 7)
    else {
      ctx.beginPath()
      ctx.arc(0, 0, 5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

/** Speed lines trailing a flying shuttle. */
function swoosh(ctx: Ctx, x: number, y: number, size: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  for (const [dy, len, width] of [
    [-0.2, 0.9, 0.035],
    [0.05, 1.2, 0.045],
    [0.3, 0.75, 0.03],
  ]) {
    ctx.lineWidth = size * width
    ctx.beginPath()
    ctx.moveTo(x - size * 0.35, y + size * dy)
    ctx.quadraticCurveTo(x - size * (0.35 + len / 2), y + size * (dy + 0.12), x - size * (0.35 + len), y + size * (dy + 0.05))
    ctx.stroke()
  }
  ctx.restore()
}

/** A shuttle flying up and to the right, cork first, with speed lines trailing its feathers. */
function flyingShuttle(ctx: Ctx, cx: number, cy: number, size: number, band: string, trail: string) {
  // Feathers point down-left (cork leads up-right): local "up" turned by about -127°.
  const angle = -2.21
  const tipX = cx + Math.sin(angle) * 0.95 * size
  const tipY = cy - Math.cos(angle) * 0.95 * size
  swoosh(ctx, tipX + 0.35 * size * 0.9, tipY - 0.05 * size, size * 0.9, trail)
  shuttle(ctx, cx, cy, size, angle, band)
}

/** Striped rows, so place badges and brackets (which span tied rows) can draw over them. */
function stripes(ctx: Ctx, count: number, top: number) {
  for (let i = 0; i < count; i += 2) {
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(PAD / 2, top + i * ROW, W - PAD, ROW)
  }
}

/** One badge per place (1st, 2nd...), centred on its rows, with a bracket joining tied rows. */
function placeBadges(ctx: Ctx, places: number[], x: number, top: number) {
  const text = writer(ctx)
  ctx.textBaseline = 'middle'
  places.forEach((place, i) => {
    if (place === places[i - 1]) return
    const tied = places.filter((p) => p === place).length
    const [fill, line] = MEDALS[place] ?? ['#f1f5f9', '#cbd5e1']
    const mid = top + i * ROW + (tied * ROW) / 2
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.roundRect(x - 30, mid - 20, 60, 40, 20)
    ctx.fill()
    text(ordinal(place), x, mid + 1, 22, '#1e293b', 800, 'center')
    if (tied > 1) {
      const bx = x + 42
      const [y0, y1] = [top + i * ROW + 12, top + (i + tied) * ROW - 12]
      ctx.strokeStyle = line
      ctx.lineWidth = 4
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(bx + 10, y0)
      ctx.lineTo(bx, y0)
      ctx.lineTo(bx, y1)
      ctx.lineTo(bx + 10, y1)
      ctx.stroke()
    }
  })
}

/** An analogue clock face showing `time`. */
function clockFace(ctx: Ctx, cx: number, cy: number, r: number, time: Date, accent: string) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = r * 0.08
  ctx.beginPath()
  ctx.arc(0, 0, r * 1.08, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = '#1e293b'
  ctx.lineCap = 'round'
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const inner = i % 3 ? 0.82 : 0.72
    ctx.lineWidth = i % 3 ? r * 0.03 : r * 0.06
    ctx.beginPath()
    ctx.moveTo(Math.sin(a) * r * inner, -Math.cos(a) * r * inner)
    ctx.lineTo(Math.sin(a) * r * 0.9, -Math.cos(a) * r * 0.9)
    ctx.stroke()
  }
  const hand = (turns: number, len: number, width: number, color: string) => {
    const a = turns * Math.PI * 2
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(Math.sin(a) * len, -Math.cos(a) * len)
    ctx.stroke()
  }
  const m = time.getMinutes()
  hand(((time.getHours() % 12) + m / 60) / 12, r * 0.5, r * 0.09, '#1e293b')
  hand(m / 60, r * 0.75, r * 0.06, accent)
  ctx.fillStyle = accent
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * The standings as a PNG, ready to share: a header with court lines, a flying
 * shuttlecock and confetti, then one row per player with places and ties.
 */
export function standingsImage(rows: StandingRow[], { title, subtitle }: { title: string; subtitle: string }): Blob {
  const [c, ctx] = canvas(W, HEAD + 70 + rows.length * ROW + FOOT)
  const text = writer(ctx)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, c.height)
  const head = ctx.createLinearGradient(0, 0, W, HEAD)
  head.addColorStop(0, '#115e59')
  head.addColorStop(0.6, '#0f766e')
  head.addColorStop(1, '#14b8a6')
  ctx.fillStyle = head
  ctx.fillRect(0, 0, W, HEAD)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, W, HEAD)
  ctx.clip()
  court(ctx, 640, -120, 300, 620, -0.35, 'rgba(255,255,255,0.16)', 4)
  confetti(ctx, 560, 10, 500, HEAD - 20, ['#fde68a', '#ffffff', '#99f6e4', '#fda4af'], 26, 7)
  flyingShuttle(ctx, 985, 70, 150, '#0d9488', 'rgba(255,255,255,0.35)')
  ctx.restore()

  ctx.textBaseline = 'alphabetic'
  text(brand(), PAD, 76, 28, 'rgba(255,255,255,0.8)')
  text(title, PAD, 160, 66, '#ffffff', 800)
  text(subtitle, PAD, 214, 30, 'rgba(255,255,255,0.88)', 500)

  // Columns: rank, name, played, won, lost, win %.
  const col = { rank: PAD + 26, name: PAD + 92, p: 700, w: 790, l: 880, pct: W - PAD }
  const y = HEAD + 50
  ctx.textBaseline = 'middle'
  for (const [label, x, align] of [
    ['#', col.rank, 'center'],
    ['Player', col.name, 'left'],
    ['P', col.p, 'center'],
    ['W', col.w, 'center'],
    ['L', col.l, 'center'],
    ['Win %', col.pct, 'right'],
  ] as const)
    text(label, x, y, 24, '#64748b', 700, align)

  const top = y + 20
  const rowTop = (i: number) => top + i * ROW
  stripes(ctx, rows.length, top)
  placeBadges(ctx, rows.map((r) => r.place), col.rank, top)
  rows.forEach((r, i) => {
    const mid = rowTop(i) + ROW / 2
    ctx.font = `600 34px ${FONT}`
    text(fit(ctx, r.name, col.p - col.name - 50), col.name, mid, 34, '#0f172a')
    text(String(r.played), col.p, mid, 30, '#64748b', 500, 'center')
    text(String(r.wins), col.w, mid, 32, '#047857', 800, 'center')
    text(String(r.losses), col.l, mid, 32, '#e11d48', 800, 'center')
    text(r.rate === null ? '–' : `${Math.round(r.rate * 100)}%`, col.pct, mid, 32, '#0f172a', 700, 'right')
  })

  ctx.textBaseline = 'alphabetic'
  text('P played · W won · L lost · ranked by wins, then win % · same record = same place', PAD, c.height - 45, 24, '#94a3b8', 500)
  return png(c)
}

export interface CheckinImageRow {
  name: string
  place: number
  sessions: number
  firsts: number
  /** Average minutes after the first arrival. */
  after: number
  /** Check-in time, for one session. */
  at?: number
}

/**
 * Check-in standings as a PNG: a night-to-sunrise sky with a clock (at the
 * first arrival's time) and a shuttle flying past, then everyone in order of
 * arrival. One session shows times; several show sessions, firsts and the
 * average minutes after the first arrival.
 */
export function checkinImage(rows: CheckinImageRow[], { title, subtitle }: { title: string; subtitle: string }): Blob {
  const [c, ctx] = canvas(W, HEAD + 70 + rows.length * ROW + FOOT)
  const text = writer(ctx)
  const single = rows.some((r) => r.at !== undefined)
  const firstAt = Math.min(...rows.map((r) => r.at ?? Infinity))

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, c.height)
  const sky = ctx.createLinearGradient(0, 0, W, HEAD)
  sky.addColorStop(0, '#1e1b4b')
  sky.addColorStop(0.55, '#4338ca')
  sky.addColorStop(1, '#f59e0b')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, HEAD)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, W, HEAD)
  ctx.clip()
  // A rising sun behind the clock, and stars on the night side.
  const sun = ctx.createRadialGradient(900, HEAD, 10, 900, HEAD, 260)
  sun.addColorStop(0, 'rgba(253,230,138,0.85)')
  sun.addColorStop(1, 'rgba(253,230,138,0)')
  ctx.fillStyle = sun
  ctx.fillRect(560, 0, 520, HEAD)
  confetti(ctx, 380, 8, 420, HEAD - 16, ['#ffffff', '#fde68a', '#c7d2fe'], 22, 3)
  clockFace(ctx, 900, 128, 92, Number.isFinite(firstAt) ? new Date(firstAt) : new Date(2026, 0, 1, 18, 0), '#d97706')
  flyingShuttle(ctx, 790, 70, 105, '#4338ca', 'rgba(255,255,255,0.45)')
  ctx.restore()

  ctx.textBaseline = 'alphabetic'
  text(brand(), PAD, 76, 28, 'rgba(255,255,255,0.8)')
  text(title, PAD, 160, 62, '#ffffff', 800)
  text(subtitle, PAD, 214, 30, 'rgba(255,255,255,0.88)', 500)

  const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const after = (m: number) => (single && !Math.round(m) ? 'First' : `+${Math.round(m)} min`)
  const col = { rank: PAD + 26, name: PAD + 92, a: 590, b: 735, c: W - PAD }
  const head: [string, number, CanvasTextAlign][] = single
    ? [
        ['#', col.rank, 'center'],
        ['Player', col.name, 'left'],
        ['Checked in', col.b, 'center'],
        ['After first', col.c, 'right'],
      ]
    : [
        ['#', col.rank, 'center'],
        ['Player', col.name, 'left'],
        ['Sessions', col.a, 'center'],
        ['Firsts', col.b, 'center'],
        ['Avg after first', col.c, 'right'],
      ]
  const y = HEAD + 50
  ctx.textBaseline = 'middle'
  for (const [label, x, align] of head) text(label, x, y, 24, '#64748b', 700, align)

  const top = y + 20
  stripes(ctx, rows.length, top)
  placeBadges(ctx, rows.map((r) => r.place), col.rank, top)
  rows.forEach((r, i) => {
    const mid = top + i * ROW + ROW / 2
    ctx.font = `600 34px ${FONT}`
    text(fit(ctx, r.name, (single ? col.b - 110 : col.a - 80) - col.name), col.name, mid, 34, '#0f172a')
    if (single) {
      text(clock(r.at!), col.b, mid, 32, '#4338ca', 700, 'center')
    } else {
      text(String(r.sessions), col.a, mid, 30, '#64748b', 500, 'center')
      text(String(r.firsts), col.b, mid, 32, '#b45309', 800, 'center')
    }
    text(after(r.after), col.c, mid, 32, '#0f172a', 700, 'right')
  })

  ctx.textBaseline = 'alphabetic'
  text(
    single ? 'Ranked by check-in time · same minute = same place' : 'Ranked by average minutes after the first arrival, then most firsts',
    PAD,
    c.height - 45,
    24,
    '#94a3b8',
    500,
  )
  return png(c)
}

/** Colours for each award: deep background, bright middle, light accents. */
export const AWARD_TONES = {
  emerald: ['#064e3b', '#059669', '#a7f3d0'],
  rose: ['#881337', '#e11d48', '#fecdd3'],
  amber: ['#78350f', '#d97706', '#fde68a'],
  slate: ['#0f172a', '#475569', '#cbd5e1'],
  orange: ['#7c2d12', '#ea580c', '#fed7aa'],
  violet: ['#4c1d95', '#7c3aed', '#ddd6fe'],
  sky: ['#0c4a6e', '#0284c7', '#bae6fd'],
  teal: ['#134e4a', '#0d9488', '#99f6e4'],
  indigo: ['#312e81', '#4f46e5', '#c7d2fe'],
  lime: ['#365314', '#65a30d', '#d9f99d'],
  cyan: ['#164e63', '#0891b2', '#a5f3fc'],
  fuchsia: ['#701a75', '#c026d3', '#f5d0fe'],
  blue: ['#172554', '#1d4ed8', '#bfdbfe'],
} as const

export type AwardTone = keyof typeof AWARD_TONES

/** A five-or-more-pointed star centred at (x, y). */
function star(ctx: Ctx, x: number, y: number, r: number, color: string, points = 5, inner = 0.45) {
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
    const rr = i % 2 ? r * inner : r
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

/** A badminton racket with the end of its handle at (x, y), pointing up, turned by `angle`. About 1.06 × size long. */
function racket(ctx: Ctx, x: number, y: number, size: number, angle: number, frame: string, grip: string) {
  const s = size
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.fillStyle = grip
  ctx.beginPath()
  ctx.roundRect(-0.045 * s, -0.3 * s, 0.09 * s, 0.3 * s, 0.03 * s)
  ctx.fill()
  ctx.strokeStyle = frame
  ctx.lineWidth = 0.03 * s
  ctx.beginPath()
  ctx.moveTo(0, -0.3 * s)
  ctx.lineTo(0, -0.5 * s)
  ctx.moveTo(0, -0.47 * s)
  ctx.lineTo(-0.1 * s, -0.58 * s)
  ctx.moveTo(0, -0.47 * s)
  ctx.lineTo(0.1 * s, -0.58 * s)
  ctx.stroke()
  const cy = -0.8 * s
  const rx = 0.2 * s
  const ry = 0.26 * s
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(0, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = 0.006 * s
  for (let i = -7; i <= 7; i++) {
    ctx.beginPath()
    ctx.moveTo((i / 7.5) * rx, cy - ry)
    ctx.lineTo((i / 7.5) * rx, cy + ry)
    ctx.moveTo(-rx, cy + (i / 7.5) * ry)
    ctx.lineTo(rx, cy + (i / 7.5) * ry)
    ctx.stroke()
  }
  ctx.restore()
  ctx.strokeStyle = frame
  ctx.lineWidth = 0.04 * s
  ctx.beginPath()
  ctx.ellipse(0, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** A flame whose base is centred at (x, y), `h` tall: red outside, yellow at the heart. */
function flame(ctx: Ctx, x: number, y: number, w: number, h: number) {
  const layer = (scale: number, color: string, lift: number) => {
    const ww = w * scale
    const hh = h * scale
    const by = y - lift
    ctx.beginPath()
    ctx.moveTo(x, by - hh)
    ctx.bezierCurveTo(x + ww * 0.15, by - hh * 0.6, x + ww * 0.62, by - hh * 0.55, x + ww * 0.5, by - hh * 0.2)
    ctx.bezierCurveTo(x + ww * 0.42, by, x + ww * 0.2, by + hh * 0.04, x, by + hh * 0.04)
    ctx.bezierCurveTo(x - ww * 0.2, by + hh * 0.04, x - ww * 0.42, by, x - ww * 0.5, by - hh * 0.2)
    ctx.bezierCurveTo(x - ww * 0.6, by - hh * 0.5, x - ww * 0.3, by - hh * 0.55, x - ww * 0.25, by - hh * 0.75)
    ctx.bezierCurveTo(x - ww * 0.1, by - hh * 0.6, x - ww * 0.05, by - hh * 0.7, x, by - hh)
    ctx.fillStyle = color
    ctx.fill()
  }
  layer(1, '#ef4444', 0)
  layer(0.78, '#f97316', h * 0.02)
  layer(0.55, '#fbbf24', h * 0.03)
  layer(0.32, '#fef9c3', h * 0.03)
}

/** A fluffy cloud centred at (x, y), about 2.2 × r wide. */
function cloud(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  for (const [dx, dy, rr] of [
    [-0.75, 0.15, 0.55],
    [-0.25, -0.25, 0.75],
    [0.4, -0.1, 0.65],
    [0.9, 0.2, 0.45],
    [0.1, 0.25, 0.6],
  ]) {
    ctx.moveTo(x + dx * r + rr * r, y + dy * r)
    ctx.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2)
  }
  ctx.fill()
}

/** Short lines bursting out from (x, y), for impacts and sparkles. */
function burst(ctx: Ctx, x: number, y: number, r0: number, r1: number, count: number, color: string, width: number, turn = 0) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  for (let i = 0; i < count; i++) {
    const a = turn + (i / count) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0)
    ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1)
    ctx.stroke()
  }
  ctx.restore()
}

/** The picture for each award, drawn around (cx, cy) within about ±230. */
export type AwardArt =
  | 'trophy'
  | 'net'
  | 'flame'
  | 'rain'
  | 'rocket'
  | 'target'
  | 'tube'
  | 'clash'
  | 'hourglass'
  | 'stopwatch'
  | 'sunrise'
  | 'moon'
  | 'deuce'

type Tone = readonly [string, string, string]

const ARTS: Record<AwardArt, (ctx: Ctx, cx: number, cy: number, tone: Tone) => void> = {
  // Highest deuce: a flip scoreboard stuck at 20 : 20, with lightning either side.
  deuce(ctx, cx, cy, [deep, , light]) {
    burst(ctx, cx, cy, 250, 300, 16, 'rgba(255,255,255,0.35)', 6)
    // Crossed rackets behind the board.
    racket(ctx, cx - 170, cy + 230, 330, 0.55, '#ffffff', deep)
    racket(ctx, cx + 170, cy + 230, 330, -0.55, '#ffffff', deep)
    // The board on its stand.
    ctx.fillStyle = '#0b1220'
    ctx.beginPath()
    ctx.roundRect(cx - 18, cy + 120, 36, 90, 8)
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(cx - 90, cy + 200, 180, 26, 10)
    ctx.fill()
    ctx.fillStyle = '#111827'
    ctx.strokeStyle = light
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.roundRect(cx - 280, cy - 125, 560, 255, 34)
    ctx.fill()
    ctx.stroke()
    // Two flip cards reading 20, with the fold across the middle.
    for (const side of [-1, 1]) {
      const x = cx + side * 132
      const face = ctx.createLinearGradient(0, cy - 95, 0, cy + 100)
      face.addColorStop(0, '#334155')
      face.addColorStop(0.5, '#1e293b')
      face.addColorStop(0.5, '#0f172a')
      face.addColorStop(1, '#1e293b')
      ctx.fillStyle = face
      ctx.beginPath()
      ctx.roundRect(x - 105, cy - 95, 210, 195, 20)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = `900 150px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('20', x, cy + 8)
      ctx.strokeStyle = '#020617'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(x - 105, cy + 3)
      ctx.lineTo(x + 105, cy + 3)
      ctx.stroke()
      for (const y of [cy - 30, cy + 36]) {
        ctx.fillStyle = '#64748b'
        ctx.fillRect(x - 110, y - 5, 10, 10)
        ctx.fillRect(x + 100, y - 5, 10, 10)
      }
    }
    ctx.fillStyle = light
    for (const y of [cy - 25, cy + 35]) {
      ctx.beginPath()
      ctx.arc(cx, y, 12, 0, Math.PI * 2)
      ctx.fill()
    }
    // Lightning bolts: the tension of two points to win.
    for (const side of [-1, 1]) {
      const x = cx + side * 345
      const y = cy - 70
      ctx.fillStyle = '#fde047'
      ctx.strokeStyle = '#ca8a04'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(x + side * 18, y - 90)
      ctx.lineTo(x - side * 40, y + 20)
      ctx.lineTo(x, y + 20)
      ctx.lineTo(x - side * 22, y + 120)
      ctx.lineTo(x + side * 48, y - 5)
      ctx.lineTo(x + side * 8, y - 5)
      ctx.lineTo(x + side * 38, y - 90)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    star(ctx, cx - 300, cy - 190, 16, '#ffffff', 4, 0.35)
    star(ctx, cx + 290, cy - 200, 22, light, 4, 0.35)
    star(ctx, cx + 230, cy + 170, 14, '#ffffff', 4, 0.35)
  },

  // Unbeatable duo: a golden trophy over two crossed rackets.
  trophy(ctx, cx, cy, [deep]) {
    racket(ctx, cx - 200, cy + 210, 380, 0.5, '#ffffff', deep)
    racket(ctx, cx + 200, cy + 210, 380, -0.5, '#ffffff', deep)
    const gold = ctx.createLinearGradient(cx - 130, 0, cx + 130, 0)
    gold.addColorStop(0, '#f59e0b')
    gold.addColorStop(0.45, '#fde68a')
    gold.addColorStop(1, '#d97706')
    ctx.strokeStyle = gold
    ctx.lineWidth = 24
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(cx + side * 125, cy - 60, 50, side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5, side < 0 ? Math.PI * 1.5 : Math.PI * 0.5)
      ctx.stroke()
    }
    ctx.fillStyle = gold
    ctx.beginPath()
    ctx.moveTo(cx - 130, cy - 130)
    ctx.lineTo(cx + 130, cy - 130)
    ctx.quadraticCurveTo(cx + 125, cy + 45, cx, cy + 65)
    ctx.quadraticCurveTo(cx - 125, cy + 45, cx - 130, cy - 130)
    ctx.fill()
    ctx.fillRect(cx - 20, cy + 55, 40, 55)
    ctx.beginPath()
    ctx.roundRect(cx - 85, cy + 105, 170, 34, 10)
    ctx.fill()
    ctx.fillStyle = '#92400e'
    ctx.beginPath()
    ctx.roundRect(cx - 110, cy + 136, 220, 40, 10)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.beginPath()
    ctx.ellipse(cx - 70, cy - 60, 14, 50, 0.15, 0, Math.PI * 2)
    ctx.fill()
    star(ctx, cx, cy - 45, 42, '#fffbeb')
    star(ctx, cx - 210, cy - 190, 18, '#fde68a', 4, 0.35)
    star(ctx, cx + 220, cy - 150, 24, '#ffffff', 4, 0.35)
    star(ctx, cx + 170, cy - 230, 14, '#fde68a', 4, 0.35)
  },

  // Worst duo: a shuttle stuck in the net.
  net(ctx, cx, cy, [deep, , light]) {
    const top = cy - 70
    const bottom = cy + 110
    ctx.fillStyle = '#e2e8f0'
    for (const x of [cx - 300, cx + 300]) {
      ctx.beginPath()
      ctx.roundRect(x - 9, top - 40, 18, 290, 6)
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 3
    for (let x = cx - 290; x <= cx + 290; x += 24) {
      ctx.beginPath()
      ctx.moveTo(x, top)
      ctx.quadraticCurveTo(x + (x - cx) * 0.02, (top + bottom) / 2 + 12, x, bottom)
      ctx.stroke()
    }
    for (let y = top; y <= bottom; y += 24) {
      ctx.beginPath()
      ctx.moveTo(cx - 291, y)
      ctx.quadraticCurveTo(cx, y + 22, cx + 291, y)
      ctx.stroke()
    }
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.roundRect(cx - 300, top - 14, 600, 18, 6)
    ctx.fill()
    // Bulge where the shuttle hit.
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.ellipse(cx + 40, cy + 20, 60, 44, 0, 0, Math.PI * 2)
    ctx.stroke()
    shuttle(ctx, cx + 40, cy + 25, 200, -0.9, deep)
    burst(ctx, cx + 40, cy + 25, 70, 110, 7, light, 8, -2.4)
    // A loose feather drifting down.
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.ellipse(cx - 120, cy + 190, 9, 28, 1.1, 0, Math.PI * 2)
    ctx.fill()
  },

  // Longest win streak: a shuttle rising out of the flames.
  flame(ctx, cx, cy) {
    flame(ctx, cx, cy + 210, 330, 400)
    shuttle(ctx, cx + 10, cy - 150, 170, Math.PI + 0.15, '#dc2626')
    const rnd = random(7)
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = i % 2 ? '#fde68a' : '#fb923c'
      ctx.beginPath()
      ctx.arc(cx - 220 + rnd() * 440, cy - 200 + rnd() * 330, 4 + rnd() * 7, 0, Math.PI * 2)
      ctx.fill()
    }
  },

  // Longest losing run: rain on a fallen shuttle.
  rain(ctx, cx, cy, [, bright]) {
    ctx.fillStyle = 'rgba(15,23,42,0.18)'
    ctx.beginPath()
    ctx.ellipse(cx + 20, cy + 205, 200, 26, 0, 0, Math.PI * 2)
    ctx.fill()
    shuttle(ctx, cx - 70, cy + 175, 210, Math.PI / 2 + 0.25, bright)
    ctx.fillStyle = '#bae6fd'
    const rnd = random(3)
    for (let i = 0; i < 11; i++) {
      const x = cx - 200 + i * 40 + rnd() * 16
      const y = cy - 10 + rnd() * 140
      ctx.beginPath()
      ctx.moveTo(x, y - 22)
      ctx.quadraticCurveTo(x + 11, y, x, y + 9)
      ctx.quadraticCurveTo(x - 11, y, x, y - 22)
      ctx.fill()
    }
    cloud(ctx, cx - 10, cy - 75, 115, '#e2e8f0')
    cloud(ctx, cx - 10, cy - 88, 105, '#f8fafc')
  },

  // On a roll: a rocket taking off, with a shuttle in the window.
  rocket(ctx, cx, cy, [deep, bright]) {
    for (const [x, y, r] of [
      [cx - 230, cy - 170, 16],
      [cx + 200, cy - 40, 12],
      [cx - 150, cy + 150, 10],
      [cx + 240, cy - 210, 20],
    ]) {
      star(ctx, x, y, r, '#ffffff', 4, 0.35)
    }
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(0.6)
    flame(ctx, 0, 205, 100, -190)
    ctx.fillStyle = bright
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(side * 60, 90)
      ctx.lineTo(side * 120, 190)
      ctx.lineTo(side * 115, 230)
      ctx.lineTo(side * 55, 180)
      ctx.fill()
    }
    ctx.fillStyle = '#f8fafc'
    ctx.beginPath()
    ctx.moveTo(0, -230)
    ctx.bezierCurveTo(70, -170, 82, -40, 70, 110)
    ctx.lineTo(55, 200)
    ctx.lineTo(-55, 200)
    ctx.lineTo(-70, 110)
    ctx.bezierCurveTo(-82, -40, -70, -170, 0, -230)
    ctx.fill()
    ctx.fillStyle = bright
    ctx.beginPath()
    ctx.moveTo(0, -230)
    ctx.bezierCurveTo(40, -196, 56, -160, 62, -130)
    ctx.lineTo(-62, -130)
    ctx.bezierCurveTo(-56, -160, -40, -196, 0, -230)
    ctx.fill()
    ctx.fillRect(-58, 150, 116, 20)
    ctx.fillStyle = deep
    ctx.beginPath()
    ctx.arc(0, -30, 50, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#cbd5e1'
    ctx.lineWidth = 10
    ctx.stroke()
    shuttle(ctx, 0, -2, 70, 0, bright)
    ctx.restore()
  },

  // Best win rate: a shuttle in the bullseye.
  target(ctx, cx, cy, [deep, bright, light]) {
    const rings = [210, 168, 126, 84, 42]
    rings.forEach((r, i) => {
      ctx.fillStyle = i % 2 ? bright : '#ffffff'
      if (i === rings.length - 1) ctx.fillStyle = '#facc15'
      ctx.beginPath()
      ctx.arc(cx, cy + 10, r, 0, Math.PI * 2)
      ctx.fill()
    })
    ctx.strokeStyle = deep
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(cx, cy + 10, 210, 0, Math.PI * 2)
    ctx.stroke()
    burst(ctx, cx, cy + 10, 230, 270, 10, light, 8)
    shuttle(ctx, cx + 6, cy + 12, 230, -0.7, deep)
  },

  // Most games: a tube spilling shuttles.
  tube(ctx, cx, cy, [deep, bright]) {
    ctx.save()
    ctx.translate(cx - 70, cy + 40)
    ctx.rotate(-0.95)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.roundRect(-70, -40, 140, 300, 22)
    ctx.fill()
    ctx.fillStyle = bright
    ctx.fillRect(-70, 60, 140, 70)
    ctx.fillStyle = deep
    ctx.beginPath()
    ctx.roundRect(-74, 230, 148, 40, 14)
    ctx.fill()
    ctx.fillStyle = 'rgba(15,23,42,0.25)'
    ctx.beginPath()
    ctx.ellipse(0, -40, 70, 22, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    for (const [x, y, a] of [
      [cx - 60, cy - 30, 0.2],
      [cx + 40, cy - 70, 0.9],
      [cx + 150, cy - 10, 1.5],
      [cx + 200, cy + 120, 2.2],
    ]) {
      shuttle(ctx, x, y, 125, a, bright)
    }
  },

  // Biggest rivalry: rackets clashing, with a bolt of lightning.
  clash(ctx, cx, cy, [deep, , light]) {
    star(ctx, cx, cy - 120, 120, 'rgba(253,224,71,0.9)', 12, 0.55)
    racket(ctx, cx - 230, cy + 210, 400, 0.55, '#ffffff', deep)
    racket(ctx, cx + 230, cy + 210, 400, -0.55, '#ffffff', deep)
    ctx.fillStyle = '#fde047'
    ctx.strokeStyle = deep
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(cx + 20, cy - 230)
    ctx.lineTo(cx - 45, cy - 110)
    ctx.lineTo(cx + 5, cy - 110)
    ctx.lineTo(cx - 30, cy + 10)
    ctx.lineTo(cx + 60, cy - 135)
    ctx.lineTo(cx + 10, cy - 135)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    burst(ctx, cx, cy - 120, 150, 190, 12, light, 8, 0.2)
  },

  // Longest game: an hourglass.
  hourglass(ctx, cx, cy, [deep]) {
    const top = cy - 190
    const bottom = cy + 190
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.beginPath()
    ctx.moveTo(cx - 125, top + 20)
    ctx.bezierCurveTo(cx - 125, cy - 60, cx - 16, cy - 30, cx - 16, cy)
    ctx.bezierCurveTo(cx - 16, cy + 30, cx - 125, cy + 60, cx - 125, bottom - 20)
    ctx.lineTo(cx + 125, bottom - 20)
    ctx.bezierCurveTo(cx + 125, cy + 60, cx + 16, cy + 30, cx + 16, cy)
    ctx.bezierCurveTo(cx + 16, cy - 30, cx + 125, cy - 60, cx + 125, top + 20)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 8
    ctx.stroke()
    // Sand: a little left on top, a heap below, a stream between.
    ctx.fillStyle = '#fcd34d'
    ctx.beginPath()
    ctx.moveTo(cx - 70, cy - 70)
    ctx.quadraticCurveTo(cx, cy - 85, cx + 70, cy - 70)
    ctx.quadraticCurveTo(cx + 30, cy - 30, cx, cy - 8)
    ctx.quadraticCurveTo(cx - 30, cy - 30, cx - 70, cy - 70)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(cx - 118, bottom - 22)
    ctx.quadraticCurveTo(cx, cy + 40, cx + 118, bottom - 22)
    ctx.fill()
    ctx.fillRect(cx - 3, cy - 8, 6, 120)
    ctx.fillStyle = '#ffffff'
    for (const y of [top, bottom]) {
      ctx.beginPath()
      ctx.roundRect(cx - 160, y - 18, 320, 36, 14)
      ctx.fill()
    }
    ctx.fillStyle = deep
    for (const x of [cx - 140, cx + 140]) ctx.fillRect(x - 6, top + 16, 12, bottom - top - 32)
    star(ctx, cx + 210, cy - 170, 20, '#ffffff', 4, 0.35)
    star(ctx, cx - 220, cy + 120, 14, '#ffffff', 4, 0.35)
  },

  // Shortest game: a stopwatch with speed lines.
  stopwatch(ctx, cx, cy, [deep, bright, light]) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineCap = 'round'
    for (const [dy, len] of [
      [-80, 150],
      [0, 210],
      [80, 130],
    ]) {
      ctx.lineWidth = 14
      ctx.beginPath()
      ctx.moveTo(cx - 200, cy + 30 + dy)
      ctx.lineTo(cx - 200 - len, cy + 30 + dy)
      ctx.stroke()
    }
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.roundRect(cx - 30, cy - 200, 60, 50, 10)
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(cx - 45, cy - 215, 90, 26, 10)
    ctx.fill()
    ctx.save()
    ctx.translate(cx + 140, cy - 125)
    ctx.rotate(0.8)
    ctx.beginPath()
    ctx.roundRect(-18, -25, 36, 40, 8)
    ctx.fill()
    ctx.restore()
    ctx.beginPath()
    ctx.arc(cx, cy + 30, 185, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = bright
    ctx.lineWidth = 16
    ctx.stroke()
    ctx.fillStyle = light
    ctx.beginPath()
    ctx.moveTo(cx, cy + 30)
    ctx.arc(cx, cy + 30, 150, -Math.PI / 2, -Math.PI / 2 + 0.9)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = deep
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      ctx.lineWidth = i % 3 ? 5 : 10
      ctx.beginPath()
      ctx.moveTo(cx + Math.sin(a) * 140, cy + 30 - Math.cos(a) * 140)
      ctx.lineTo(cx + Math.sin(a) * 165, cy + 30 - Math.cos(a) * 165)
      ctx.stroke()
    }
    ctx.lineWidth = 12
    ctx.beginPath()
    ctx.moveTo(cx, cy + 30)
    ctx.lineTo(cx + Math.sin(0.9) * 130, cy + 30 - Math.cos(0.9) * 130)
    ctx.stroke()
    ctx.fillStyle = deep
    ctx.beginPath()
    ctx.arc(cx, cy + 30, 16, 0, Math.PI * 2)
    ctx.fill()
  },

  // Early bird: the sun coming up, with birds.
  sunrise(ctx, cx, cy, [deep]) {
    const horizon = cy + 120
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W, horizon)
    ctx.clip()
    burst(ctx, cx, horizon, 210, 300, 14, 'rgba(254,240,138,0.85)', 16, Math.PI)
    const sun = ctx.createRadialGradient(cx, horizon, 20, cx, horizon, 190)
    sun.addColorStop(0, '#fef9c3')
    sun.addColorStop(1, '#f59e0b')
    ctx.fillStyle = sun
    ctx.beginPath()
    ctx.arc(cx, horizon, 180, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.beginPath()
    ctx.moveTo(cx - 330, horizon + 70)
    ctx.quadraticCurveTo(cx - 180, horizon - 30, cx - 20, horizon + 20)
    ctx.quadraticCurveTo(cx + 160, horizon - 40, cx + 330, horizon + 30)
    ctx.lineTo(cx + 330, horizon + 120)
    ctx.lineTo(cx - 330, horizon + 120)
    ctx.fill()
    ctx.fillStyle = deep
    ctx.fillRect(cx - 330, horizon, 660, 8)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 9
    ctx.lineCap = 'round'
    for (const [x, y, s] of [
      [cx - 170, cy - 160, 1.2],
      [cx - 60, cy - 210, 0.9],
      [cx + 190, cy - 140, 1],
    ]) {
      ctx.beginPath()
      ctx.moveTo(x - 40 * s, y)
      ctx.quadraticCurveTo(x - 18 * s, y - 26 * s, x, y)
      ctx.quadraticCurveTo(x + 18 * s, y - 26 * s, x + 40 * s, y)
      ctx.stroke()
    }
  },

  // Last to arrive: the moon and stars, fast asleep.
  moon(ctx, cx, cy, [, , light]) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W, 700)
    ctx.arc(cx + 80, cy - 70, 160, 0, Math.PI * 2, true)
    ctx.clip()
    const moon = ctx.createRadialGradient(cx - 60, cy - 40, 20, cx - 20, cy, 220)
    moon.addColorStop(0, '#fefce8')
    moon.addColorStop(1, '#fde68a')
    ctx.fillStyle = moon
    ctx.beginPath()
    ctx.arc(cx - 20, cy + 10, 200, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    for (const [x, y, r] of [
      [cx + 200, cy + 110, 22],
      [cx + 250, cy - 40, 14],
      [cx - 250, cy - 170, 18],
      [cx + 110, cy + 200, 12],
      [cx - 230, cy + 160, 12],
    ]) {
      star(ctx, x, y, r, '#ffffff', 5, 0.5)
    }
    const text = writer(ctx)
    ctx.textBaseline = 'alphabetic'
    text('z', cx + 110, cy - 60, 56, light, 900, 'center')
    text('z', cx + 165, cy - 110, 72, light, 900, 'center')
    text('Z', cx + 235, cy - 165, 92, '#ffffff', 900, 'center')
  },
}

export interface AwardCard {
  title: string
  /** Missing while nobody has won it yet; `empty` says why. */
  who?: string
  value?: string
  detail: string
  /** Which games: "All time", "Last 3 months" or a session date. */
  scope: string
  tone: AwardTone
  art: AwardArt
  empty?: string
}

export const AWARD_SIZE = { width: W, height: 1350 }

/**
 * Draws one award (e.g. Unbeatable duo) as a 4:5 card, in a 1080 × 1350
 * space (scale the context to draw it smaller): the award's colours, court
 * lines, confetti and its own picture, then who won it, the big number and
 * what it means. The Stats tab shows these; Share sends the same card.
 */
export function drawAward(ctx: Ctx, { title, who, value, detail, scope, tone, art, empty }: AwardCard) {
  const H = AWARD_SIZE.height
  const text = writer(ctx)
  const colors = AWARD_TONES[tone]
  const [deep, bright, light] = colors
  const won = !!(who && value)

  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H)
  bg.addColorStop(0, bright)
  bg.addColorStop(1, deep)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  court(ctx, 170, -160, 740, 1500, 0.32, 'rgba(255,255,255,0.09)', 6)
  if (won) {
    confetti(ctx, 0, 0, W, 560, [light, '#ffffff', '#fde68a', light], 46, title.length * 31)
    confetti(ctx, 0, 1080, W, 270, [light, '#ffffff', '#fde68a'], 18, title.length * 17)
  }

  // A glow behind the picture.
  const glow = ctx.createRadialGradient(W / 2, 340, 10, W / 2, 340, 300)
  glow.addColorStop(0, 'rgba(255,255,255,0.32)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 40, W, 600)
  ctx.save()
  ARTS[art](ctx, W / 2, 340, colors)
  ctx.restore()

  ctx.textBaseline = 'alphabetic'
  text(brand().toUpperCase(), W / 2, 86, 26, 'rgba(255,255,255,0.8)', 700, 'center')

  // Award name on a ribbon.
  ctx.font = `800 40px ${FONT}`
  const label = title.toUpperCase()
  const ribbon = ctx.measureText(label).width + 90
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  ctx.roundRect(W / 2 - ribbon / 2, 610, ribbon, 76, 38)
  ctx.fill()
  text(label, W / 2, 662, 40, deep, 800, 'center')

  if (won) {
    ctx.font = `800 78px ${FONT}`
    const lines = wrap(ctx, who, W - 2 * PAD - 40, 2)
    lines.forEach((l, i) => text(l, W / 2, 800 + i * 88, 78, '#ffffff', 800, 'center'))
    const below = 800 + (lines.length - 1) * 88
    ctx.font = `900 190px ${FONT}`
    text(fit(ctx, value, W - 2 * PAD), W / 2, below + 205, 190, light, 900, 'center')
    ctx.font = `500 38px ${FONT}`
    text(fit(ctx, detail, W - 2 * PAD), W / 2, below + 285, 38, 'rgba(255,255,255,0.9)', 500, 'center')
  } else {
    ctx.font = `600 52px ${FONT}`
    wrap(ctx, empty ?? 'Not enough results yet', W - 2 * PAD - 80, 3).forEach((l, i) =>
      text(l, W / 2, 860 + i * 70, 52, 'rgba(255,255,255,0.85)', 600, 'center'),
    )
  }

  // Footer: which games this covers.
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(0, H - 110, W, 110)
  text(scope, W / 2, H - 44, 32, '#ffffff', 700, 'center')
}

/** One award card as a PNG, ready to share. */
export function awardImage(card: AwardCard): Blob {
  const [c, ctx] = canvas(AWARD_SIZE.width, AWARD_SIZE.height)
  drawAward(ctx, card)
  return png(c)
}

/**
 * Open the share sheet with an image (iPad: Messages, Messenger, Photos…), or
 * download it where sharing files isn't supported.
 */
export async function shareImage(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled'
      // Not allowed (e.g. the tap expired): download instead.
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}
