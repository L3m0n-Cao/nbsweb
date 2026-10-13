// Port of open_song_nbs/save_song. NBS uses legacy one-byte strings, not UTF-8.
import { Reader, Writer } from './binary';
import { clamp, endTick, ensureLayers, newSong, normalize, type Instrument, type Song } from './model';

export function readNbs(data: Uint8Array, filename = ''): Song {
  const r = new Reader(data), song = newSong();
  const length = r.u16(); let version = 0, firstCustom = 20;
  if (length === 0) {
    version = r.u8();
    if (version < 1 || version > 6) throw new Error(`Unsupported NBS version ${version}. Supported versions: 0–6.`);
    firstCustom = r.u8();
    if (version >= 3) r.u16();
  }
  const height = r.u16();
  song.filename = filename; song.version = 6;
  song.name = r.string(); song.author = r.string(); song.originalAuthor = r.string(); song.description = r.string();
  song.tempo = r.u16() / 100;
  if (!song.tempo) throw new Error('The song tempo must be greater than zero.');
  song.autosave = r.u8(); song.autosaveMinutes = r.u8(); song.timeSignature = clamp(r.u8(), 2, 8);
  song.stats = Array.from({ length: 5 }, () => r.u32()); song.midi = r.string();
  if (version >= 4) { song.loop = !!r.u8(); song.loopCount = r.u8(); song.loopStart = r.u16(); }
  let tick = -1;
  for (;;) {
    const jump = r.u16(); if (!jump) break; tick += jump;
    if (tick > 65534) throw new Error('Song exceeds the supported NBS tick range.');
    let layer = -1;
    for (;;) {
      const jumpLayer = r.u16(); if (!jumpLayer) break; layer += jumpLayer;
      if (layer > 65534) throw new Error('Song exceeds the supported NBS layer range.');
      let instrument = r.u8(); if (version > 0 && instrument >= firstCustom) instrument += 20 - firstCustom;
      const key = r.u8(), velocity = version >= 4 ? r.u8() : 100, pan = version >= 4 ? r.u8() : 100, pitch = version >= 4 ? r.i16() : 0;
      song.notes.push({ tick, layer, instrument, key, velocity, pan, pitch });
    }
  }
  ensureLayers(song, height);
  if (r.remaining) for (let i = 0; i < height; i++) {
    const layer = song.layers[i]; layer.name = r.string(); const lock = version >= 4 ? r.u8() : 0; layer.locked = lock === 1; layer.solo = lock === 2;
    layer.volume = clamp(r.u8(), 0, 100); layer.pan = version >= 2 ? clamp(r.u8(), 0, 200) : 100;
  }
  if (r.remaining) {
    const count = r.u8();
    if (version === 5 && count > 236) song.version = 5;
    for (let i = 0; i < count; i++) song.instruments.push({ name: r.string(), file: r.string(), key: r.u8(), press: !!r.u8() });
  }
  normalize(song);
  return song;
}

export function writeNbs(song: Song, version = song.version): Uint8Array {
  if (!Number.isInteger(version) || version < 0 || version > 6) throw new Error('Unsupported NBS save version.');
  const w = new Writer(), notes = [...song.notes].sort((a, b) => a.tick - b.tick || a.layer - b.layer);
  const v6InLegacy = version < 6 && notes.some(n => n.instrument >= 16 && n.instrument < 20);
  const custom: Instrument[] = (v6InLegacy ? song.instruments.slice(16, 20) : []).concat(song.instruments.slice(20));
  const firstCustom = version >= 6 ? 20 : 16;
  if (custom.length > 256 - firstCustom) throw new Error(`NBS v${version} cannot store this many custom instruments.`);
  if (song.layers.length > 65535 || endTick(song) > 65534) throw new Error('Song is too large for the NBS format.');
  if (version > 0) { w.u16(0); w.u8(version); w.u8(firstCustom); }
  if (version === 0 || version >= 3) w.u16(version === 0 ? Math.max(1, endTick(song)) : endTick(song));
  w.u16(song.layers.length);
  w.string(song.name); w.string(song.author); w.string(song.originalAuthor); w.string(song.description);
  w.u16(clamp(Math.round(song.tempo * 100), 1, 65535)); w.u8(song.autosave); w.u8(song.autosaveMinutes); w.u8(song.timeSignature);
  for (const stat of song.stats) w.u32(stat);
  w.string(song.midi);
  if (version >= 4) { w.u8(+song.loop); w.u8(song.loopCount); w.u16(song.loopStart); }
  let lastTick = -1, lastLayer = -1;
  for (const note of notes) {
    if (note.tick !== lastTick) {
      if (lastTick !== -1) w.u16(0);
      w.u16(note.tick - lastTick); lastTick = note.tick; lastLayer = -1;
    }
    w.u16(note.layer - lastLayer); lastLayer = note.layer;
    let ins = note.instrument; if (version < 6 && ins >= 20 && !v6InLegacy) ins -= 4;
    if (ins > 255 || ins < 0) throw new Error('Instrument ID cannot be stored in this NBS version.');
    w.u8(ins); w.u8(note.key);
    if (version >= 4) { w.u8(note.velocity); w.u8(note.pan); w.u16(note.pitch); }
  }
  if (notes.length) w.u16(0);
  w.u16(0);
  for (const layer of song.layers) {
    w.string(layer.name); if (version >= 4) w.u8(layer.locked ? 1 : layer.solo ? 2 : 0); w.u8(layer.volume); if (version >= 2) w.u8(layer.pan);
  }
  w.u8(custom.length);
  for (const ins of custom) { w.string(ins.name); w.string(ins.file); w.u8(ins.key); w.u8(+ins.press); }
  return w.finish();
}
