import { useEffect, useRef, useState } from 'react'
import { CHECKIN_API, checkinLink, randomPin, useRemoteStatus } from '../lib/remoteCheckin'
import { useStore } from '../store/useStore'
import { ShareIcon } from './Standings'
import { NumberField } from './NumberPad'

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export function PhoneIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2h8a2 2 0 012 2v16a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2zM11 18h2" />
    </svg>
  )
}

/**
 * Turns phone check-in on (a link, QR code and PIN for this session) and shows
 * whether it's on. Hidden when this build has no check-in API.
 */
export function PhoneCheckinButton() {
  const remote = useStore((s) => s.session.remote)
  const online = useRemoteStatus((s) => s.online)
  const locked = useRemoteStatus((s) => s.locked)
  const [show, setShow] = useState(false)
  if (!CHECKIN_API) return null

  return (
    <>
      {remote ? (
        <button
          className={`d-btn ml-auto h-11 ${
            online && !locked ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-800'
          }`}
          onClick={() => setShow(true)}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${online && !locked ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden />
          {locked ? 'Phone check-in: change PIN' : online ? 'Phone check-in on' : 'Phone check-in offline'}
          <span className="font-mono tracking-wider opacity-70">{remote.code}</span>
        </button>
      ) : (
        <button className="d-btn d-btn-primary d-btn-soft ml-auto h-11" onClick={() => setShow(true)}>
          <PhoneIcon />
          Phone check-in
        </button>
      )}
      {show && <PhoneCheckinDialog onClose={() => setShow(false)} />}
    </>
  )
}

/** Four digits, typed on the app's number pad. */
function PinInput({ value, onChange }: { value: string; onChange: (pin: string) => void }) {
  return (
    <NumberField
      className="w-40 font-mono text-3xl font-bold tracking-[0.4em]"
      maxLength={4}
      label="PIN"
      placeholder="····"
      value={value}
      onChange={onChange}
    />
  )
}

function PhoneCheckinDialog({ onClose }: { onClose: () => void }) {
  const remote = useStore((s) => s.session.remote)
  const openRemote = useStore((s) => s.openRemote)
  const closeRemote = useStore((s) => s.closeRemote)
  const setRemotePin = useStore((s) => s.setRemotePin)
  const locked = useRemoteStatus((s) => s.locked)
  const [pin, setPin] = useState(randomPin)
  // Changing the PIN of an open check-in.
  const [editing, setEditing] = useState(false)
  const [qr, setQr] = useState<string>()
  const [copied, setCopied] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const link = remote ? checkinLink(remote.code) : ''

  useEffect(() => dialog.current?.showModal(), [])
  useEffect(() => {
    if (!link) return
    let live = true
    void import('qrcode')
      .then((q) => q.toDataURL(link, { width: 640, margin: 1, color: { dark: '#134e4a' } }))
      .then((url) => live && setQr(url))
    return () => {
      live = false
    }
  }, [link])

  const share = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'Check in to badminton', url: link }).catch(() => {})
    } else {
      await navigator.clipboard?.writeText(link)
      setCopied(true)
    }
  }
  const savePin = () => {
    setRemotePin(pin)
    useRemoteStatus.setState({ locked: false })
    setEditing(false)
  }

  return (
    <dialog ref={dialog} className="d-modal" onClose={onClose}>
      {!remote ? (
        <div className="d-modal-box max-w-md">
          <h3 className="text-2xl font-black text-teal-800">Phone check-in</h3>
          <p className="mt-2 text-slate-600">
            Players scan a QR code, enter this PIN and tap their name. Tell them the PIN at the venue, so a forwarded
            link alone can&apos;t check anyone in.
          </p>
          <div className="mt-5 flex items-center gap-4">
            <PinInput value={pin} onChange={setPin} />
            <span className="text-sm text-slate-500">PIN for this session. Change it if you like.</span>
          </div>
          <div className="d-modal-action">
            <button className="d-btn d-btn-ghost h-11" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button className="d-btn d-btn-primary h-11" disabled={pin.length !== 4} onClick={() => openRemote(pin)}>
              Turn on
            </button>
          </div>
        </div>
      ) : (
        <div className="d-modal-box max-w-3xl">
          <div className="flex items-center gap-6">
            <div className="aspect-square w-72 shrink-0 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
              {qr ? (
                <img src={qr} alt="Check-in QR code" className="h-full w-full" />
              ) : (
                <div className="h-full w-full animate-pulse rounded-xl bg-slate-100" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-2xl font-black text-teal-800">Scan to check in</h3>
              <p className="mt-1 text-slate-600">Scan with the phone camera, enter the PIN, then tap your name.</p>
              <div className="mt-4 rounded-2xl bg-teal-50 p-4 ring-1 ring-teal-100">
                <div className="text-sm font-bold tracking-wide text-teal-700 uppercase">PIN</div>
                {editing ? (
                  <div className="mt-1 flex items-center gap-2">
                    <PinInput value={pin} onChange={setPin} />
                    <button className="d-btn d-btn-primary h-11" disabled={pin.length !== 4} onClick={savePin}>
                      Save
                    </button>
                    <button className="d-btn d-btn-ghost h-11" onClick={() => setEditing(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-5xl font-black tracking-[0.2em] text-teal-900">{remote.pin}</span>
                    <button
                      className="d-btn d-btn-ghost d-btn-sm ml-auto text-teal-700"
                      onClick={() => {
                        setPin(randomPin())
                        setEditing(true)
                      }}
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>
              {locked && !editing && (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 ring-1 ring-amber-200">
                  Too many wrong PINs were tried, so the PIN stopped working. Change it to let players check in again.
                </p>
              )}
              <p className="mt-3 text-sm break-all text-slate-500 select-text">{link}</p>
              <p className="mt-1 text-sm text-slate-500">
                Code <strong className="font-mono text-base tracking-widest text-slate-800">{remote.code}</strong> · works
                until the session ends
              </p>
            </div>
          </div>
          <div className="d-modal-action justify-between">
            <button
              className="d-btn d-btn-ghost h-11 text-rose-700"
              onClick={() => {
                closeRemote()
                dialog.current?.close()
              }}
            >
              Turn off
            </button>
            <div className="flex gap-2">
              <button className="d-btn d-btn-primary d-btn-soft h-11" onClick={share}>
                <ShareIcon />
                {copied ? 'Link copied' : 'Share link'}
              </button>
              <button className="d-btn d-btn-primary h-11" onClick={() => dialog.current?.close()}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      <form method="dialog" className="d-modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  )
}

/** Names typed on a phone that aren't on the player list: add, match to a player, or dismiss. */
export function PhoneNewcomers() {
  const newcomers = useRemoteStatus((s) => s.newcomers)
  const players = useStore((s) => s.players)
  const attendees = useStore((s) => s.session.attendees)
  const admitNewcomer = useStore((s) => s.admitNewcomer)
  const dismissRemote = useStore((s) => s.dismissRemote)
  if (newcomers.length === 0) return null

  const here = new Set(attendees.map((a) => a.playerId))
  const notHere = players.filter((p) => p.active && !here.has(p.id)).sort((a, b) => a.name.localeCompare(b.name))
  const done = (id: string) =>
    useRemoteStatus.setState((s) => ({ newcomers: s.newcomers.filter((c) => c.id !== id) }))

  return (
    <section className="rounded-2xl border-2 border-sky-200 bg-sky-50 p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-bold tracking-wide text-sky-800 uppercase">
        <PhoneIcon className="h-4 w-4" />
        New names from phones ({newcomers.length})
      </h2>
      <ul className="space-y-2">
        {newcomers.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-sky-100">
            <span className="text-lg font-semibold">{c.name}</span>
            <span className="text-sm text-slate-500 tabular-nums">arrived {time(c.at)}</span>
            <div className="ml-auto flex items-center gap-2">
              <select
                className="d-select d-select-sm w-48"
                value=""
                aria-label={`${c.name} is an existing player`}
                onChange={(e) => {
                  admitNewcomer(c, e.target.value)
                  done(c.id)
                }}
              >
                <option value="" disabled>
                  It&apos;s an existing player…
                </option>
                {notHere.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                className="d-btn d-btn-primary d-btn-sm"
                onClick={() => {
                  admitNewcomer(c)
                  done(c.id)
                }}
              >
                Add new player
              </button>
              <button
                className="d-btn d-btn-ghost d-btn-sm"
                onClick={() => {
                  dismissRemote(c.id)
                  done(c.id)
                }}
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
