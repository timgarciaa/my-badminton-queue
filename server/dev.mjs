// Local check-in API for development: the same handler with an in-memory db.
// Run with `pnpm checkin:dev`; the app uses it through .env.development.
import { createServer } from 'node:http'
import { createApi, memoryDb } from './checkin.mjs'

const PORT = Number(process.env.PORT ?? 5181)
const handle = createApi(memoryDb())

createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE')
  res.setHeader('access-control-allow-headers', 'content-type, x-key, x-pin')
  if (req.method === 'OPTIONS') return res.writeHead(204).end()
  let raw = ''
  for await (const chunk of req) raw += chunk
  let body
  try {
    body = raw ? JSON.parse(raw) : undefined
  } catch {
    return res.writeHead(400).end()
  }
  const out = await handle({ method: req.method, path: new URL(req.url, 'http://x').pathname, key: req.headers['x-key'], pin: req.headers['x-pin'], body })
  res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify(out.body))
}).listen(PORT, () => console.log(`Check-in API on http://localhost:${PORT}`))
