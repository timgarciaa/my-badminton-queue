// Phone check-in API, shared by the Lambda function (lambda.mjs) and the local
// dev server (dev.mjs). The iPad opens a check-in for the session under a short
// code and keeps a secret key; players open the link, enter the session's PIN,
// pick their name and check in. The iPad polls with its key and checks them in
// on its side.
//
//   PUT    /s/:code           (key) open or update: { date, pin, players: [{ id, name }], here: [id] }
//   GET    /s/:code           (pin) the names, and who is already in
//   POST   /s/:code/checkin   (pin) { id } or { name } for someone not on the list
//   GET    /s/:code/checkins  (key) every phone check-in: [{ id, name?, at }], and if the PIN is locked
//   DELETE /s/:code           (key) close it when the session ends
import { createHash } from 'node:crypto'

/** How long a check-in stays open without the iPad updating it. */
export const OPEN_MS = 18 * 60 * 60 * 1000
/** Wrong PINs before the PIN stops working, until the iPad sets a new one. */
export const MAX_FAILS = 30
const MAX_PLAYERS = 500
const MAX_NEW = 30
const MAX_NAME = 40
const CODE = /^[A-Z2-9]{6}$/
const PIN = /^\d{4}$/

const hash = (key) => createHash('sha256').update(String(key)).digest('hex')
const json = (status, body) => ({ status, body })
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)

/**
 * db is { get(code), put(item), checkIn(code, id, entry, now) → boolean,
 * fail(code), remove(code) }. checkIn adds the entry only if the check-in is
 * still open and the id isn't in yet, atomically; fail counts a wrong PIN.
 */
export function createApi(db, now = () => Date.now()) {
  const open = async (code) => {
    const item = await db.get(code)
    return item && item.expires * 1000 > now() ? item : null
  }
  const owned = async (code, key) => {
    const item = await open(code)
    return item && key && item.keyHash === hash(key) ? item : null
  }
  // A player's request: the check-in must be open and the PIN right.
  const entered = async (code, pin) => {
    const item = await open(code)
    if (!item) return { error: json(404, { error: 'closed' }) }
    if ((item.fails ?? 0) >= MAX_FAILS) return { error: json(429, { error: 'locked' }) }
    if (!pin) return { error: json(401, { error: 'pin required' }) }
    if (hash(`${code}:${pin}`) !== item.pinHash) {
      await db.fail(code)
      return { error: json(401, { error: 'wrong pin' }) }
    }
    return { item }
  }

  return async function handle({ method, path, key, pin, body }) {
    const [, s, code, sub] = path.split('/')
    if (s !== 's' || !CODE.test(code ?? '')) return json(404, { error: 'not found' })

    if (method === 'PUT' && !sub) {
      if (!key) return json(401, { error: 'key required' })
      if (!PIN.test(String(body?.pin ?? ''))) return json(400, { error: 'pin must be 4 digits' })
      const existing = await db.get(code)
      if (existing && existing.keyHash !== hash(key)) return json(403, { error: 'wrong key' })
      const pinHash = hash(`${code}:${body.pin}`)
      const players = (Array.isArray(body?.players) ? body.players : [])
        .slice(0, MAX_PLAYERS)
        .map((p) => ({ id: String(p.id).slice(0, 64), name: clean(p.name) }))
        .filter((p) => p.id && p.name)
      await db.put({
        code,
        keyHash: hash(key),
        pinHash,
        // A new PIN unlocks it again.
        fails: existing?.pinHash === pinHash ? (existing.fails ?? 0) : 0,
        date: String(body?.date ?? '').slice(0, 10),
        players,
        here: (Array.isArray(body?.here) ? body.here : []).slice(0, MAX_PLAYERS).map(String),
        checkins: existing?.checkins ?? {},
        expires: Math.floor((now() + OPEN_MS) / 1000),
      })
      return json(200, { ok: true })
    }

    if (method === 'GET' && !sub) {
      const { item, error } = await entered(code, pin)
      if (error) return error
      const inside = new Set([...item.here, ...Object.keys(item.checkins)])
      return json(200, {
        date: item.date,
        players: item.players.map((p) => ({ ...p, in: inside.has(p.id) })),
      })
    }

    if (method === 'POST' && sub === 'checkin') {
      const { item, error } = await entered(code, pin)
      if (error) return error
      const at = now()
      const id = String(body?.id ?? '')
      if (id) {
        if (!item.players.some((p) => p.id === id)) return json(400, { error: 'unknown player' })
        if (item.here.includes(id)) return json(200, { at: null, already: true })
        const added = await db.checkIn(code, id, { at }, at)
        return json(200, added ? { at } : { at: null, already: true })
      }
      const name = clean(body?.name)
      if (!name) return json(400, { error: 'name required' })
      const newcomers = Object.keys(item.checkins).filter((k) => k.startsWith('new-'))
      if (newcomers.length >= MAX_NEW) return json(429, { error: 'too many new names' })
      const newId = `new-${crypto.randomUUID()}`
      const added = await db.checkIn(code, newId, { at, name }, at)
      return added ? json(200, { at, id: newId }) : json(404, { error: 'closed' })
    }

    if (method === 'GET' && sub === 'checkins') {
      const item = await owned(code, key)
      if (!item) return json(403, { error: 'wrong key' })
      return json(200, {
        checkins: Object.entries(item.checkins)
          .map(([id, c]) => ({ id, ...c }))
          .sort((a, b) => a.at - b.at),
        locked: (item.fails ?? 0) >= MAX_FAILS,
      })
    }

    if (method === 'DELETE' && !sub) {
      if (await owned(code, key)) await db.remove(code)
      return json(200, { ok: true })
    }

    return json(404, { error: 'not found' })
  }
}

/** An in-memory db, for the dev server and tests. */
export function memoryDb() {
  const items = new Map()
  return {
    get: async (code) => structuredClone(items.get(code)),
    put: async (item) => void items.set(item.code, structuredClone(item)),
    checkIn: async (code, id, entry, now) => {
      const item = items.get(code)
      if (!item || item.expires * 1000 <= now || item.checkins[id]) return false
      item.checkins[id] = entry
      return true
    },
    fail: async (code) => {
      const item = items.get(code)
      if (item) item.fails = (item.fails ?? 0) + 1
    },
    remove: async (code) => void items.delete(code),
  }
}
