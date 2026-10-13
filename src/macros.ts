import { clamp, type Note } from './model';
export const macroNames = ['Tremolo', 'Stereo', 'Arpeggio', 'Portamento', 'Vibrato', 'Stagger', 'Chorus', 'Volume LFO', 'Fade in', 'Fade out', 'Replace key', 'Set velocity', 'Set panning', 'Set pitch', 'Reset'] as const;
export type Macro = typeof macroNames[number];
export interface MacroOptions { value?: number; reverse?: boolean; pattern?: string; from?: number; spacing?: number; fade?: string; automatic?: boolean; decay?: number; sustain?: number; percent?: boolean; add?: boolean }
export function applyMacro(name: Macro, input: Note[], options: MacroOptions = {}): Note[] {
  const notes = structuredClone(input).sort((a, b) => a.tick - b.tick || a.layer - b.layer);
  if (!notes.length) return notes;
  const ticks = [...new Set(notes.map(n => n.tick))], columns = ticks.map(t => notes.filter(n => n.tick === t));
  const value = options.value ?? (name === 'Portamento' ? 100 : name === 'Set pitch' ? 0 : 100);
  const pattern = (options.pattern ?? '0|4|7').split('|').map(Number);
  if ((name === 'Arpeggio' || name === 'Stagger') && (pattern.length < 2 || pattern.some(n => !Number.isFinite(n)))) throw new Error('Separate at least two numbers with pipes (|).');
  if (name === 'Stagger' && pattern.some(n => n < 0)) throw new Error('Stagger can only extend downwards.');
  if (name === 'Chorus' && columns.some(c => c.length < 2)) throw new Error('Chorus requires at least two note blocks in each selected column.');
  if (name === 'Tremolo') {
    const spacing = clamp(Math.round(options.spacing ?? 1), 1, 2), automatic = options.automatic !== false, decay = options.decay ?? 20, sustain = options.sustain ?? 20;
    const result: Note[] = []; let tick = ticks[0];
    columns.forEach((column, i) => {
      const last = i === columns.length - 1, fading = options.fade === 'in' || options.fade === 'out';
      const repeats = last ? 1 : Math.ceil((ticks[i + 1] - ticks[i]) / spacing);
      const increment = automatic ? 100 / (repeats > 4 ? repeats - 4 : repeats > 2 ? repeats - 2 : repeats) : decay;
      if (last && fading && result.length) tick = result.at(-1)!.tick + 1;
      for (let j = 0; j < repeats; j++) {
        result.push(...column.map((n, index) => {
          const note = { ...n, tick }, amount = increment * (j + 1);
          if (!last && options.fade === 'in') {
            // Preserve the desktop's separate first-note/chord-note cap rules.
            note.velocity = index === 0 ? Math.min(amount, automatic ? 80 : sustain) : amount <= decay ? amount : automatic ? 80 : sustain;
          } else if (!last && options.fade === 'out') note.velocity = 100 - amount >= 20 ? 100 - amount : automatic ? 20 : sustain;
          return note;
        })); tick += spacing;
      }
    });
    return result;
  }
  columns.forEach((column, i) => column.forEach((n, j) => {
    switch (name) {
      case 'Stereo': n.pan = 100 + value * (i % 2 ? -1 : 1) * (options.reverse ? -1 : 1); break;
      case 'Arpeggio': n.key += pattern[i % pattern.length]; break;
      case 'Portamento': n.pitch = options.reverse ? value + value / columns.length * (1 - i) : n.pitch + value / columns.length * (i + 1); break;
      case 'Vibrato': n.pitch = [40, 0, -40, 0][i % 4]; break;
      case 'Stagger': n.layer += pattern[i % pattern.length]; break;
      case 'Chorus': n.pan = 100 + 40 * (j % 2 ? -1 : 1); n.pitch += 5 * (j % 2 ? -1 : 1); break;
      case 'Volume LFO': n.velocity = [100, 50, 25, 50][i % 4]; if (i % 4 === 0 && n.pan === 0) n.pan = 100; break;
      case 'Fade in': n.velocity = clamp(Math.ceil(n.velocity * (columns.length === 1 ? 0 : i / (columns.length - 1))), 1, 100); break;
      case 'Fade out': n.velocity = clamp(Math.ceil(n.velocity * (columns.length === 1 ? 1 : 1 - i / (columns.length - 1))), 1, 100); break;
      case 'Replace key': n.key = input.slice().sort((a, b) => a.tick - b.tick || a.layer - b.layer)[0].key; break;
      case 'Set velocity': n.velocity = options.percent ? n.velocity * value / 100 : value; break;
      case 'Set panning': n.pan = value; break;
      case 'Set pitch': n.pitch = options.add ? n.pitch + value : value; break;
      case 'Reset': n.velocity = 100; n.pan = 100; n.pitch = 0; break;
    }
    n.key = clamp(n.key, 0, 87); n.velocity = clamp(n.velocity, 0, 100); n.pan = clamp(n.pan, 0, 200); n.pitch = clamp(Math.round(n.pitch), -32768, 32767);
  }));
  return notes;
}
