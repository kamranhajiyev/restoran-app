// The order of a venue's halls, as admin, the browser till and the exe show
// them: by position. Halls made before reordering all sat at 0, which the
// site broke by name and the exe's own store by id, so the first move numbers
// every hall.

export type Positioned = { id: string; position: number };

/** The halls with `id` one step left (-1) or right (+1), numbered 0, 1, 2…
 *  Null when it is already at that end. */
export function hallsMoved<T extends Positioned>(halls: T[], id: string, dir: -1 | 1): T[] | null {
  const i = halls.findIndex(h => h.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= halls.length) return null;
  const next = [...halls];
  [next[i], next[j]] = [next[j], next[i]];
  return next.map((h, position) => ({ ...h, position }));
}

/** Where a new hall goes: after the last one. */
export function nextHallPosition(halls: Positioned[]): number {
  return halls.reduce((m, h) => Math.max(m, h.position + 1), 0);
}
