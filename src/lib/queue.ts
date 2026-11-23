/** Add to the back of the queue (first come, first served). */
export function enqueue(queue: string[], ids: string[]): string[] {
  const rest = queue.filter((id) => !ids.includes(id))
  return [...rest, ...ids]
}

export function dequeue(queue: string[], ids: string[]): string[] {
  return queue.filter((id) => !ids.includes(id))
}

/** Put players back at the front (e.g. a cancelled game). */
export function pushFront(queue: string[], ids: string[]): string[] {
  return [...ids, ...queue.filter((id) => !ids.includes(id))]
}

export function nextFour(queue: string[]): string[] | null {
  return queue.length >= 4 ? queue.slice(0, 4) : null
}

export function move(queue: string[], id: string, delta: number): string[] {
  const from = queue.indexOf(id)
  if (from < 0) return queue
  const to = Math.max(0, Math.min(queue.length - 1, from + delta))
  const next = [...queue]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

export function swap(queue: string[], outId: string, inId: string): string[] {
  return queue.map((id) => (id === outId ? inId : id === inId ? outId : id))
}

/**
 * Apply an automatic swap (one or two players) to the queue: whoever moves up
 * takes the place of the player they replace, and that player waits first in
 * line for the following game (not back where the other one was).
 * game: the four who play (by default the first four once swapped).
 */
export function applySwap(
  queue: string[],
  s: { in: string; out: string; also?: { in: string; out: string } },
  game?: string[],
): string[] {
  const moves = s.also ? [s, s.also] : [s]
  const ins = new Set(moves.map((m) => m.in))
  const outs = queue.filter((id) => moves.some((m) => m.out === id))
  const placed = queue.filter((id) => !ins.has(id)).map((id) => moves.find((m) => m.out === id)?.in ?? id)
  const four = game ?? placed.slice(0, 4)
  const after = Math.max(...four.map((id) => placed.indexOf(id))) + 1
  return [...placed.slice(0, after), ...outs, ...placed.slice(after)]
}

/**
 * Move a player who hasn't played yet to their place by arrival time: in front
 * of the first waiting player who also hasn't played and arrived later, or at
 * the back. newcomers: arrival times of the players who haven't played yet.
 */
export function placeByArrival(queue: string[], id: string, newcomers: Map<string, number>): string[] {
  const at = newcomers.get(id)
  if (at === undefined || !queue.includes(id)) return queue
  const rest = queue.filter((q) => q !== id)
  const i = rest.findIndex((q) => (newcomers.get(q) ?? -Infinity) > at)
  return i < 0 ? [...rest, id] : [...rest.slice(0, i), id, ...rest.slice(i)]
}
