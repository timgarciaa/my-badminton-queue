// Checks the sign-in token (a Cognito ID token, a JWT) sent with club
// requests: signed by the club user pool, for this app, not expired.
import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto'

const b64 = (s) => Buffer.from(s, 'base64url')

/** The parts of a JWT, or null if it isn't one. */
function decode(token) {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 3) return null
  try {
    return {
      header: JSON.parse(b64(parts[0]).toString()),
      payload: JSON.parse(b64(parts[1]).toString()),
      signed: Buffer.from(`${parts[0]}.${parts[1]}`),
      signature: b64(parts[2]),
    }
  } catch {
    return null
  }
}

const valid = (claims, { iss, aud, now }) =>
  claims.iss === iss && claims.aud === aud && claims.token_use === 'id' && claims.exp * 1000 > now()

/** verify(token) → the token's claims, or null. For tokens from a Cognito user pool. */
export function cognitoVerifier({ region, poolId, clientId, now = () => Date.now() }) {
  const iss = `https://cognito-idp.${region}.amazonaws.com/${poolId}`
  let keys = new Map()
  let fetchedAt = 0
  const keyFor = async (kid) => {
    // Fetch the pool's public keys once, and again only if a new key shows up
    // (at most every 5 minutes, so made-up key ids can't make us fetch each time).
    if (!keys.has(kid) && now() - fetchedAt > 5 * 60_000) {
      fetchedAt = now()
      const { keys: list } = await (await fetch(`${iss}/.well-known/jwks.json`)).json()
      keys = new Map(list.map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]))
    }
    return keys.get(kid)
  }
  return async (token) => {
    const t = decode(token)
    if (!t || t.header.alg !== 'RS256') return null
    const key = await keyFor(t.header.kid)
    if (!key || !verify('RSA-SHA256', t.signed, key, t.signature)) return null
    return valid(t.payload, { iss, aud: clientId, now }) ? t.payload : null
  }
}

/** Tokens for the local dev server, signed with a secret instead of Cognito's keys. */
export function devTokens({ now = () => Date.now() } = {}) {
  const secret = randomBytes(32)
  const iss = 'mbq-dev'
  const aud = 'dev'
  const sign = (s) => createHmac('sha256', secret).update(s).digest()
  return {
    issue(claims, seconds = 3600) {
      const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
      const body = Buffer.from(
        JSON.stringify({ ...claims, iss, aud, token_use: 'id', exp: Math.floor(now() / 1000) + seconds }),
      ).toString('base64url')
      return `${head}.${body}.${sign(`${head}.${body}`).toString('base64url')}`
    },
    async verify(token) {
      const t = decode(token)
      if (!t || t.header.alg !== 'HS256') return null
      const expected = sign(t.signed)
      if (t.signature.length !== expected.length || !timingSafeEqual(t.signature, expected)) return null
      return valid(t.payload, { iss, aud, now }) ? t.payload : null
    },
  }
}
