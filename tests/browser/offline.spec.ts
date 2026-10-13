import { test, expect } from '@playwright/test';
test('the production editor and vanilla samples work offline', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('nbs-settings', JSON.stringify({ show_welcome: 0 })));
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true); await page.reload();
  await expect(page.locator('#grid')).toHaveAttribute('aria-label', /0 notes/);
  await page.locator('#grid').click({ position: { x: 16, y: 48 } });
  await expect(page.locator('#grid')).toHaveAttribute('aria-label', /1 notes/);
  expect(await page.evaluate(async () => { const r = await fetch('./assets/sounds/harp.ogg'); return r.ok && (await r.arrayBuffer()).byteLength > 100; })).toBe(true);
  expect(errors).toEqual([]);
});
