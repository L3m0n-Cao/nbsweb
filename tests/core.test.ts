import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { readNbs, writeNbs } from '../src/nbs';
import { applyMacro } from '../src/macros';
import { History, newSong, normalize, tempoMap, tickSeconds, secondsTick, type Note } from '../src/model';
import { parseSelection, readPattern, selectionCode, writePattern } from '../src/patterns';
import { importMidi } from '../src/midi';
import { exportDatapack } from '../src/datapack';
import { strFromU8, unzipSync } from 'fflate';
import assets from '../src/generated/assets.json';
const note = (tick = 0, layer = 0, fields: Partial<Note> = {}): Note => ({ tick, layer, instrument: 0, key: 39, velocity: 100, pan: 100, pitch: 0, ...fields });

describe('NBS file compatibility', () => {
  for (const filename of readdirSync('NoteBlockStudio/datafiles/Songs').filter(n => n.endsWith('.nbs'))) {
    it(`preserves notes and metadata from the supplied ${filename}`, () => {
      const source = readNbs(readFileSync(`NoteBlockStudio/datafiles/Songs/${filename}`), filename);
      expect(source.notes.length).toBeGreaterThan(0);
      const result = readNbs(writeNbs(source), filename);
      expect(result.notes).toEqual(source.notes); expect(result.layers).toEqual(source.layers);
      expect(result.instruments).toEqual(source.instruments); expect(result.name).toBe(source.name);
      expect(result.tempo).toBeCloseTo(source.tempo, 2);
    });
  }
  it('reads an independently constructed v6 note with signed fine pitch', () => {
    // Empty metadata, tempo 10, 1 layer, note at tick 4/layer 0, then layer data.
    const bytes = [0, 0, 6, 20, 4, 0, 1, 0, ...Array(16).fill(0), 232, 3, 0, 10, 4, ...Array(24).fill(0), 0, 0, 0, 0,
      5, 0, 1, 0, 16, 45, 70, 140, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 80, 60, 0];
    const song = readNbs(Uint8Array.from(bytes));
    expect(song.notes).toEqual([note(4, 0, { instrument: 16, key: 45, velocity: 70, pan: 140, pitch: -40 })]);
    expect(song.layers[0].volume).toBe(80); expect(song.layers[0].pan).toBe(60);
  });
  it.each([0, 1, 2, 3, 4, 5, 6])('saves an empty and a populated version %i file', version => {
    const s = newSong(); expect(readNbs(writeNbs(s, version)).notes).toEqual([]);
    s.notes = [note(0), note(5, 2)]; normalize(s);
    expect(readNbs(writeNbs(s, version)).notes).toEqual(s.notes);
  });
  it('retains 240 custom instruments when saving v5', () => {
    const s = newSong(); for (let i = 0; i < 240; i++) s.instruments.push({ name: `Custom ${i}`, file: `${i}.ogg`, key: 45, press: true });
    s.notes = [note(0, 0, { instrument: 259 })]; normalize(s);
    const loaded = readNbs(writeNbs(s, 5)); expect(loaded.notes[0].instrument).toBe(259); expect(loaded.version).toBe(5);
    expect(() => writeNbs(s, 6)).toThrow('custom instruments');
  });
  it('represents v6 trumpet instruments as custom definitions in v5', () => {
    const s = newSong(); s.notes = [note(0, 0, { instrument: 18 })]; normalize(s);
    const result = readNbs(writeNbs(s, 5)); expect(result.instruments[result.notes[0].instrument].name).toBe('Weathered Trumpet');
  });
  it('preserves Sound Stopper packed layer bytes', () => {
    const s = newSong(); s.instruments.push({ name: 'Sound Stopper', file: '', key: 45, press: false });
    s.notes = [note(0, 0, { instrument: 20, velocity: 250, pan: 220, pitch: 123 })]; normalize(s);
    expect(readNbs(writeNbs(s)).notes).toEqual(s.notes);
  });
  it('rejects malformed and truncated files', () => {
    const s = newSong(); s.notes = [note()]; normalize(s); const data = writeNbs(s);
    expect(() => readNbs(data.slice(0, 40))).toThrow('Truncated');
    expect(() => readNbs(Uint8Array.from([0, 0, 99, 20]))).toThrow('Unsupported');
  });
});

