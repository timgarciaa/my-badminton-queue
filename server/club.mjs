// Club data API, with sign-up and approval of organizers.
//
// Anyone can ask for an account: to create a new club (approved by the app
// admin, with server/club.sh or by setting the club's `approved` to true in
// DynamoDB) or to join a club with its code (approved by any of that club's
// organizers, in the app). Until then they can sign in, but only see that
// they're waiting.
//
// An approved organizer's iPad keeps working from its own copy and saves
// changes here. The data is a few documents per club, each a JSON string: the
// players, the current session, and one per past session. Every save bumps
// the club's revision; a save made from an older revision (another device
// saved since) is refused, so nothing is overwritten without the organizer
// choosing to.
//
//   POST /signup          { username, password, create: name } or { ..., join: code }
//   GET  /club            → { club: { id, name, code }, user, rev, docs }, or 403 { pending }
//   POST /club/save       { baseRev, put: { [id]: json }, remove: [id] } → { rev }, or 409 if behind
//   GET  /club/members    → { members: [{ username, approved, requestedAt }] }
//   POST /club/members    { username, approve: true } approves; approve: false declines or removes
//   GET  /club/link       → { slug }: the club's public stats page link name
//   POST /club/link       { slug } → { slug }, or 409 if another club has it
//   GET  /public/<slug>   → the club's player stats, for its public page (no sign-in)
//
// Requests other than /signup and /public carry the organizer's sign-in token
// (Authorization: Bearer ...).
import { randomInt } from 'node:crypto'

