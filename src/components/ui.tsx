import { useEffect, useState, type ReactNode } from 'react'
import { GENDER_LABELS, SKILL_LABELS, type Gender, type Player, type Skill } from '../types'

export const SKILL_COLORS: Record<Skill, string> = {
  1: 'bg-sky-100 text-sky-800 ring-sky-300',
  2: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  3: 'bg-amber-100 text-amber-800 ring-amber-300',
  4: 'bg-orange-100 text-orange-800 ring-orange-300',
  5: 'bg-rose-100 text-rose-800 ring-rose-300',
}

export function SkillBadge({ skill, full = false }: { skill: Skill; full?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${SKILL_COLORS[skill]}`}
      title={SKILL_LABELS[skill]}
    >
      {full ? SKILL_LABELS[skill] : skill}
    </span>
  )
}

export function GenderBadge({ gender }: { gender?: Gender }) {
  if (!gender) return null
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-1 ${
        gender === 'M' ? 'bg-indigo-100 text-indigo-800 ring-indigo-300' : 'bg-pink-100 text-pink-800 ring-pink-300'
      }`}
      title={GENDER_LABELS[gender]}
    >
      {gender}
    </span>
  )
}

/** Gender + skill badges shown next to a player's name. */
export function PlayerTags({ player }: { player: Player }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <GenderBadge gender={player.gender} />
      <SkillBadge skill={player.skill} />
    </span>
  )
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  label,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  label?: ReactNode
}) {
  return (
    <div className="inline-flex items-center gap-2">
      {label && <span className="text-sm font-medium text-slate-500">{label}</span>}
      <button
        type="button"
        className="d-btn d-btn-square h-11 w-11 border-slate-200 bg-white text-xl"
        disabled={value - step < min}
        onClick={() => onChange(value - step)}
        aria-label="Decrease"
      >
        −
      </button>
      <span className="min-w-8 text-center text-xl font-bold tabular-nums">{value}</span>
      <button
        type="button"
        className="d-btn d-btn-square h-11 w-11 border-slate-200 bg-white text-xl"
        disabled={value + step > max}
        onClick={() => onChange(value + step)}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  )
}

export function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (n: number) => void
}) {
  const [text, setText] = useState(value ? String(value) : '')
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : value ? String(value) : ''))
  }, [value])
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-500">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-lg text-slate-400">₱</span>
        <input
          className="field pl-8 tabular-nums"
          inputMode="decimal"
          value={text}
          placeholder="0.00"
          onChange={(e) => {
            const t = e.target.value.replace(/[^0-9.]/g, '')
            setText(t)
            onChange(Number(t) || 0)
          }}
        />
      </div>
    </label>
  )
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export function elapsed(from: number, now: number) {
  const sec = Math.max(0, Math.floor((now - from) / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center text-slate-500">{children}</div>
}

/** Round initials badge, tinted by gender. */
export function Initials({ player, muted = false, size = 'w-12' }: { player: Player; muted?: boolean; size?: string }) {
  const initials = player.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
  const tint = muted
    ? 'bg-slate-100 text-slate-500'
    : player.gender === 'F'
      ? 'bg-pink-100 text-pink-800'
      : player.gender === 'M'
        ? 'bg-indigo-100 text-indigo-800'
        : 'bg-teal-100 text-teal-800'
  return (
    <div className="d-avatar d-avatar-placeholder shrink-0">
      <div className={`${size} rounded-full ${tint}`}>
        <span className="text-base font-bold">{initials}</span>
      </div>
    </div>
  )
}
