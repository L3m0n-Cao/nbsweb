import data from './generated/assets.json' with { type: 'json' };
export const assets = data;
const sprites = data.sprites as Record<string, { width: number; height: number; frames: string[] }>;
const images = new Map<string, HTMLImageElement>();
export function assetUrl(path: string) { return import.meta.env.BASE_URL + path; }
export function spriteUrl(name: string, frame = 0) { return assetUrl(sprites[name]?.frames[frame] ?? sprites.spr_block.frames[0]); }
export function sprite(ctx: CanvasRenderingContext2D, name: string, frame: number, x: number, y: number, w?: number, h?: number) {
  const def = sprites[name]; if (!def?.frames[frame]) return;
  const url = spriteUrl(name, frame); let image = images.get(url);
  if (!image) { image = new Image(); image.src = url; images.set(url, image); }
  if (image.complete && image.naturalWidth) ctx.drawImage(image, x, y, w ?? def.width, h ?? def.height);
}
export function iconHtml(name: string, dark = false, classic = false) {
  const frame = (assets.icons as Record<string, number>)[name];
  return `<img alt="" draggable="false" src="${spriteUrl(classic ? 'spr_icons' : dark ? 'spr_icons_d_hires' : 'spr_icons_f_hires', frame)}">${classic ? '' : `<span class="accent-icon" style="mask-image:url('${spriteUrl('spr_icons_col_hires', frame)}')"></span>`}`;
}
