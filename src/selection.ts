import { cell, clamp, type Note } from './model';
export function bounds(notes: Note[]) {
  return notes.reduce((b, n) => ({ left: Math.min(b.left, n.tick), right: Math.max(b.right, n.tick), top: Math.min(b.top, n.layer), bottom: Math.max(b.bottom, n.layer) }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
}
export function moveNotes(notes: Note[], dx: number, dy: number) {
  if (!notes.length) return notes;
  const b = bounds(notes); dx = clamp(dx, -b.left, 65534 - b.right); dy = clamp(dy, -b.top, 65534 - b.bottom);
  return notes.map(n => ({ ...n, tick: n.tick + dx, layer: n.layer + dy }));
}
// selection_compress.gml preserves colliding notes by moving them down layers.
export function compressNotes(notes: Note[]) {
  if (!notes.length) return notes;
  const min = bounds(notes).left, occupied = new Set<string>();
  return [...notes].sort((a, b) => a.tick - b.tick || a.layer - b.layer).map(n => {
    const result = { ...n, tick: min + Math.floor((n.tick - min) / 2) };
    while (occupied.has(cell(result))) result.layer++;
    if (result.layer > 65534) throw new Error('Compressed selection exceeds the NBS layer limit.');
    occupied.add(cell(result)); return result;
  });
}
