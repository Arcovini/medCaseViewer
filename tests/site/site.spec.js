// @ts-check
import { test, expect } from "@playwright/test";

const SITE_URL = '/';
const WA_PREFIX = 'https://wa.me/5521993118288';
const DEMO_PREFIX = 'https://biodesignlab.com.br/case/?id=';

test.describe('marketing landing', () => {
  test('smoke: page loads with Medcase wordmark + hero headline', async ({ page }) => {
    await page.goto(SITE_URL);
    await expect(page).toHaveTitle(/Medcase/i);
    await expect(page.locator('.lockup-brand')).toContainText('Medcase');
    await expect(page.locator('h1.headline')).toContainText('Anatomia');
  });

  test('cta wiring: every Solicitar links to wa.me, every Abrir caso demo to /case/', async ({ page }) => {
    await page.goto(SITE_URL);
    const coralLinks = page.locator('a.btn-primary.coral');
    const coralCount = await coralLinks.count();
    expect(coralCount).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < coralCount; i++) {
      const href = await coralLinks.nth(i).getAttribute('href');
      expect(href || '').toContain(WA_PREFIX);
    }
    const demoLinks = page.locator('a.btn-ghost, a.btn-ghost-dark');
    const demoCount = await demoLinks.count();
    expect(demoCount).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < demoCount; i++) {
      const href = await demoLinks.nth(i).getAttribute('href');
      expect(href || '').toContain(DEMO_PREFIX);
    }
  });

  test('partner row: all 4 logos load with non-empty alt', async ({ page }) => {
    await page.goto(SITE_URL);
    const cells = page.locator('.partners .cell img');
    await expect(cells).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const img = cells.nth(i);
      const alt = await img.getAttribute('alt');
      expect((alt || '').length).toBeGreaterThan(0);
      // Wait until the image has finished loading before reading naturalWidth.
      await img.evaluate(el => /** @type {HTMLImageElement} */ (el).complete || new Promise(r => el.addEventListener('load', r, { once: true })));
      const naturalWidth = await img.evaluate(el => /** @type {HTMLImageElement} */ (el).naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    }
  });

  test('hero video: present with muted/loop/playsinline and correct src', async ({ page }) => {
    await page.goto(SITE_URL);
    const video = page.locator('.hero-canvas video').first();
    await expect(video).toHaveCount(1);
    const attrs = await video.evaluate(v => ({
      muted: v.hasAttribute('muted'),
      loop: v.hasAttribute('loop'),
      playsinline: v.hasAttribute('playsinline'),
      src: v.getAttribute('src'),
    }));
    expect(attrs.muted).toBe(true);
    expect(attrs.loop).toBe(true);
    expect(attrs.playsinline).toBe(true);
    expect(attrs.src || '').toMatch(/videoViewer\.mp4$/);
  });

  test('GTM dataLayer: gtm.start push present after load', async ({ page }) => {
    await page.goto(SITE_URL);
    await page.waitForLoadState('load');
    // Give gtag and inline scripts a beat to push their entries.
    await page.waitForFunction(() => Array.isArray(window.dataLayer) && window.dataLayer.length > 0);
    const dl = await page.evaluate(() => (window.dataLayer || []).slice());
    expect(dl.length).toBeGreaterThan(0);
    const hasGtmJs = dl.some(o => o && (o.event === 'gtm.js' || (typeof o['gtm.start'] === 'number')));
    expect(hasGtmJs).toBe(true);
  });

  test('anchor navigation: nav links scroll to matching section ids', async ({ page, isMobile }) => {
    await page.goto(SITE_URL);
    // Mobile project hides anchor links (.nav a:not(.btn-primary)) via CSS; skip there.
    if (isMobile) {
      test.skip(true, 'Nav anchor links hidden under 900px viewport.');
    }
    for (const id of ['produto', 'numeros', 'equipe']) {
      const link = page.locator(`.nav a[href="#${id}"]`);
      if (await link.count() === 0) continue;
      await link.first().click();
      const target = page.locator(`#${id}`);
      await expect(target).toBeVisible();
    }
  });
});
