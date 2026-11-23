import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { newSession, useStore } from '../store/useStore'
import type { Player, ScheduledGame, Season, Session } from '../types'
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
/**
 * How long a request may take before it's given up and tried again later: on
 * wifi that has dropped, a request can otherwise hang for minutes and hold up
 * every save after it. (Changeable for tests.)
 */
export const timing = { requestMs: 20_000 }
/** How often an open app checks the club for changes made on other devices. */
const PULL_MS = 2 * 60_000
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
  /** The club's revision this device last saw (kept after signing out, with saved, for lastClubId). */
  rev: number
  /** Hash of each document as last saved or downloaded, so only changes are sent. */
  saved: Record<string, string>
  /**
   * Hashes of documents sent in saves not known to have arrived ('' for a
   * removal): a save can reach the club after the internet drops, before its
   * reply gets back. Then the club's copy is this device's own, not a change.
   */
  sent?: Record<string, string[]>
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
export const useSyncStatus = create<{ status: SyncStatus; savedAt?: number; waiting: number; clashes?: string[] }>(() => ({
  status: 'saved',
  /** People asking to join the club, for its organizers to approve. */
  waiting: 0,
}))

const fail = (message: string, status?: number, data?: Record<string, string>) =>
  Object.assign(new Error(message), { status, data })
type Failure = Error & { status?: number; data?: Record<string, string> }

