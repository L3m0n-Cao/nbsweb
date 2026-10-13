// Run when updating the corresponding third-party packages, not on each build.
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
await mkdir('public/licenses', { recursive: true });
for (const [url, name] of [
  ['https://raw.githubusercontent.com/FFmpeg/FFmpeg/n5.1.4/COPYING.GPLv2', 'FFmpeg-GPLv2.txt'],
  ['https://raw.githubusercontent.com/ffmpegwasm/ffmpeg.wasm/main/LICENSE', 'ffmpeg-wasm-MIT.txt'],
]) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`License download failed: ${url}`);
  await writeFile(`public/licenses/${name}`, await response.text());
}
await copyFile('node_modules/fflate/LICENSE', 'public/licenses/fflate-MIT.txt');
