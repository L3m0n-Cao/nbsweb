import { Reader } from './binary';
import assets from './generated/assets.json' with { type: 'json' };
import { clamp, ensureLayers, newSong, normalize, type Song } from './model';
interface MidiEvent { tick: number; track: number; status: number; a: number; b: number; meta?: number; bytes?: Uint8Array; order: number }
export function importMidi(bytes: Uint8Array, filename: string, ticksPerSecond = 10, velocity = true, duration = false, octave = 0): Song {
  const r = new Reader(bytes), text = (n: number) => new TextDecoder().decode(r.bytes(n));
  if (text(4) !== 'MThd') throw new Error('Not a Standard MIDI File.');
  const headerLength = r.u32(true), format = r.u16(true), tracks = r.u16(true), division = r.u16(true);
  if (headerLength < 6 || division === 0) throw new Error('Invalid MIDI header.');
  if (format > 1) throw new Error('Asynchronous MIDI format 2 must first be converted to format 0 or 1.');
  r.bytes(headerLength - 6);
  const events: MidiEvent[] = [], names: string[] = []; let order = 0;
  for (let track = 0; track < tracks; track++) {
    if (text(4) !== 'MTrk') throw new Error('Missing MIDI track chunk.');
    const t = new Reader(r.bytes(r.u32(true))); let tick = 0, running = 0;
    while (t.remaining) {
      tick += t.vlq(); let status = t.u8();
      if (status < 128) { if (!running) throw new Error('MIDI running status without a previous channel event.'); t.offset--; status = running; }
      if (status === 0xff) {
        const meta = t.u8(), data = t.bytes(t.vlq());
        if (meta === 3) names[track] = new TextDecoder().decode(data);
        events.push({ tick, track, status, a: 0, b: 0, meta, bytes: data, order: order++ });
        if (meta === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) { t.bytes(t.vlq()); running = 0; }
      else {
        if (status >= 0xf0) throw new Error('Unsupported MIDI system event.');
        running = status; const type = status & 0xf0, a = t.u8(), b = type === 0xc0 || type === 0xd0 ? 0 : t.u8();
        events.push({ tick, track, status, a, b, order: order++ });
      }
    }
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const song = newSong(); song.name = names.find(Boolean) || filename.replace(/\.midi?$/i, ''); song.midi = filename; song.tempo = ticksPerSecond;
  const programs = Array(16).fill(0), volumes = Array(16).fill(127), pans = Array(16).fill(64), channelLayers: number[][] = Array.from({ length: 16 }, () => []);
  const pending = new Map<string, { note: number; start: number }[]>();
  const occupied = new Set<string>(); const layerEnds: number[] = [];
  let seconds = 0, lastTick = 0, microseconds = 500000;
  const fpsCode = 256 - (division >> 8), smpteRate = fpsCode === 29 ? 29.97 : fpsCode;
  for (const event of events) {
    seconds += (event.tick - lastTick) * (division & 0x8000 ? 1 / (smpteRate * (division & 255)) : microseconds / 1e6 / division); lastTick = event.tick;
    if (event.meta === 0x51 && event.bytes?.length === 3) { microseconds = (event.bytes[0] << 16) | (event.bytes[1] << 8) | event.bytes[2]; continue; }
    if (event.meta === 0x58 && event.bytes?.length) { song.timeSignature = clamp(event.bytes[0], 2, 8); continue; }
    const type = event.status & 0xf0, channel = event.status & 15, tick = Math.round(seconds * ticksPerSecond);
    if (tick > 65534) throw new Error('The MIDI file is longer than the NBS tick limit at this tempo.');
    if (event.status === 0xff) continue;
    if (type === 0xc0) { programs[channel] = event.a; continue; }
    if (type === 0xb0) { if (event.a === 7) volumes[channel] = event.b; if (event.a === 10) pans[channel] = event.b; continue; }
    const keyId = `${channel}:${event.a}`;
    if (type === 0x80 || (type === 0x90 && event.b === 0)) {
      const pair = pending.get(keyId)?.shift(); if (!pair) continue;
      const note = song.notes[pair.note]; layerEnds[note.layer] = tick;
      if (duration && channel !== 9) for (let at = pair.start + 1; at < tick; at++) {
        const id = `${at}:${note.layer}`; if (occupied.has(id)) continue;
        song.notes.push({ ...note, tick: at, velocity: Math.floor(note.velocity / 2), pan: (at - pair.start) % 2 ? 50 : 150 }); occupied.add(id);
      }
      continue;
    }
    if (type !== 0x90) continue;
    const mapping = channel === 9 ? assets.drums[event.a] : assets.midi[programs[channel]];
    if (!mapping || mapping.instrument < 0) continue;
    const key = clamp(channel === 9 ? mapping.pitch + 33 : event.a - 21 + (mapping.pitch + octave) * 12, 0, 87);
    let layer = channelLayers[channel].find(l => !occupied.has(`${tick}:${l}`) && (!duration || layerEnds[l] <= tick));
    if (layer === undefined) { layer = song.layers.length; ensureLayers(song, layer + 1); song.layers[layer].name = `Channel ${channel + 1} (${mapping.name})`; channelLayers[channel].push(layer); }
    const noteIndex = song.notes.length;
    song.notes.push({ tick, layer, instrument: mapping.instrument, key, velocity: velocity ? Math.round(event.b / 127 * volumes[channel] / 127 * 100) : 100, pan: Math.round(pans[channel] / 127 * 200), pitch: 0 });
    occupied.add(`${tick}:${layer}`); layerEnds[layer] = duration ? Infinity : tick + 1;
    if (!pending.has(keyId)) pending.set(keyId, []); pending.get(keyId)!.push({ note: noteIndex, start: tick });
  }
  normalize(song); return song;
}
