// Local API for development: phone check-in and club data with in-memory dbs,
// and /dev-auth standing in for Cognito sign-in (same requests and answers).
// Run with `pnpm checkin:dev`; the app uses it through .env.development.
// Dev account: demo / demo1234, organizer of "Dev Club".
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { devTokens } from './auth.mjs'
import { createApi, memoryDb } from './checkin.mjs'
import { createClubApi, memoryClubDb } from './club.mjs'

const PORT = Number(process.env.PORT ?? 5181)
const USERS = { demo: { password: 'demo1234', club: 'dev-club' } }

const tokens = devTokens()
const refresh = new Map()
const handle = createApi(memoryDb())
const handleClub = createClubApi(memoryClubDb({ 'dev-club': 'Dev Club' }), tokens.verify)

/** Cognito's InitiateAuth, for USER_PASSWORD_AUTH and REFRESH_TOKEN_AUTH. */
function devAuth(body) {
  const p = body?.AuthParameters ?? {}
  const username =
    body?.AuthFlow === 'REFRESH_TOKEN_AUTH'
      ? refresh.get(p.REFRESH_TOKEN)
      : USERS[p.USERNAME]?.password === p.PASSWORD
        ? p.USERNAME
        : undefined
  if (!username) {
    return { status: 400, body: { __type: 'NotAuthorizedException', message: 'Incorrect username or password.' } }
  }
  const IdToken = tokens.issue({ 'cognito:username': username, 'custom:club': USERS[username].club })
  const result = { IdToken, ExpiresIn: 3600, TokenType: 'Bearer' }
  if (body.AuthFlow === 'USER_PASSWORD_AUTH') {
    result.RefreshToken = randomUUID()
    refresh.set(result.RefreshToken, username)
  }
  return { status: 200, body: { AuthenticationResult: result } }
}

createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE')
  res.setHeader('access-control-allow-headers', 'content-type, x-key, x-pin, authorization, x-amz-target')
  if (req.method === 'OPTIONS') return res.writeHead(204).end()
  let raw = ''
  for await (const chunk of req) raw += chunk
  let body
  try {
    body = raw ? JSON.parse(raw) : undefined
  } catch {
    return res.writeHead(400).end()
  }
  const path = new URL(req.url, 'http://x').pathname
  const out =
    path === '/dev-auth'
      ? devAuth(body)
      : path.startsWith('/club')
        ? await handleClub({ method: req.method, path, token: req.headers.authorization?.replace(/^Bearer /, ''), body })
        : await handle({ method: req.method, path, key: req.headers['x-key'], pin: req.headers['x-pin'], body })
  res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify(out.body))
}).listen(PORT, () => console.log(`MBQ API on http://localhost:${PORT} (dev account demo / demo1234)`))
