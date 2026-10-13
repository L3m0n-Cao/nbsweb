import assets from './generated/assets.json' with { type: 'json' };

export interface Note { tick: number; layer: number; instrument: number; key: number; velocity: number; pan: number; pitch: number }
export interface Layer { name: string; locked: boolean; volume: number; pan: number; solo: boolean }
export interface Instrument { name: string; file: string; key: number; press: boolean }
export interface Song {
  id: string; filename: string; name: string; author: string; originalAuthor: string; description: string;
  version: number; tempo: number; timeSignature: number; loop: boolean; loopCount: number; loopStart: number;
  autosave: number; autosaveMinutes: number; stats: number[]; midi: string;
  notes: Note[]; layers: Layer[]; instruments: Instrument[];
}
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const cell = (n: Pick<Note, 'tick' | 'layer'>) => `${n.tick}:${n.layer}`;
export const newLayer = (): Layer => ({ name: '', locked: false, volume: 100, pan: 100, solo: false });
export function newSong(): Song {
  return { id: crypto.randomUUID(), filename: '', name: '', author: '', originalAuthor: '', description: '',
    version: 6, tempo: 10, timeSignature: 4, loop: false, loopCount: 0, loopStart: 0,
    autosave: 0, autosaveMinutes: 1, stats: [0, 0, 0, 0, 0], midi: '', notes: [], layers: [],
    instruments: structuredClone(assets.instruments) };
}
export function endTick(song: Song) { return song.notes.reduce((v, n) => Math.max(v, n.tick), 0); }
export function ensureLayers(song: Song, count: number) { while (song.layers.length < count) song.layers.push(newLayer()); }
export function normalize(song: Song) {
  const grid = new Map<string, Note>();
  for (const n of song.notes) {
    if (!Object.values(n).every(Number.isFinite)) throw new Error('Invalid note values.');
    n.tick = clamp(Math.round(n.tick), 0, 65534); n.layer = clamp(Math.round(n.layer), 0, 65534);
    const stopper = song.instruments[n.instrument]?.name === 'Sound Stopper';
    n.key = clamp(Math.round(n.key), 0, 87); n.velocity = clamp(Math.round(n.velocity), 0, stopper ? 255 : 100);
    n.pan = clamp(Math.round(n.pan), 0, stopper ? 255 : 200); n.pitch = clamp(Math.round(n.pitch), -32768, 32767);
    grid.set(cell(n), n);
  }
  song.notes = [...grid.values()].sort((a, b) => a.tick - b.tick || a.layer - b.layer);
  ensureLayers(song, song.notes.reduce((v, n) => Math.max(v, n.layer + 1), 0));
}
export function keyName(key: number, octave = true, flat = false) {
  const names = flat ? ['A', 'B♭', 'B', 'C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭'] : ['A', 'A♯', 'B', 'C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯'];
  return names[((key % 12) + 12) % 12] + (octave ? Math.floor((key + 9) / 12) : '');
}
export interface TempoPoint { tick: number; tempo: number; seconds: number }
export function tempoMap(song: Song): TempoPoint[] {
  const tempos = new Map<number, number>([[0, Math.max(.01, song.tempo)]]);
  for (const n of song.notes) if (song.instruments[n.instrument]?.name === 'Tempo Changer' && n.pitch !== 0) tempos.set(n.tick, Math.abs(n.pitch) / 15);
  const result: TempoPoint[] = [];
  for (const [tick, tempo] of [...tempos].sort((a, b) => a[0] - b[0])) {
    const prev = result.at(-1);
    result.push({ tick, tempo, seconds: prev ? prev.seconds + (tick - prev.tick) / prev.tempo : 0 });
  }
  return result;
}
export function tickSeconds(tick: number, map: TempoPoint[]) {
  let p = map[0]; for (const next of map) { if (next.tick > tick) break; p = next; }
  return p.seconds + (tick - p.tick) / p.tempo;
}
export function secondsTick(seconds: number, map: TempoPoint[]) {
  let p = map[0]; for (const next of map) { if (next.seconds > seconds) break; p = next; }
  return p.tick + (seconds - p.seconds) * p.tempo;
}

export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private pending = '';
  saved: string;
  constructor(public song: Song) { this.saved = JSON.stringify(song); }
  get dirty() { return JSON.stringify(this.song) !== this.saved; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  begin() { if (!this.pending) this.pending = JSON.stringify(this.song); }
  commit() {
    if (!this.pending) return;
    normalize(this.song);
    if (this.pending !== JSON.stringify(this.song)) {
      this.undoStack.push(this.pending); this.redoStack = [];
      if (this.undoStack.length > 100) this.undoStack.shift();
    }
    this.pending = '';
  }
  edit(fn: (song: Song) => void) {
    this.begin();
    try { fn(this.song); this.commit(); }
    catch (e) { if (this.pending) this.song = JSON.parse(this.pending); this.pending = ''; throw e; }
  }
  undo() { this.commit(); const value = this.undoStack.pop(); if (value) { this.redoStack.push(JSON.stringify(this.song)); this.song = JSON.parse(value); } }
  redo() { const value = this.redoStack.pop(); if (value) { this.undoStack.push(JSON.stringify(this.song)); this.song = JSON.parse(value); } }
  markSaved() { this.saved = JSON.stringify(this.song); }
}
