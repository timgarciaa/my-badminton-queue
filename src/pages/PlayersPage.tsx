import { useState } from 'react'
import { EmptyState, Initials, SKILL_COLORS, SkillBadge } from '../components/ui'
import { parseNames } from '../lib/importNames'
import { playerRecords, winRate } from '../lib/stats'
import { useStore } from '../store/useStore'
import { GENDER_LABELS, SKILL_LABELS, type Gender, type Player, type Skill } from '../types'
import type { PlayerRecord } from '../lib/stats'

type Mode = 'add' | 'import'
type Filter = 'all' | 'M' | 'F' | 'nogender' | 'archived'
type Sort = 'name' | 'skill' | 'wins'

const SKILLS: Skill[] = [1, 2, 3, 4, 5]
const GENDER_ON: Record<Gender, string> = {
  M: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  F: 'bg-pink-100 text-pink-800 border-pink-300',
}

export function PlayersPage() {
  const players = useStore((s) => s.players)
  const session = useStore((s) => s.session)
  const history = useStore((s) => s.history)
  const [mode, setMode] = useState<Mode>('add')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('name')
  // Ids missing gender when that filter was picked; rows stay put while you set them.
  const [noGenderIds, setNoGenderIds] = useState<Set<string>>(new Set())
  const records = playerRecords([session, ...history].flatMap((s) => s.games))

  const active = players.filter((p) => p.active)
  const archived = players.length - active.length
  const noGender = active.filter((p) => !p.gender).length

  const pick = (f: Filter) => {
    if (f === 'nogender') setNoGenderIds(new Set(active.filter((p) => !p.gender).map((p) => p.id)))
    setFilter(f)
  }

  const inFilter = (p: Player) => {
    if (filter === 'archived') return !p.active
    if (!p.active) return false
    if (filter === 'nogender') return noGenderIds.has(p.id)
    return filter === 'all' || p.gender === filter
  }
  const wins = (p: Player) => records.get(p.id)?.wins ?? 0
  const list = players
    .filter(inFilter)
    .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    .sort(
      (a, b) =>
        (sort === 'skill' ? b.skill - a.skill : sort === 'wins' ? wins(b) - wins(a) : 0) || a.name.localeCompare(b.name),
    )

  const tabs: { id: Filter; label: string; count: number; hide?: boolean }[] = [
    { id: 'all', label: 'All', count: active.length },
    { id: 'M', label: 'Male', count: active.filter((p) => p.gender === 'M').length },
    { id: 'F', label: 'Female', count: active.filter((p) => p.gender === 'F').length },
    { id: 'nogender', label: 'No gender', count: noGender, hide: noGender === 0 && filter !== 'nogender' },
    { id: 'archived', label: 'Archived', count: archived, hide: archived === 0 && filter !== 'archived' },
  ]

  return (
    <div className="flex h-full gap-5 p-5">
      <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto">
        <div className="d-card d-card-border bg-base-100 shadow-sm space-y-4 p-4">
          <div role="tablist" className="d-tabs d-tabs-box d-tabs-sm grid grid-cols-2">
            {(['add', 'import'] as Mode[]).map((m) => (
              <button
                key={m}
                role="tab"
                className={`d-tab font-semibold ${mode === m ? 'd-tab-active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'add' ? 'Add player' : 'Import list'}
              </button>
            ))}
          </div>
          {mode === 'add' ? (
            <AddPlayerForm />
          ) : (
            <ImportForm
              onImported={() => {
                setMode('add')
                pick('nogender')
              }}
            />
          )}
        </div>
        <RosterSummary players={active} />
      </aside>

      <section className="d-card d-card-border bg-base-100 shadow-sm flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="flex gap-3">
            <input
              className="field py-2.5 text-base"
              placeholder={`Search ${players.length} players`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="d-select h-auto w-40 shrink-0 font-semibold"
              aria-label="Sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              <option value="name">Sort: Name</option>
              <option value="skill">Sort: Skill</option>
              <option value="wins">Sort: Wins</option>
            </select>
          </div>
          <div role="tablist" className="d-tabs d-tabs-border">
            {tabs
              .filter((t) => !t.hide)
              .map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  className={`d-tab gap-1.5 font-semibold ${filter === t.id ? 'd-tab-active' : ''}`}
                  onClick={() => pick(t.id)}
                >
                  {t.label}
                  <span
                    className={`d-badge d-badge-sm ${t.id === 'nogender' && t.count ? 'd-badge-warning' : 'd-badge-ghost'}`}
                  >
                    {t.count}
                  </span>
                </button>
              ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {list.length === 0 ? (
            <EmptyState>
              {filter === 'nogender'
                ? 'Everyone has a gender set.'
                : players.length
                  ? 'No players match.'
                  : 'Add your regulars, or paste your list with Import list.'}
            </EmptyState>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(21rem,1fr))] gap-3">
              {list.map((p) => (
                <PlayerCard key={p.id} player={p} record={records.get(p.id)} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

/** Players by gender and skill, so you can see the mix at a glance. */
function RosterSummary({ players }: { players: Player[] }) {
  if (players.length === 0) return null
  const max = Math.max(...SKILLS.map((s) => players.filter((p) => p.skill === s).length))
  return (
    <div className="d-card d-card-border bg-base-100 shadow-sm space-y-3 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold">Roster</h2>
        <span className="text-sm text-slate-500">
          {players.length} players · {players.filter((p) => p.gender === 'M').length} M ·{' '}
          {players.filter((p) => p.gender === 'F').length} F
        </span>
      </div>
      <ul className="space-y-1.5">
        {SKILLS.map((s) => {
          const n = players.filter((p) => p.skill === s).length
          return (
            <li key={s} className="flex items-center gap-2 text-sm">
              <SkillBadge skill={s} />
              <span className="w-24 text-slate-600">{SKILL_LABELS[s]}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${SKILL_COLORS[s].split(' ')[0]} ring-1 ${SKILL_COLORS[s].split(' ')[2]}`} style={{ width: `${max ? (n / max) * 100 : 0}%` }} />
              </div>
              <span className="w-5 text-right font-semibold tabular-nums">{n}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AddPlayerForm() {
  const players = useStore((s) => s.players)
  const addPlayer = useStore((s) => s.addPlayer)
  const [name, setName] = useState('')
  const [skill, setSkill] = useState<Skill>(3)
  const [gender, setGender] = useState<Gender>()
  const dupe = players.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())
  const ready = !!name.trim() && !dupe && !!gender

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    addPlayer(name, skill, gender!)
    setName('')
    setGender(undefined)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        className="field py-2.5 text-base"
        placeholder="Player name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoCapitalize="words"
      />
      {dupe && <p className="text-sm text-rose-600">A player with that name already exists.</p>}
      <GenderJoin value={gender} onChange={setGender} wide />
      <div className="space-y-1">
        <SkillJoin value={skill} onChange={setSkill} wide />
        <p className="text-center text-xs text-slate-500">{SKILL_LABELS[skill]}</p>
      </div>
      <button className="d-btn d-btn-primary w-full" disabled={!ready}>
        {name.trim() && !gender ? 'Choose male or female' : 'Add player'}
      </button>
    </form>
  )
}

function ImportForm({ onImported }: { onImported: () => void }) {
  const players = useStore((s) => s.players)
  const addPlayers = useStore((s) => s.addPlayers)
  const [text, setText] = useState('')
  const parsed = parseNames(
    text,
    players.map((p) => p.name),
  )

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Paste names, one per line. Numbers like &quot;1.&quot; are ignored. Imported players start as Intermediate with
        no gender.
      </p>
      <textarea
        className="field h-48 resize-none font-mono text-sm"
        placeholder={'1. Bryan\n2. Ate Queen\n3. Ninong Aries'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {parsed.duplicates.length > 0 && (
        <p className="text-xs text-slate-500">
          Skipping {parsed.duplicates.length} already in the list: {parsed.duplicates.join(', ')}
        </p>
      )}
      <button
        className="d-btn d-btn-primary w-full"
        disabled={parsed.names.length === 0}
        onClick={() => {
          addPlayers(parsed.names)
          setText('')
          onImported()
        }}
      >
        Import {parsed.names.length || ''} {parsed.names.length === 1 ? 'player' : 'players'}
      </button>
    </div>
  )
}

function GenderJoin({ value, onChange, wide }: { value?: Gender; onChange: (g: Gender) => void; wide?: boolean }) {
  return (
    <div className={`d-join ${wide ? 'grid grid-cols-2' : ''}`}>
      {(['M', 'F'] as Gender[]).map((g) => (
        <button
          key={g}
          type="button"
          title={GENDER_LABELS[g]}
          onClick={() => onChange(g)}
          className={`d-btn d-join-item ${wide ? '' : 'd-btn-sm w-9'} ${value === g ? GENDER_ON[g] : 'bg-white text-slate-500'}`}
        >
          {wide ? GENDER_LABELS[g] : g}
        </button>
      ))}
    </div>
  )
}

function SkillJoin({ value, onChange, wide }: { value: Skill; onChange: (s: Skill) => void; wide?: boolean }) {
  return (
    <div className={`d-join ${wide ? 'grid grid-cols-5' : ''}`}>
      {SKILLS.map((s) => (
        <button
          key={s}
          type="button"
          title={SKILL_LABELS[s]}
          onClick={() => onChange(s)}
          className={`d-btn d-join-item ${wide ? '' : 'd-btn-sm w-9'} ${
            value === s ? `${SKILL_COLORS[s]} ring-0` : 'bg-white text-slate-500'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  )
}

function PlayerCard({ player, record }: { player: Player; record?: PlayerRecord }) {
  const updatePlayer = useStore((s) => s.updatePlayer)
  const deletePlayer = useStore((s) => s.deletePlayer)
  const inSession = useStore((s) => s.session.attendees.some((a) => a.playerId === player.id))
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(player.name)
  const rate = record ? winRate(record) : null

  return (
    <li className={`d-card d-card-border ${player.gender ? 'bg-base-100' : 'border-amber-300 bg-amber-50/60'}`}>
      <div className="flex items-center gap-3 p-3 pb-2">
        <Initials player={player} muted={!player.active} size="w-10" />
        {editing ? (
          <input
            className="field min-w-0 flex-1 py-1.5 text-base"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          <div className="min-w-0 flex-1">
            <p className="text-lg leading-tight font-semibold break-words">{player.name}</p>
            <p className="text-xs text-slate-500 tabular-nums">
              {record && record.wins + record.losses > 0 ? (
                <>
                  <span className="font-semibold text-emerald-700">{record.wins}W</span> –{' '}
                  <span className="font-semibold text-rose-600">{record.losses}L</span>
                  {rate !== null && ` · ${Math.round(rate * 100)}%`}
                </>
              ) : (
                'No results yet'
              )}
              {inSession && ' · here today'}
            </p>
          </div>
        )}
        {editing ? (
          <button
            className="d-btn d-btn-primary d-btn-sm"
            onClick={() => {
              if (name.trim()) updatePlayer(player.id, { name: name.trim() })
              setEditing(false)
            }}
          >
            Done
          </button>
        ) : (
          <button
            className="d-btn d-btn-ghost d-btn-sm d-btn-square text-slate-500"
            aria-label={`Edit ${player.name}`}
            onClick={() => {
              setName(player.name)
              setEditing(true)
            }}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
            </svg>
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <button
            className="d-btn d-btn-sm"
            disabled={inSession}
            onClick={() => updatePlayer(player.id, { active: !player.active })}
          >
            {player.active ? 'Archive' : 'Restore'}
          </button>
          <button
            className="d-btn d-btn-sm d-btn-error d-btn-soft"
            disabled={inSession}
            onClick={() => confirm(`Delete ${player.name} permanently?`) && deletePlayer(player.id)}
          >
            Delete
          </button>
          {inSession && <span className="text-xs text-slate-500">Checked in today, check out first.</span>}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <GenderJoin value={player.gender} onChange={(gender) => updatePlayer(player.id, { gender })} />
          <SkillJoin value={player.skill} onChange={(skill) => updatePlayer(player.id, { skill })} />
        </div>
      )}
    </li>
  )
}
