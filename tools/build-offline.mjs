import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const index = await readFile('dist/index.html', 'utf8');
const version = createHash('sha256').update(index).digest('hex').slice(0, 12);
const assets = JSON.parse(await readFile('src/generated/assets.json', 'utf8'));
const files = ['index.html', 'manifest.webmanifest', 'assets/icon.ico', ...(await readdir('dist/assets')).filter(n => /\.(js|css)$/.test(n)).map(n => 'assets/' + n)];
for (const sprite of Object.values(assets.sprites)) files.push(...sprite.frames);
files.push(...assets.instruments.map(ins => 'assets/sounds/' + ins.file));
await writeFile('dist/sw.js', `
const CACHE = 'opennbs-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // Batches avoid saturating Chromium's per-origin request pool.
  for (let i = 0; i < FILES.length; i += 32) await cache.addAll(FILES.slice(i, i + 32));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('opennbs-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Static assets have no per-Origin representation; Vite's CORS Vary header
    // otherwise makes a precached URL miss for a crossorigin module request.
    const cached = await cache.match(event.request, { ignoreVary: true });
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      if (event.request.mode === 'navigate') return await cache.match(new URL('index.html', self.registration.scope).href);
      throw error;
    }
  })());
});
`);
console.log(`Offline cache: ${files.length} app files, sprite frames and vanilla samples.`);
