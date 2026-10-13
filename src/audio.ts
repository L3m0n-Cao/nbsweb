import { clamp, endTick, secondsTick, tempoMap, tickSeconds, type Instrument, type Note, type Song, type TempoPoint } from './model';
import { getStored, putStored } from './storage';
import { assets } from './assets';

export class AudioEngine {
  context?: AudioContext;
  buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer | undefined>>();
  private active = new Set<{ source: AudioBufferSourceNode; layer: number }>();
  private timer?: ReturnType<typeof setInterval>;
  private song?: Song;
  private map: TempoPoint[] = [];
  private startTime = 0;
  private nextTick = 0;
  private stopTick = 0;
  private loops = 0;
  private epoch = 0;
  private preparing = false;
  private columns = new Map<number, Note[]>();
  recording = false;
  playing = false;
  position = 0;
  volume = 1;
  stereo = true;
  layerVolumes = true;
  metronome = false;
  loop = false;
  section?: [number, number];
  reference?: { buffer: AudioBuffer; offset: number; volume: number; mode: number };
  onStop = () => {};
  onError = (_error: Error) => {};
  async init() { this.context ??= new AudioContext({ latencyHint: 'interactive' }); await this.context.resume(); return this.context; }
  async install(file: string, bytes: Uint8Array) {
    const ctx = await this.init(), buffer = await ctx.decodeAudioData(new Uint8Array(bytes).buffer);
    await putStored('files', file.replaceAll('\\', '/').toLowerCase(), bytes); this.buffers.set(file, buffer);
  }
  async storeSound(file: string, bytes: Uint8Array) {
    const key = file.replaceAll('\\', '/').toLowerCase();
    await putStored('files', key, bytes);
    // Folder libraries are decoded only when used, avoiding loading thousands
    // of decoded samples into memory at import time.
    for (const cached of this.buffers.keys()) if (cached.replaceAll('\\', '/').toLowerCase() === key) this.buffers.delete(cached);
  }
  async buffer(ins: Instrument): Promise<AudioBuffer | undefined> {
    if (!ins.file) return undefined;
    if (this.buffers.has(ins.file)) return this.buffers.get(ins.file);
    if (this.pending.has(ins.file)) return this.pending.get(ins.file);
    const task = (async () => {
      const ctx = await this.init();
      const key = ins.file.replaceAll('\\', '/').toLowerCase();
      const stored = await getStored<Uint8Array>('files', key);
      let data: ArrayBuffer;
      if (stored) data = new Uint8Array(stored).buffer;
      else {
        const bundled = assets.sounds.find(file => file.toLowerCase() === key) ?? ins.file.replaceAll('\\', '/');
        const response = await fetch(`${import.meta.env.BASE_URL}assets/sounds/${bundled.split('/').map(encodeURIComponent).join('/')}`);
        if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error(`Sound not found: ${ins.file}. Use “Import sound folder…” in Settings → Instrument settings and select your sounds folder.`);
        data = await response.arrayBuffer();
      }
      const result = await ctx.decodeAudioData(data); this.buffers.set(ins.file, result); return result;
    })();
    this.pending.set(ins.file, task);
    try { return await task; } finally { this.pending.delete(ins.file); }
  }
  private emit(ctx: BaseAudioContext, buffer: AudioBuffer, ins: Instrument, note: Note, when: number, volume: number, pan: number) {
    const source = ctx.createBufferSource(), gain = ctx.createGain(), panner = ctx.createStereoPanner();
    source.buffer = buffer;
    source.playbackRate.value = .5 * 2 ** ((note.key + ins.key + note.pitch / 100 - 78) / 12);
    gain.gain.value = clamp(volume, 0, 1); panner.pan.value = this.stereo ? clamp((pan - 100) / 100, -1, 1) : 0;
    source.connect(gain).connect(panner).connect(ctx.destination); source.start(when);
    const item = { source, layer: note.layer }; if (ctx === this.context) this.active.add(item);
    source.onended = () => { this.active.delete(item); source.disconnect(); gain.disconnect(); panner.disconnect(); };
    return source;
  }
  async preview(ins: Instrument, note: Note) {
    const buffer = await this.buffer(ins); if (buffer) this.emit(this.context!, buffer, ins, note, this.context!.currentTime, note.velocity / 100 * this.volume, note.pan);
  }
  async play(song: Song, start: number) {
    if (this.preparing) return;
    this.stop(false); const epoch = this.epoch; this.preparing = true;
    try {
      await this.init();
      const used = [...new Set(song.notes.map(n => n.instrument))];
      await Promise.all(used.map(id => song.instruments[id] ? this.buffer(song.instruments[id]) : Promise.reject(new Error(`Missing instrument ${id}.`))));
      if (epoch !== this.epoch) return;
      this.song = song; this.map = tempoMap(song); this.position = start; this.nextTick = Math.ceil(start);
      this.columns.clear(); for (const n of song.notes) { if (!this.columns.has(n.tick)) this.columns.set(n.tick, []); this.columns.get(n.tick)!.push(n); }
      this.stopTick = this.recording ? 65535 : this.section?.[1] ?? endTick(song) + 1; this.loops = 0;
      this.startTime = this.context!.currentTime + .04 - tickSeconds(start, this.map); this.playing = true;
      this.startReference(start); this.schedule(); this.timer = setInterval(() => this.schedule(), 20);
    } finally { this.preparing = false; }
  }
  private startReference(tick: number) {
    if (!this.reference || this.reference.mode === 0) return;
    const ctx = this.context!, ref = this.reference, source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = ref.buffer; gain.gain.value = ref.volume / 100 * this.volume; source.connect(gain).connect(ctx.destination);
    const offset = tickSeconds(tick, this.map) - ref.offset / 1000;
    if (offset >= ref.buffer.duration) return;
    source.start(Math.max(ctx.currentTime, this.startTime + tickSeconds(tick, this.map)) + Math.max(0, -offset), Math.max(0, offset));
    const item = { source, layer: -1 }; this.active.add(item); source.onended = () => { this.active.delete(item); source.disconnect(); gain.disconnect(); };
  }
  private schedule() {
    if (!this.playing || !this.song || !this.context) return;
    const ctx = this.context, song = this.song;
    this.position = Math.max(0, secondsTick(ctx.currentTime - this.startTime, this.map));
    const solo = song.layers.some(l => l.solo);
    while (this.nextTick < this.stopTick && this.startTime + tickSeconds(this.nextTick, this.map) < ctx.currentTime + .12) {
      const when = Math.max(ctx.currentTime, this.startTime + tickSeconds(this.nextTick, this.map));
      for (const n of this.recording ? song.notes.filter(n => n.tick === this.nextTick) : this.columns.get(this.nextTick) ?? []) {
        const layer = song.layers[n.layer], ins = song.instruments[n.instrument];
        if (!ins || layer?.locked || (solo && !layer?.solo) || this.reference?.mode === 1) continue;
        if (ins.name === 'Sound Stopper') {
          const until = ((n.pan + 156) % 256) + ((n.velocity + 156) % 256) * 256;
          for (const item of this.active) if (item.layer >= Math.abs(n.pitch) && item.layer <= until) item.source.stop(when);
          continue;
        }
        const b = this.buffers.get(ins.file);
        if (b) this.emit(ctx, b, ins, n, when, this.volume * n.velocity / 100 * (this.layerVolumes ? (layer?.volume ?? 100) / 100 : 1), (n.pan + (layer?.pan ?? 100)) / 2);
      }
      if (this.metronome && this.nextTick % 4 === 0) {
        const osc = ctx.createOscillator(), gain = ctx.createGain(); osc.frequency.value = this.nextTick % (song.timeSignature * 4) === 0 ? 1200 : 800;
        gain.gain.setValueAtTime(.1 * this.volume, when); gain.gain.exponentialRampToValueAtTime(.001, when + .04);
        osc.connect(gain).connect(ctx.destination); osc.start(when); osc.stop(when + .04); osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      }
      this.nextTick++;
    }
    if (this.position >= this.stopTick) {
      if (this.loop && (!song.loopCount || this.loops < song.loopCount)) {
        this.loops++; const start = clamp(this.section?.[0] ?? song.loopStart, 0, this.stopTick - 1);
        this.startTime += tickSeconds(this.stopTick, this.map) - tickSeconds(start, this.map);
        this.nextTick = Math.ceil(start); this.position = start;
      } else { this.stop(false); this.onStop(); }
    }
  }
  stop(reset = true) {
    this.epoch++; this.playing = false; clearInterval(this.timer);
    for (const item of this.active) { try { item.source.stop(); } catch { /* already ended */ } }
    this.active.clear(); if (reset) this.position = 0;
  }
  async render(song: Song, sampleRate = 44100, channels = 2, includeLocked = false) {
    await this.init(); await Promise.all([...new Set(song.notes.map(n => n.instrument))].map(i => this.buffer(song.instruments[i])));
    const map = tempoMap(song); let duration = tickSeconds(endTick(song) + 1, map);
    for (const n of song.notes) { const ins = song.instruments[n.instrument], b = this.buffers.get(ins.file); if (b) duration = Math.max(duration, tickSeconds(n.tick, map) + b.duration / (.5 * 2 ** ((n.key + ins.key + n.pitch / 100 - 78) / 12))); }
    const ctx = new OfflineAudioContext(channels, Math.ceil((duration + .1) * sampleRate), sampleRate);
    const sources: { source: AudioBufferSourceNode; layer: number }[] = [];
    for (const n of [...song.notes].sort((a, b) => a.tick - b.tick || a.layer - b.layer)) {
      const ins = song.instruments[n.instrument], b = this.buffers.get(ins.file), l = song.layers[n.layer];
      if (!includeLocked && l?.locked) continue;
      if (ins.name === 'Sound Stopper') {
        const until = ((n.pan + 156) % 256) + ((n.velocity + 156) % 256) * 256;
        for (const item of sources) if (item.layer >= Math.abs(n.pitch) && item.layer <= until) item.source.stop(tickSeconds(n.tick, map));
      } else if (b) sources.push({ source: this.emit(ctx, b, ins, n, tickSeconds(n.tick, map), n.velocity / 100 * (l?.volume ?? 100) / 100, (n.pan + (l?.pan ?? 100)) / 2), layer: n.layer });
    }
    return encodeWav(await ctx.startRendering());
  }
}
export function encodeWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels, data = new Uint8Array(44 + buffer.length * channels * 2), v = new DataView(data.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, data.length - 8, true); text(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, channels, true); v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, data.length - 44, true); const arrays = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < buffer.length; i++) for (let c = 0; c < channels; c++) { const sample = clamp(arrays[c][i], -1, 1); v.setInt16(44 + (i * channels + c) * 2, sample * (sample < 0 ? 32768 : 32767), true); }
  return data;
}
