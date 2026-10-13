// Media modules: image framing (box vs image, Encuadrar mode), the SVG module, color swatches in normal rows, click
// interactions (copy, modal, download) and downloadable source files.
// The local demo covers the editing and viewing flows; the fake Supabase project (tests/fake-supabase.cjs) covers what
// is stored: framing and files surviving a reload, the bucket keeping or freeing source files, and named downloads.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { FakeSupabase } = require('./fake-supabase.cjs');
const FIX = path.join(__dirname, 'fixtures') + path.sep;
const T = path.join(__dirname, 'output') + path.sep;
fs.mkdirSync(T, { recursive: true });
const BASE = process.env.BASE_URL || 'http://localhost:8765/index.html';
const SUPA_BASE = process.env.SUPA_BASE_URL || 'http://localhost:8766/index.html';
const SUPA_URL = process.env.SUPA_URL || 'https://belotest.supabase.co';
const SB_JS = require.resolve('@supabase/supabase-js/dist/umd/supabase.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
const sizeOf = (f) => fs.statSync(FIX + f).size;

async function routes(ctx) {
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/lenis/, r => r.fulfill({ path: FIX + 'lenis.min.js', contentType: 'text/javascript' }));
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/gsap@[^/]+\/dist\/(gsap|ScrollTrigger|SplitText)\.min\.js/, r => r.fulfill({ path: FIX + r.request().url().split('/').pop(), contentType: 'text/javascript' }));
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js/, r => r.fulfill({ path: SB_JS, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
}
function watch(page, errors) {
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|ERR_CONNECTION_RESET|Failed to fetch/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
}
/* Helpers bound to one page */
function kit(page) {
  const k = {};
  k.scrollIdle = () => page.waitForFunction(() => !document.documentElement.classList.contains('lenis-scrolling'), null, { timeout: 5000 }).catch(() => {});
  k.has = (sel) => page.locator('#insp ' + sel).count().then(n => n > 0);
  k.pressed = (key) => page.evaluate((key) => (document.querySelector(`#insp [data-action="seg"][data-k="${key}"][aria-pressed="true"]`) || {}).dataset?.v ?? null, key);
  k.toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent));
  k.range = (sel, v) => page.locator(sel).first().evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  k.field = async (key, v) => { await page.fill('#f-' + key, String(v)); await page.dispatchEvent('#f-' + key, 'input'); await page.dispatchEvent('#f-' + key, 'change'); };
  k.confirm = async () => { await page.keyboard.press('Control+Enter'); await page.waitForTimeout(500); };
  k.cancel = async () => { await page.click('#insp [data-action="cancel-edit"]'); await page.waitForTimeout(600); };
  k.view = (v) => page.click(`#insp [data-action="insp-view"][data-v="${v}"]`);
  k.newRow = async (sub, layout) => {
    await page.locator(`#s-${sub} [data-action="adder-open"]`).scrollIntoViewIfNeeded(); await k.scrollIdle();
    await page.click(`#s-${sub} [data-action="adder-open"]`);
    await page.click(`#s-${sub} [data-action="adder-layout"][data-layout="${layout}"]`);
    await page.waitForSelector('#insp:not([hidden]) .insp-body');
  };
  k.edit = async (row) => {
    await row.scrollIntoViewIfNeeded(); await k.scrollIdle();
    await row.hover(); await row.locator('[data-action="row-edit"]').click();
    await page.waitForSelector('#insp:not([hidden]) .insp-body');
  };
  /* Where the image of a module is drawn, relative to its box */
  k.geo = (sel) => page.evaluate((sel) => {
    const s = document.querySelector(sel), i = s.querySelector(':scope > img'), a = s.getBoundingClientRect(), b = i.getBoundingClientRect();
    return { w: a.width, h: a.height, x: b.left - a.left, y: b.top - a.top, iw: b.width, ih: b.height, framed: s.classList.contains('is-framed') };
  }, sel);
  k.mode = async (m) => {
    await page.evaluate(() => scrollTo(0, 0)); await k.scrollIdle();
    await page.click('#btn-menu'); await page.waitForTimeout(700);
    await page.click(`#menu [data-action="mode"][data-mode="${m}"]`); await page.waitForTimeout(300);
    await page.click('#menu-close'); await page.waitForTimeout(700);
  };
  return k;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  await routes(ctx);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const page = await ctx.newPage();
  const errors = []; watch(page, errors);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(BASE + '#s_poder');
  await page.waitForSelector('#s-s_poder [data-action="adder-open"]');
  await page.waitForTimeout(800);
  const k = kit(page);
  const rows = page.locator('#s-s_poder .row');
  const lastRow = async () => page.locator(`#s-s_poder .row[data-id="${await rows.last().getAttribute('data-id')}"]`);

  // 1. The module picker of a normal row offers SVG and Color; a full-screen background does not offer SVG
  await k.newRow('s_poder', 'full');
  const picks = await page.$$eval('.row.is-editing [data-action="pick-type"]', b => b.map(x => x.dataset.type));
  check(picks.includes('svg') && picks.includes('color'), 'a normal module can hold an SVG or a color (' + picks.join(', ') + ')');
  await k.cancel();
  await k.newRow('s_poder', 'fullscreen');
  const fsPicks = await page.$$eval('.row.is-editing [data-action="pick-type"]', b => b.map(x => x.dataset.type));
  check(!fsPicks.includes('svg') && fsPicks.includes('color'), 'a full-screen background offers no SVG');
  await k.cancel();

  // 2. Image framing: the box (Contenedor) apart from the image inside it (Imagen)
  await k.newRow('s_poder', 'full');
  await page.click('.row.is-editing [data-action="pick-type"][data-type="image"]');
  await page.setInputFiles('.row.is-editing input[data-upload]', FIX + 'hero.jpg');
  await page.waitForSelector('.row.is-editing img.is-loaded');
  const img = '.row.is-editing .slot.media';
  check(await page.locator('#insp .insp-sec h4', { hasText: 'Contenedor' }).count() === 1 && await k.has('select[data-f="ratio"]'), 'the box has its own section with the proportion');
  check(await k.has('[data-k="ffit"]') && await k.has('input[data-f="fzoom"]') && await k.has('[data-k="fpos"]') && await k.has('#f-fx') && await k.has('#f-fy') && await k.has('[data-action="frame-mode"]'), 'the image section has fit, scale, focal point and Encuadrar');
  check(await page.isDisabled('#insp [data-action="frame-reset"]'), 'Restablecer starts disabled');
  check(/hero\.jpg/.test(await page.textContent('#insp .file-meta')), 'the file row shows the original file name');
  let g = await k.geo(img);
  check(!g.framed && near(g.x, 0) && near(g.iw, g.w) && near(g.ih, g.h), 'an untouched image fills its box exactly as before');
  await page.click('#insp [data-action="seg"][data-k="fpos"][data-v="tl"]');
  await k.range('#insp input[data-f="fzoom"]', 200);
  g = await k.geo(img);
  check(g.framed && near(g.x, 0) && near(g.y, 0) && near(g.iw, 2 * g.w) && near(g.ih, 2 * g.h), `scale 200% from the top-left corner doubles the image inside the same box (${Math.round(g.iw)}×${Math.round(g.ih)} in ${Math.round(g.w)}×${Math.round(g.h)})`);
  await page.click('#insp [data-action="seg"][data-k="fpos"][data-v="br"]');
  g = await k.geo(img);
  check(near(g.x, -g.w) && near(g.y, -g.h) && await page.inputValue('#f-fx') === '100' && await page.inputValue('#f-fy') === '100', 'the bottom-right focal point shows the opposite corner and fills X / Y');
  await k.field('fx', 25);
  g = await k.geo(img);
  check(near(g.x, -.25 * g.w) && await k.pressed('fpos') === null, 'X moves the image and leaves the matrix without a preset');
  check(await page.evaluate((sel) => { const i = document.querySelector(sel + ' > img'); return getComputedStyle(i).transform === 'none' && getComputedStyle(document.querySelector(sel)).transform === 'none'; }, img), 'framing never uses transform on the module or its image');

  // Encuadrar: drag to pan, wheel to zoom, ghosted overflow, one undo step per gesture, Esc leaves
  await page.click('#insp [data-action="frame-mode"]');
  check(await page.locator('.row.is-editing .slot.is-framing .frame-bar').count() === 1 && await page.locator('#frame-ghost:not([hidden]) img').count() === 1, 'Encuadrar shows the bar on the image and the ghosted overflow');
  const ghostOk = await page.evaluate(() => { const gi = document.querySelector('#frame-ghost img').getBoundingClientRect(), i = document.querySelector('.row.is-editing .slot.is-framing > img').getBoundingClientRect(); return Math.abs(gi.left - i.left) < 2 && Math.abs(gi.width - i.width) < 2 && Math.abs(gi.top - i.top) < 2; });
  check(ghostOk, 'the ghost lines up with the framed image');
  await page.screenshot({ path: T + 'media-01-framing.png' });
  const bx = await page.locator('.row.is-editing .slot.is-framing').boundingBox();
  const fx0 = +(await page.inputValue('#f-fx')), fy0 = +(await page.inputValue('#f-fy'));
  await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 3);
  await page.mouse.down(); await page.mouse.move(bx.x + bx.width / 2 + 180, bx.y + bx.height / 3 + 90, { steps: 6 }); await page.mouse.up();
  const fx1 = +(await page.inputValue('#f-fx')), fy1 = +(await page.inputValue('#f-fy'));
  check(fx1 < fx0 && fy1 < fy0, `dragging right and down pans toward the top-left (${fx0},${fy0} → ${fx1},${fy1})`);
  await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
  await page.mouse.wheel(0, -200); await page.waitForTimeout(200);
  const z1 = +(await page.inputValue('#insp input[data-f="fzoom"]'));
  check(z1 > 200 && await page.textContent('.frame-bar output') === z1 + '%', `the wheel zooms in and the bar follows (${z1}%)`);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(250);
  check(+(await page.inputValue('#insp input[data-f="fzoom"]')) === 200 && +(await page.inputValue('#f-fx')) === fx1, 'undo takes back the zoom only');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(250);
  check(+(await page.inputValue('#f-fx')) === fx0 && +(await page.inputValue('#f-fy')) === fy0 && await page.locator('.slot.is-framing').count() === 1, 'a second undo takes back the whole drag, still framing');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check(await page.locator('.slot.is-framing').count() === 0 && await page.locator('#frame-ghost[hidden]').count() === 1 && await page.locator('#insp:not([hidden])').count() === 1, 'Esc leaves Encuadrar and keeps editing');
  await page.click('#insp [data-action="frame-mode"]');
  await page.click('.frame-bar [data-action="frame-mode"]');
  check(await page.locator('.slot.is-framing').count() === 0 && /Encuadrar/.test(await page.textContent('#insp [data-action="frame-mode"]')), 'Listo leaves Encuadrar too');
  const want = { x: +(await page.inputValue('#f-fx')), y: +(await page.inputValue('#f-fy')) };
  await k.confirm();
  const imgRow = await lastRow();
  const imgView = `#s-s_poder .row[data-id="${await imgRow.getAttribute('data-id')}"] .slot.media`;
  await imgRow.scrollIntoViewIfNeeded(); await k.scrollIdle(); await page.waitForTimeout(300);
  g = await k.geo(imgView);
  check(g.framed && near(g.iw, 2 * g.w) && near(g.x, -want.x / 100 * g.w) && near(g.y, -want.y / 100 * g.h), 'the framing is kept after confirming');
  await k.edit(imgRow);
  check(await page.inputValue('#f-fx') === String(want.x) && !(await page.isDisabled('#insp [data-action="frame-reset"]')), 'reopening shows the stored framing');
  await page.click('#insp [data-action="frame-reset"]');
  g = await k.geo(img);
  check(!g.framed && near(g.iw, g.w) && await page.isDisabled('#insp [data-action="frame-reset"]'), 'Restablecer brings back the untouched image');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(250);
  check((await k.geo(img)).framed, 'undo brings the framing back');

  // The zoom preset still runs on a framed image, and leaves it framed
  await k.view('anim');
  await page.selectOption('#insp select[data-f="menter"]', 'zoom');
  await page.click('#insp [data-action="anim-preview"]');
  const during = await until(() => page.evaluate(() => { const t = getComputedStyle(document.querySelector('.row.is-editing .slot.media > img')).transform; return t !== 'none' && t.startsWith('matrix'); }), 2000);
  check(during, 'the zoom preset scales the framed image while it plays');
  await page.waitForFunction(() => !document.querySelector('.row.is-editing.is-previewing'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  g = await k.geo(img);
  check(g.framed && near(g.iw, 2 * g.w) && await page.evaluate(() => getComputedStyle(document.querySelector('.row.is-editing .slot.media > img')).transform === 'none'), 'after the preset the image is framed as before, without transform');
  await k.view('design');
  await k.cancel();

  // 3. Adaptive ink follows the framing: a full-screen image, half light and half dark
  await k.newRow('s_poder', 'fullscreen');
  await page.click('.row.is-editing [data-action="pick-type"][data-type="image"]');
  await page.setInputFiles('.row.is-editing input[data-upload]', FIX + 'split.jpg');
  await page.waitForSelector('.row.is-editing img.is-loaded');
  check(await k.has('[data-k="ffit"]') && !(await k.has('select[data-f="ratio"]')), 'a full-screen image has the image section, and its box is the block');
  await k.range('#insp input[data-f="fzoom"]', 200);
  await page.click('#insp [data-action="seg"][data-k="fpos"][data-v="ml"]');
  await k.confirm();
  const fsRow = page.locator('#s-s_poder .row[data-layout="fullscreen"]');
  const toTop = async () => { await fsRow.evaluate(el => scrollTo(0, el.getBoundingClientRect().top + scrollY)); await page.waitForTimeout(900); };
  const railInk = () => page.getAttribute('#btn-menu', 'data-ink');
  await toTop();
  check(await railInk() === 'dark', 'framed on the light half, the menu buttons turn dark');
  await k.edit(fsRow);
  await page.click('#insp [data-action="seg"][data-k="fpos"][data-v="mr"]');
  await k.confirm();
  await toTop();
  check(await railInk() === 'light', 'framed on the dark half, they turn light');
  await page.screenshot({ path: T + 'media-02-fs-framed.png' });
  await k.edit(fsRow);
  await page.click('#insp [data-action="frame-mode"]');
  check(await page.locator('.row.is-editing .fs-media.is-framing .frame-bar').count() === 1, 'a full-screen background can be framed on the canvas too');
  await page.keyboard.press('Escape');
  await k.cancel();
  await fsRow.hover(); await fsRow.locator('[data-action="row-delete"]').click(); await fsRow.locator('[data-action="row-delete-confirm"]').click();
  await until(() => fsRow.count().then(n => n === 0));

  // 4. SVG module: uploaded as an image, its box and the drawing set apart, downloadable with its own name
  await k.newRow('s_poder', 'half');
  await page.locator('.row.is-editing [data-action="pick-type"][data-type="svg"]').first().click();
  check(/SVG/.test(await page.textContent('.row.is-editing .dropzone')), 'the SVG dropzone asks for an SVG');
  await page.setInputFiles('.row.is-editing input[data-upload]', FIX + 'img1.jpg');
  await page.waitForTimeout(400);
  check((await k.toasts()).some(t => /no es un SVG/.test(t)) && await page.locator('.row.is-editing .slot-svg img').count() === 0, 'a JPG is refused by the SVG module');
  await page.setInputFiles('.row.is-editing input[data-upload]', FIX + 'belo-mark.svg');
  await page.waitForSelector('.row.is-editing .slot-svg .svg-in > img.is-loaded');
  check(await page.locator('.row.is-editing .slot-svg svg').count() === 0, 'the drawing is shown through an <img>, never inlined');
  check(/belo-mark\.svg/.test(await page.textContent('#insp .file-meta')) && await k.has('#f-pt') && await k.has('input[data-f="sscale"]') && await k.has('[data-k="svgpos"]') && await k.has('#f-sdx') && await k.has('[data-action="svg-dl"]') && await k.has('[data-k="bg"]'), 'the SVG panel has file, box, background, spacing, size, alignment, offset and download');
  check(!(await k.has('#f-size')) && !(await k.has('[data-k="ffit"]')), 'and nothing from text or image framing');
  const svgGeo = () => page.evaluate(() => { const b = document.querySelector('.row.is-editing .svg-in').getBoundingClientRect(), i = document.querySelector('.row.is-editing .svg-in > img').getBoundingClientRect(); return { bw: b.width, bh: b.height, l: i.left - b.left, t: i.top - b.top, r: b.right - i.right, b: b.bottom - i.bottom, w: i.width }; });
  let sg = await svgGeo();
  check(near(sg.w, .6 * sg.bw) && near(sg.l, sg.r) && near(sg.t, sg.b), 'by default the drawing is 60% wide and centered');
  await k.range('#insp input[data-f="sscale"]', 40);
  await page.click('#insp [data-action="seg"][data-k="svgpos"][data-v="br"]');
  sg = await svgGeo();
  check(near(sg.w, .4 * sg.bw) && near(sg.r, 0) && near(sg.b, 0), 'size 40% and bottom-right alignment');
  await k.field('sdx', -10);
  sg = await svgGeo();
  check(near(sg.r, .1 * sg.bw), 'the X offset nudges it by a share of the box');
  const svgBox = await page.evaluate(() => document.querySelector('.row.is-editing .slot-svg').getBoundingClientRect().width);
  await k.field('pl', 60);
  check(await page.evaluate((w) => document.querySelector('.row.is-editing .svg-in').getBoundingClientRect().left - document.querySelector('.row.is-editing .slot-svg').getBoundingClientRect().left, svgBox) > 30, 'the inner spacing moves the drawing area');
  await page.click('#insp [data-action="svg-dl"]');
  check(await page.getAttribute('#insp [data-action="svg-dl"]', 'aria-checked') === 'true' && await k.has('input[data-files]'), 'Descargable switches on and offers the source files');
  await page.screenshot({ path: T + 'media-03-svg.png' });

  // 5. Color module next to it: name and HEX, palette swatches, copy on click by default value
  await page.locator('.row.is-editing [data-action="pick-type"][data-type="color"]').first().click();
  await page.waitForSelector('.row.is-editing .slot-color');
  const cbox = await page.evaluate(() => { const r = document.querySelector('.row.is-editing .slot-color').getBoundingClientRect(); return r.width / r.height; });
  check(near(cbox, 1, .02) && /Azul Belo/.test(await page.textContent('.row.is-editing .slot-color')) && /#002FA7/.test(await page.textContent('.row.is-editing .slot-color')), 'a color module is a square swatch named after the palette, with its HEX');
  await page.click('#insp [data-action="seg"][data-k="fspal"][data-v="pc_blanco"]');
  check(/Blanco/.test(await page.textContent('.row.is-editing .slot-color')) && await page.getAttribute('.row.is-editing .slot-color', 'data-tone') === 'dark', 'a light swatch writes its label in dark ink');
  await page.click('#insp [data-action="seg"][data-k="fspal"][data-v="pc_azul"]');
  await k.view('act');
  const colorKinds = await page.$$eval('#insp [data-k="act"]', b => b.map(x => x.dataset.v));
  check(colorKinds.includes('copy') && await k.pressed('act') === 'none', 'interactions are off by default and a color can be copied');
  await page.click('#insp [data-action="seg"][data-k="act"][data-v="copy"]');
  check(await k.pressed('act') === 'copy' && await page.getAttribute('#f-actvalue', 'placeholder') === '#002FA7', 'copy offers the HEX as its default value');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(250);
  check(await k.pressed('act') === 'none', 'undo turns the interaction off again');
  await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(250);
  check(await k.pressed('act') === 'copy', 'redo brings it back');
  await k.view('design');
  await k.confirm();
  const halfRow = await lastRow();

  // 6. Image with a modal, then with two source files
  await k.newRow('s_poder', 'full');
  await page.click('.row.is-editing [data-action="pick-type"][data-type="image"]');
  await page.setInputFiles('.row.is-editing input[data-upload]', FIX + 'img2.jpg');
  await page.waitForSelector('.row.is-editing img.is-loaded');
  await k.view('act');
  const imgKinds = await page.$$eval('#insp [data-k="act"]', b => b.map(x => x.dataset.v));
  check(JSON.stringify(imgKinds) === JSON.stringify(['none', 'modal', 'download']), 'an image offers only a modal or a download (' + imgKinds.join(', ') + ')');
  await page.click('#insp [data-action="seg"][data-k="act"][data-v="modal"]');
  await page.fill('#f-acttitle', 'Azul Belo');
  await page.fill('#f-actbody', 'El color principal de la marca.\n\nÚsalo con generosidad.');
  await page.setInputFiles('#insp input[data-modal-media]', [FIX + 'img3.jpg', FIX + 'img4.jpg']);
  await until(() => page.locator('#insp .mthumbs .thumb img').count().then(n => n === 2));
  check(await page.locator('#insp .mthumbs .thumb img').count() === 2, 'the modal takes two images');
  await page.click('#insp [data-action="modal-media-remove"][data-i="1"]');
  check(await page.locator('#insp .mthumbs .thumb img').count() === 1, 'an image can be removed from the modal');
  await page.screenshot({ path: T + 'media-04-modal-editor.png' });
  await k.confirm();
  const modalRow = await lastRow();

  // Admin, not editing: the click opens the modal; focus is trapped and comes back; Esc and the backdrop close it
  const modalSlot = modalRow.locator('.slot');
  await modalSlot.scrollIntoViewIfNeeded(); await k.scrollIdle();
  check(await modalSlot.getAttribute('role') === 'button' && await modalSlot.getAttribute('tabindex') === '0' && /Ver detalle/.test(await modalSlot.locator('.act-chip').textContent()), 'an interactive module is a button with a chip that says what it does');
  await modalSlot.click({ position: { x: 60, y: 60 } });
  await page.waitForSelector('#amodal:not([hidden]) .amodal-panel');
  check(/Azul Belo/.test(await page.textContent('#amodal h2')) && await page.locator('#amodal .amodal-body p').count() === 2 && await page.locator('#amodal .amodal-media img').count() === 1, 'the modal shows the title, two paragraphs and the image');
  check(await until(() => page.evaluate(() => { const i = document.querySelector('#amodal .amodal-media img'); return i && i.complete && i.naturalWidth > 0; })), 'the modal image is still stored after confirming');
  check(await page.evaluate(() => !!document.activeElement.closest('#amodal')), 'focus moves into the modal');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  check(await page.evaluate(() => !!document.activeElement.closest('#amodal')), 'Tab stays inside the modal');
  await page.screenshot({ path: T + 'media-05-modal.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check(await page.locator('#amodal[hidden]').count() === 1 && await page.evaluate(() => document.activeElement && document.activeElement.dataset.act === 'modal'), 'Esc closes it and focus returns to the module');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#amodal:not([hidden]) .amodal-panel');
  check(true, 'Enter on the focused module opens it again');
  await page.mouse.click(30, 450); await page.waitForTimeout(300);
  check(await page.locator('#amodal[hidden]').count() === 1, 'a click on the backdrop closes it');

  await k.edit(modalRow);
  await k.view('act');
  await page.click('#insp [data-action="seg"][data-k="act"][data-v="download"]');
  check(/la imagen|del módulo/.test(await page.textContent('#insp .files + .insp-hint')), 'without files, the download falls back to the module file');
  await page.setInputFiles('#insp input[data-files]', [FIX + 'belo-mark.svg', FIX + 'guia-de-marca.pdf']);
  await until(() => page.locator('#insp .frow:not(.is-pending)').count().then(n => n === 2));
  const badges = await page.$$eval('#insp .frow .fbadge', b => b.map(x => x.textContent));
  check(JSON.stringify(badges) === '["SVG","PDF"]' && /480 B/.test(await page.textContent('#insp .frow')), 'the list shows each format, name and size');
  await page.fill('#insp .frow:nth-child(2) .fname', 'Guía de marca.pdf');
  await page.dispatchEvent('#insp .frow:nth-child(2) .fname', 'change');
  await page.screenshot({ path: T + 'media-06-files.png' });
  await k.view('design');
  await k.confirm();
  await modalSlot.scrollIntoViewIfNeeded(); await k.scrollIdle();
  check(/Descargar/.test(await modalSlot.locator('.act-chip').textContent()), 'the chip now says Descargar');
  await modalSlot.click({ position: { x: 60, y: 60 } });
  await page.waitForSelector('#pop:not([hidden]) [data-action="dl-file"]');
  const items = await page.$$eval('#pop [data-action="dl-file"]', b => b.map(x => x.textContent));
  check(items.length === 2 && /belo-mark\.svg.*SVG · 480 B/.test(items[0]) && /Guía de marca\.pdf.*PDF/.test(items[1]), 'with two files the click opens a menu with both (' + items.join(' | ') + ')');
  await page.screenshot({ path: T + 'media-07-download-menu.png' });
  let [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('#pop [data-action="dl-file"] >> nth=1')]);
  check(!!dl && dl.suggestedFilename() === 'Guía de marca.pdf' && fs.statSync(await dl.path()).size === sizeOf('guia-de-marca.pdf'), 'choosing one downloads it with its display name and its bytes (' + (dl && dl.suggestedFilename()) + ')');

  // 7. Viewer: the SVG downloads itself with its original name; the color copies "#002FA7"
  await k.mode('viewer');
  const svgSlot = halfRow.locator('.slot-svg');
  await svgSlot.scrollIntoViewIfNeeded(); await k.scrollIdle();
  await svgSlot.hover(); await page.waitForTimeout(300);
  check(await svgSlot.locator('.act-chip').textContent() === 'SVG' && await svgSlot.locator('.act-chip').evaluate(n => +getComputedStyle(n).opacity) > .9, 'in viewer mode a downloadable SVG shows an «SVG» button on hover');
  await page.screenshot({ path: T + 'media-08-viewer.png' });
  [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), svgSlot.click()]);
  check(!!dl && dl.suggestedFilename() === 'belo-mark.svg' && fs.statSync(await dl.path()).size === sizeOf('belo-mark.svg'), 'clicking it downloads belo-mark.svg (' + (dl && dl.suggestedFilename()) + ')');
  const colorSlot = halfRow.locator('.slot-color');
  check(/Copiar #002FA7/.test(await colorSlot.locator('.act-chip').textContent()), 'the color chip says «Copiar #002FA7»');
  await colorSlot.click();
  check(await until(async () => (await k.toasts()).includes('#002FA7 copiado')), 'copying shows the toast «#002FA7 copiado»');
  check(await page.evaluate(() => navigator.clipboard.readText()) === '#002FA7', 'and the clipboard holds #002FA7');
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await colorSlot.focus(); await page.keyboard.press(' ');
  check(await until(() => page.evaluate(() => navigator.clipboard.readText()).then(v => v === '#002FA7')), 'Space on the focused module copies too');
  check(await page.evaluate(() => { const s = document.querySelectorAll('#s-s_poder .slot[data-act]'); return [...s].every(n => getComputedStyle(n).transform === 'none'); }), 'interactive modules are never transformed');

  // 8. Search finds the SVG by its file name, and the source files and modal text
  await page.evaluate(() => scrollTo(0, 0)); await k.scrollIdle();
  await page.click('#btn-search'); await page.waitForSelector('#search-input');
  await page.fill('#search-input', 'belo-mark'); await page.waitForTimeout(250);
  check(await page.locator('#search-results .sr').count() >= 1, 'search finds the SVG and the file named belo-mark');
  await page.fill('#search-input', 'guía de marca'); await page.waitForTimeout(250);
  check(await page.locator('#search-results .sr').count() >= 1, 'search finds a downloadable file by its display name');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await k.mode('admin');
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

  // 9. Phone: Encuadrar clears the sheet away and keeps the image in sight; nothing overflows
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const imgRows = page.locator('#s-s_poder .row:has(.slot.media)');
  const mRow = imgRows.first();
  await mRow.scrollIntoViewIfNeeded();
  await mRow.locator('[data-action="row-edit"]').click({ force: true });
  await page.waitForSelector('#insp:not([hidden]) .insp-body');
  await page.locator('#insp [data-action="frame-mode"]').scrollIntoViewIfNeeded();
  await page.click('#insp [data-action="frame-mode"]');
  await page.waitForTimeout(1100);
  const mob = await page.evaluate(() => { const r = document.querySelector('.row.is-editing .slot.is-framing').getBoundingClientRect(), b = document.querySelector('.frame-bar').getBoundingClientRect(); return { insp: getComputedStyle(document.querySelector('#insp')).visibility, top: r.top, bottom: r.bottom, barIn: b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight }; });
  check(mob.insp === 'hidden' && mob.top >= 0 && mob.bottom <= 844 && mob.barIn, `on a phone the panel steps aside and the image and its bar are on screen (${JSON.stringify(mob)})`);
  await page.screenshot({ path: T + 'media-09-mobile-framing.png' });
  await page.click('.frame-bar [data-action="frame-mode"]');
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#insp')).visibility) === 'visible', 'Listo brings the panel back');
  await k.view('act');
  check(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) === 0 && await page.evaluate(() => { const i = document.querySelector('#insp'); return i.scrollWidth <= i.clientWidth + 1; }), 'no horizontal overflow at 390px, and the files list fits the sheet');
  await page.screenshot({ path: T + 'media-10-mobile-files.png' });
  await k.view('design');
  await k.cancel();
  check(errors.length === 0, 'no page errors on a phone' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();

  // 10. Touch screens always show the chip; reduced motion opens and closes the modal at once
  const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await routes(tctx);
  const tp = await tctx.newPage(); const terr = []; watch(tp, terr);
  await tp.goto(BASE + '#s_poder');
  await tp.waitForSelector('#s-s_poder [data-action="adder-open"]');
  await tp.waitForTimeout(600);
  const tk = kit(tp);
  await tk.newRow('s_poder', 'full');
  await tp.click('.row.is-editing [data-action="pick-type"][data-type="color"]');
  await tk.view('act');
  await tp.click('#insp [data-action="seg"][data-k="act"][data-v="modal"]');
  await tp.fill('#f-acttitle', 'Azul Belo');
  await tp.click('#insp [data-action="confirm-edit"]'); await tp.waitForTimeout(500);
  const tSlot = tp.locator('#s-s_poder .slot-color');
  await tSlot.scrollIntoViewIfNeeded();
  check(await tSlot.locator('.act-chip').evaluate(n => +getComputedStyle(n).opacity) === 1, 'on touch screens the chip is always visible');
  await tSlot.tap();
  check(await tp.locator('#amodal:not([hidden])').count() === 1 && await tp.evaluate(() => document.querySelector('#amodal .amodal-panel').getAnimations().length === 0), 'with reduced motion the modal opens without animating');
  await tp.click('#amodal .amodal-x');
  check(await tp.locator('#amodal[hidden]').count() === 1, 'and closes at once');
  check(terr.length === 0, 'no page errors on touch' + (terr.length ? ': ' + terr.join(' | ') : ''));
  await tctx.close();

  // 11. Stored through Supabase: framing and files survive a reload, the bucket keeps or frees the source files,
  //     and downloads go through Storage with the original name
  const fake = new FakeSupabase(SUPA_URL);
  const leo = fake.addUser({ email: 'leo@paisanoscreando.com', name: 'Leo Suárez' });
  const bytes = (f) => fs.readFileSync(FIX + f);
  fake.files.set('photo.jpg', { body: bytes('hero.jpg'), type: 'image/jpeg' });
  fake.files.set('mark.svg', { body: bytes('belo-mark.svg'), type: 'image/svg+xml' });
  fake.files.set('src1.svg', { body: bytes('belo-mark.svg'), type: 'image/svg+xml' });
  fake.files.set('src2.pdf', { body: bytes('guia-de-marca.pdf'), type: 'application/pdf' });
  fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [{ id: 'c_a', name: 'Visual', subs: [{ id: 's_m', name: 'Medios' }] }] }, leo.id);
  fake.seed('pages/s_m', { rows: [
    { id: 'r_img', layout: 'full', h: null, slots: [{ id: 'm_img', type: 'image', asset: 'photo.jpg', w: 1512, h: 900, ratio: 'auto', dim: 0, scrim: true, frame: { fit: 'cover', x: 0, y: 0, zoom: 200 }, action: { kind: 'download' },
      files: [{ id: 'src1.svg', name: 'belo-mark.svg', type: 'image/svg+xml', size: 480 }, { id: 'src2.pdf', name: 'guia-de-marca.pdf', type: 'application/pdf', size: 578 }] }] },
    { id: 'r_svg', layout: 'full', h: null, slots: [{ id: 'm_svg', type: 'svg', asset: 'mark.svg', name: 'belo-mark.svg', size: 480, w: 240, h: 96, ratio: '16/9', bg: { kind: 'surface' }, scale: 50, pos: 'mc', dx: 0, dy: 0, action: { kind: 'download' } }] }
  ] }, leo.id);
  const sctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  await fake.attach(sctx, 'leo'); await routes(sctx); await fake.signInContext(sctx, leo);
  const L = await sctx.newPage(); const lerr = []; watch(L, lerr);
  await L.emulateMedia({ colorScheme: 'light' });
  await L.goto(SUPA_BASE + '#s_m');
  await L.waitForSelector('#s-s_m .row');
  await until(() => L.evaluate(() => document.documentElement.dataset.mode === 'admin'));
  await L.waitForTimeout(500);
  const lk = kit(L);
  const sImg = '#s-s_m .row[data-id="r_img"] .slot.media';
  const framedOk = async () => { await L.waitForSelector(sImg + ' > img.is-loaded'); const q = await lk.geo(sImg); return q.framed && near(q.x, 0) && near(q.y, 0) && near(q.iw, 2 * q.w); };
  check(await framedOk(), 'a stored framing renders from the page document');
  const svgRow = L.locator('#stage .row[data-id="r_svg"]');
  await svgRow.scrollIntoViewIfNeeded(); await lk.scrollIdle();
  const [req, sdl] = await Promise.all([L.waitForRequest(r => /\/storage\/v1\/object\/public\/assets\/mark\.svg\?download=/.test(r.url()), { timeout: 5000 }).catch(() => null), L.waitForEvent('download', { timeout: 5000 }).catch(() => null), svgRow.locator('.slot-svg').click()]);
  check(!!req && /download=belo-mark\.svg/.test(req.url()) && !!sdl && sdl.suggestedFilename() === 'belo-mark.svg', 'on Supabase the download asks Storage for the original name (' + (req && req.url().split('?')[1]) + ')');
  // Remove one source file and add another: the bucket frees the removed one and keeps the rest
  const imgRowL = L.locator('#stage .row[data-id="r_img"]');
  await lk.edit(imgRowL);
  await lk.view('act');
  await L.click('#insp [data-action="file-remove"][data-id="src1.svg"]');
  fake.uploadBytes = bytes('guia-de-marca.pdf');
  await L.setInputFiles('#insp input[data-files]', FIX + 'guia-de-marca.pdf');
  await until(() => L.locator('#insp .frow:not(.is-pending)').count().then(n => n === 2));
  await lk.view('design');
  await L.keyboard.press('Control+Enter');
  const slotDoc = () => { const d = (fake.docs.get('pages/s_m') || {}).data; return d && d.rows.find(r => r.id === 'r_img').slots[0]; };
  check(await until(() => { const s = slotDoc(); return !!s && s.files.length === 2 && s.files[0].id === 'src2.pdf' && /\.pdf$/.test(s.files[1].id) && s.files[1].name === 'guia-de-marca.pdf' && s.files[1].type === 'application/pdf'; }), 'the page stores the new file with its name and type');
  const added = slotDoc().files[1].id;
  check(await until(() => !fake.files.has('src1.svg') && fake.files.has('src2.pdf') && fake.files.has(added) && fake.files.has('photo.jpg')), 'the removed file leaves the bucket; the kept and new ones stay');
  // A file added and then cancelled is freed; nothing else is
  await lk.edit(imgRowL);
  await lk.view('act');
  fake.uploadBytes = bytes('belo-mark.svg');
  const before = new Set(fake.files.keys());
  await L.setInputFiles('#insp input[data-files]', FIX + 'belo-mark.svg');
  await until(() => L.locator('#insp .frow:not(.is-pending)').count().then(n => n === 3));
  const extra = [...fake.files.keys()].find(n => !before.has(n));
  await lk.view('design');
  await lk.cancel();
  check(!!extra && await until(() => !fake.files.has(extra) && fake.files.has('src2.pdf') && fake.files.has(added)), 'cancelling frees the file uploaded during the edit and keeps the stored ones');
  await L.reload();
  await L.waitForSelector('#s-s_m .row');
  await L.waitForTimeout(500);
  check(await framedOk(), 'after a reload the image keeps its framing');
  check(slotDoc().frame && slotDoc().frame.zoom === 200, 'the framing is stored in the page document');
  check(lerr.length === 0, 'no page errors on the shared catalog' + (lerr.length ? ': ' + lerr.join(' | ') : ''));

  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll media checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
