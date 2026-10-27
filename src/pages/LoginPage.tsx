import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ChooseDataDialog } from '../components/Cloud'
import {
  checkAgain,
  type ClubSnapshot,
  keepThisDevice,
  type Pending,
  type SignInResult,
  signIn,
  signOut,
  signUp,
  takeClubData,
  useCloud,
} from '../lib/cloud'

type View = 'signin' | 'signup' | 'pending'

const failure = (e: unknown) =>
  e instanceof TypeError ? "Can't connect. Check the internet connection." : (e as Error).message

/**
 * Before the app: organizers sign in, or ask for an account to create a club
 * or join one. Both wait for approval; until then signing in shows that.
 */
export function LoginPage() {
  const signedInBefore = useCloud((s) => !!s.auth)
  // Signed out by the server: this iPad still has the club's data.
  const signedOutOf = useCloud((s) => s.club?.name)
  const lastUser = useCloud((s) => s.lastUser)
  const [view, setView] = useState<View>('signin')
  const [pending, setPending] = useState<Pending | null>(null)
  const [choosing, setChoosing] = useState<ClubSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** After signing in: go in (with the right data), or show that it's waiting. */
  const handle = (r: SignInResult) => {
    if ('pending' in r) {
      setPending(r.pending)
      setView('pending')
    } else if (r.choice === 'upload') keepThisDevice(r.snap)
    else if (r.choice === 'download') takeClubData(r.snap)
    else setChoosing(r.snap)
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(failure(e))
    } finally {
      setBusy(false)
    }
  }

  // Signed in earlier but still waiting (e.g. reopened the app): check where it stands.
  const resume = useRef(signedInBefore)
  useEffect(() => {
    if (!resume.current) return
    resume.current = false
    void run(async () => handle(await checkAgain()))
  }, [])

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-gradient-to-br from-teal-700 via-teal-600 to-emerald-500 p-6 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center text-white">
          <h1 className="text-3xl font-black tracking-tight">My Badminton Queue</h1>
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-xl">
          {view === 'signin' && (
            <SignIn
              signedOutOf={signedOutOf}
              lastUser={lastUser}
              busy={busy}
              error={error}
              onSubmit={(u, p) => run(async () => handle(await signIn(u, p)))}
              onSignUp={() => {
                setError(null)
                setView('signup')
              }}
            />
          )}
          {view === 'signup' && (
            <SignUp
              busy={busy}
              error={error}
              onSubmit={(u, p, club) =>
                run(async () => {
                  await signUp(u, p, club)
                  handle(await signIn(u, p))
                })
              }
              onBack={() => {
                setError(null)
                setView('signin')
              }}
            />
          )}
          {view === 'pending' && pending && (
            <div className="space-y-3 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </span>
              <h2 className="text-xl font-bold">Waiting for approval</h2>
              <p className="text-slate-600">
                {pending.kind === 'club' ? (
                  <>
                    Your new club <strong>{pending.clubName}</strong> needs approving by the app&apos;s admin before you
                    can sign in.
                  </>
                ) : (
                  <>
                    An organizer of <strong>{pending.clubName}</strong> needs to approve you. Let them know you&apos;ve
                    asked.
                  </>
                )}
              </p>
              {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
              <button
                className="d-btn d-btn-primary w-full"
                disabled={busy}
                onClick={() => run(async () => handle(await checkAgain()))}
              >
                {busy ? 'Checking…' : 'Check again'}
              </button>
              <button
                className="d-btn d-btn-ghost w-full"
                onClick={() => {
                  signOut()
                  setPending(null)
                  setView('signin')
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
      {choosing && <ChooseDataDialog snap={choosing} onDone={() => setChoosing(null)} />}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function SignIn({
  signedOutOf,
  lastUser,
  busy,
  error,
  onSubmit,
  onSignUp,
}: {
  signedOutOf?: string
  lastUser?: string
  busy: boolean
  error: string | null
  onSubmit: (username: string, password: string) => void
  onSignUp: () => void
}) {
  const [username, setUsername] = useState(signedOutOf ? (lastUser ?? '') : '')
  const [password, setPassword] = useState('')
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(username, password)
      }}
    >
      <h2 className="text-xl font-bold">Sign in</h2>
      {signedOutOf && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          You were signed out of <strong>{signedOutOf}</strong>. Sign in again to keep going. This iPad&apos;s data is
          kept, and saved once you&apos;re back in.
        </p>
      )}
      <Field label="Username">
        <input
          className="field mt-1"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field label="Password">
        <input
          className="field mt-1"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
      <button className="d-btn d-btn-primary h-12 w-full text-base" disabled={busy || !username.trim() || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="pt-1 text-center text-sm text-slate-600">
        New organizer?{' '}
        <button type="button" className="font-semibold text-teal-700 underline" onClick={onSignUp}>
          Create an account
        </button>
      </p>
    </form>
  )
}

function SignUp({
  busy,
  error,
  onSubmit,
  onBack,
}: {
  busy: boolean
  error: string | null
  onSubmit: (username: string, password: string, club: { create: string } | { join: string }) => void
  onBack: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [mode, setMode] = useState<'join' | 'create'>('join')
  const [code, setCode] = useState('')
  const [clubName, setClubName] = useState('')
  const mismatch = again.length > 0 && again !== password
  const ready =
    username.trim().length >= 3 &&
    password.length >= 8 &&
    password === again &&
    (mode === 'join' ? code.trim().length === 6 : clubName.trim().length >= 2)

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onSubmit(username, password, mode === 'join' ? { join: code.trim() } : { create: clubName.trim() })
      }}
    >
      <h2 className="text-xl font-bold">Create an account</h2>
      <div role="tablist" className="d-tabs d-tabs-box">
        <button type="button" role="tab" className={`d-tab flex-1 font-semibold ${mode === 'join' ? 'd-tab-active' : ''}`} onClick={() => setMode('join')}>
          Join a club
        </button>
        <button type="button" role="tab" className={`d-tab flex-1 font-semibold ${mode === 'create' ? 'd-tab-active' : ''}`} onClick={() => setMode('create')}>
          Create a club
        </button>
      </div>
      {mode === 'join' ? (
        <Field label="Club code (from one of its organizers)">
          <input
            className="field mt-1 font-mono tracking-[0.3em] uppercase"
            autoCapitalize="characters"
            autoCorrect="off"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())}
          />
        </Field>
      ) : (
        <Field label="Club name">
          <input className="field mt-1" maxLength={40} value={clubName} onChange={(e) => setClubName(e.target.value)} />
        </Field>
      )}
      <Field label="Username (letters, numbers, . _ -)">
        <input
          className="field mt-1"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          maxLength={32}
          value={username}
          onChange={(e) => setUsername(e.target.value.replace(/[^a-z0-9._-]/gi, '').toLowerCase())}
        />
      </Field>
      <Field label="Password (8+ characters)">
        <input
          className="field mt-1"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label="Same password again">
        <input
          className="field mt-1"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </Field>
      {mismatch && <p className="text-sm font-semibold text-rose-700">The passwords don&apos;t match.</p>}
      {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
      <p className="text-sm text-slate-500">
        {mode === 'join'
          ? "An organizer of the club approves you before you can sign in."
          : "The app's admin approves new clubs before you can sign in."}
      </p>
      <button className="d-btn d-btn-primary h-12 w-full text-base" disabled={busy || !ready}>
        {busy ? 'Sending…' : 'Ask for an account'}
      </button>
      <p className="text-center text-sm text-slate-600">
        Have an account?{' '}
        <button type="button" className="font-semibold text-teal-700 underline" onClick={onBack}>
          Sign in
        </button>
      </p>
    </form>
  )
}
