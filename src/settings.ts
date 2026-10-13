import assets from './generated/assets.json' with { type: 'json' };
export type SettingValue = string | number;
export const defaults: Record<string, SettingValue> = Object.fromEntries(assets.settings.filter(s => s.default !== null).map(s => [s.variable, s.default!])) as Record<string, SettingValue>;
Object.assign(defaults, { window_scale: 1, mastervol: 1, piano_start: 12, accent: '#0078d4', mousewheel_scroll_speed: 1 });
export class Settings {
  values = { ...defaults };
  constructor() { try { Object.assign(this.values, JSON.parse(localStorage.getItem('nbs-settings') ?? '{}')); } catch { /* A corrupt settings record uses source defaults. */ } }
  n(key: string) { return Number(this.values[key] ?? 0); }
  s(key: string) { return String(this.values[key] ?? ''); }
  set(key: string, value: SettingValue) { this.values[key] = value; localStorage.setItem('nbs-settings', JSON.stringify(this.values)); }
  importIni(text: string) {
    let section = '';
    for (const line of text.split(/\r?\n/)) {
      const group = line.match(/^\s*\[([^\]]+)\]/); if (group) { section = group[1]; continue; }
      const pair = line.match(/^\s*([^=;]+)\s*=\s*(.*?)\s*$/); if (!pair) continue;
      const def = assets.settings.find(s => s.section === section && s.key === pair[1].trim());
      if (def) { const raw = pair[2].replace(/^"|"$/g, ''); const v = def.type === 'real' ? Number(raw) : raw; if (typeof v === 'string' || Number.isFinite(v)) this.values[def.variable] = v; }
    }
    localStorage.setItem('nbs-settings', JSON.stringify(this.values));
  }
  exportIni() {
    const sections = new Map<string, string[]>();
    for (const def of assets.settings) {
      const value = this.values[def.variable]; if (value === undefined) continue;
      if (!sections.has(def.section)) sections.set(def.section, []);
      sections.get(def.section)!.push(`${def.key}=${def.type === 'string' ? JSON.stringify(value) : value}`);
    }
    return [...sections].map(([section, lines]) => `[${section}]\r\n${lines.join('\r\n')}`).join('\r\n\r\n');
  }
}
