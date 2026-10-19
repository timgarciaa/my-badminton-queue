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

/** Apply an automatic swap (one or two players) to the queue. */
export function applySwap(queue: string[], s: { in: string; out: string; also?: { in: string; out: string } }): string[] {
  const once = swap(queue, s.out, s.in)
  return s.also ? swap(once, s.also.out, s.also.in) : once
}
