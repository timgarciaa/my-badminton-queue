import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { newSession, useStore } from '../store/useStore'
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
  /** For people asking to join; missing until the club's first sign-in after join codes came in. */
  code?: string
}

interface CloudState {
  auth?: Auth
  club?: Club
  /** The club's revision this device last saw. */
  rev: number
  /** Hash of each document as last saved, so only changes are sent. */
  saved: Record<string, string>
  /** The club this device's data last went to; kept after signing out. */
  lastClubId?: string
  /** Who was signed in when the server signed them out, to fill in on the sign-in page. */
  lastUser?: string
}

export const useCloud = create<CloudState>()(persist(() => ({ rev: 0, saved: {} }), { name: 'mbq-cloud' }))

/**
 * saved: up to date. offline: will retry. conflict: another device saved
 * since; the organizer picks which data to keep. (Signed out by the server:
 * back to the sign-in page, see signInAgain.)
 */
export type SyncStatus = 'saved' | 'saving' | 'offline' | 'conflict'
export const useSyncStatus = create<{ status: SyncStatus; savedAt?: number; waiting: number }>(() => ({
  status: 'saved',
  /** People asking to join the club, for its organizers to approve. */
  waiting: 0,
}))

const fail = (message: string, status?: number, data?: Record<string, string>) =>
  Object.assign(new Error(message), { status, data })
type Failure = Error & { status?: number; data?: Record<string, string> }

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
  if (!res.ok) throw fail(data.error ?? res.statusText, res.status, data)
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
    else if (status === 401 || status === 403) signInAgain()
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

export interface Member {
  username: string
  approved: boolean
  requestedAt: number
}

/** The club's public stats page link name (given one from the club's name the first time). */
export const fetchLink = () => api<{ slug: string }>('GET', '/club/link').then((r) => r.slug)
/** Change it; fails with the reason (taken, or not a valid name). */
export const saveLink = (slug: string) => api<{ slug: string }>('POST', '/club/link', { slug }).then((r) => r.slug)
/** The public stats page's address for a link name. */
export const publicLink = (slug: string) => `${location.origin}${import.meta.env.BASE_URL}${slug}`

export const fetchMembers = () => api<{ members: Member[] }>('GET', '/club/members').then((r) => r.members)

/** Approve someone asking to join, or decline them (or remove an organizer). */
export async function decideMember(username: string, approve: boolean) {
  await api('POST', '/club/members', { username, approve })
  await refreshWaiting()
}

async function refreshWaiting() {
  try {
    const members = await fetchMembers()
    useSyncStatus.setState({ waiting: members.filter((m) => !m.approved).length })
  } catch {
    // Checked again later.
  }
}

/**
 * Save shortly after every change while signed in; right away when the app
 * is put away. Also checks now and then for people asking to join.
 */
export function useCloudSync() {
  const signedIn = useCloud((s) => !!s.auth && !!s.club)
  useEffect(() => {
    if (!CLOUD || !signedIn) return
    scheduleSave(500)
    void refreshWaiting()
    const requests = window.setInterval(() => document.visibilityState === 'visible' && void refreshWaiting(), 5 * 60_000)
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
      clearInterval(requests)
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
  // This device's data belongs to another club: never pass it on without asking.
  const otherClub = !!useCloud.getState().lastClubId && useCloud.getState().lastClubId !== snap.club.id
  if (Object.keys(snap.docs).length === 0) return hasData(local) && otherClub ? 'ask' : 'upload'
  if (!hasData(local)) return 'download'
  if (before.clubId === snap.club.id && before.rev === snap.rev) return 'upload'
  return changes(toDocs(local), hashes(snap.docs)).length === 0 ? 'upload' : 'ask'
}

/** Waiting for approval: of a new club (by the app admin) or to join one (by its organizers). */
export interface Pending {
  kind: 'club' | 'member'
  clubName: string
}

export type SignInResult = { snap: ClubSnapshot; choice: Choice } | { pending: Pending }

/** Fetches the club after signing in: its data, with whose to use, or that the account is waiting. */
async function enter(before: { clubId?: string; rev: number }): Promise<SignInResult> {
  try {
    const snap = await fetchClub()
    return { snap, choice: choose(snap, before) }
  } catch (e) {
    const f = e as Failure
    if (f.status === 403 && (f.data?.pending === 'club' || f.data?.pending === 'member')) {
      return { pending: { kind: f.data.pending, clubName: f.data.clubName } }
    }
    useCloud.setState({ auth: undefined })
    throw f.status === 403 ? fail("This account isn't an organizer of any club.") : e
  }
}

/** For an account waiting for approval: has it been approved yet? */
export const checkAgain = () => enter({ rev: 0 })

/** Asks for an account, to create a club or join one by its code. */
export async function signUp(username: string, password: string, club: { create: string } | { join: string }) {
  const res = await fetch(`${CHECKIN_API}/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password, ...club }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw fail(data.error ?? 'Something went wrong. Try again.', res.status)
}

/** Signs in and fetches the club (see SignInResult). */
export async function signIn(username: string, password: string): Promise<SignInResult> {
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
  return enter(before)
}

/** Whether there is anything worth keeping in this data. */
export const hasData = (d: Partial<ClubData>) =>
  (d.players?.length ?? 0) > 0 || (d.history?.length ?? 0) > 0 || (d.session?.attendees.length ?? 0) > 0

/** Replace this device's data with the club's. */
export function takeClubData(snap: ClubSnapshot) {
  const data = fromDocs(snap.docs)
  // A club with nothing saved yet starts this device on a fresh session too.
  useStore.getState().importData({ ...data, session: data.session ?? newSession() })
  useCloud.setState({ club: snap.club, rev: snap.rev, saved: hashes(snap.docs), lastClubId: snap.club.id })
  useSyncStatus.setState({ status: 'saved', savedAt: Date.now() })
}

/** Keep this device's data and save it over the club's. */
export function keepThisDevice(snap: ClubSnapshot) {
  useCloud.setState({ club: snap.club, rev: snap.rev, saved: hashes(snap.docs), lastClubId: snap.club.id })
  useSyncStatus.setState({ status: 'saving' })
  void save()
}

/**
 * Signed out by the server (e.g. a year passed, or removed from the club):
 * back to the sign-in page. This device keeps its data and the club's place,
 * so changes not saved yet are saved after signing in again.
 */
export function signInAgain() {
  clearTimeout(timer)
  useCloud.setState((s) => ({ auth: undefined, lastUser: s.auth?.username ?? s.lastUser }))
  useSyncStatus.setState({ status: 'saved' })
}

export function signOut() {
  clearTimeout(timer)
  useCloud.setState({ auth: undefined, club: undefined, rev: 0, saved: {} })
  useSyncStatus.setState({ status: 'saved', savedAt: undefined, waiting: 0 })
}
