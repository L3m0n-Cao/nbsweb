export type AudioFormat = 'wav' | 'mp3' | 'aiff' | 'flac';
// The single-threaded WASM core works on ordinary HTTPS static hosts without
// SharedArrayBuffer or cross-origin isolation headers.
export async function encodeAudio(wav: Uint8Array, format: AudioFormat, sampleRate: number, progress: (message: string) => void) {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const encoder = new FFmpeg();
  const base = new URL(`${import.meta.env.BASE_URL}assets/ffmpeg/`, location.href).href;
  try {
    progress('Loading browser audio encoder…');
    encoder.on('progress', ({ progress: ratio }) => progress(`Encoding ${format.toUpperCase()}… ${Math.min(100, Math.max(0, Math.round(ratio * 100)))}%`));
    await encoder.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
    await encoder.writeFile('input.wav', wav);
    const output = `output.${format}`, args = ['-i', 'input.wav', '-ar', String(sampleRate)];
    if (format === 'mp3') args.push('-codec:a', 'libmp3lame', '-b:a', '192k');
    if (format === 'flac') args.push('-codec:a', 'flac');
    if (format === 'aiff') args.push('-codec:a', 'pcm_s16be');
    const status = await encoder.exec([...args, output]);
    if (status !== 0) throw new Error(`Audio encoding failed. ${format.toUpperCase()} may not support the selected sample rate.`);
    const data = await encoder.readFile(output); if (typeof data === 'string') throw new Error('The encoder returned invalid audio.');
    return data;
  } finally { encoder.terminate(); }
}
