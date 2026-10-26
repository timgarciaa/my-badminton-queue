import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { cognitoVerifier, devTokens } from './auth.mjs'
import { createClubApi, memoryClubDb } from './club.mjs'

const setup = () => {
  const tokens = devTokens()
  const api = createClubApi(memoryClubDb({ c1: 'Serve N Shout', c2: 'Other club' }), tokens.verify)
  const as = (club) => tokens.issue({ 'cognito:username': 'tim', 'custom:club': club })
  return { api, token: as('c1'), as, tokens }
}

describe('club data api', () => {
  it('needs a valid sign-in for an existing club', async () => {
    const { api, as } = setup()
    expect((await api({ method: 'GET', path: '/club' })).status).toBe(401)
    expect((await api({ method: 'GET', path: '/club', token: 'nope' })).status).toBe(401)
    expect((await api({ method: 'GET', path: '/club', token: devTokens().issue({ 'custom:club': 'c1' }) })).status).toBe(401)
    expect((await api({ method: 'GET', path: '/club', token: as(undefined) })).status).toBe(403)
    expect((await api({ method: 'GET', path: '/club', token: as('zz') })).status).toBe(403)
  })

  it('saves documents and loads them back, one club at a time', async () => {
    const { api, token, as } = setup()
    expect((await api({ method: 'GET', path: '/club', token })).body).toEqual({
      club: { id: 'c1', name: 'Serve N Shout' },
      user: 'tim',
      rev: 0,
      docs: {},
    })
    const put = { players: '[]', session: '{}', 'h#abc-1': '{"id":"abc-1"}' }
    expect((await api({ method: 'POST', path: '/club/save', token, body: { baseRev: 0, put, remove: [] } })).body).toEqual({ rev: 1 })
    await api({ method: 'POST', path: '/club/save', token, body: { baseRev: 1, put: { players: '[1]' }, remove: ['h#abc-1'] } })
    const club = (await api({ method: 'GET', path: '/club', token })).body
    expect(club.rev).toBe(2)
    expect(club.docs).toEqual({ players: '[1]', session: '{}' })
    // Another club sees none of it.
    expect((await api({ method: 'GET', path: '/club', token: as('c2') })).body.docs).toEqual({})
  })

  it('refuses a save from a device that is behind', async () => {
    const { api, token } = setup()
    await api({ method: 'POST', path: '/club/save', token, body: { baseRev: 0, put: { players: '[]' }, remove: [] } })
    const stale = await api({ method: 'POST', path: '/club/save', token, body: { baseRev: 0, put: { players: '[2]' }, remove: [] } })
    expect(stale.status).toBe(409)
    expect((await api({ method: 'GET', path: '/club', token })).body.docs.players).toBe('[]')
  })

  it('rejects bad documents', async () => {
    const { api, token } = setup()
    const save = (body) => api({ method: 'POST', path: '/club/save', token, body })
    expect((await save({ baseRev: 0, put: { 'other': '1' }, remove: [] })).status).toBe(400)
    expect((await save({ baseRev: 0, put: { players: 5 }, remove: [] })).status).toBe(400)
    expect((await save({ baseRev: 0, put: { players: '[]' }, remove: ['players'] })).status).toBe(400)
    expect((await save({ put: {}, remove: [] })).status).toBe(400)
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