/** Calls Cognito (or the dev server's stand-in): InitiateAuth and friends. */
async function cognito<T>(action: string, body: unknown): Promise<T> {
  const res = await fetchInTime(AUTH_URL!, {
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

/** fetch, given up after timing.requestMs (a network failure: no status, so tried again later). */
async function fetchInTime(url: string, init: RequestInit): Promise<Response> {
  const stop = new AbortController()
  const timeout = setTimeout(() => stop.abort(), timing.requestMs)
  try {
    const res = await fetch(url, { ...init, signal: stop.signal })
    // The body can stall too.
    const text = await res.text()
    return new Response(text, { status: res.status, statusText: res.statusText })
  } finally {
    clearTimeout(timeout)
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await idToken()
  const res = await fetchInTime(`${CHECKIN_API}${path}`, {
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
  /** Missing in data from before games could be scheduled. */
  schedule?: ScheduledGame[]
  /** Missing in data from before seasons. */
  seasons?: Season[]
}

/** players, session, h#<id> for each past session, and schedule and seasons (when there are any), as JSON. */
export function toDocs(d: ClubData): Record<string, string> {
  const docs: Record<string, string> = { players: JSON.stringify(d.players), session: JSON.stringify(d.session) }
  for (const s of d.history) docs[`h#${s.id}`] = JSON.stringify(s)
  if (d.schedule?.length) docs.schedule = JSON.stringify(d.schedule)
  if (d.seasons?.length) docs.seasons = JSON.stringify(d.seasons)
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
    schedule: docs.schedule ? (JSON.parse(docs.schedule) as ScheduledGame[]) : [],
    seasons: docs.seasons ? (JSON.parse(docs.seasons) as Season[]) : [],
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

/**
 * A three-way merge, document by document: `base` is what this device last
 * knew the club had (hashes), `local` this device's documents and `server` the
 * club's. A document only one side changed takes that side; one both changed
 * the same way (e.g. this device's own save whose reply was lost) is already
 * in sync; one both changed differently is a clash, for the organizer to pick.
 */
export function merge(local: Record<string, string>, base: Record<string, string>, server: Record<string, string>) {
  const docs: Record<string, string> = {}
  const clashes: string[] = []
  let took = false
  for (const id of new Set([...Object.keys(local), ...Object.keys(base), ...Object.keys(server)])) {
    const l = id in local ? hashOf(local[id]) : undefined
    const s = id in server ? hashOf(server[id]) : undefined
    const b = base[id]
    if (l === s || s === b) {
      if (id in local) docs[id] = local[id]
    } else if (l === b) {
      took = true
      if (id in server) docs[id] = server[id]
    } else {
      clashes.push(id)
      if (id in local) docs[id] = local[id]
    }
  }
  return { docs, clashes, took }
}

/**
 * The club changed since this device last saw it: take the other devices'
 * changes and keep this device's, without asking unless both changed the same
 * thing. Returns false for a clash (the organizer picks, see CloudBanner).
 */
function reconcile(snap: ClubSnapshot): boolean {
  // Older than what this device already saved: nothing to take from it.
  if (snap.rev < useCloud.getState().rev) return true
  const { docs, clashes, took } = merge(toDocs(useStore.getState()), baseOf(snap.docs), snap.docs)
  if (clashes.length > 0) {
    clearTimeout(timer)
    useSyncStatus.setState({ status: 'conflict', clashes })
    return false
  }
  if (took) {
    const data = fromDocs(docs)
    useStore.getState().importData({ ...data, session: data.session ?? useStore.getState().session })
  }
  useCloud.setState({ rev: snap.rev, saved: hashes(snap.docs), sent: {} })
  return true
}

/** What this device last knew the club had, counting its own saves that got there without a reply. */
export function baseOf(server: Record<string, string>): Record<string, string> {
  const { saved, sent = {} } = useCloud.getState()
  const base = { ...saved }
  for (const [id, tries] of Object.entries(sent)) {
    const now = id in server ? hashOf(server[id]) : ''
    if (!tries.includes(now)) continue
    if (now) base[id] = now
    else delete base[id]
  }
  return base
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
      useCloud.setState((s) => {
        const sent = { ...s.sent }
        // Retries while offline send the same thing again: keep each version once.
        const add = (id: string, h: string) => (sent[id] = [...(sent[id] ?? []).filter((x) => x !== h), h].slice(-200))
        for (const [id, json] of Object.entries(b.put)) add(id, hashOf(json))
        for (const id of b.remove) add(id, '')
        return { sent }
      })
      const { rev } = await api<{ rev: number }>('POST', '/club/save', { baseRev: useCloud.getState().rev, ...b })
      useCloud.setState((s) => {
        const saved = { ...s.saved, ...hashes(b.put) }
        for (const id of b.remove) delete saved[id]
        const sent = { ...s.sent }
        for (const id of [...Object.keys(b.put), ...b.remove]) delete sent[id]
        return { rev, saved, sent }
      })
    }
    useSyncStatus.setState({ status: 'saved', savedAt: Date.now() })
  } catch (e) {
    const status = (e as Failure).status
    if (status === 409) {
      // Changed elsewhere, or this device's last save got there but its reply
      // didn't (the internet dropped): merge with the club's copy and go again.
      try {
        if (reconcile(await fetchClub())) again = true
      } catch {
        useSyncStatus.setState({ status: 'offline' })
        scheduleSave(RETRY_MS)
      }
    } else if (status === 401 || status === 403) signInAgain()
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

let pulling = false

/**
 * Bring this device up to date with the club: when another device saved
 * since, take its changes and keep this device's unsaved ones (see reconcile).
 */
export async function pull() {
  const { auth, club } = useCloud.getState()
  if (!CLOUD || !auth || !club || running || pulling || useSyncStatus.getState().status === 'conflict') return
  pulling = true
  try {
    const snap = await fetchClub()
    // A save started meanwhile, or nothing new: check again later. A save
    // that finished while the answer was on its way makes it older than this
    // device's data (a lower rev), and taking it would undo those changes.
    if (running || snap.club.id !== club.id || snap.rev <= useCloud.getState().rev) return
    if (reconcile(snap)) {
      if (changes(toDocs(useStore.getState()), useCloud.getState().saved).length > 0) scheduleSave(0)
      else useSyncStatus.setState({ status: 'saved', savedAt: Date.now() })
    }
  } catch (e) {
    const status = (e as Failure).status
    if (status === 401 || status === 403) signInAgain()
    // Offline: checked again when back online or the app is opened.
  } finally {
    pulling = false
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
    // The club's latest first, then anything this device changed while closed.
    void pull().then(() => scheduleSave(500))
    void refreshWaiting()
    const visible = () => document.visibilityState === 'visible'
    const requests = window.setInterval(() => visible() && void refreshWaiting(), 5 * 60_000)
    const pulls = window.setInterval(() => visible() && void pull(), PULL_MS)
    const unsubscribe = useStore.subscribe((st, prev) => {
      if (st.players !== prev.players || st.session !== prev.session || st.history !== prev.history || st.schedule !== prev.schedule || st.seasons !== prev.seasons) {
        scheduleSave()
      }
    })
    // Put away: save now. Back again: pick up changes from other devices.
    const shown = () => void (visible() ? pull() : save())
    const online = () => {
      scheduleSave(0)
      void pull()
    }
    const focus = () => void pull()
    document.addEventListener('visibilitychange', shown)
    window.addEventListener('online', online)
    window.addEventListener('focus', focus)
    return () => {
      unsubscribe()
      clearTimeout(timer)
      clearInterval(requests)
      clearInterval(pulls)
      document.removeEventListener('visibilitychange', shown)
      window.removeEventListener('online', online)
      window.removeEventListener('focus', focus)
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

export function choose(snap: ClubSnapshot, before: { clubId?: string; rev: number; saved?: Record<string, string> }): Choice {
  const local = useStore.getState()
  // This device's data belongs to another club: never pass it on without asking.
  const otherClub = !!useCloud.getState().lastClubId && useCloud.getState().lastClubId !== snap.club.id
  if (Object.keys(snap.docs).length === 0) return hasData(local) && otherClub ? 'ask' : 'upload'
  if (!hasData(local)) return 'download'
  const same = before.clubId === snap.club.id
  if (same && before.rev === snap.rev) return 'upload'
  // Nothing changed here since this device last synced: the club's copy is the latest.
  if (same && before.saved && changes(toDocs(local), before.saved).length === 0) return 'download'
  return changes(toDocs(local), hashes(snap.docs)).length === 0 ? 'upload' : 'ask'
}

/** Waiting for approval: of a new club (by the app admin) or to join one (by its organizers). */
export interface Pending {
  kind: 'club' | 'member'
  clubName: string
}

export type SignInResult = { snap: ClubSnapshot; choice: Choice } | { pending: Pending }

/** Fetches the club after signing in: its data, with whose to use, or that the account is waiting. */
async function enter(before: { clubId?: string; rev: number; saved?: Record<string, string> }): Promise<SignInResult> {
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
  const { club, lastClubId, rev, saved } = useCloud.getState()
  const before = { clubId: club?.id ?? lastClubId, rev, saved }
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
    sent: {},
  })
  return enter(before)
}

/** Whether there is anything worth keeping in this data. */
export const hasData = (d: Partial<ClubData>) =>
  (d.players?.length ?? 0) > 0 || (d.history?.length ?? 0) > 0 || (d.session?.attendees.length ?? 0) > 0

/** The data one side lost when the organizer picked the other (this device's, or the club's), to restore if that was wrong. */
export interface ReplacedCopy {
  at: number
  /** Whose data it was. */
  from: 'device' | 'club'
  data: ClubData
}

const REPLACED_KEY = 'mbq-replaced'

export function replacedCopy(): ReplacedCopy | undefined {
  try {
    const raw = localStorage.getItem(REPLACED_KEY)
    return raw ? (JSON.parse(raw) as ReplacedCopy) : undefined
  } catch {
    return undefined
  }
}

export function forgetReplacedCopy() {
  try {
    localStorage.removeItem(REPLACED_KEY)
  } catch {
    // Nothing kept.
  }
}

/** Keep a copy of data about to be replaced, when it has anything the other side doesn't. */
function keepCopy(from: ReplacedCopy['from'], data: ClubData, other: Record<string, string>) {
  if (!hasData(data) || changes(toDocs(data), hashes(other)).length === 0) return
  try {
    localStorage.setItem(REPLACED_KEY, JSON.stringify({ at: Date.now(), from, data } satisfies ReplacedCopy))
  } catch {
    // Storage full or private mode: nothing kept.
  }
}

/** Put a kept copy back on this device (it saves to the club as usual), keeping this device's data as the copy instead. */
export function restoreReplacedCopy() {
  const copy = replacedCopy()
  if (!copy) return
  const local = useStore.getState()
  forgetReplacedCopy()
  keepCopy('device', local, toDocs(copy.data))
  useStore.getState().importData(copy.data)
}

/** Replace this device's data with the club's (keeping a copy of this device's changes not saved yet). */
export function takeClubData(snap: ClubSnapshot) {
  const local = useStore.getState()
  if (changes(toDocs(local), useCloud.getState().saved).length > 0) keepCopy('device', local, snap.docs)
  const data = fromDocs(snap.docs)
  // A club with nothing saved yet starts this device on a fresh session too.
  useStore.getState().importData({ ...data, session: data.session ?? newSession() })
  useCloud.setState({ club: snap.club, rev: snap.rev, saved: hashes(snap.docs), sent: {}, lastClubId: snap.club.id })
  useSyncStatus.setState({ status: 'saved', savedAt: Date.now() })
}

/** What clashing documents hold, for the conflict banner: "today's session and the players". */
export function clashLabel(ids: string[]): string {
  const what = (id: string) =>
    id === 'session' ? "today's session" : id === 'players' ? 'the players' : id === 'schedule' ? 'the schedule' : id === 'seasons' ? 'the seasons' : 'past sessions'
  const list = [...new Set(ids.map(what))]
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : (list[0] ?? 'the data')
}

/** Keep this device's data and save it over the club's (keeping a copy of the club's). */
export function keepThisDevice(snap: ClubSnapshot) {
  const theirs = fromDocs(snap.docs)
  keepCopy('club', { ...theirs, session: theirs.session ?? newSession() }, toDocs(useStore.getState()))
  useCloud.setState({ club: snap.club, rev: snap.rev, saved: hashes(snap.docs), sent: {}, lastClubId: snap.club.id })
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

/** Keeps rev and saved with lastClubId, to tell on the next sign-in whether this device's data is just an older copy. */
export function signOut() {
  clearTimeout(timer)
  useCloud.setState({ auth: undefined, club: undefined })
  useSyncStatus.setState({ status: 'saved', savedAt: undefined, waiting: 0 })
}
