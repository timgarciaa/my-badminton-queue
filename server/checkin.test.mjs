import { describe, expect, it } from 'vitest'
import { createApi, MAX_FAILS, memoryDb, OPEN_MS } from './checkin.mjs'

const setup = () => {
  let t = 1_000_000
  const api = createApi(memoryDb(), () => t)
  // Players' requests carry the PIN; the iPad's carry the key.
  const call = (method, path, body, key, pin = key ? undefined : '4821') => api({ method, path, body, key, pin })
  const open = (pin = '4821') =>
    call('PUT', '/s/ABC234', { date: '2026-10-26', pin, players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Ben' }], here: ['b'] }, 'secret')
  return { call, open, tick: (ms) => (t += ms), now: () => t }
}

describe('phone check-in api', () => {
  it('lists the names, with who is already in', async () => {
    const { call, open } = setup()
    expect((await open()).status).toBe(200)
    const res = await call('GET', '/s/ABC234')
    expect(res.body).toEqual({
      date: '2026-10-26',
      players: [
        { id: 'a', name: 'Ana', in: false },
        { id: 'b', name: 'Ben', in: true },
      ],
    })
  })

  it('checks a player in once, at the server time', async () => {
    const { call, open, now } = setup()
    await open()
    expect((await call('POST', '/s/ABC234/checkin', { id: 'a' })).body).toEqual({ at: now() })
    expect((await call('POST', '/s/ABC234/checkin', { id: 'a' })).body).toEqual({ at: null, already: true })
    // Already checked in on the iPad.
    expect((await call('POST', '/s/ABC234/checkin', { id: 'b' })).body).toEqual({ at: null, already: true })
    expect((await call('POST', '/s/ABC234/checkin', { id: 'zz' })).status).toBe(400)
    const list = await call('GET', '/s/ABC234/checkins', undefined, 'secret')
    expect(list.body).toEqual({ checkins: [{ id: 'a', at: now() }], locked: false })
  })

  it('takes a new name for the iPad to add', async () => {
    const { call, open } = setup()
    await open()
    const res = await call('POST', '/s/ABC234/checkin', { name: '  Cara   Lee ' })
    expect(res.body.id).toMatch(/^new-/)
    const list = await call('GET', '/s/ABC234/checkins', undefined, 'secret')
    expect(list.body.checkins[0]).toMatchObject({ id: res.body.id, name: 'Cara Lee' })
  })

  it('keeps check-ins when the iPad updates the names', async () => {
    const { call, open } = setup()
    await open()
    await call('POST', '/s/ABC234/checkin', { id: 'a' })
    await open()
    expect((await call('GET', '/s/ABC234/checkins', undefined, 'secret')).body.checkins).toHaveLength(1)
  })

  it('needs the key to update, read check-ins or close', async () => {
    const { call, open } = setup()
    await open()
    expect((await call('PUT', '/s/ABC234', { pin: '1111', players: [] }, 'other')).status).toBe(403)
    expect((await call('PUT', '/s/ABC234', { pin: '1111', players: [] })).status).toBe(401)
    expect((await call('GET', '/s/ABC234/checkins', undefined, 'other')).status).toBe(403)
    await call('DELETE', '/s/ABC234', undefined, 'other')
    expect((await call('GET', '/s/ABC234')).status).toBe(200)
    await call('DELETE', '/s/ABC234', undefined, 'secret')
    expect((await call('GET', '/s/ABC234')).status).toBe(404)
  })

  it('closes on its own once the iPad stops updating it', async () => {
    const { call, open, tick } = setup()
    await open()
    tick(OPEN_MS + 1)
    expect((await call('GET', '/s/ABC234')).status).toBe(404)
    expect((await call('POST', '/s/ABC234/checkin', { id: 'a' })).status).toBe(404)
  })

  it('needs the PIN to see the names or check in', async () => {
    const { call, open } = setup()
    expect((await call('PUT', '/s/ABC234', { pin: '12', players: [] }, 'secret')).status).toBe(400)
    await open()
    expect((await call('GET', '/s/ABC234', undefined, undefined, '')).body).toEqual({ error: 'pin required' })
    expect((await call('GET', '/s/ABC234', undefined, undefined, '0000')).status).toBe(401)
    expect((await call('POST', '/s/ABC234/checkin', { id: 'a' }, undefined, '0000')).status).toBe(401)
    expect((await call('GET', '/s/ABC234/checkins', undefined, 'secret')).body.checkins).toEqual([])
  })

  it('stops taking PINs after too many wrong ones, until the iPad sets a new one', async () => {
    const { call, open } = setup()
    await open()
    for (let i = 0; i < MAX_FAILS; i++) await call('GET', '/s/ABC234', undefined, undefined, '0000')
    expect((await call('GET', '/s/ABC234')).status).toBe(429)
    expect((await call('GET', '/s/ABC234/checkins', undefined, 'secret')).body.locked).toBe(true)
    // Same PIN again (the iPad updating the names): still locked.
    await open()
    expect((await call('GET', '/s/ABC234')).status).toBe(429)
    await open('5555')
    expect((await call('GET', '/s/ABC234', undefined, undefined, '5555')).status).toBe(200)
    expect((await call('GET', '/s/ABC234/checkins', undefined, 'secret')).body.locked).toBe(false)
  })

  it('rejects bad codes', async () => {
    const { call } = setup()
    expect((await call('GET', '/s/abc')).status).toBe(404)
    expect((await call('GET', '/s/ABC234')).status).toBe(404)
  })
})
