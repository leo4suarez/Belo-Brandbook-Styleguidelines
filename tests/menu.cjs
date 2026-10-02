const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const FIX = path.join(__dirname, 'fixtures') + path.sep;
const T = path.join(__dirname, 'output') + path.sep;
fs.mkdirSync(T, { recursive: true });
const BASE = process.env.BASE_URL || 'http://localhost:8765/index.html';
const log = (...a) => console.log(...a);
const state = (page) => page.evaluate(() => {
  const ov = document.querySelector('#menu'); const bg = document.querySelector('#menu-bg');
  const vis = getComputedStyle(ov).display;
  const items = [...ov.querySelectorAll('.ov-item')].map(i => (+getComputedStyle(i).opacity).toFixed(2)).join(',');
  const top = (+getComputedStyle(ov.querySelector('.ov-top')).opacity).toFixed(2);
  const bottom = (+getComputedStyle(ov.querySelector('.ov-bottom')).opacity).toFixed(2);
  const bgop = (+getComputedStyle(bg).opacity).toFixed(2);
  const inner = (+getComputedStyle(ov.querySelector('.ov-inner')).opacity).toFixed(2);
  return `display=${vis} top=${top} items=[${items}] bottom=${bottom} inner=${inner} bg=${bgop} running=${ov.getAnimations({ subtree: true }).filter(a => a.playState !== 'finished').length}`;
});
// Every part of an open menu must be painted: visible and opaque. Chrome once kept a stale inherited
// visibility:hidden on animated parts (background, top bar, controls) while the category names showed.
const undrawn = (page) => page.evaluate(() => ['#menu-bg', '#menu .ov-top', '#menu-close', '#menu .ov-list', '#menu .ov-item', '#menu .ov-bottom']
  .flatMap(sel => [...document.querySelectorAll(sel)].map(el => [sel, getComputedStyle(el)]))
  .filter(([, cs]) => cs.visibility !== 'visible' || cs.opacity !== '1' || cs.display === 'none')
  .map(([sel, cs]) => `${sel}(vis=${cs.visibility},op=${cs.opacity})`));
let failures = 0;
const expectDrawn = async (page, what) => { const bad = await undrawn(page); log((bad.length ? 'FAIL ' : 'ok   ') + what + (bad.length ? ': ' + bad.join(' ') : '')); if (bad.length) failures++; };
async function scenario(browser, stalled) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
  if (stalled) await ctx.addInitScript(() => { const o = Element.prototype.animate; Element.prototype.animate = function (...a) { const an = o.apply(this, a); if (this.closest && this.closest('.ov')) an.pause(); return an; }; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/lenis/, r => r.fulfill({ path: FIX + 'lenis.min.js', contentType: 'text/javascript' }));
  await page.goto(BASE);
  await page.waitForSelector('#s-s_sepuede .row');
  await page.waitForTimeout(500);
  const tag = stalled ? 'STALLED' : 'NORMAL';
  await page.waitForTimeout(1200);
  await expectDrawn(page, tag + ' opening screen');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); // close the opening menu
  let frames;
  if (!stalled) frames = page.evaluate(() => new Promise(res => { const d = []; let last = performance.now(); const t0 = last; const f = (t) => { d.push(t - last); last = t; if (t - t0 < 1000) requestAnimationFrame(f); else res(d); }; requestAnimationFrame(f); }));
  await page.click('#btn-menu');
  await page.waitForTimeout(120);
  log(tag, 'open +120ms :', await state(page));
  if (!stalled) await page.screenshot({ path: T + 'v4-menu-mid.png' });
  await page.waitForTimeout(1300);
  log(tag, 'open +1.4s  :', await state(page));
  await expectDrawn(page, tag + ' open with the button');
  if (frames) { const d = (await frames).slice(1); log(tag, 'frames', d.length, 'max', Math.round(Math.max(...d)), 'ms, >34ms:', d.filter(x => x > 34).length); }
  await page.screenshot({ path: T + `v4-menu-${tag}.png` });
  await page.click('#menu-close');
  await page.waitForTimeout(900);
  log(tag, 'closed +0.9s:', await state(page));
  // fast open/close/open
  await page.click('#btn-menu'); await page.waitForTimeout(80);
  await page.keyboard.press('Escape'); await page.waitForTimeout(50);
  await page.click('#btn-menu'); await page.waitForTimeout(1500);
  log(tag, 'reopen +1.5s:', await state(page));
  await expectDrawn(page, tag + ' fast close and reopen');
  // category click closes and navigates
  await page.click('.ov-cat[data-id="c_voice"]');
  await page.waitForTimeout(900);
  log(tag, 'after category:', await state(page), '| title:', await page.textContent('.rail-title'));
  log(tag, 'errors:', JSON.stringify(errors));
  // The production case: reload, close the opening menu while it is still animating in, open it again.
  await page.reload(); await page.waitForSelector('#menu.is-open'); await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); await page.waitForTimeout(120);
  await page.click('#btn-menu'); await page.waitForTimeout(1500);
  await expectDrawn(page, tag + ' reopen right after the opening screen');
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch();
  await scenario(browser, false);
  await scenario(browser, true);
  await browser.close();
  if (failures) { console.error(`${failures} menu check(s) failed`); process.exit(1); }
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
