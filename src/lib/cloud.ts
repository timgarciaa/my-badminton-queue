import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useStore } from '../store/useStore'
import type { Player, Session } from '../types'
import { CHECKIN_API } from './remoteCheckin'

/**
 * Club accounts: an organizer signs in (Cognito, username and password) and
 * this device saves its data to the club in the cloud (server/club.mjs). The
 * device keeps working from its own copy, so a session never waits on the
 * internet; changes go up a few seconds later, or once it's back online.
 */
const AUTH_URL: string | undefined = import.meta.env.VITE_AUTH_URL || undefined
const CLIENT_ID: string | undefined = import.meta.env.VITE_COGNITO_CLIENT_ID || undefined
/** Whether this build can sign in to a club. */
export const CLOUD = !!(CHECKIN_API && AUTH_URL && CLIENT_ID)

const SAVE_DELAY = 3000
const RETRY_MS = 20_000
/** Per request; the server allows 90 documents at once. */
const MAX_DOCS = 80
const MAX_BYTES = 3_000_000

interface Auth {
  username: string
  idToken: string
  refreshToken: string
  expiresAt: number
}

export interface Club {
  id: string
  name: string
}

interface CloudState {
  auth?: Auth
  club?: Club
  /** The club's revision this device last saw. */
  rev: number
  /** Hash of each document as last saved, so only changes are sent. */
  saved: Record<string, string>
}

export const useCloud = create<CloudState>()(persist(() => ({ rev: 0, saved: {} }), { name: 'mbq-cloud' }))

/**
 * saved: up to date. offline: will retry. conflict: another device saved
 * since; the organizer picks which data to keep. expired: sign in again.
 */
export type SyncStatus = 'saved' | 'saving' | 'offline' | 'conflict' | 'expired'
export const useSyncStatus = create<{ status: SyncStatus; savedAt?: number }>(() => ({ status: 'saved' }))

const fail = (message: string, status?: number) => Object.assign(new Error(message), { status })
type Failure = Error & { status?: number }

/** Calls Cognito (or the dev server's stand-in): InitiateAuth and friends. */
async function cognito<T>(action: string, body: unknown): Promise<T> {
  const res = await fetch(AUTH_URL!, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const wrong = data.__type === 'NotAuthorizedException' || data.__type === 'UserNotFoundException'
    throw fail(wrong ? 'Wrong username or password.' : (data.message ?? 'Sign-in failed.'), wrong ? 401 : res.status)
  }
  return data as T
}

interface AuthResult {
  AuthenticationResult?: { IdToken: string; RefreshToken?: string; ExpiresIn: number }
}

/** A current ID token, refreshed when it's about to run out. */
async function idToken(): Promise<string> {
  const { auth } = useCloud.getState()
  if (!auth) throw fail('Signed out', 401)
  if (auth.expiresAt - Date.now() > 60_000) return auth.idToken
  const r = await cognito<AuthResult>('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { REFRESH_TOKEN: auth.refreshToken },
  })
  const result = r.AuthenticationResult!
  const next = { ...auth, idToken: result.IdToken, expiresAt: Date.now() + result.ExpiresIn * 1000 }
  useCloud.setState({ auth: next })
  return next.idToken
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await idToken()
  const res = await fetch(`${CHECKIN_API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw fail(data.error ?? res.statusText, res.status)
  return data as T
}

// --- Documents: the store split into the pieces saved to the cloud ---

export interface ClubData {
  players: Player[]
  session: Session
  history: Session[]
}

/** players, session, and h#<id> for each past session, as JSON. */
export function toDocs(d: ClubData): Record<string, string> {
  const docs: Record<string, string> = { players: JSON.stringify(d.players), session: JSON.stringify(d.session) }
  for (const s of d.history) docs[`h#${s.id}`] = JSON.stringify(s)
  return docs
}

/** When a session last had anything happen, to order past sessions newest first. */
const lastActivity = (s: Session) =>
  Math.max(0, ...s.games.map((g) => g.endedAt ?? g.startedAt), ...s.attendees.map((a) => a.checkedInAt))

export function fromDocs(docs: Record<string, string>): Partial<ClubData> & { players: Player[]; history: Session[] } {
  const history = Object.entries(docs)
    .filter(([id]) => id.startsWith('h#'))
    .map(([, json]) => JSON.parse(json) as Session)
    .sort((a, b) => b.date.localeCompare(a.date) || lastActivity(b) - lastActivity(a))
  return {
    players: docs.players ? JSON.parse(docs.players) : [],
    ...(docs.session && { session: JSON.parse(docs.session) as Session }),
    history,
  }
}

/** A short hash (cyrb53) of a document, to tell whether it changed. */
export function hashOf(s: string) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const hashes = (docs: Record<string, string>) =>
  Object.fromEntries(Object.entries(docs).map(([id, json]) => [id, hashOf(json)]))

export interface Batch {
  put: Record<string, string>
  remove: string[]
}

/** What to send to bring the cloud from `saved` to `docs`, in requests small enough to send. */
export function changes(docs: Record<string, string>, saved: Record<string, string>): Batch[] {
  const put = Object.entries(docs).filter(([id, json]) => saved[id] !== hashOf(json))
  const remove = Object.keys(saved).filter((id) => !(id in docs))
  const batches: Batch[] = []
  let batch: Batch = { put: {}, remove: [] }
  let docsIn = 0
  let bytes = 0
  const next = (size: number) => {
    if (docsIn > 0 && (docsIn >= MAX_DOCS || bytes + size > MAX_BYTES)) {
      batches.push(batch)
      batch = { put: {}, remove: [] }
      docsIn = 0
      bytes = 0
    }
    docsIn++
    bytes += size
  }
  for (const [id, json] of put) {
    next(json.length)
    batch.put[id] = json
  }
  for (const id of remove) {
    next(0)
    batch.remove.push(id)
  }
  if (docsIn > 0) batches.push(batch)
  return batches
}

