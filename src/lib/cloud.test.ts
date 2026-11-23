import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Saving and pulling against a stand-in club server, with the internet as bad
 * as it gets at the courts: slow answers, replies that never arrive, requests
 * that hang, and no connection at all. One iPad, as in a session.
 */
describe('cloud sync on bad wifi', () => {
  // A stand-in club: documents and a revision, like server/club.mjs.
  let rev = 0
  let docs: Record<string, string> = {}
  const net = {
    /** No connection: requests fail before reaching the club. */
    offline: false,
    /** Saves that reach the club but whose reply is lost. */
    dropReplies: 0,
    /** GET /club answers held back until let go (slow wifi). */
    holdPulls: false,
    /** Requests that never answer (until given up). */
    hang: false,
  }
  const held: (() => void)[] = []
  const letPullsGo = () => {
    net.holdPulls = false
    held.splice(0).forEach((go) => go())
  }

  beforeAll(() => {
    vi.stubEnv('VITE_CHECKIN_API', 'http://club.test')
    vi.stubEnv('VITE_AUTH_URL', 'http://auth.test')
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'client')
    const kept = new Map<string, string>()
    const storage = {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
      removeItem: (k: string) => void kept.delete(k),
    }
    vi.stubGlobal('localStorage', storage)
    // Saves are sent by hand here, not on a timer.
    vi.stubGlobal('window', { localStorage: storage, setTimeout: () => 0 })
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (net.offline) throw new TypeError('Load failed')
      if (net.hang) {
        return new Promise<Response>((_, fail) =>
          init?.signal?.addEventListener('abort', () => fail(new DOMException('Aborted', 'AbortError'))),
        )
      }
      const path = url.replace('http://club.test', '')
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      if (path === '/club') {
        // What the club has when the request arrives, answered later.
        const snap = { club: { id: 'c1', name: 'Club' }, user: 'tim', rev, docs: { ...docs } }
        if (net.holdPulls) await new Promise<void>((r) => held.push(r))
        return reply(snap)
      }
      if (path === '/club/save') {
        const b = JSON.parse(String(init!.body))
        if (b.baseRev !== rev) return reply({ error: 'changed on another device' }, 409)
        docs = { ...docs, ...b.put }
        for (const id of b.remove) delete docs[id]
        rev++
        if (net.dropReplies > 0) {
          net.dropReplies--
          throw new TypeError('Load failed')
        }
        return reply({ rev })
      }
      return reply({}, 404)
    })
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  /** A fresh app on the iPad, signed in to an empty club, with a game on court 1. */
  async function start() {
    rev = 0
    docs = {}
    Object.assign(net, { offline: false, dropReplies: 0, holdPulls: false, hang: false })
    vi.resetModules()
    const { useStore, newSession } = await import('../store/useStore')
    const cloud = await import('./cloud')
    const players = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id, skill: 3 as const, active: true, createdAt: 0 }))
    useStore.setState({ players, session: newSession(), history: [], schedule: [], seasons: [] })
    cloud.useCloud.setState({
      auth: { username: 'tim', idToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 },
      club: { id: 'c1', name: 'Club' },
      rev: 0,
      saved: {},
    })
    const st = () => useStore.getState()
    st().startGame(1, ['a', 'b'], ['c', 'd'])
    await cloud.save()
    /** Ends the game on court 1 and starts the next one. */
    const play = (score: [number, number]) => {
      st().endGame(st().session.games.find((g) => !g.endedAt)!.id, 'A', false, score)
      st().startGame(1, ['a', 'c'], ['b', 'd'])
    }
    const scores = () => st().session.games.filter((g) => g.score).map((g) => g.score!.join('–'))
    const clubScores = () =>
      (JSON.parse(docs.session) as { games: { score?: number[] }[] }).games.filter((g) => g.score).map((g) => g.score!.join('–'))
    const status = () => cloud.useSyncStatus.getState().status
    return { cloud, st, play, scores, clubScores, status }
  }

  beforeEach(() => {
    held.length = 0
  })

  it("doesn't bring back older data when a save finishes while a pull is on its way", async () => {
    const { cloud, play, scores, clubScores } = await start()
    // The app checks the club (e.g. the iPad got focus); the answer is slow...
    net.holdPulls = true
    const pulling = cloud.pull()
    await new Promise((r) => setTimeout(r, 0))
    // ...and meanwhile a game ends and is saved.
    play([21, 15])
    await cloud.save()
    // Now the slow answer arrives, from before the game ended.
    letPullsGo()
    await pulling
    expect(scores()).toEqual(['21–15'])
    expect(clubScores()).toEqual(['21–15'])
  })

  it('keeps every game when a reply is lost, more games are played, and the app checks the club', async () => {
    const { cloud, play, scores, clubScores, status } = await start()
    net.dropReplies = 1
    play([21, 15])
    await cloud.save()
    expect(status()).toBe('offline')
    play([21, 19])
    // Back online: the app checks the club first, then saves.
    await cloud.pull()
    await cloud.save()
    expect(status()).toBe('saved')
    expect(scores()).toEqual(['21–15', '21–19'])
    expect(clubScores()).toEqual(['21–15', '21–19'])
  })

  it('keeps every game through a long time offline after a save whose reply was lost', async () => {
    const { cloud, play, scores, clubScores, status } = await start()
    net.dropReplies = 1
    play([21, 10])
    await cloud.save()
    // Half an hour without wifi: games go on, and saving keeps being tried.
    net.offline = true
    for (let i = 0; i < 12; i++) {
      play([21, i])
      await cloud.save()
      await cloud.pull()
    }
    expect(status()).toBe('offline')
    net.offline = false
    await cloud.pull()
    await cloud.save()
    expect(status()).toBe('saved')
    expect(scores()).toHaveLength(13)
    expect(clubScores()).toEqual(scores())
  })

  it('gives up on a request that hangs, and saves once the wifi is back', async () => {
    const { cloud, play, clubScores, status } = await start()
    cloud.timing.requestMs = 50
    net.hang = true
    play([21, 17])
    await cloud.save()
    expect(status()).toBe('offline')
    net.hang = false
    await cloud.save()
    expect(status()).toBe('saved')
    expect(clubScores()).toEqual(['21–17'])
  })

  it('a slow answer to a save that hangs and lands later loses nothing', async () => {
    const { cloud, play, scores, clubScores, status } = await start()
    // The save gets there, but the reply is lost and a slow pull is on its way too.
    net.dropReplies = 1
    play([21, 12])
    await cloud.save()
    net.holdPulls = true
    const pulling = cloud.pull()
    await new Promise((r) => setTimeout(r, 0))
    play([23, 21])
    letPullsGo()
    await pulling
    await cloud.save()
    expect(status()).toBe('saved')
    expect(scores()).toEqual(['21–12', '23–21'])
    expect(clubScores()).toEqual(['21–12', '23–21'])
  })
})
