import { useState } from 'react'
import { EmptyState, GenderPicker, SkillPicker } from '../components/ui'
import { parseNames } from '../lib/importNames'
import { playerRecords } from '../lib/stats'
import { useStore } from '../store/useStore'
import { SKILL_LABELS, type Gender, type Player, type Skill } from '../types'
import type { PlayerRecord } from '../lib/stats'

type Mode = 'add' | 'import'

export function PlayersPage() {
  const players = useStore((s) => s.players)
  const [mode, setMode] = useState<Mode>('add')
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  // Ids missing gender when the filter was turned on; rows stay put while you edit them.
  const [needsGenderIds, setNeedsGenderIds] = useState<Set<string> | null>(null)
  const needsGenderOnly = needsGenderIds !== null
  const snapshotNeedsGender = () =>
    setNeedsGenderIds(new Set(useStore.getState().players.filter((p) => p.active && !p.gender).map((p) => p.id)))
  const session = useStore((s) => s.session)
  const history = useStore((s) => s.history)
  const records = playerRecords([session, ...history].flatMap((s) => s.games))

  const needsGender = players.filter((p) => p.active && !p.gender).length
  const list = players
    .filter((p) => p.active !== showArchived)
    .filter((p) => !needsGenderIds || needsGenderIds.has(p.id))
    .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="card p-5">
        <div className="mb-4 inline-flex rounded-xl bg-slate-100 p-1">
          {(['add', 'import'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-5 py-2 font-semibold transition ${
                mode === m ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500'
              }`}
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
              snapshotNeedsGender()
              setShowArchived(false)
            }}
          />
        )}
      </div>

      <div className="flex items-center gap-3">
        <input
          className="field"
          placeholder={`Search ${players.length} players`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(needsGender > 0 || needsGenderOnly) && (
          <button
            className={`btn whitespace-nowrap ring-1 ${
              needsGenderOnly ? 'bg-amber-500 text-white ring-amber-600' : 'bg-amber-50 text-amber-800 ring-amber-200'
            }`}
            onClick={() => (needsGenderOnly ? setNeedsGenderIds(null) : snapshotNeedsGender())}
          >
            Needs gender ({needsGender})
          </button>
        )}
        <button className="btn-ghost whitespace-nowrap" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? 'Show active' : 'Show archived'}
        </button>
      </div>

      {list.length === 0 ? (
        <EmptyState>
          {needsGenderOnly
            ? 'Everyone has a gender set.'
            : players.length
              ? 'No players match.'
              : 'Add your regulars, or paste your list with Import list.'}
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-slate-100">
          <li className="flex items-center gap-3 px-5 py-2 text-xs text-slate-500">
            <span className="flex-1">Tap to set gender and skill</span>
            <span>
              Skill: {([1, 2, 3, 4, 5] as Skill[]).map((s) => `${s} ${SKILL_LABELS[s]}`).join(' · ')}
            </span>
          </li>
          {list.map((p) => (
            <PlayerRow key={p.id} player={p} record={records.get(p.id)} />
          ))}
        </ul>
      )}
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || dupe || !gender) return
    addPlayer(name, skill, gender)
    setName('')
    setGender(undefined)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex gap-3">
        <input
          className="field"
          placeholder="Player name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoCapitalize="words"
        />
        <button className="btn-primary px-8" disabled={!name.trim() || dupe || !gender}>
          Add
        </button>
      </div>
      {dupe && <p className="text-sm text-rose-600">A player with that name already exists.</p>}
      <div className="flex flex-wrap gap-4">
        <GenderPicker value={gender} onChange={setGender} />
        <SkillPicker value={skill} onChange={setSkill} />
      </div>
      {name.trim() && !gender && <p className="text-sm text-slate-500">Choose male or female to add.</p>}
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
      <p className="text-slate-600">
        Paste names, one per line. Numbers like &quot;1.&quot; and blank lines are ignored. Imported players start as
        Intermediate with no gender — set those after importing.
      </p>
      <textarea
        className="field h-56 resize-none font-mono text-base"
        placeholder={'1. Bryan\n2. Ate Queen\n3. Ninong Aries'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-4">
        <button
          className="btn-primary px-8"
          disabled={parsed.names.length === 0}
          onClick={() => {
            addPlayers(parsed.names)
            setText('')
            onImported()
          }}
        >
          Import {parsed.names.length || ''} {parsed.names.length === 1 ? 'player' : 'players'}
        </button>
        {parsed.duplicates.length > 0 && (
          <p className="text-sm text-slate-500">
            Skipping {parsed.duplicates.length} already in the list: {parsed.duplicates.join(', ')}
          </p>
        )}
      </div>
    </div>
  )
}

function PlayerRow({ player, record }: { player: Player; record?: PlayerRecord }) {
  const updatePlayer = useStore((s) => s.updatePlayer)
  const deletePlayer = useStore((s) => s.deletePlayer)
  const inSession = useStore((s) => s.session.attendees.some((a) => a.playerId === player.id))
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(player.name)

  if (!editing) {
    return (
      <li className={`flex items-center gap-3 px-5 py-3 ${player.gender ? '' : 'bg-amber-50/60'}`}>
        <span className="min-w-0 flex-1 truncate text-lg font-medium">{player.name}</span>
        {record && (
          <span className="text-sm whitespace-nowrap text-slate-500 tabular-nums" title="All-time wins - losses">
            <strong className="text-emerald-700">{record.wins}W</strong> –{' '}
            <strong className="text-rose-600">{record.losses}L</strong>
          </span>
        )}
        <GenderPicker compact value={player.gender} onChange={(gender) => updatePlayer(player.id, { gender })} />
        <SkillPicker compact value={player.skill} onChange={(skill) => updatePlayer(player.id, { skill })} />
        <button className="btn-ghost py-2" onClick={() => setEditing(true)}>
          Edit
        </button>
      </li>
    )
  }

  return (
    <li className="space-y-3 bg-slate-50 px-5 py-4">
      <div className="flex gap-3">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="btn-primary"
          onClick={() => {
            if (name.trim()) updatePlayer(player.id, { name: name.trim() })
            setEditing(false)
          }}
        >
          Done
        </button>
      </div>
      <div className="flex gap-3">
        <button
          className="btn-ghost py-2"
          disabled={inSession}
          onClick={() => updatePlayer(player.id, { active: !player.active })}
        >
          {player.active ? 'Archive' : 'Restore'}
        </button>
        <button
          className="btn-danger py-2"
          disabled={inSession}
          onClick={() => confirm(`Delete ${player.name} permanently?`) && deletePlayer(player.id)}
        >
          Delete
        </button>
        {inSession && <span className="self-center text-sm text-slate-500">Checked in today — check out first.</span>}
      </div>
    </li>
  )
}
