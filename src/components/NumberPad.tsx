import { useEffect, useRef, useState } from 'react'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'done'] as const

/**
 * A number box with its own keypad: the iPad shows its full keyboard even for
 * numbers, so tapping this opens a number pad beside it instead. The pad is a
 * popover, so it shows over cards that clip their content and over dialogs;
 * tapping outside it closes it. The first key typed replaces what was there.
 */
export function NumberField({
  value,
  onChange,
  maxLength,
  label,
  placeholder = '–',
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  maxLength: number
  /** Read out for the box, e.g. "Points for Tim & Ana". */
  label: string
  placeholder?: string
  className?: string
}) {
  const field = useRef<HTMLButtonElement>(null)
  const pad = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState({ top: 0, left: 0 })
  // Typing starts over until the first key.
  const fresh = useRef(true)

  const show = () => {
    const box = field.current!.getBoundingClientRect()
    const width = 3 * 64 + 2 * 8 + 2 * 8
    const height = 4 * 56 + 3 * 8 + 2 * 8
    const below = box.bottom + 8 + height <= window.innerHeight
    setPlace({
      top: below ? box.bottom + 8 : Math.max(8, box.top - 8 - height),
      left: Math.min(Math.max(8, box.left + box.width / 2 - width / 2), window.innerWidth - width - 8),
    })
    fresh.current = true
    pad.current?.showPopover()
  }
  const close = () => pad.current?.hidePopover()

  const press = (key: (typeof KEYS)[number]) => {
    if (key === 'done') return close()
    if (key === 'back') onChange(fresh.current ? '' : value.slice(0, -1))
    else onChange(((fresh.current ? '' : value) + key).slice(0, maxLength))
    fresh.current = false
  }

  // A hardware keyboard works too while the pad is open.
  useEffect(() => {
    if (!open) return
    const keydown = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key as (typeof KEYS)[number])
      else if (e.key === 'Backspace') press('back')
      else if (e.key === 'Enter') press('done')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  return (
    <>
      <button
        ref={field}
        type="button"
        className={`field flex items-center justify-center tabular-nums ${open ? 'ring-2 ring-teal-600' : ''} ${
          value ? '' : 'text-slate-400'
        } ${className}`}
        aria-label={value ? `${label}: ${value}` : label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={show}
      >
        {value || placeholder}
      </button>
      <div
        ref={pad}
        popover="auto"
        role="dialog"
        aria-label={label}
        onToggle={(e) => setOpen((e as unknown as ToggleEvent).newState === 'open')}
        style={{ top: place.top, left: place.left }}
        className="fixed m-0 hidden grid-cols-3 gap-2 rounded-2xl open:grid border-0 bg-white p-2 shadow-2xl ring-1 ring-slate-200"
      >
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className={`d-btn h-14 w-16 text-2xl font-bold ${
              key === 'done' ? 'd-btn-primary text-base' : key === 'back' ? 'd-btn-ghost' : 'border-slate-200 bg-slate-50'
            }`}
            aria-label={key === 'back' ? 'Delete' : key === 'done' ? 'Done' : key}
            onClick={() => press(key)}
          >
            {key === 'back' ? (
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 5H9l-6 7 6 7h12zM18 9l-6 6M12 9l6 6" />
              </svg>
            ) : key === 'done' ? (
              'Done'
            ) : (
              key
            )}
          </button>
        ))}
      </div>
    </>
  )
}