describe('source macro semantics', () => {
  const input = [note(0), note(0, 2), note(8), note(16), note(32)];
  it('advances vibrato over occupied columns, not empty ticks', () => { expect(applyMacro('Vibrato', input).map(n => n.pitch)).toEqual([40, 40, 0, -40, 0]); });
  it('uses original stereo order and width', () => { expect(applyMacro('Stereo', input, { value: 30 }).map(n => n.pan)).toEqual([130, 130, 70, 130, 70]); });
  it('scales fade velocity, clamps silence to 1, and leaves input unchanged', () => { expect(applyMacro('Fade in', input).map(n => n.velocity)).toEqual([1, 1, 34, 67, 100]); expect(input[0].velocity).toBe(100); });
  it('replaces every key with the first selected note key', () => { expect(applyMacro('Replace key', [note(0, 0, { key: 47 }), note(1, 0, { key: 70 })]).map(n => n.key)).toEqual([47, 47]); });
  it('rejects chorus columns without a second note', () => { expect(() => applyMacro('Chorus', input)).toThrow('two note blocks'); });
  it('repeats each tremolo column up to the next occupied column', () => { expect(applyMacro('Tremolo', [note(0), note(4)], { spacing: 2 }).map(n => n.tick)).toEqual([0, 2, 4]); });
});

describe('patterns, history, timing', () => {
  it('reads the supplied drum pattern', () => { const pattern = readPattern(readFileSync('NoteBlockStudio/datafiles/Patterns/Drum Example.nbp')); expect(pattern.notes.length).toBeGreaterThan(0); });
  it('round trips sparse selection code and pattern instrument definitions', () => {
    const notes = [note(4, 2), note(4, 5, { instrument: 20 }), note(9, 3)];
    expect(parseSelection(selectionCode(notes))).toEqual(notes.map(n => ({ ...n, tick: n.tick - 4, layer: n.layer - 2 })));
    const s = newSong(); s.instruments.push({ name: 'Custom', file: 'custom.ogg', key: 44, press: false });
    const loaded = readPattern(writePattern(s, notes)); expect(loaded.instruments.get(20)).toEqual(s.instruments[20]); expect(loaded.notes.length).toBe(3);
  });
  it('rolls back failed edits and preserves the undo branch and saved state', () => {
    const h = new History(newSong()); h.edit(s => s.notes.push(note())); expect(h.dirty).toBe(true); h.markSaved();
    h.edit(s => s.notes.push(note(1))); h.undo(); expect(h.dirty).toBe(false); h.redo(); expect(h.song.notes.length).toBe(2);
    expect(() => h.edit(s => { s.notes = []; throw new Error('fail'); })).toThrow('fail'); expect(h.song.notes.length).toBe(2);
    h.undo(); h.edit(s => s.notes.push(note(2))); expect(h.canRedo).toBe(false);
  });
  it('integrates tempo changes and supports inverse seeking', () => {
    const s = newSong(); s.instruments.push({ name: 'Tempo Changer', file: '', key: 45, press: false }); s.notes = [note(10, 0, { instrument: 20, pitch: 300 })];
    const map = tempoMap(s); expect(tickSeconds(30, map)).toBe(2); expect(secondsTick(2, map)).toBe(30);
  });
});

describe('MIDI and data packs', () => {
  it('extracts all General MIDI and percussion mappings from source', () => { expect(assets.midi).toHaveLength(128); expect(assets.drums).toHaveLength(128); });
  it('reads running status, note-off, and program changes', () => {
    const track = [0, 0xc0, 0, 0, 0x90, 60, 100, 0x83, 0x60, 64, 100, 0, 0x80, 60, 0, 0, 64, 0, 0, 0xff, 0x2f, 0];
    const data = Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,track.length,...track]);
    const s = importMidi(data, 'test.mid'); expect(s.notes.map(n => [n.tick, n.key])).toEqual([[0,39],[5,43]]);
  });
  it('writes modern function paths and scheduled note commands', () => {
    const s = newSong(); s.notes = [note(10)]; normalize(s);
    const files = unzipSync(exportDatapack(s, 'song', 'A song'));
    expect(strFromU8(files['data/song/function/play.mcfunction'])).toContain('matches 20');
    expect(strFromU8(files['data/song/function/notes/20.mcfunction'])).toContain('minecraft:block.note_block.harp');
    expect(() => exportDatapack(s, '../oops', '')).toThrow('Namespace');
  });
});
