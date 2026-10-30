import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { cognitoVerifier, devTokens } from './auth.mjs'
import { createClubApi, MAX_PENDING, memoryAccounts, memoryClubDb, slugOf } from './club.mjs'

const setup = () => {
  let t = 1000
  const tokens = devTokens()
  const db = memoryClubDb({
    c1: { name: 'Serve N Shout', code: 'SERVE2', organizers: ['tim'] },
    c2: { name: 'Other club', code: 'OTHER2', organizers: ['olga'] },
  })
  const accounts = memoryAccounts({ tim: 'pw-tim-123', olga: 'pw-olga-123' })
  const api = createClubApi(db, accounts, tokens.verify, () => t++)
  const as = (username, extra = {}) => tokens.issue({ 'cognito:username': username, ...extra })
  const call = (method, path, token, body) => api({ method, path, token, body })
  return { api, call, token: as('tim'), as, accounts, db }
}

describe('club data api', () => {
  it('needs a valid sign-in from an organizer', async () => {
    const { call, as } = setup()
    expect((await call('GET', '/club')).status).toBe(401)
    expect((await call('GET', '/club', 'nope')).status).toBe(401)
    expect((await call('GET', '/club', devTokens().issue({ 'cognito:username': 'tim' }))).status).toBe(401)
    expect((await call('GET', '/club', as('stranger'))).status).toBe(403)
  })

  it('saves documents and loads them back, one club at a time', async () => {
    const { call, token, as } = setup()
    expect((await call('GET', '/club', token)).body).toEqual({
      club: { id: 'c1', name: 'Serve N Shout', code: 'SERVE2' },
      user: 'tim',
      rev: 0,
      docs: {},
    })
    const put = { players: '[]', session: '{}', 'h#abc-1': '{"id":"abc-1"}' }
    expect((await call('POST', '/club/save', token, { baseRev: 0, put, remove: [] })).body).toEqual({ rev: 1 })
    await call('POST', '/club/save', token, { baseRev: 1, put: { players: '[1]' }, remove: ['h#abc-1'] })
    const club = (await call('GET', '/club', token)).body
    expect(club.rev).toBe(2)
    expect(club.docs).toEqual({ players: '[1]', session: '{}' })
    // Another club sees none of it.
    expect((await call('GET', '/club', as('olga'))).body.docs).toEqual({})
  })

  it('refuses a save from a device that is behind', async () => {
    const { call, token } = setup()
    await call('POST', '/club/save', token, { baseRev: 0, put: { players: '[]' }, remove: [] })
    const stale = await call('POST', '/club/save', token, { baseRev: 0, put: { players: '[2]' }, remove: [] })
    expect(stale.status).toBe(409)
    expect((await call('GET', '/club', token)).body.docs.players).toBe('[]')
  })

  it('rejects bad documents', async () => {
    const { call, token } = setup()
    const save = (body) => call('POST', '/club/save', token, body)
    expect((await save({ baseRev: 0, put: { other: '1' }, remove: [] })).status).toBe(400)
    expect((await save({ baseRev: 0, put: { players: 5 }, remove: [] })).status).toBe(400)
    expect((await save({ baseRev: 0, put: { players: '[]' }, remove: ['players'] })).status).toBe(400)
    expect((await save({ put: {}, remove: [] })).status).toBe(400)
  })

  it('carries over organizers whose club was set on their account', async () => {
    const { call, as, db } = setup()
    expect((await call('GET', '/club', as('ana', { 'custom:club': 'c1' }))).status).toBe(200)
    expect(await db.membership('ana')).toMatchObject({ clubId: 'c1', approved: true })
  })

  it('gives an older club a join code', async () => {
    const tokens = devTokens()
    const api = createClubApi(memoryClubDb({ c1: { name: 'Old', organizers: ['tim'] } }), memoryAccounts(), tokens.verify)
    const res = await api({ method: 'GET', path: '/club', token: tokens.issue({ 'cognito:username': 'tim' }) })
    expect(res.body.club.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
  })
})

describe('sign-up and approval', () => {
  it('joins a club by code, waiting for an organizer of that club', async () => {
    const { call, as, token, accounts } = setup()
    const res = await call('POST', '/signup', undefined, { username: ' Jules ', password: 'longenough', join: 'serve2' })
    expect(res.body).toEqual({ pending: 'member', clubName: 'Serve N Shout' })
    expect(accounts.users.jules).toBe('longenough')
    expect((await call('GET', '/club', as('jules'))).body).toMatchObject({ pending: 'member', clubName: 'Serve N Shout' })
    expect((await call('POST', '/club/save', as('jules'), { baseRev: 0, put: {}, remove: [] })).status).toBe(403)

    // Another club's organizer can't approve it.
    expect((await call('POST', '/club/members', as('olga'), { username: 'jules', approve: true })).status).toBe(404)
    const members = (await call('GET', '/club/members', token)).body.members
    expect(members.map((m) => [m.username, m.approved])).toEqual([['tim', true], ['jules', false]])
    await call('POST', '/club/members', token, { username: 'jules', approve: true })
    expect((await call('GET', '/club', as('jules'))).status).toBe(200)
  })

  it('declining removes the request and the account', async () => {
    const { call, as, token, accounts } = setup()
    await call('POST', '/signup', undefined, { username: 'mo', password: 'longenough', join: 'SERVE2' })
    await call('POST', '/club/members', token, { username: 'mo', approve: false })
    expect(accounts.users.mo).toBeUndefined()
    expect((await call('GET', '/club', as('mo'))).status).toBe(403)
    expect((await call('POST', '/club/members', token, { username: 'tim', approve: false })).status).toBe(400)
  })

  it('creates a club that waits for the app admin', async () => {
    const { call, as, db } = setup()
    const res = await call('POST', '/signup', undefined, { username: 'kai', password: 'longenough', create: 'Smash Club' })
    expect(res.body).toEqual({ pending: 'club', clubName: 'Smash Club' })
    expect((await call('GET', '/club', as('kai'))).body.pending).toBe('club')
    const { clubId } = await db.membership('kai')
    expect(clubId).toMatch(/^smash-club-[a-z0-9]{4}$/)
    // Nobody can join it before it's approved.
    const code = (await db.club(clubId)).code
    expect((await call('POST', '/signup', undefined, { username: 'lee', password: 'longenough', join: code })).status).toBe(404)
  })

  it('checks the request', async () => {
    const { call } = setup()
    const signup = (body) => call('POST', '/signup', undefined, body)
    expect((await signup({ username: 'tim', password: 'longenough', join: 'SERVE2' })).status).toBe(409)
    expect((await signup({ username: 'a', password: 'longenough', join: 'SERVE2' })).status).toBe(400)
    expect((await signup({ username: 'abc', password: 'short', join: 'SERVE2' })).status).toBe(400)
    expect((await signup({ username: 'abc', password: 'longenough', join: 'NOPE22' })).status).toBe(404)
    expect((await signup({ username: 'abc', password: 'longenough' })).status).toBe(400)
    expect((await signup({ username: 'abc', password: 'longenough', join: 'SERVE2', create: 'X' })).status).toBe(400)
  })

  it('limits waiting requests', async () => {
    const { call } = setup()
    for (let i = 0; i < MAX_PENDING; i++) {
      await call('POST', '/signup', undefined, { username: `user${i}`, password: 'longenough', join: 'SERVE2' })
    }
    expect((await call('POST', '/signup', undefined, { username: 'late', password: 'longenough', join: 'SERVE2' })).status).toBe(429)
  })
})

describe('cognito tokens', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
  const iss = 'https://cognito-idp.ap-southeast-1.amazonaws.com/pool'
  const jwt = (claims, header = { alg: 'RS256', kid: 'k1' }) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const signed = `${enc(header)}.${enc(claims)}`
    return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url')}`
  }
  const good = { iss, aud: 'client', token_use: 'id', exp: 2_000_000_000, 'custom:club': 'c1' }

  it('accepts only id tokens from the pool, for this app, not expired', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ keys: [jwk] }) })))
    const verify = cognitoVerifier({ region: 'ap-southeast-1', poolId: 'pool', clientId: 'client', now: () => 1_900_000_000_000 })
    expect(await verify(jwt(good))).toMatchObject({ 'custom:club': 'c1' })
    expect(await verify(jwt({ ...good, aud: 'other' }))).toBeNull()
    expect(await verify(jwt({ ...good, token_use: 'access' }))).toBeNull()
    expect(await verify(jwt({ ...good, iss: 'https://evil' }))).toBeNull()
    expect(await verify(jwt({ ...good, exp: 1_000 }))).toBeNull()
    expect(await verify(jwt(good, { alg: 'HS256', kid: 'k1' }))).toBeNull()
    // Changed after signing.
    const [h, , s] = jwt(good).split('.')
    const forged = Buffer.from(JSON.stringify({ ...good, 'custom:club': 'c2' })).toString('base64url')
    expect(await verify(`${h}.${forged}.${s}`)).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('public stats page', () => {
  const saved = (call, token) => {
    const players = [{ id: 'p1', name: 'Tim', skill: 4, gender: 'M', active: true, createdAt: 1 }, { id: 'p2', name: 'Ana', skill: 2, gender: 'F', active: true, createdAt: 2 }]
    const game = { id: 'g1', number: 1, court: 2, teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], startedAt: 10, endedAt: 20, winner: 'A', score: [21, 15], shuttles: 2, shuttleType: 't1' }
    const session = (id, date, extra = {}) => ({
      id,
      date,
      status: 'closed',
      courtFee: 800,
      shuttleTypes: [{ id: 't1', name: 'Vortex', price: 95, extra: 0 }],
      attendees: [{ playerId: 'p1', checkedInAt: 5, gamesPlayed: 1, paid: true, resting: false }],
      games: [game],
      queue: [],
      ...extra,
    })
    const put = {
      players: JSON.stringify(players),
      session: JSON.stringify(session('now', '2026-10-30', { status: 'open', remote: { code: 'ABC234', key: 'secret-key', pin: '4820', handled: [] } })),
      'h#old': JSON.stringify(session('old', '2026-10-25')),
      'h#older': JSON.stringify(session('older', '2026-10-18')),
    }
    return call('POST', '/club/save', token, { baseRev: 0, put, remove: [] })
  }

  it('gives each club a link name from its name, the first time', async () => {
    const { call, token, as } = setup()
    expect((await call('GET', '/club/link', token)).body).toEqual({ slug: 'serve-n-shout' })
    expect((await call('GET', '/club/link', token)).body).toEqual({ slug: 'serve-n-shout' })
    expect((await call('GET', '/club/link', as('olga'))).body).toEqual({ slug: 'other-club' })
    expect(slugOf("Serve N' Shout!")).toBe('serve-n-shout')
    expect((await call('GET', '/club/link')).status).toBe(401)
  })

  it('lets an organizer change it, if it is free and fits', async () => {
    const { call, token, as } = setup()
    expect((await call('POST', '/club/link', token, { slug: 'tim' })).body).toEqual({ slug: 'tim' })
    expect((await call('GET', '/club/link', token)).body).toEqual({ slug: 'tim' })
    // Another club can't take it; the old name is free again.
    expect((await call('POST', '/club/link', as('olga'), { slug: 'tim' })).status).toBe(409)
    expect((await call('POST', '/club/link', as('olga'), { slug: 'serve-n-shout' })).body).toEqual({ slug: 'serve-n-shout' })
    for (const bad of ['ab', 'Tim Garcia', '-tim', 'tim-', 'a--b', 'x'.repeat(31), 'assets', 'tension-tester']) {
      expect((await call('POST', '/club/link', token, { slug: bad })).status, bad).toBe(400)
    }
    // Uppercase is taken as lowercase.
    expect((await call('POST', '/club/link', token, { slug: 'TIMS' })).body).toEqual({ slug: 'tims' })
  })

  it('shows names, games and check-in times without signing in, and nothing private', async () => {
    const { call, token } = setup()
    await saved(call, token)
    await call('POST', '/club/link', token, { slug: 'tim' })
    const res = await call('GET', '/public/tim')
    expect(res.status).toBe(200)
    expect(res.body.club).toEqual({ name: 'Serve N Shout' })
    expect(res.body.players).toEqual([{ id: 'p1', name: 'Tim' }, { id: 'p2', name: 'Ana' }])
    expect(res.body.history.map((s) => s.date)).toEqual(['2026-10-25', '2026-10-18'])
    expect(res.body.session).toEqual({
      id: 'now',
      date: '2026-10-30',
      status: 'open',
      attendees: [{ playerId: 'p1', checkedInAt: 5 }],
      games: [{ id: 'g1', number: 1, court: 2, teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], startedAt: 10, endedAt: 20, winner: 'A', score: [21, 15] }],
    })
    // No PIN, check-in key, money, payments or skill levels.
    const text = JSON.stringify(res.body)
    for (const secret of ['secret-key', '4820', 'ABC234', 'courtFee', 'price', 'paid', 'skill', 'gender']) {
      expect(text, secret).not.toContain(secret)
    }
  })

  it('is not found for unknown names, old names and clubs waiting for approval', async () => {
    const { call, token } = setup()
    expect((await call('GET', '/public/nobody')).status).toBe(404)
    expect((await call('GET', '/public/../club')).status).toBe(404)
    await call('GET', '/club/link', token)
    await call('POST', '/club/link', token, { slug: 'tim' })
    expect((await call('GET', '/public/serve-n-shout')).status).toBe(404)
    expect((await call('GET', '/public/tim')).status).toBe(200)
    // A new club waiting for approval has no public page.
    const { db } = setup()
    await db.createClub({ id: 'c3', name: 'New club', code: 'NEWCL2', approved: false })
    await db.setSlug('c3', 'new-club', null)
    const api = createClubApi(db, memoryAccounts(), devTokens().verify)
    expect((await api({ method: 'GET', path: '/public/new-club' })).status).toBe(404)
  })
})
