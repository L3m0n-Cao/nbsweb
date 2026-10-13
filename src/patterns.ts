import { Reader, Writer } from './binary';
import { type Instrument, type Note, type Song } from './model';
export function selectionCode(notes: Note[]) {
  if (!notes.length) return '';
  const ordered = [...notes].sort((a, b) => a.tick - b.tick || a.layer - b.layer);
  const minTick = Math.min(...notes.map(n => n.tick)), minLayer = Math.min(...notes.map(n => n.layer));
  const values: number[] = []; let tick = minTick, layer = minLayer, started = false;
  for (const n of ordered) {
    if (!started || n.tick !== tick) { if (started) values.push(-1); values.push(n.tick - tick); tick = n.tick; layer = minLayer; started = true; }
    values.push(n.layer - layer, n.instrument, n.key, n.velocity, n.pan, n.pitch); layer = n.layer;
  }
  values.push(-1); return values.join('|') + '|';
}
export function parseSelection(code: string): Note[] {
  const values = code.trim().split('|').filter(s => s !== '').map(Number);
  if (values.some(n => !Number.isFinite(n))) throw new Error('Invalid selection code.');
  const notes: Note[] = []; let i = 0, tick = 0;
  while (i < values.length) {
    tick += values[i++]; let layer = 0;
    for (;;) {
      if (i >= values.length) throw new Error('Incomplete selection code.');
      if (values[i] === -1) { i++; break; }
      if (i + 6 > values.length) throw new Error('Incomplete selection note.');
      layer += values[i++]; const instrument = values[i++], key = values[i++], velocity = values[i++], pan = values[i++], pitch = values[i++];
      notes.push({ tick, layer, instrument, key, velocity, pan, pitch });
    }
  }
  return notes;
}
export function writePattern(song: Song, notes: Note[]) {
  if (!notes.length) throw new Error('Select notes to export a pattern.');
  const w = new Writer(), minTick = Math.min(...notes.map(n => n.tick)), minLayer = Math.min(...notes.map(n => n.layer));
  const width = Math.max(...notes.map(n => n.tick)) - minTick + 1, height = Math.max(...notes.map(n => n.layer)) - minLayer + 1;
  w.u8(2); w.u16(width - 1); w.u16(height - 1); w.u16(width); w.zstring(selectionCode(notes));
  for (let x = 0; x < width; x++) { const col = notes.filter(n => n.tick === minTick + x); w.u8(col.length ? Math.min(...col.map(n => n.layer)) - minLayer : -1); w.u8(col.length ? Math.max(...col.map(n => n.layer)) - minLayer : -1); }
  const ids = [...new Set(notes.filter(n => n.instrument >= 20).map(n => n.instrument))]; w.u8(ids.length);
  for (const id of ids) { const ins = song.instruments[id]; w.u16(id); w.zstring(ins.name); w.zstring(ins.file); w.u8(ins.key); w.u8(+ins.press); }
  return w.finish();
}
export function readPattern(data: Uint8Array): { notes: Note[]; instruments: Map<number, Instrument> } {
  const r = new Reader(data), version = r.u8(); if (version > 2) throw new Error('Unsupported pattern version.');
  r.u16(); r.u16(); const width = r.u16(), notes = parseSelection(r.zstring()); r.bytes(width * 2);
  const instruments = new Map<number, Instrument>();
  if (version >= 2) { const count = r.u8(); for (let i = 0; i < count; i++) { const id = r.u16(); instruments.set(id, { name: r.zstring(), file: r.zstring(), key: r.u8(), press: !!r.u8() }); } }
  return { notes, instruments };
}
