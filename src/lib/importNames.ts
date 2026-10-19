export interface ParsedNames {
  /** New names, in list order. */
  names: string[]
  /** Names skipped because they already exist or repeat in the list. */
  duplicates: string[]
}

/**
 * Parse a pasted list of names, one per line. Strips numbering and bullets
 * ("1.", "2)", "-", "•"), extra spaces and blank lines.
 */
export function parseNames(text: string, existing: string[] = []): ParsedNames {
  const seen = new Set(existing.map((n) => n.trim().toLowerCase()))
  const names: string[] = []
  const duplicates: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const name = line
      .replace(/^\s*(\d+\s*[.)\-:]|[-*•])\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) duplicates.push(name)
    else {
      seen.add(key)
      names.push(name)
    }
  }
  return { names, duplicates }
}
