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
  const vis = getComputedStyle(ov).visibility;
  const items = [...ov.querySelectorAll('.ov-item')].map(i => (+getComputedStyle(i).opacity).toFixed(2)).join(',');
  const top = (+getComputedStyle(ov.querySelector('.ov-top')).opacity).toFixed(2);
  const bottom = (+getComputedStyle(ov.querySelector('.ov-bottom')).opacity).toFixed(2);
  const clip = getComputedStyle(bg).clipPath;
  const inner = (+getComputedStyle(ov.querySelector('.ov-inner')).opacity).toFixed(2);
  return `vis=${vis} top=${top} items=[${items}] bottom=${bottom} inner=${inner} clip=${clip.slice(0, 40)} running=${ov.getAnimations({ subtree: true }).filter(a => a.playState !== 'finished').length}`;
});
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
  let frames;
  if (!stalled) frames = page.evaluate(() => new Promise(res => { const d = []; let last = performance.now(); const t0 = last; const f = (t) => { d.push(t - last); last = t; if (t - t0 < 1000) requestAnimationFrame(f); else res(d); }; requestAnimationFrame(f); }));
  await page.click('#btn-menu');
  await page.waitForTimeout(120);
  log(tag, 'open +120ms :', await state(page));
  if (!stalled) await page.screenshot({ path: T + 'v4-menu-mid.png' });
  await page.waitForTimeout(1300);
  log(tag, 'open +1.4s  :', await state(page));
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
  // category click closes and navigates
  await page.click('.ov-cat[data-id="c_voice"]');
  await page.waitForTimeout(900);
  log(tag, 'after category:', await state(page), '| title:', await page.textContent('.rail-title'));
  log(tag, 'errors:', JSON.stringify(errors));
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch();
  await scenario(browser, false);
  await scenario(browser, true);
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