/** Document ids: players, session, and h#<session id> for past sessions. */
export const DOC_ID = /^(players|session|h#[\w-]{1,64})$/
/** Per save; the app sends bigger saves in parts. */
export const MAX_ACTIONS = 90
/** Waiting requests: new clubs in all, and people asking to join each club. */
export const MAX_PENDING = 20
const MAX_DOC = 350_000
const USERNAME = /^[a-z0-9._-]{3,32}$/
/** Public page link names: 3 to 30 lowercase letters, digits and inner dashes. */
export const SLUG = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/
/** Not link names: the app's own files and paths sit next to them. */
const RESERVED = new Set(['assets', 'index', 'public', 'club', 'signup', 'admin', 'api', 'app', 'login', 'settings', 'stats', 'tension-tester'])
/** Link name from a club's name: "Serve N' Shout" → serve-n-shout. */
export const slugOf = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '')
const slugError = (slug) =>
  !SLUG.test(slug) || slug.includes('--')
    ? 'Use 3 to 30 lowercase letters, numbers or dashes.'
    : RESERVED.has(slug)
      ? 'That name is taken.'
      : null
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const json = (status, body) => ({ status, body })
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
/** Six letters and digits for joining a club, without look-alikes (0/O, 1/I). */
export const joinCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('')
const clubId = (name) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'club'
  }-${Array.from({ length: 4 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[randomInt(36)]).join('')}`

/**
 * db: the club table (see memoryClubDb for what each call does).
 * accounts: { create(username, password) → 'ok' | 'taken' | { error }, remove(username) }.
 * verify(token) → the token's claims, or null.
 */
export function createClubApi(db, accounts, verify, now = () => Date.now()) {
  /** The signed-in organizer and their club, or the response to send instead. */
  const organizer = async (token) => {
    const claims = token ? await verify(token) : null
    if (!claims) return { error: json(401, { error: 'sign in' }) }
    const username = String(claims['cognito:username'] ?? '').toLowerCase()
    let member = await db.membership(username)
    // Organizers added before sign-up existed have their club on the account.
    if (!member && claims['custom:club']) {
      member = { clubId: claims['custom:club'], approved: true }
      await db.addMember(member.clubId, username, true, now())
    }
    if (!member) return { error: json(403, { error: 'not an organizer' }) }
    let club = await db.club(member.clubId)
    if (!club) return { error: json(403, { error: 'unknown club' }) }
    if (club.approved === false) return { error: json(403, { error: 'waiting', pending: 'club', clubName: club.name }) }
    if (!member.approved) return { error: json(403, { error: 'waiting', pending: 'member', clubName: club.name }) }
    // Clubs made before join codes get one the first time it's needed.
    if (!club.code) club = { ...club, code: await db.setCode(member.clubId, joinCode()) }
    return { username, clubId: member.clubId, club }
  }

  /** The club's link name, given one from its name (or a free variant) the first time. */
  const linkOf = async (id, club) => {
    if (club.slug) return club.slug
    const base = slugOf(club.name)
    const start = slugError(base) ? 'club' : base
    for (let n = 1; n <= 20; n++) {
      const slug = n === 1 && start !== 'club' ? start : `${start.slice(0, 26)}-${n === 1 ? randomInt(100, 1000) : n}`
      if (!slugError(slug) && (await db.setSlug(id, slug, null))) return slug
    }
    throw new Error('no free link name')
  }

  /** What a club's public page shows: names, games and check-in times; no money, payments or PINs. */
  async function publicStats(slug) {
    const id = SLUG.test(slug) ? await db.clubBySlug(slug) : null
    const club = id && (await db.club(id))
    if (!club || club.approved === false) return json(404, { error: 'not found' })
    const docs = await db.docs(id)
    const parse = (d) => {
      try {
        return JSON.parse(d)
      } catch {
        return null
      }
    }
    const players = (parse(docs.players) ?? []).map((p) => ({ id: p.id, name: p.name }))
    const session = (s) =>
      s && {
        id: s.id,
        date: s.date,
        status: s.status,
        attendees: (s.attendees ?? []).map((a) => ({ playerId: a.playerId, checkedInAt: a.checkedInAt })),
        games: (s.games ?? []).map((g) => ({
          id: g.id,
          number: g.number,
          court: g.court,
          teamA: g.teamA,
          teamB: g.teamB,
          startedAt: g.startedAt,
          endedAt: g.endedAt,
          winner: g.winner,
          score: g.score,
          outOfHours: g.outOfHours,
        })),
      }
    const history = Object.keys(docs)
      .filter((d) => d.startsWith('h#'))
      .map((d) => session(parse(docs[d])))
      .filter(Boolean)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    return json(200, { club: { name: club.name }, players, session: session(parse(docs.session)) ?? null, history })
  }

  async function signup(body) {
    const username = clean(body?.username, 40).toLowerCase()
    const password = String(body?.password ?? '')
    if (!USERNAME.test(username)) {
      return json(400, { error: 'Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.' })
    }
    if (password.length < 8) return json(400, { error: 'Use a password of at least 8 characters.' })
    const create = clean(body?.create, 40)
    const code = clean(body?.join, 6).toUpperCase()
    if (!create === !code) return json(400, { error: 'Create a club or join one.' })

    let joining
    if (code) {
      const id = await db.clubByCode(code)
      const club = id && (await db.club(id))
      if (!club || club.approved === false) return json(404, { error: 'No club has that code.' })
      const waiting = (await db.members(id)).filter((m) => !m.approved).length
      if (waiting >= MAX_PENDING) return json(429, { error: 'This club has too many requests waiting. Try again later.' })
      joining = { id, name: club.name }
    } else {
      if (create.length < 2) return json(400, { error: 'Give the club a name.' })
      if ((await db.pendingClubs()) >= MAX_PENDING) {
        return json(429, { error: 'Too many new clubs are waiting for approval. Try again later.' })
      }
    }

    const made = await accounts.create(username, password)
    if (made === 'taken') return json(409, { error: 'That username is taken.' })
    if (made !== 'ok') return json(400, { error: made.error })
    try {
      if (joining) {
        await db.addMember(joining.id, username, false, now())
        return json(200, { pending: 'member', clubName: joining.name })
      }
      const id = clubId(create)
      await db.createClub({ id, name: create, code: joinCode(), createdBy: username, approved: false, now: now() })
      await db.addMember(id, username, true, now())
      return json(200, { pending: 'club', clubName: create })
    } catch (e) {
      await accounts.remove(username)
      throw e
    }
  }

  return async function handle({ method, path, token, body }) {
    if (method === 'POST' && path === '/signup') return signup(body)
    if (method === 'GET' && path.startsWith('/public/')) return publicStats(path.slice(8))

    const me = await organizer(token)
    if (me.error) return me.error
    const { clubId: id, club, username } = me

    if (method === 'GET' && path === '/club') {
      return json(200, {
        club: { id, name: club.name, code: club.code },
        user: username,
        rev: club.rev,
        docs: await db.docs(id),
      })
    }

    if (method === 'POST' && path === '/club/save') {
      const baseRev = body?.baseRev
      const put = body?.put ?? {}
      const remove = body?.remove ?? []
      if (!Number.isInteger(baseRev) || typeof put !== 'object' || !Array.isArray(remove)) {
        return json(400, { error: 'bad save' })
      }
      const ids = [...Object.keys(put), ...remove]
      if (ids.length > MAX_ACTIONS) return json(400, { error: 'too many changes at once' })
      if (new Set(ids).size !== ids.length || !ids.every((d) => DOC_ID.test(d))) return json(400, { error: 'bad document' })
      if (!Object.values(put).every((v) => typeof v === 'string' && v.length <= MAX_DOC)) {
        return json(400, { error: 'document too big' })
      }
      const rev = await db.save(id, baseRev, put, remove)
      return rev === null ? json(409, { error: 'changed on another device' }) : json(200, { rev })
    }

    if (method === 'GET' && path === '/club/link') return json(200, { slug: await linkOf(id, club) })

    if (method === 'POST' && path === '/club/link') {
      const slug = clean(body?.slug, 40).toLowerCase()
      const error = slugError(slug)
      if (error) return json(400, { error })
      const current = await linkOf(id, club)
      if (slug !== current && !(await db.setSlug(id, slug, current))) return json(409, { error: 'That name is taken.' })
      return json(200, { slug })
    }

    if (method === 'GET' && path === '/club/members') {
      return json(200, { members: (await db.members(id)).sort((a, b) => a.requestedAt - b.requestedAt) })
    }

    if (method === 'POST' && path === '/club/members') {
      const who = clean(body?.username, 40).toLowerCase()
      const member = (await db.members(id)).find((m) => m.username === who)
      if (!member) return json(404, { error: 'No such organizer or request.' })
      if (body?.approve === true) {
        await db.approveMember(id, who)
      } else {
        if (who === username) return json(400, { error: "You can't remove yourself." })
        await db.removeMember(id, who)
        await accounts.remove(who)
      }
      return json(200, { ok: true })
    }

    return json(404, { error: 'not found' })
  }
}

/**
 * An in-memory club table, for the dev server and tests. clubs: { [id]:
 * { name, code?, approved?, organizers?: [username] } }.
 */
export function memoryClubDb(clubs = {}) {
  const meta = new Map()
  const docs = new Map()
  const members = new Map()
  const users = new Map()
  const codes = new Map()
  const slugs = new Map()
  for (const [id, c] of Object.entries(clubs)) {
    meta.set(id, { name: c.name, rev: 0, code: c.code, approved: c.approved, slug: c.slug })
    if (c.slug) slugs.set(c.slug, id)
    docs.set(id, {})
    members.set(id, new Map())
    if (c.code) codes.set(c.code, id)
    for (const u of c.organizers ?? []) {
      users.set(u, id)
      members.get(id).set(u, { username: u, approved: true, requestedAt: 0 })
    }
  }
  return {
    club: async (id) => structuredClone(meta.get(id) ?? null),
    docs: async (id) => structuredClone(docs.get(id) ?? {}),
    save: async (id, baseRev, put, remove) => {
      const club = meta.get(id)
      if (!club || club.rev !== baseRev) return null
      Object.assign(docs.get(id), put)
      for (const d of remove) delete docs.get(id)[d]
      return ++club.rev
    },
    membership: async (username) => {
      const id = users.get(username)
      const m = id && members.get(id)?.get(username)
      return m ? { clubId: id, approved: m.approved, requestedAt: m.requestedAt } : null
    },
    members: async (id) => [...(members.get(id)?.values() ?? [])].map((m) => ({ ...m })),
    /** False if the user already belongs to a club. */
    addMember: async (id, username, approved, at) => {
      if (users.has(username)) return false
      users.set(username, id)
      members.get(id).set(username, { username, approved, requestedAt: at })
      return true
    },
    approveMember: async (id, username) => {
      const m = members.get(id)?.get(username)
      if (m) m.approved = true
    },
    removeMember: async (id, username) => {
      members.get(id)?.delete(username)
      if (users.get(username) === id) users.delete(username)
    },
    clubByCode: async (code) => codes.get(code) ?? null,
    createClub: async ({ id, name, code, approved }) => {
      meta.set(id, { name, rev: 0, code, approved })
      docs.set(id, {})
      members.set(id, new Map())
      codes.set(code, id)
    },
    pendingClubs: async () => [...meta.values()].filter((c) => c.approved === false).length,
    /** For the dev server: what the app admin does with server/club.sh. */
    approveClub: async (id) => {
      meta.get(id).approved = true
    },
    clubBySlug: async (slug) => slugs.get(slug) ?? null,
    /** Gives a club a public link name, freeing its old one (from); false if another club has it. */
    setSlug: async (id, slug, from) => {
      if (slugs.has(slug) && slugs.get(slug) !== id) return false
      if (from && slugs.get(from) === id) slugs.delete(from)
      slugs.set(slug, id)
      meta.get(id).slug = slug
      return true
    },
    /** Gives a club a join code if it has none; returns the club's code. */
    setCode: async (id, code) => {
      const club = meta.get(id)
      if (!club.code) {
        club.code = code
        codes.set(code, id)
      }
      return club.code
    },
  }
}

/** In-memory accounts, for the dev server and tests: { [username]: password }. */
export function memoryAccounts(users = {}) {
  return {
    users,
    create: async (username, password) => {
      if (username in users) return 'taken'
      users[username] = password
      return 'ok'
    },
    remove: async (username) => void delete users[username],
  }
}
