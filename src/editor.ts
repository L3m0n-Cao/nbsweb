import { sprite } from './assets';
import { cell, clamp, endTick, keyName, type Note, type Song } from './model';
import type { Settings } from './settings';

export interface EditorView {
  song: Song; settings: Settings; selected: Set<string>; marker: number; playing: boolean;
  x: number; y: number; key: number; instrument: number; mode: number; section?: [number, number];
  hover?: { tick: number; layer: number }; marquee?: { x1: number; x2: number; y1: number; y2: number };
  pianoBindings: Record<string, number>;
}
export class GridRenderer {
  width = 0; height = 0;
  constructor(public canvas: HTMLCanvasElement, public view: () => EditorView) {}
  resize() {
    const scale = this.view().settings.n('window_scale') || 1;
    this.width = this.canvas.clientWidth / scale; this.height = this.canvas.clientHeight / scale;
    const dpr = window.devicePixelRatio * scale;
    if (this.canvas.width !== Math.round(this.width * dpr) || this.canvas.height !== Math.round(this.height * dpr)) {
      this.canvas.width = Math.round(this.width * dpr); this.canvas.height = Math.round(this.height * dpr);
    }
    const ctx = this.canvas.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return ctx;
  }
  point(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect(), scale = this.view().settings.n('window_scale') || 1;
    const x = (e.clientX - rect.left) / scale, y = (e.clientY - rect.top) / scale, v = this.view();
    return { tick: clamp(Math.floor(x / 32) + v.x, 0, 65534), layer: clamp(Math.floor((y - 32) / 32) + v.y, 0, 65534), ruler: y < 32 };
  }
  draw() {
    const ctx = this.resize(), v = this.view(), s = v.settings, dark = s.n('theme') === 2 || (s.n('theme') === 3 && !!s.n('fdark'));
    const text = dark ? '#ffffff' : '#000000', bg = s.n('blackout') ? '#000000' : dark ? '#272727' : s.n('theme') === 1 ? '#d4d0c8' : s.n('theme') === 0 ? '#ffffff' : '#f9f9f9';
    ctx.clearRect(0, 0, this.width, this.height); ctx.fillStyle = bg; ctx.fillRect(0, 0, this.width, this.height);
    const rows = Math.ceil((this.height - 32) / 32), cols = Math.ceil(this.width / 32);
    ctx.strokeStyle = text;
    for (let i = 0; i <= cols; i++) { const tick = i + v.x; ctx.globalAlpha = tick % (v.song.timeSignature * 4) === 0 ? .3 : tick % 4 === 0 ? .25 : .1; ctx.lineWidth = tick % (v.song.timeSignature * 4) === 0 ? 2 : 1; ctx.beginPath(); ctx.moveTo(i * 32 + .5, 32); ctx.lineTo(i * 32 + .5, this.height); ctx.stroke(); }
    ctx.lineWidth = 1; ctx.globalAlpha = .04;
    for (let i = 0; i <= rows; i++) { ctx.beginPath(); ctx.moveTo(0, 32 + i * 32 + .5); ctx.lineTo(this.width, 32 + i * 32 + .5); ctx.stroke(); }
    ctx.globalAlpha = 1;
    for (const n of v.song.notes) {
      if (n.tick < v.x || n.tick > v.x + cols || n.layer < v.y || n.layer > v.y + rows) continue;
      const x = (n.tick - v.x) * 32, y = (n.layer - v.y) * 32 + 32;
      const selected = v.selected.has(cell(n)), hovering = v.hover?.tick === n.tick && v.hover.layer === n.layer;
      const alpha = s.n('fade') ? 1 : clamp(.5 * n.velocity / 100 + .25 + (selected || hovering ? .5 : 0), 0, 1);
      this.note(ctx, n, x, y, alpha, selected);
    }
    for (let row = 0; row < rows; row++) if (v.song.layers[v.y + row]?.locked) { ctx.fillStyle = dark ? '#00000070' : '#80808050'; ctx.fillRect(0, 32 + row * 32, this.width, 32); }
    if (v.marquee) {
      const m = v.marquee, x = (Math.min(m.x1, m.x2) - v.x) * 32, y = (Math.min(m.y1, m.y2) - v.y) * 32 + 32;
      const width = (Math.abs(m.x2 - m.x1) + 1) * 32, height = (Math.abs(m.y2 - m.y1) + 1) * 32;
      ctx.fillStyle = '#0078d433'; ctx.fillRect(x, y, width, height); ctx.strokeStyle = s.s('accent'); ctx.strokeRect(x + .5, y + .5, width - 1, height - 1);
    }
    if (v.hover && !v.playing) { ctx.strokeStyle = '#88888888'; ctx.strokeRect((v.hover.tick - v.x) * 32 + .5, (v.hover.layer - v.y) * 32 + 32.5, 31, 31); }
    ctx.fillStyle = dark ? '#202020' : s.n('theme') === 1 ? '#d4d0c8' : '#f3f3f3'; ctx.fillRect(0, 0, this.width, 32);
    ctx.font = '11px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = text;
    for (let i = 0; i <= cols; i++) {
      const tick = v.x + i;
      if (tick % 4 === 0) { ctx.globalAlpha = .6; ctx.fillRect(i * 32, 25, 1, 7); ctx.fillText(String(tick), i * 32 + 16, 16); }
    }
    ctx.globalAlpha = 1;
    if (v.section) { ctx.fillStyle = '#e8b62755'; ctx.fillRect((v.section[0] - v.x) * 32, 0, (v.section[1] - v.section[0]) * 32, this.height); }
    const mx = (v.marker - v.x) * 32; ctx.fillStyle = '#ed3b28'; ctx.fillRect(mx, 0, 2, this.height); ctx.beginPath(); ctx.moveTo(mx - 6, 0); ctx.lineTo(mx + 7, 0); ctx.lineTo(mx + 1, 10); ctx.fill();
    this.canvas.setAttribute('aria-label', `Note editor: ${v.song.notes.length} notes, ${v.selected.size} selected. Tick ${Math.floor(v.marker)}.`);
  }
  note(ctx: CanvasRenderingContext2D, n: Note, x: number, y: number, alpha: number, selected: boolean) {
    const v = this.view(), s = v.settings, frame = n.instrument < 20 ? n.instrument : 20 + (n.instrument - 20) % 18;
    const name = s.n('use_colors') ? s.n('use_shapes') ? 'spr_block_color_shape' : 'spr_block_color' : s.n('use_shapes') ? 'spr_block_shape' : 'spr_block';
    ctx.globalAlpha = alpha; sprite(ctx, name, name === 'spr_block' ? 1 : frame, x, y, 32, 32);
    if (s.n('use_icons')) sprite(ctx, 'spr_instrumenticons', Math.min(n.instrument, 19), x + 16, y + 16, 16, 16);
    ctx.globalAlpha = 1;
    if (n.pitch) { ctx.fillStyle = n.pitch > 0 ? '#0000ff' : '#ff0000'; ctx.globalAlpha = Math.min(.5, Math.abs(n.pitch) / 100 * alpha * .25); ctx.fillRect(x, y, 31, 31); ctx.globalAlpha = 1; }
    if (s.n('show_incompatible') && (n.instrument >= 20 || n.key < 33 || n.key > 57)) { ctx.strokeStyle = '#ff0000'; ctx.strokeRect(x + 1.5, y + 1.5, 29, 29); }
    if (selected) { ctx.globalAlpha = s.n('selection_alpha'); sprite(ctx, 'spr_block_sel', 0, x, y, 32, 32); ctx.globalAlpha = 1; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = 'bold 9px "Segoe UI", sans-serif'; ctx.fillStyle = s.n('theme') === 2 ? '#ffffff' : '#ffff00';
    ctx.fillText(keyName(n.key, !!s.n('show_octaves'), !!s.n('keynames_flat')), x + 16, y + 3);
    if (s.n('show_numbers')) {
      ctx.fillStyle = '#ffffff'; ctx.font = '10px "Segoe UI", sans-serif';
      const label = v.mode === 0 ? n.key < 33 ? ' < ' : n.key > 57 ? ' > ' : String(n.key - 33) : v.mode === 1 ? String(n.velocity) : v.mode === 2 ? `${n.pan < 100 ? 'L ' : n.pan > 100 ? 'R ' : ''}${Math.abs(n.pan - 100)}` : `${n.pitch > 0 ? '+' : ''}${n.pitch}`;
      ctx.fillText(v.song.instruments[n.instrument]?.name === 'Tempo Changer' ? `${Math.abs(n.pitch)}` : label, x + 16 - 8 * s.n('use_icons'), y + 16);
    }
  }
}

export class PianoRenderer {
  private keys: { key: number; x: number; black: boolean }[] = [];
  constructor(public canvas: HTMLCanvasElement, public view: () => EditorView) {}
  hit(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect(), scale = this.view().settings.n('window_scale') || 1, x = (e.clientX - rect.left) / scale, y = (e.clientY - rect.top) / scale;
    return [...this.keys].reverse().find(k => x >= k.x + (k.black ? 7 : 0) && x < k.x + (k.black ? 32 : 39) && y >= (k.black ? 1 : 8) && y < (k.black ? 72 : 133))?.key;
  }
  draw() {
    const v = this.view(), s = v.settings, scale = s.n('window_scale') || 1, width = this.canvas.clientWidth / scale, height = 140, dpr = devicePixelRatio * scale;
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) { this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr); }
    const ctx = this.canvas.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const count = Math.min(s.n('keysmax') || 30, Math.floor((width - 32) / 39)), allWhites = Array.from({ length: 88 }, (_, i) => i).filter(i => ![1, 4, 6, 9, 11].includes(i % 12));
    const start = clamp(s.n('piano_start'), 0, 52 - count), whites = allWhites.slice(start, start + count), x0 = (width - count * 39) / 2;
    this.keys = whites.map((key, i) => ({ key, x: x0 + i * 39, black: false }));
    for (let i = 1; i < whites.length; i++) if (whites[i] - whites[i - 1] === 2) this.keys.push({ key: whites[i] - 1, x: x0 + i * 39 - 19, black: true });
    const offset = s.n('theme') === 3 ? 6 + (s.n('fdark') ? 6 : 0) : 0;
    for (const k of this.keys) {
      const y = k.black ? 1 : 8;
      if (k.black) sprite(ctx, 'spr_piano', offset + 2, k.x, y);
      sprite(ctx, 'spr_piano', offset + (k.black ? 1 : 0), k.x, y);
      if (s.n('show_outofrange') && (k.key < 33 || k.key > 57)) { ctx.fillStyle = '#ffcc9930'; ctx.fillRect(k.x + (k.black ? 7 : 1), y + 1, k.black ? 24 : 37, k.black ? 57 : 118); }
      if (k.key === v.key) { ctx.fillStyle = '#0078d45a'; ctx.fillRect(k.x + (k.black ? 7 : 1), y + 1, k.black ? 24 : 37, k.black ? 57 : 118); }
      ctx.fillStyle = k.black || (s.n('theme') === 3 && s.n('fdark')) ? '#ffffff' : '#111111'; ctx.textAlign = 'center'; ctx.font = 'bold 11px "Segoe UI", sans-serif';
      if (s.n('show_keynames')) ctx.fillText(keyName(k.key, true, !!s.n('keynames_flat')), k.x + 19, y + (k.black ? 27 : 88));
      ctx.font = '10px "Segoe UI", sans-serif';
      if (s.n('show_keynumbers') && k.key >= 33 && k.key <= 57) ctx.fillText(String(k.key - 33), k.x + 19, y + (k.black ? 39 : 102));
      if (s.n('show_keyboard')) { const binding = Object.entries(v.pianoBindings).find(([, note]) => note === k.key)?.[0] ?? ''; ctx.fillText(binding.toUpperCase(), k.x + 19, y + (k.black ? 53 : 117)); }
    }
  }
}
