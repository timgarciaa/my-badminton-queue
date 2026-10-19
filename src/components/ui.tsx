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

export function GenderPicker({
  value,
  onChange,
  compact = false,
}: {
  value?: Gender
  onChange: (g: Gender) => void
  compact?: boolean
}) {
  return (
    <div className="flex gap-1.5">
      {(['M', 'F'] as Gender[]).map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => onChange(g)}
          title={GENDER_LABELS[g]}
          className={`rounded-lg py-2 text-sm font-semibold ring-1 transition ${compact ? 'w-10' : 'px-4'} ${
            value === g
              ? g === 'M'
                ? 'bg-indigo-100 text-indigo-800 ring-2 ring-indigo-300'
                : 'bg-pink-100 text-pink-800 ring-2 ring-pink-300'
              : 'bg-white text-slate-500 ring-slate-200'
          }`}
        >
          {compact ? g : GENDER_LABELS[g]}
        </button>
      ))}
    </div>
  )
}

export function SkillPicker({
  value,
  onChange,
  compact = false,
}: {
  value: Skill
  onChange: (s: Skill) => void
  compact?: boolean
}) {
  return (
    <div className="flex gap-1.5">
      {([1, 2, 3, 4, 5] as Skill[]).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          title={SKILL_LABELS[s]}
          className={`rounded-lg py-2 text-sm font-semibold ring-1 transition ${compact ? 'w-9' : 'px-3'} ${
            value === s ? `${SKILL_COLORS[s]} ring-2` : 'bg-white text-slate-500 ring-slate-200'
          }`}
        >
          {compact ? s : SKILL_LABELS[s]}
        </button>
      ))}
    </div>
  )
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  label,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  label?: ReactNode
}) {
  return (
    <div className="inline-flex items-center gap-2">
      {label && <span className="text-sm font-medium text-slate-500">{label}</span>}
      <button
        type="button"
        className="btn-ghost h-11 w-11 p-0 text-xl"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        aria-label="Decrease"
      >
        −
      </button>
      <span className="min-w-8 text-center text-xl font-bold tabular-nums">{value}</span>
      <button
        type="button"
        className="btn-ghost h-11 w-11 p-0 text-xl"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
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
