export class Reader {
  offset = 0;
  view: DataView;
  constructor(public data: Uint8Array) { this.view = new DataView(data.buffer, data.byteOffset, data.byteLength); }
  get remaining() { return this.data.length - this.offset; }
  need(n: number) { if (!Number.isInteger(n) || n < 0 || n > this.remaining) throw new Error(`Truncated or invalid file at byte ${this.offset}.`); }
  u8() { this.need(1); return this.view.getUint8(this.offset++); }
  u16(be = false) { this.need(2); const v = this.view.getUint16(this.offset, !be); this.offset += 2; return v; }
  i16() { this.need(2); const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
  u32(be = false) { this.need(4); const v = this.view.getUint32(this.offset, !be); this.offset += 4; return v; }
  bytes(n: number) { this.need(n); const v = this.data.slice(this.offset, this.offset + n); this.offset += n; return v; }
  string() { const bytes = this.bytes(this.u32()); let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s; }
  zstring() { let s = ''; for (;;) { const c = this.u8(); if (!c) return s; s += String.fromCharCode(c); } }
  vlq() { let v = 0; for (let i = 0; i < 4; i++) { const b = this.u8(); v = (v << 7) | (b & 127); if (!(b & 128)) return v; } throw new Error('Invalid MIDI variable-length integer.'); }
}
export class Writer {
  data: number[] = [];
  u8(n: number) { this.data.push(n & 255); }
  u16(n: number, be = false) { if (be) { this.u8(n >> 8); this.u8(n); } else { this.u8(n); this.u8(n >> 8); } }
  u32(n: number, be = false) { if (be) { this.u16(n >>> 16, true); this.u16(n, true); } else { this.u16(n); this.u16(n >>> 16); } }
  bytes(data: Uint8Array) { for (const b of data) this.u8(b); }
  string(s: string) { const chars = [...s]; this.u32(chars.length); for (const c of chars) this.u8(c.codePointAt(0)!); }
  zstring(s: string) { for (const c of s) this.u8(c.charCodeAt(0)); this.u8(0); }
  finish() { return Uint8Array.from(this.data); }
}
