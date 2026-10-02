const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const FIX = path.join(__dirname, 'fixtures') + path.sep;
const T = path.join(__dirname, 'output') + path.sep;
fs.mkdirSync(T, { recursive: true });
const BASE = process.env.BASE_URL || 'http://localhost:8765/index.html';
const log = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/lenis/, r => r.fulfill({ path: FIX + 'lenis.min.js', contentType: 'text/javascript' }));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(BASE);
  await page.waitForSelector('#s-s_sepuede .row');
  await page.waitForTimeout(400);
  const snap = async (name, opts = {}) => { await page.screenshot({ path: T + name + '.png', ...opts }); };
  // Lenis keeps easing the page after programmatic scrolls; wait for it so clicks land where the element is.
  const scrollIdle = () => page.waitForFunction(() => !document.documentElement.classList.contains('lenis-scrolling'), null, { timeout: 5000 }).catch(() => {});

  // Section divider
  log('divider:', await page.evaluate(() => { const m = document.querySelector('#s-s_poder .sec-mark'); const cs = getComputedStyle(m); return cs.borderTopStyle + ' ' + cs.borderTopWidth + ' text="' + m.textContent + '"'; }));

  // Chooser
  await page.click('#s-s_poder [data-action="adder-open"]');
  await page.waitForTimeout(400);
  log('chooser order:', await page.evaluate(() => [...document.querySelectorAll('#s-s_poder .ac-opt')].map(b => b.dataset.layout).join(',')), '| card heights:', await page.evaluate(() => [...document.querySelectorAll('#s-s_poder .ac-opt')].map(b => Math.round(b.getBoundingClientRect().height)).join(',')));
  await page.locator('#s-s_poder .adder').scrollIntoViewIfNeeded();
  await page.hover('#s-s_poder .ac-opt[data-layout="fullscreen"]');
  await page.waitForTimeout(300);
  await snap('v3-01-chooser');

  // New fullscreen: back with empty history -> chooser
  await scrollIdle();
  await page.click('#s-s_poder .ac-opt[data-layout="fullscreen"]');
  await page.waitForSelector('#insp:not([hidden]) #insp-back');
  log('types bar on:', await page.evaluate(() => document.querySelector('#types').classList.contains('is-on')), 'buttons:', await page.evaluate(() => [...document.querySelectorAll('#types button')].map(b => b.dataset.type).join(',')));
  await page.click('#insp-back');
  await page.waitForTimeout(300);
  await scrollIdle();
  log('after back at start: editing?', await page.evaluate(() => !!document.querySelector('.row.is-editing')), '| chooser open?', await page.evaluate(() => !!document.querySelector('#s-s_poder .adder-choose')));

  // Again: fullscreen -> image via types bar -> upload -> overlay -> undo/redo
  await page.click('#s-s_poder .ac-opt[data-layout="fullscreen"]');
  await page.waitForSelector('#types.is-on');
  await page.click('#types [data-type="image"]');
  await page.setInputFiles('.row.is-editing input[data-upload]', FIX + 'hero.jpg');
  await page.waitForSelector('.row.is-editing .fs-media img.is-loaded');
  await page.click('#types [data-type="color"]');
  await page.waitForTimeout(200);
  log('switched to color:', await page.evaluate(() => document.querySelector('.row.is-editing .fs-media').dataset.kind));
  await page.click('#types [data-type="image"]');
  await page.waitForTimeout(300);
  log('back to image keeps upload:', await page.evaluate(() => !!document.querySelector('.row.is-editing .fs-media img')));
  await page.click('#insp [data-action="ov-add"]');
  await page.waitForSelector('.row.is-editing .fs-overlay .tb[data-block]');
  await page.locator('.row.is-editing .fs-overlay .tb[data-block]').first().click();
  await page.keyboard.type('Hola');
  await page.waitForTimeout(900);
  await page.fill('#f-size', '140'); await page.dispatchEvent('#f-size', 'input');
  await page.waitForTimeout(200);
  await snap('v3-02-panel');
  const sizeNow = () => page.evaluate(() => document.querySelector('.row.is-editing .fs-overlay .tb').style.getPropertyValue('--fs'));
  log('size before undo:', await sizeNow());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  log('size after 1 undo:', await sizeNow());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  log('text after 2 undo:', await page.evaluate(() => document.querySelector('.row.is-editing .fs-overlay .tb')?.textContent));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  log('overlay after 3 undo:', await page.evaluate(() => !!document.querySelector('.row.is-editing .fs-overlay')));
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  log('overlay after redo:', await page.evaluate(() => !!document.querySelector('.row.is-editing .fs-overlay')));
  await page.click('#insp-back');
  await page.waitForTimeout(300);
  log('after back button: overlay?', await page.evaluate(() => !!document.querySelector('.row.is-editing .fs-overlay')));
  await page.click('[data-action="confirm-edit"]');
  await page.waitForTimeout(400);
  log('confirmed rows in poder:', await page.evaluate(() => document.querySelectorAll('#s-s_poder .row').length));

  // Inline input (sub) has no container
  await page.click('[data-action="add-sub"]');
  await page.waitForSelector('#inline-input');
  log('inline input border:', await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('#inline-input')); return cs.borderTopWidth + ' ' + cs.backgroundColor + ' pad ' + cs.paddingLeft; }));
  await page.keyboard.type('Logotipo');
  await snap('v3-03-inline');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  log('new section adder label:', await page.evaluate(() => [...document.querySelectorAll('.adder-btn span:last-child')].pop().textContent));

  // Menu animation frame timing
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const frames = page.evaluate(() => new Promise(res => { const d = []; let last = performance.now(); const t0 = last; const f = (t) => { d.push(t - last); last = t; if (t - t0 < 900) requestAnimationFrame(f); else res(d); }; requestAnimationFrame(f); }));
  await page.click('#btn-menu');
  const d = await frames;
  d.shift();
  log('menu open frames:', d.length, 'max frame ms:', Math.round(Math.max(...d)), 'over 34ms:', d.filter(x => x > 34).length);
  await page.waitForTimeout(200);
  await snap('v3-04-menu');
  await page.click('#menu-close');
  await page.waitForTimeout(600);
  log('menu closed vis:', await page.evaluate(() => getComputedStyle(document.querySelector('#menu')).visibility));

  // Edit an existing row: back disabled at start
  const r = page.locator('#s-s_direccion .row').first();
  await r.hover(); await r.locator('[data-action="row-edit"]').click();
  await page.waitForSelector('#insp-back');
  log('back disabled at start of existing edit:', await page.evaluate(() => document.querySelector('#insp-back').disabled));
  await page.click('[data-action="cancel-edit"]');
  await page.waitForTimeout(300);

  // Mobile panel
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const r2 = page.locator('#s-s_direccion .row').first();
  await r2.scrollIntoViewIfNeeded();
  await r2.locator('[data-action="row-edit"]').click({ force: true });
  await page.waitForTimeout(500);
  await snap('v3-05-mobile-edit');
  log('mobile overflow px:', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  log('ERRORS:', JSON.stringify(errors, null, 1));
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
