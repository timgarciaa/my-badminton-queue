// Club data API: an organizer signs in on the club's iPad, which keeps working
// from its own copy and saves changes here. The data is a few documents per
// club, each a JSON string: the players, the current session, and one per
// past session. Every save bumps the club's revision; a save made from an
// older revision (another device saved since) is refused, so nothing is
// overwritten without the organizer choosing to.
//
//   GET  /club        → { club: { id, name }, user, rev, docs: { [id]: json } }
//   POST /club/save   { baseRev, put: { [id]: json }, remove: [id] } → { rev }, or 409 if behind
//
// Requests carry the organizer's sign-in token (Authorization: Bearer ...),
// whose custom:club claim says which club they organize.

/** Document ids: players, session, and h#<session id> for past sessions. */
export const DOC_ID = /^(players|session|h#[\w-]{1,64})$/
/** Per save; the app sends bigger saves in parts. */
export const MAX_ACTIONS = 90
const MAX_DOC = 350_000

const json = (status, body) => ({ status, body })

/**
 * db is { load(clubId) → { name, rev, docs } | null, save(clubId, baseRev,
 * put, remove) → new rev, or null if the club's rev isn't baseRev }.
 * verify(token) → the token's claims, or null.
 */
export function createClubApi(db, verify) {
  return async function handle({ method, path, token, body }) {
    const claims = token ? await verify(token) : null
    if (!claims) return json(401, { error: 'sign in' })
    const clubId = claims['custom:club']
    if (!clubId) return json(403, { error: 'not an organizer' })

    if (method === 'GET' && path === '/club') {
      const club = await db.load(clubId)
      if (!club) return json(403, { error: 'unknown club' })
      return json(200, {
        club: { id: clubId, name: club.name },
        user: claims['cognito:username'],
        rev: club.rev,
        docs: club.docs,
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
      if (new Set(ids).size !== ids.length || !ids.every((id) => DOC_ID.test(id))) return json(400, { error: 'bad document' })
      if (!Object.values(put).every((v) => typeof v === 'string' && v.length <= MAX_DOC)) {
        return json(400, { error: 'document too big' })
      }
      const rev = await db.save(clubId, baseRev, put, remove)
      return rev === null ? json(409, { error: 'changed on another device' }) : json(200, { rev })
    }

    return json(404, { error: 'not found' })
  }
}

/** An in-memory db, for the dev server and tests. */
export function memoryClubDb(clubs = {}) {
  const items = new Map(Object.entries(clubs).map(([id, name]) => [id, { name, rev: 0, docs: {} }]))
  return {
    load: async (clubId) => structuredClone(items.get(clubId) ?? null),
    save: async (clubId, baseRev, put, remove) => {
      const club = items.get(clubId)
      if (!club || club.rev !== baseRev) return null
      Object.assign(club.docs, put)
      for (const id of remove) delete club.docs[id]
      return ++club.rev
    },
  }
}
