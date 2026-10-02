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
  await page.waitForSelector('.rail-title');
  await page.waitForSelector('#s-s_sepuede .row');
  await page.waitForTimeout(900);
  const snap = async (name, opts = {}) => { await page.screenshot({ path: T + name + '.png', ...opts }); };
  // The menu is the opening screen
  log('landing menu open:', await page.evaluate(() => document.querySelector('#menu').classList.contains('is-open')), '| bg opacity', await page.evaluate(() => getComputedStyle(document.querySelector('#menu-bg')).opacity));
  await snap('v5-00-landing-menu');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await snap('v2-01-admin-top');
  log('title:', await page.textContent('.rail-title'), '| scheme', await page.evaluate(() => document.documentElement.dataset.scheme));

  // 1. Rail click -> scroll to Se puede; check adaptive ink
  await page.click('.sub[data-id="s_sepuede"]');
  await page.waitForTimeout(1600);
  log('active after click:', await page.evaluate(() => document.querySelector('.sub.is-active')?.dataset.id), 'hash', await page.evaluate(() => location.hash));
  log('ink over blue: title=', await page.evaluate(() => document.querySelector('.rail-title').dataset.ink), 'menuBtn=', await page.evaluate(() => document.querySelector('#btn-menu').dataset.ink));
  await snap('v2-02-over-blue');

  // 2. Add fullscreen image to Direccion with overlay text
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.click('#s-s_direccion [data-action="adder-open"]');
  await page.click('#s-s_direccion [data-action="adder-layout"][data-layout="fullscreen"]');
  await page.waitForSelector('.row.is-editing .fs-media.slot-picker');
  await page.click('.row.is-editing [data-action="pick-type"][data-type="image"]');
  await page.setInputFiles('.row.is-editing input[data-upload]', FIX + 'hero.jpg');
  await page.waitForSelector('.row.is-editing .fs-media img.is-loaded');
  await page.click('#insp [data-action="ov-add"]');
  await page.waitForSelector('.row.is-editing .fs-overlay .tb[data-block]');
  const ob = page.locator('.row.is-editing .fs-overlay .tb[data-block]');
  await ob.nth(0).click(); await page.keyboard.type('Our Brand');
  await page.fill('#f-size', '160'); await page.dispatchEvent('#f-size', 'input');
  await page.click('#insp [data-k="pos"][data-v="br"]');
  await page.click('#insp [data-k="ow"][data-v="content"]');
  await page.click('#insp [data-k="align"][data-v="right"]');
  await page.click('#insp [data-k="ink"][data-v="light"]');
  await page.locator('#insp [data-action="tab"]').first().click();
  await page.fill('#insp input[data-f="dim"]', '20'); await page.dispatchEvent('#insp input[data-f="dim"]', 'input');
  await page.waitForTimeout(300);
  await snap('v2-03-fs-edit');
  const fsSize = await page.evaluate(() => getComputedStyle(document.querySelector('.row.is-editing .fs-overlay .tb')).fontSize);
  log('overlay font size computed:', fsSize, 'family:', await page.evaluate(() => getComputedStyle(document.querySelector('.row.is-editing .fs-overlay .tb')).fontFamily));
  const dimRail = await page.evaluate(() => getComputedStyle(document.querySelector('.rail')).opacity);
  log('rail opacity while editing:', dimRail);
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(500);
  // move it to top
  const fsRow = page.locator('#s-s_direccion .row[data-layout="fullscreen"]');
  await fsRow.hover();
  await fsRow.locator('[data-action="row-up"]').click();
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  log('starts-full:', await page.evaluate(() => document.querySelector('#stage').classList.contains('starts-full')));
  log('ink over photo: title=', await page.evaluate(() => document.querySelector('.rail-title').dataset.ink), 'photo?', await page.evaluate(() => 'photo' in document.querySelector('.rail-title').dataset));

  // 3. Edit the text row with inspector
  const tRow = page.locator('#s-s_direccion .row[data-layout="full"]').first();
  await tRow.scrollIntoViewIfNeeded();
  await tRow.hover();
  await tRow.locator('[data-action="row-edit"]').click();
  await page.waitForSelector('#insp:not([hidden]) .insp-body');
  const tb = page.locator('.row.is-editing .tb[data-block]');
  await tb.nth(1).click();
  await page.click('#insp [data-k="font"][data-v="phudu"]');
  await page.click('#insp [data-k="upper"][data-v="true"]');
  // dropdown weight
  await page.click('#insp [data-action="dd"][data-k="weight"]');
  await page.click('#pop [data-action="dd-pick"][data-v="900"]');
  // scrub size
  const k = await page.locator('#insp [data-scrub="size"]').boundingBox();
  await page.mouse.move(k.x + 10, k.y + 10); await page.mouse.down(); await page.mouse.move(k.x + 70, k.y + 10, { steps: 6 }); await page.mouse.up();
  await page.fill('#f-lh', '90'); await page.dispatchEvent('#f-lh', 'input');
  await page.fill('#f-ls', '-3.5'); await page.dispatchEvent('#f-ls', 'input');
  log('pressed font/upper:', await page.evaluate(() => [...document.querySelectorAll('#insp [data-k="font"][aria-pressed="true"], #insp [data-k="upper"][aria-pressed="true"]')].map(b => b.dataset.v).join(',')));
  const st = await page.evaluate(() => { const el = document.querySelector('.row.is-editing .tb.is-active'); const cs = getComputedStyle(el); return { fs: el.style.getPropertyValue('--fs'), w: cs.fontWeight, lh: el.style.lineHeight, ls: el.style.letterSpacing, ff: cs.fontFamily, tt: cs.textTransform }; });
  log('block style after inspector:', JSON.stringify(st));
  // drag height
  const hz = await page.locator('.row.is-editing .rz').boundingBox();
  await page.mouse.move(hz.x + hz.width / 2, hz.y + hz.height / 2); await page.mouse.down(); await page.mouse.move(hz.x + hz.width / 2, hz.y + 220, { steps: 8 });
  await snap('v2-04-text-edit');
  await page.mouse.up();
  log('row h after drag:', await page.evaluate(() => document.querySelector('.row.is-editing').style.getPropertyValue('--h')), 'field:', await page.inputValue('#f-h'));
  await page.click('#insp [data-action="confirm-edit"]');
  await page.waitForTimeout(400);

  // 4. Half row with text + carousel in "Poder"
  await page.click('.sub[data-id="s_poder"]');
  await page.waitForTimeout(1300);
  await page.click('#s-s_poder [data-action="adder-open"]');
  await page.click('#s-s_poder [data-action="adder-layout"][data-layout="half"]');
  await page.waitForSelector('.row.is-editing .slot-picker');
  await page.locator('.row.is-editing .slot-picker').nth(0).locator('[data-type="text"]').click();
  await page.locator('.row.is-editing .slot-picker [data-type="carousel"]').click();
  await page.waitForTimeout(400);
  await page.setInputFiles('.row.is-editing .dropzone input[data-upload]', [1, 2, 3, 4].map(i => FIX + `img${i}.jpg`));
  await page.waitForSelector('.row.is-editing .thumbs .thumb[data-index="3"]');
  await page.fill('#f-pace', '1.5'); await page.dispatchEvent('#f-pace', 'input');
  const tb2 = page.locator('.row.is-editing .tb[data-block]');
  await tb2.nth(1).click(); await page.keyboard.type('Todas tus monedas');
  await tb2.nth(2).click(); await page.keyboard.type('Una billetera. Muchas formas de tener dinero.');
  await page.click('[data-action="confirm-edit"]');
  await page.waitForTimeout(600);
  const car = page.locator('#s-s_poder .carousel').first();
  await car.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2600);
  log('player after ~2.6s autoplay:', await page.evaluate(() => { const d = [...document.querySelectorAll('#s-s_poder .spl-dot')]; return d.map(x => x.getAttribute('aria-current')).join(',') + ' | track ' + document.querySelector('#s-s_poder .car-track').style.transform; }));
  await snap('v2-05-carousel');
  // click dot 4
  await page.locator('#s-s_poder .spl-dot').nth(3).click();
  await page.waitForTimeout(800);
  log('after dot click:', await page.evaluate(() => [...document.querySelectorAll('#s-s_poder .spl-dot')].findIndex(x => x.getAttribute('aria-current') === 'step')));
  await page.locator('#s-s_poder .spl-go').click();
  await page.waitForTimeout(300);
  log('playing after toggle?', await page.evaluate(() => document.querySelector('#s-s_poder .spl-go').getAttribute('aria-label')));

  // 5. Menu
  await page.click('#btn-menu');
  await page.waitForTimeout(800);
  await snap('v2-06-menu');
  log('menu items:', await page.evaluate(() => [...document.querySelectorAll('.ov-cat')].map(b => b.textContent).join(' / ')), '| ink', await page.evaluate(() => document.querySelector('.ov-item').dataset.ink));
  await page.click('#menu [data-action="scheme"][data-scheme="dark"]');
  await page.waitForTimeout(500);
  log('scheme after toggle:', await page.evaluate(() => document.documentElement.dataset.scheme));
  await page.click('#menu [data-action="menu-bg"][data-kind="theme"]');
  await page.waitForTimeout(300);
  await snap('v2-07-menu-dark-theme-bg');
  log('menu ink on theme bg (dark):', await page.evaluate(() => document.querySelector('.ov-item').dataset.ink));
  await page.click('#menu [data-action="menu-bg"][data-kind="brand"]');
  await page.click('#menu [data-action="mode"][data-mode="viewer"]');
  await page.waitForTimeout(400);
  await page.click('#menu-close');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await snap('v2-08b-viewer-top');
  log('viewer top inks: menuBtn', await page.evaluate(() => document.querySelector('#btn-menu').dataset.ink), 'search', await page.evaluate(() => document.querySelector('#btn-search').dataset.ink));
  const adminVisible = await page.evaluate(() => [...document.querySelectorAll('.admin-only')].filter(e => e.getClientRects().length).length);
  log('admin-only visible in viewer:', adminVisible, '| empty subs dimmed:', await page.evaluate(() => document.querySelectorAll('.sub.is-empty').length));
  await snap('v2-08-viewer-dark-full', { fullPage: true });

  // 6. Search
  await page.click('#btn-search');
  await page.waitForTimeout(400);
  await snap('v2-09-search-empty');
  await page.keyboard.type('billetera');
  await page.waitForTimeout(300);
  log('search results:', await page.evaluate(() => document.querySelectorAll('.sr').length));
  await snap('v2-10-search');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1800);
  log('after search go: active', await page.evaluate(() => document.querySelector('.sub.is-active')?.dataset.id), 'flash', await page.evaluate(() => !!document.querySelector('.row.is-flash')));

  // 7. Category switch
  await page.click('#btn-menu');
  await page.waitForTimeout(700);
  await page.click('.ov-cat[data-id="c_voice"]');
  await page.waitForTimeout(700);
  log('category now:', await page.textContent('.rail-title'), '| stage note:', await page.evaluate(() => document.querySelector('.empty-note h2')?.textContent));

  // 8. Light + mobile
  await page.click('#btn-menu'); await page.waitForTimeout(600);
  await page.click('#menu [data-action="scheme"][data-scheme="light"]');
  await page.click('.ov-cat[data-id="c_ourbrand"]');
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await snap('v2-11-mobile-top');
  log('mobile overflow px:', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  await page.click('#btn-menu'); await page.waitForTimeout(800);
  await snap('v2-12-mobile-menu');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  log('ERRORS:', JSON.stringify(errors, null, 1));
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
