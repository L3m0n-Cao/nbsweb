import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readNbs } from '../../src/nbs';

async function start(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
    localStorage.setItem('nbs-settings', JSON.stringify({ show_welcome: 0 }));
  });
  await page.goto('/'); await expect(page.locator('#grid')).toHaveAttribute('aria-label', /0 notes/);
}
async function addNote(page: Page, tick: number, layer = 0) { await page.locator('#grid').click({ position: { x: tick * 32 + 16, y: layer * 32 + 48 } }); }

test('edit, select, apply macro, undo/redo and save an interoperable NBS', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await start(page); await addNote(page, 0); await addNote(page, 4); await addNote(page, 8, 1);
  await expect(page.locator('#grid')).toHaveAttribute('aria-label', /3 notes/);
  await page.keyboard.press('Control+a'); await expect(page.locator('#grid')).toHaveAttribute('aria-label', /3 selected/);
  await page.getByRole('button', { name: 'Vibrato', exact: true }).click();
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+y');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save song (Ctrl+S)', exact: true }).click();
  const file = await download, path = await file.path(); const song = readNbs(new Uint8Array(await readFile(path!)));
  expect(song.notes.map(n => n.pitch)).toEqual([40, 0, -40]); expect(song.layers).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('opens supplied example, starts and stops sample playback, exports audible WAV', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await start(page);
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Open song (Ctrl+O)', exact: true }).click();
  await (await chooser).setFiles('NoteBlockStudio/datafiles/Songs/Nyan Cat.nbs');
  await expect(page.locator('#tabs')).toContainText('Nyan');
  await page.getByRole('button', { name: 'Play / Pause song (Space)', exact: true }).click();
  await expect(page.locator('#position')).not.toHaveText(/^0\.00 s/);
  await page.getByRole('button', { name: 'Stop song (Enter)', exact: true }).click();
  await expect(page.locator('#position')).toHaveText(/^0\.00 s/);
  // A short new song makes offline render verification deterministic and inexpensive.
  await page.getByRole('button', { name: 'New song (Ctrl+N)', exact: true }).click(); await addNote(page, 0);
  await page.getByRole('button', { name: 'File', exact: true }).click(); await page.getByRole('menuitem', { name: 'Export…', exact: true }).click(); await page.getByRole('menuitem', { name: 'Audio track…', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download, wav = await readFile((await file.path())!);
  expect(wav.subarray(0, 4).toString()).toBe('RIFF'); expect(wav.length).toBeGreaterThan(44100);
  expect(wav.subarray(44).some(b => b !== 0)).toBe(true); expect(errors).toEqual([]);
});

test('preferences apply, and unsaved work survives reload', async ({ page }) => {
  await start(page); await addNote(page, 2);
  await page.keyboard.press('Control+p'); await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByLabel('Fluent dark mode').check(); await expect(page.locator('body')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect.poll(async () => page.evaluate(() => new Promise<number>((resolve, reject) => { const r = indexedDB.open('opennbs-web', 1); r.onerror = () => reject(r.error); r.onsuccess = () => { const q = r.result.transaction('state').objectStore('state').get('recovery'); q.onsuccess = () => { resolve(q.result?.[0]?.notes.length ?? 0); r.result.close(); }; }; }))).toBe(1);
  page.on('dialog', dialog => dialog.accept()); await page.reload(); await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('#grid')).toHaveAttribute('aria-label', /1 notes/);
});

test('selection drag and locked-layer erasing preserve intended notes', async ({ page }) => {
  await start(page); await addNote(page, 0); await addNote(page, 2, 1);
  const box = (await page.locator('#grid').boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 34); await page.mouse.down(); await page.mouse.move(box.x + 95, box.y + 95, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('#grid')).toHaveAttribute('aria-label', /2 selected/);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Escape');
  await page.locator('[data-layer="0"] [data-layer-action="lock"]').click();
  await page.locator('#grid').click({ button: 'right', position: { x: 48, y: 48 } });
  await expect(page.locator('#grid')).toHaveAttribute('aria-label', /2 notes/);
});

test('encodes MP3, AIFF and FLAC entirely in the browser', async ({ page }) => {
  test.setTimeout(90000);
  await start(page); await addNote(page, 0);
  for (const [format, signature] of [['mp3', 'ID3'], ['aiff', 'FORM'], ['flac', 'fLaC']]) {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export…', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Audio track…', exact: true }).click();
    await page.getByLabel('Output format').selectOption(format);
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click();
    const file = await download, data = await readFile((await file.path())!);
    expect(data.subarray(0, signature.length).toString()).toBe(signature); expect(data.length).toBeGreaterThan(100);
  }
});

test('imports nested sound folders and resolves their paths after reload', async ({ page }) => {
  const sample = [...await readFile('public/assets/sounds/harp.ogg')];
  await page.addInitScript(sample => {
    const file = { kind: 'file', name: 'Trigger.ogg', getFile: async () => new File([new Uint8Array(sample)], 'Trigger.ogg') };
    const directory = (name: string, children: unknown[]) => ({ kind: 'directory', name, async *values() { yield* children; } });
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => directory('sounds', [directory('Minecraft', [directory('Portal', [file])])]) });
  }, sample);
  await start(page);
  await page.getByRole('button', { name: 'Instrument settings', exact: true }).click();
  await page.getByRole('button', { name: 'Import sound folder…', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported 1 sounds.' }).last()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Instrument settings', exact: true }).click();
  await page.locator('[data-ins="0"]').click();
  await page.getByLabel('Sound filename').fill('minecraft\\portal\\trigger.ogg');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await addNote(page, 0); await addNote(page, 8);
  await page.getByRole('button', { name: 'Play / Pause song (Space)', exact: true }).click();
  await expect(page.locator('#position')).not.toHaveText(/^0\.00 s/);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});
