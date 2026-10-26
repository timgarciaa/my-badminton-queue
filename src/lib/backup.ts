import { useStore } from '../store/useStore'

/** When this iPad last exported a backup (per device, so browser storage is enough). */
export const LAST_BACKUP_KEY = 'mbq-last-backup'

/** Downloads everything as a JSON backup file; returns when, also remembered as the last backup. */
export function exportBackup() {
  const { players, session, history } = useStore.getState()
  const blob = new Blob([JSON.stringify({ app: 'mbq', version: 1, players, session, history }, null, 2)], {
    type: 'application/json',
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `mbq-backup-${new Date().toLocaleDateString('en-CA')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  const now = Date.now()
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(now))
  } catch {
    // Private mode: just don't remember it.
  }
  return now
}
