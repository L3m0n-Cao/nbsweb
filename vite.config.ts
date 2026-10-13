import { defineConfig } from 'vite';
export default defineConfig({ base: './', optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] }, server: { host: '0.0.0.0', port: 5173, strictPort: true } });