// --- Saving ---

let timer: number | undefined
let running = false
let again = false

export function scheduleSave(delay = SAVE_DELAY) {
  clearTimeout(timer)
  timer = window.setTimeout(() => void save(), delay)
}

/** Send whatever changed since the last save. */
export async function save() {
  if (running) {
    again = true
    return
  }
  const { auth, club } = useCloud.getState()
  if (!CLOUD || !auth || !club || useSyncStatus.getState().status === 'conflict') return
  running = true
  try {
    const batches = changes(toDocs(useStore.getState()), useCloud.getState().saved)
    if (batches.length > 0) useSyncStatus.setState({ status: 'saving' })
    for (const b of batches) {
      const { rev } = await api<{ rev: number }>('POST', '/club/save', { baseRev: useCloud.getState().rev, ...b })
      useCloud.setState((s) => {
        const saved = { ...s.saved, ...hashes(b.put) }
        for (const id of b.remove) delete saved[id]
        return { rev, saved }
      })
    }
    useSyncStatus.setState({ status: 'saved', savedAt: Date.now() })
  } catch (e) {
    const status = (e as Failure).status
    if (status === 409) useSyncStatus.setState({ status: 'conflict' })
    else if (status === 401 || status === 403) useSyncStatus.setState({ status: 'expired' })
    else {
      useSyncStatus.setState({ status: 'offline' })
      scheduleSave(RETRY_MS)
    }
  } finally {
    running = false
    if (again) {
      again = false
      scheduleSave(0)
    }
  }
}

/** Save shortly after every change while signed in; right away when the app is put away. */
export function useCloudSync() {
  const signedIn = useCloud((s) => !!s.auth && !!s.club)
  useEffect(() => {
    if (!CLOUD || !signedIn) return
    scheduleSave(500)
    const unsubscribe = useStore.subscribe((st, prev) => {
      if (st.players !== prev.players || st.session !== prev.session || st.history !== prev.history) scheduleSave()
    })
    const hidden = () => document.visibilityState === 'hidden' && void save()
    const online = () => scheduleSave(0)
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('online', online)
    return () => {
      unsubscribe()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('online', online)
    }
  }, [signedIn])
}

// --- Signing in and choosing data ---

export interface ClubSnapshot {
  club: Club
  user: string
  rev: number
  docs: Record<string, string>
}

export const fetchClub = () => api<ClubSnapshot>('GET', '/club')

/**
 * After signing in, whose data to use: upload this device's (the club has
 * none, or hasn't changed since this device last saved), download the club's
 * (this device has none), or ask.
 */
export type Choice = 'upload' | 'download' | 'ask'

function choose(snap: ClubSnapshot, before: { clubId?: string; rev: number }): Choice {
  const local = useStore.getState()
  if (Object.keys(snap.docs).length === 0) return 'upload'
  if (!hasData(local)) return 'download'
  if (before.clubId === snap.club.id && before.rev === snap.rev) return 'upload'
  return changes(toDocs(local), hashes(snap.docs)).length === 0 ? 'upload' : 'ask'
}

/** Signs in and fetches the club, with whose data to use (see Choice). */
export async function signIn(username: string, password: string): Promise<{ snap: ClubSnapshot; choice: Choice }> {
  const before = { clubId: useCloud.getState().club?.id, rev: useCloud.getState().rev }
  const r = await cognito<AuthResult>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: username.trim(), PASSWORD: password },
  })
  const result = r.AuthenticationResult
  if (!result?.RefreshToken) throw fail('This account needs its password set again. Ask the club admin.')
  useCloud.setState({
    auth: {
      username: username.trim(),
      idToken: result.IdToken,
      refreshToken: result.RefreshToken,
      expiresAt: Date.now() + result.ExpiresIn * 1000,
    },
    club: undefined,
    rev: 0,
    saved: {},
  })
  try {
    const snap = await fetchClub()
    return { snap, choice: choose(snap, before) }
  } catch (e) {
    useCloud.setState({ auth: undefined })
    throw (e as Failure).status === 403 ? fail("This account isn't an organizer of any club.") : e
  }
}

/** Whether there is anything worth keeping in this data. */
export const hasData = (d: Partial<ClubData>) =>
  (d.players?.length ?? 0) > 0 || (d.history?.length ?? 0) > 0 || (d.session?.attendees.length ?? 0) > 0

/** Replace this device's data with the club's. */
export function takeClubData(snap: ClubSnapshot) {
  const data = fromDocs(snap.docs)
  useStore.getState().importData(data)
  useCloud.setState({ club: snap.club, rev: snap.rev, saved: hashes(snap.docs) })
  useSyncStatus.setState({ status: 'saved', savedAt: Date.now() })
}

/** Keep this device's data and save it over the club's. */
export function keepThisDevice(snap: ClubSnapshot) {
  useCloud.setState({ club: snap.club, rev: snap.rev, saved: hashes(snap.docs) })
  useSyncStatus.setState({ status: 'saving' })
  void save()
}

export function signOut() {
  clearTimeout(timer)
  useCloud.setState({ auth: undefined, club: undefined, rev: 0, saved: {} })
  useSyncStatus.setState({ status: 'saved', savedAt: undefined })
}
