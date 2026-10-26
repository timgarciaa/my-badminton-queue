import { ordinal, type PlayerRecord } from './stats'

export interface StandingRow extends PlayerRecord {
  name: string
  rate: number | null
  /** Place, shared by tied players (1, 1, 2...). */
  place: number
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
  text("My Badminton Queue · Serve N' Shout", PAD, 76, 28, 'rgba(255,255,255,0.8)')
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
  // Stripes first, so the place badges and brackets (which span tied rows) draw over them.
  rows.forEach((_, i) => {
    if (i % 2) return
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(PAD / 2, rowTop(i), W - PAD, ROW)
  })
  // One badge per place, centred on the tied rows, with a bracket joining them.
  rows.forEach((r, i) => {
    if (r.place === rows[i - 1]?.place) return
    const tied = rows.filter((x) => x.place === r.place).length
    const [fill, line] = MEDALS[r.place] ?? ['#f1f5f9', '#cbd5e1']
    const mid = rowTop(i) + (tied * ROW) / 2
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.roundRect(col.rank - 30, mid - 20, 60, 40, 20)
    ctx.fill()
    text(ordinal(r.place), col.rank, mid + 1, 22, '#1e293b', 800, 'center')
    if (tied > 1) {
      const x = col.rank + 42
      const [y0, y1] = [rowTop(i) + 12, rowTop(i + tied) - 12]
      ctx.strokeStyle = line
      ctx.lineWidth = 4
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(x + 10, y0)
      ctx.lineTo(x, y0)
      ctx.lineTo(x, y1)
      ctx.lineTo(x + 10, y1)
      ctx.stroke()
    }
  })
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
} as const

export type AwardTone = keyof typeof AWARD_TONES

/**
 * One award (e.g. Unbeatable duo) as a 4:5 card for sharing: the award's
 * colours, court lines, confetti and a flying shuttlecock, then who won it,
 * the big number and what it means.
 */
export function awardImage({
  title,
  who,
  value,
  detail,
  scope,
  tone,
}: {
  title: string
  who: string
  value: string
  detail: string
  /** Which games: "All time", "Last 3 months" or a session date. */
  scope: string
  tone: AwardTone
}): Blob {
  const H = 1350
  const [c, ctx] = canvas(W, H)
  const text = writer(ctx)
  const [deep, bright, light] = AWARD_TONES[tone]

  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H)
  bg.addColorStop(0, bright)
  bg.addColorStop(1, deep)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  court(ctx, 170, -160, 740, 1500, 0.32, 'rgba(255,255,255,0.09)', 6)
  confetti(ctx, 0, 0, W, 560, [light, '#ffffff', '#fde68a', light], 46, title.length * 31)
  confetti(ctx, 0, 1080, W, 270, [light, '#ffffff', '#fde68a'], 18, title.length * 17)

  // A glow behind the shuttle.
  const glow = ctx.createRadialGradient(W / 2, 330, 10, W / 2, 330, 260)
  glow.addColorStop(0, 'rgba(255,255,255,0.35)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 60, W, 540)
  flyingShuttle(ctx, W / 2 + 130, 250, 270, bright, 'rgba(255,255,255,0.4)')

  ctx.textBaseline = 'alphabetic'
  text("MY BADMINTON QUEUE · SERVE N' SHOUT", W / 2, 96, 26, 'rgba(255,255,255,0.8)', 700, 'center')

  // Award name on a ribbon.
  ctx.font = `800 40px ${FONT}`
  const label = title.toUpperCase()
  const ribbon = ctx.measureText(label).width + 90
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  ctx.roundRect(W / 2 - ribbon / 2, 600, ribbon, 76, 38)
  ctx.fill()
  text(label, W / 2, 652, 40, deep, 800, 'center')

  ctx.font = `800 78px ${FONT}`
  const lines = wrap(ctx, who, W - 2 * PAD - 40, 2)
  lines.forEach((l, i) => text(l, W / 2, 790 + i * 88, 78, '#ffffff', 800, 'center'))
  const below = 790 + (lines.length - 1) * 88
  text(value, W / 2, below + 210, 190, light, 900, 'center')
  ctx.font = `500 38px ${FONT}`
  text(fit(ctx, detail, W - 2 * PAD), W / 2, below + 290, 38, 'rgba(255,255,255,0.9)', 500, 'center')

  // Footer: which games this covers.
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(0, H - 110, W, 110)
  text(scope, W / 2, H - 44, 32, '#ffffff', 700, 'center')
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
