// Block editor: contextual inspector, inner spacing of modules, linked text styles and the brand palette.
// The local demo covers the editing flows; the fake Supabase project (tests/fake-supabase.cjs) covers what is stored:
// a style update reaching a page of another category, and spacing and colors surviving a reload.
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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1 });
  await routes(ctx);
  const page = await ctx.newPage();
  const errors = []; watch(page, errors);
  await page.emulateMedia({ colorScheme: 'light' });
  // A link to a section opens it directly (no opening screen in front)
  await page.goto(BASE + '#s_direccion');
  await page.waitForSelector('#s-s_sepuede .row');
  await page.waitForTimeout(600);

  const scrollIdle = () => page.waitForFunction(() => !document.documentElement.classList.contains('lenis-scrolling'), null, { timeout: 5000 }).catch(() => {});
  const edit = async (rowId) => {
    const row = page.locator(`#stage .row[data-id="${rowId}"]`);
    await row.scrollIntoViewIfNeeded(); await scrollIdle();
    await row.hover(); await row.locator('[data-action="row-edit"]').click();
    await page.waitForSelector('#insp:not([hidden]) .insp-body');
  };
  const confirm = async () => { await page.keyboard.press('Control+Enter'); await page.waitForTimeout(350); };
  const cancel = async () => { await page.click('#insp [data-action="cancel-edit"]'); await page.waitForTimeout(500); };
  const has = (sel) => page.locator('#insp ' + sel).count().then(n => n > 0);
  const field = async (k, v) => { await page.fill('#f-' + k, String(v)); await page.dispatchEvent('#f-' + k, 'input'); };
  const pad = (sel) => page.evaluate((sel) => { const cs = getComputedStyle(document.querySelector(sel)); return ['Top', 'Right', 'Bottom', 'Left'].map(s => Math.round(parseFloat(cs['padding' + s]) * 10) / 10); }, sel);
  const kOf = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return Math.min(1, el.clientWidth / (parseFloat(el.style.getPropertyValue('--ref')) || 1114)); }, sel);
  const fsOf = (sel) => page.evaluate((sel) => document.querySelector(sel).style.getPropertyValue('--fs'), sel);
  const colorOf = (sel) => page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).color, sel);
  const inlineColor = (sel) => page.evaluate((sel) => document.querySelector(sel).style.color, sel);
  const styleSel = () => page.inputValue('#insp select[data-f="typestyle"]');
  const pressed = (k) => page.evaluate((k) => (document.querySelector(`#insp [data-action="seg"][data-k="${k}"][aria-pressed="true"]`) || {}).dataset?.v ?? null, k);
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
  const setColor = (sel, v) => page.locator(sel).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const mode = async (m) => {
    await page.evaluate(() => scrollTo(0, 0)); await scrollIdle();
    await page.click('#btn-menu'); await page.waitForTimeout(700);
    await page.click(`#menu [data-action="mode"][data-mode="${m}"]`); await page.waitForTimeout(300);
    await page.click('#menu-close'); await page.waitForTimeout(600);
  };

  // 1. Contextual inspector: each content type lists only its sections
  await edit('r_t');
  check(await page.locator('#insp [data-action="insp-view"]').count() >= 2 && await has('[data-action="insp-view"][data-v="design"][aria-selected="true"]'), 'the panel opens on the Design view with its view switch');
  check(await has('select[data-f="typestyle"]') && await has('#f-size') && await has('[data-k="tcolor"]') && await has('#f-pt'), 'text shows typography, text styles, text color and inner spacing');
  check(await has('#f-h') && !(await has('select[data-f="ratio"]')) && !(await has('input[data-f="dim"]')), 'text shows the block height but no media framing');
  await page.click('#insp [data-action="insp-view"][data-v="anim"]');
  check(!(await has('select[data-f="typestyle"]')) && !(await has('#f-pt')) && await has('select[data-f="tenter"]'), 'the Animation view has no design sections');
  await page.click('#insp [data-action="insp-view"][data-v="design"]');
  await cancel();

  await page.click('.sub[data-id="s_poder"]'); await page.waitForTimeout(1300);
  await page.click('#s-s_poder [data-action="adder-open"]');
  await page.click('#s-s_poder [data-action="adder-layout"][data-layout="full"]');
  await page.click('.row.is-editing [data-action="pick-type"][data-type="image"]');
  await page.setInputFiles('.row.is-editing input[data-upload]', FIX + 'img1.jpg');
  await page.waitForSelector('.row.is-editing img.is-loaded');
  check(await has('select[data-f="ratio"]') && await has('#f-h'), 'image shows its framing and the block height');
  check(!(await has('#f-size')) && !(await has('select[data-f="typestyle"]')) && !(await has('#f-pt')) && !(await has('[data-k="tcolor"]')), 'image shows no typography, text color or text spacing');
  await cancel();

  await edit('r_sp');
  check(await has('[data-k="fspal"]') && await has('#f-hex') && await has('#f-h') && !(await has('#f-pt')), 'full-screen color shows the palette, the hex field and the height');
  await page.locator('#insp [data-action="tab"]').nth(1).click();
  check(await has('#f-pt') && await has('[data-k="pos"]') && await has('select[data-f="typestyle"]') && !(await has('#f-h')), 'the text over it shows spacing and position, and leaves the height to the background tab');
  await cancel();

  // 2. Inner spacing: untouched modules look exactly as before
  await page.click('.sub[data-id="s_direccion"]'); await page.waitForTimeout(1300);
  check(JSON.stringify(await pad('#s-s_direccion .row[data-id="r_t"] .tpad')) === '[0,0,0,0]', 'text without background keeps no inner spacing');
  check(JSON.stringify(await pad('#s-s_sepuede .fs-overlay')) === JSON.stringify([45, 20, 45, 378]), 'text over a full-screen background keeps its distance to the edges (5vh, 20px, 25%)');
  await edit('r_t');
  await page.click('#insp [data-action="seg"][data-k="bg"][data-v="surface"]');
  const W = await page.evaluate(() => document.querySelector('.row.is-editing .slot-text').clientWidth);
  const auto = Math.round(Math.min(40, Math.max(20, .032 * W)) * 10) / 10;
  check((await pad('.row.is-editing .tpad')).every(v => Math.abs(v - auto) < .2), `text with background keeps clamp(20px, 3.2cqi, 40px) (${auto}px)`);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200);

  // Linked sides, then one side, empty = automatic, undo, reset
  const tpad = '.row.is-editing .tpad', k1 = await kOf('.row.is-editing .slot-text');
  check(await page.getAttribute('#insp [data-action="pad-link"]', 'aria-pressed') === 'true', 'sides start linked');
  await field('pt', 24);
  check((await pad(tpad)).every(v => Math.abs(v - 24 * k1) < .2) && await page.inputValue('#f-pl') === '24', 'one value fills the four linked sides, live');
  await page.click('#insp [data-action="pad-link"]');
  check(await page.getAttribute('#insp [data-action="pad-link"]', 'aria-pressed') === 'false', 'sides can be unlinked');
  await field('pl', 80);
  let p = await pad(tpad);
  check(Math.abs(p[3] - 80 * k1) < .2 && Math.abs(p[0] - 24 * k1) < .2, 'an unlinked side changes alone');
  await page.fill('#f-pt', ''); await page.dispatchEvent('#f-pt', 'input');
  check((await pad(tpad))[0] === 0, 'an empty side goes back to the automatic spacing');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(250);
  check(Math.abs((await pad(tpad))[0] - 24 * k1) < .2 && await page.inputValue('#f-pt') === '24', 'undo brings the side back');
  await page.click('#insp [data-action="pad-reset"]');
  check(JSON.stringify(await pad(tpad)) === '[0,0,0,0]' && await page.inputValue('#f-pl') === '' && await page.isDisabled('#insp [data-action="pad-reset"]'), 'Restablecer returns every side to automatic');
  await page.click('#insp [data-action="pad-link"]');
  await field('pt', 32);
  await page.screenshot({ path: T + 'editor-01-spacing.png' });
  await confirm();
  const viewPad = '#s-s_direccion .row[data-id="r_t"] .tpad';
  check((await pad(viewPad)).every(v => Math.abs(v - 32 * k1) < .2), 'the spacing is kept after confirming');
  await edit('r_t');
  check(await page.inputValue('#f-pb') === '32', 'reopening the block shows the stored spacing');
  await cancel();

  // Text over a full-screen background: the spacing is its distance to the edges
  await edit('r_sp');
  await page.locator('#insp [data-action="tab"]').nth(1).click();
  await page.click('#insp [data-action="pad-link"]');
  await field('pl', 0);
  p = await pad('.row.is-editing .fs-overlay');
  check(p[3] === 0 && p[0] === 45 && p[1] === 20, 'overlay text: one side moves to the edge, the others keep their default');
  await cancel();
  check(JSON.stringify(await pad('#s-s_sepuede .fs-overlay')) === JSON.stringify([45, 20, 45, 378]), 'cancelling leaves the overlay as it was');

  // 3. Text styles: link, modified, reset, update across pages, undo, create, rename, unlink, delete
  await edit('r_sp');
  await page.locator('#insp [data-action="tab"]').nth(1).click();
  await page.locator('.row.is-editing .tb[data-block="b3"]').click();
  await page.selectOption('#insp select[data-f="typestyle"]', 'ts_headline');
  const b3 = '.row.is-editing .tb[data-block="b3"]';
  check(await fsOf(b3) === '72' && /Phudu/.test(await page.evaluate((s) => getComputedStyle(document.querySelector(s)).fontFamily, b3)), 'applying Headline sets its typography on the block');
  check(await page.isVisible('#insp .type-style-meta') && !(await has('.type-style-mod')), 'a linked text shows the style card, not modified');
  await confirm();

  await edit('r_t');
  await page.locator('.row.is-editing .tb[data-block="b2"]').click();
  await page.selectOption('#insp select[data-f="typestyle"]', 'ts_headline');
  const b2 = '.row.is-editing .tb[data-block="b2"]';
  check(await fsOf(b2) === '72' && await styleSel() === 'ts_headline', 'a second text takes the same style');
  await field('size', 80);
  check(await page.isVisible('#insp .type-style-mod') && await styleSel() === 'ts_headline', 'changing its size marks it as modified, still linked');
  await field('size', 72);
  check(!(await has('.type-style-mod')), 'matching the style again clears the mark');
  await field('size', 80);
  await page.click('#insp [data-action="type-style-reset"]');
  check(await fsOf(b2) === '72' && !(await has('.type-style-mod')) && await page.inputValue('#f-size') === '72', 'Restablecer brings back the style values');
  await field('size', 80);
  await page.screenshot({ path: T + 'editor-02-style-modified.png' });
  await page.click('#insp [data-action="type-style-update"]');
  await page.waitForTimeout(400);
  check(!(await has('.type-style-mod')) && await fsOf(b2) === '80' && /Headline.*actualizado/.test(await toasts()), 'Actualizar estilo saves the change into the style');
  check((await page.textContent('#insp select[data-f="typestyle"] option[value="ts_headline"]')).includes('80'), 'the style list shows the new size');
  // Undo goes back to the size before the change: the style keeps 80, so the text now differs from it
  await page.keyboard.press('Control+z'); await page.waitForTimeout(250);
  check(await fsOf(b2) === '72' && await styleSel() === 'ts_headline' && await page.isVisible('#insp .type-style-mod'), 'undo after updating the style shows the text as modified');
  await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(250);
  check(await fsOf(b2) === '80' && !(await has('.type-style-mod')), 'redo matches the style again');
  await confirm();
  check(await fsOf('#s-s_sepuede .tb[data-block="b3"]') === '80', 'the linked text of another section follows the style');

  // A style updated from a block whose edit is then cancelled: the stored copy of that block follows the style too
  await edit('r_sp');
  await page.locator('#insp [data-action="tab"]').nth(1).click();
  await page.locator(b3).click();
  await field('size', 90);
  await page.click('#insp [data-action="type-style-update"]');
  await page.waitForTimeout(400);
  await cancel();
  check(await fsOf('#s-s_sepuede .tb[data-block="b3"]') === '90' && await fsOf('#s-s_direccion .tb[data-block="b2"]') === '90', 'cancelling after Actualizar estilo keeps every linked text on the updated style');

  await edit('r_t');
  await page.locator('.row.is-editing .tb[data-block="b1"]').click();
  await page.selectOption('#insp select[data-f="typestyle"]', 'ts_caption');
  check(await fsOf('.row.is-editing .tb[data-block="b1"]') === '13', 'Caption applied');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(250);
  check(await fsOf('.row.is-editing .tb[data-block="b1"]') === '14' && await styleSel() === '', 'undo removes the link and the values');
  await page.click('#insp [data-action="type-style-new"]');
  await page.fill('#type-style-name', 'Kicker'); await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const kick = await styleSel();
  check(!!kick && (await page.textContent(`#insp select[data-f="typestyle"] option[value="${kick}"]`)).startsWith('Kicker') && /Kicker.*guardado/.test(await toasts()), 'Guardar como estilo creates a style from the block and links it');
  await page.click('#insp [data-action="type-style-ask"][data-mode="rename"]');
  await page.fill('#type-style-name', 'Kicker XL'); await page.click('#insp [data-action="type-style-name-ok"]');
  check((await page.textContent(`#insp select[data-f="typestyle"] option[value="${kick}"]`)).startsWith('Kicker XL'), 'a style can be renamed');
  await page.click('#insp [data-action="type-style-unlink"]');
  check(await styleSel() === '' && await fsOf('.row.is-editing .tb[data-block="b1"]') === '14', 'Desvincular keeps the values without the link');
  await page.locator('.row.is-editing .tb[data-block="b2"]').click();
  await page.click('#insp [data-action="type-style-ask"][data-mode="delete"]');
  check((await page.textContent('#insp .type-style-q')).includes('2 textos'), 'deleting asks first and counts the texts that use the style');
  await page.click('#insp [data-action="type-style-delete"]');
  await page.waitForTimeout(400);
  check(await styleSel() === '' && await fsOf(b2) === '90' && await page.locator('#insp select[data-f="typestyle"] option[value="ts_headline"]').count() === 0, 'deleting the style unlinks the texts and keeps their typography');
  await confirm();
  await edit('r_sp');
  await page.locator('#insp [data-action="tab"]').nth(1).click();
  await page.locator('.row.is-editing .tb[data-block="b3"]').click();
  check(await styleSel() === '' && await fsOf(b3) === '90', 'the text of the other section was unlinked too, with its values');
  await cancel();

  // 4. Text color from the palette, per text block; palette swatches for backgrounds
  await edit('r_t');
  const b1 = '.row.is-editing .tb[data-block="b1"]';
  await page.locator(b1).click();
  await page.click('#insp [data-action="seg"][data-k="tcolor"][data-v="pc_azul"]');
  check(await colorOf(b1) === 'rgb(0, 47, 167)' && await colorOf(b2) === 'rgb(0, 0, 0)' && await pressed('tcolor') === 'pc_azul', 'a palette color applies to the active text block only');
  await page.waitForTimeout(900); /* quick repeats of one control merge into a single undo step */
  await page.click('#insp [data-action="seg"][data-k="tcolor"][data-v="auto"]');
  check(await inlineColor(b1) === '' && await colorOf(b1) === 'rgb(0, 0, 0)', 'Automático goes back to the module ink');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(250);
  check(await colorOf(b1) === 'rgb(0, 47, 167)' && await pressed('tcolor') === 'pc_azul', 'undo brings the color back');
  await page.click('#insp [data-action="seg"][data-k="tcolor"][data-v="auto"]');
  await page.click('#insp [data-action="pal-open"]');
  await page.waitForSelector('#pop .pal');
  await setColor('#pal-new-hex', '#ff5a36');
  await page.fill('#pal-new-name', 'Coral');
  await page.screenshot({ path: T + 'editor-03-palette.png' });
  await page.click('#pop [data-action="pal-add"]');
  await page.waitForTimeout(200);
  const coral = await page.evaluate(() => (document.querySelector('#insp [data-k="tcolor"][title^="Coral"]') || {}).dataset?.v);
  check(!!coral && await pressed('tcolor') === coral && await colorOf(b1) === 'rgb(255, 90, 54)', 'a color added to the palette is applied to the text');
  await page.fill(`#pop [data-pal-name="${coral}"]`, 'Coral vivo'); await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  check(await page.locator('#insp [data-k="tcolor"][title^="Coral vivo"]').count() === 1, 'palette colors can be renamed');
  await page.keyboard.press('Escape');
  check(await page.isHidden('#pop') || await page.evaluate(() => document.querySelector('#pop').classList.contains('is-closing')), 'Escape closes the palette');
  await page.click('#insp [data-action="seg"][data-k="bgpal"][data-v="pc_negro"]');
  check(await page.evaluate(() => { const s = document.querySelector('.row.is-editing .slot-text'); return s.style.getPropertyValue('--slot-bg') + ' ' + s.dataset.ink; }) === '#0a0a0a light' && await pressed('bgpal') === 'pc_negro', 'a palette swatch sets the module background, with light text');
  await page.click('#insp [data-action="seg"][data-k="bg"][data-v="none"]');
  await confirm();
  check(await colorOf('#s-s_direccion .tb[data-block="b1"]') === 'rgb(255, 90, 54)', 'the text color is kept after confirming');
  await mode('viewer');
  check(await colorOf('#s-s_direccion .tb[data-block="b1"]') === 'rgb(255, 90, 54)' && (await pad('#s-s_direccion .row[data-id="r_t"] .tpad'))[0] > 0, 'viewers see the color and the spacing');
  check(await page.locator('#insp:not([hidden])').count() === 0, 'viewers get no inspector');
  await mode('admin');
  // Changing a palette color repaints the texts that use it in place: no row is rebuilt, so no animation replays
  await page.evaluate(() => { document.querySelector('#s-s_direccion .row[data-id="r_t"]')._keep = 1; });
  await edit('r_sp');
  await page.locator('#insp [data-action="tab"]').nth(1).click();
  await page.click('#insp [data-action="pal-open"]');
  await page.waitForSelector('#pop .pal');
  await setColor(`#pop [data-pal-hex="${coral}"]`, '#12a594');
  await page.waitForTimeout(200);
  check(await colorOf('#s-s_direccion .tb[data-block="b1"]') === 'rgb(18, 165, 148)' && await page.evaluate(() => document.querySelector('#s-s_direccion .row[data-id="r_t"]')._keep === 1), 'editing a palette color repaints its texts in place');
  await page.keyboard.press('Escape');
  await cancel();
  await edit('r_t');
  await page.locator(b1).click();
  await page.click('#insp [data-action="pal-open"]');
  await page.click(`#pop [data-action="pal-del"][data-id="${coral}"]`);
  check((await page.textContent('#pop .pal-q')).includes('automático'), 'removing a palette color asks first');
  await page.click(`#pop [data-action="pal-del-ok"][data-id="${coral}"]`);
  await page.waitForTimeout(200);
  check(await page.locator('#insp [data-k="tcolor"][title^="Coral"]').count() === 0 && await inlineColor(b1) === '' && await pressed('tcolor') === 'auto', 'texts with a removed color fall back to automatic');
  await page.keyboard.press('Escape');
  await cancel();
  check(await inlineColor('#s-s_direccion .tb[data-block="b1"]') === '', 'the stored page follows the palette as well');

  await edit('r_sp');
  await page.click('#insp [data-action="seg"][data-k="fspal"][data-v="pc_negro"]');
  check(await page.evaluate(() => document.querySelector('.row.is-editing .fs-media').style.getPropertyValue('--fs-color')) === '#0a0a0a' && await page.inputValue('#f-hex') === '0A0A0A' && await pressed('fspal') === 'pc_negro', 'a palette swatch sets the full-screen color');
  await page.fill('#f-hex', '123456'); await page.dispatchEvent('#f-hex', 'input');
  check(await pressed('fspal') === null, 'a custom color leaves the palette unselected');
  await cancel();

  // A side field settles on the value in use once typing ends
  await edit('r_t');
  await page.click('#insp [data-action="pad-link"]');
  await page.fill('#f-pt', '-5'); await page.dispatchEvent('#f-pt', 'input'); await page.dispatchEvent('#f-pt', 'change');
  check(await page.inputValue('#f-pt') === '0' && (await pad('.row.is-editing .tpad'))[0] === 0, 'a negative side is stored and shown as 0');
  await page.fill('#f-pt', 'abc'); await page.dispatchEvent('#f-pt', 'input'); await page.dispatchEvent('#f-pt', 'change');
  check(await page.inputValue('#f-pt') === '0', 'text that is not a number goes back to the stored side');
  // Two texts of the block being edited share a style: updating it from one moves the other one too, unmodified
  await page.locator(b1).click();
  await page.selectOption('#insp select[data-f="typestyle"]', 'ts_subheadline');
  await page.locator(b2).click();
  await page.selectOption('#insp select[data-f="typestyle"]', 'ts_subheadline');
  await field('size', 44);
  await page.click('#insp [data-action="type-style-update"]');
  await page.waitForTimeout(400);
  await page.locator(b1).click();
  check(await fsOf(b1) === '44' && await styleSel() === 'ts_subheadline' && !(await has('.type-style-mod')), 'updating a style from one text moves the other linked text of the same block');
  await cancel();

  // 5. Narrow screens: the sections fit the bottom sheet
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const r = page.locator('#s-s_direccion .row[data-id="r_t"]');
  await r.scrollIntoViewIfNeeded();
  await r.locator('[data-action="row-edit"]').click({ force: true });
  await page.waitForSelector('#insp:not([hidden]) .insp-body');
  await page.locator('#insp .insp-sec', { hasText: 'Espaciado interno' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: T + 'editor-04-mobile.png' });
  check(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) === 0, 'no horizontal overflow at 390px');
  check(await page.evaluate(() => { const i = document.querySelector('#insp'); return i.scrollWidth <= i.clientWidth + 1; }), 'the inspector sections fit the sheet width');
  await page.click('#insp [data-action="pal-open"]');
  await page.waitForSelector('#pop .pal');
  check(await page.evaluate(() => { const b = document.querySelector('#pop').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; }), 'the palette popover stays on screen');
  await page.keyboard.press('Escape');
  await cancel();
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();

  // 6. Stored through Supabase: styles reach pages that are not open, and spacing and colors survive a reload
  const fake = new FakeSupabase(SUPA_URL);
  const leo = fake.addUser({ email: 'leo@paisanoscreando.com', name: 'Leo Suárez' });
  const blk = (id, extra) => ({ id, text: 'Texto ' + id, font: 'jakarta', size: 40, weight: 600, lh: 110, ls: -1, align: 'left', upper: false, ...extra });
  const textRow = (id, blocks) => ({ id, layout: 'full', h: null, slots: [{ id: 'm_' + id, type: 'text', bg: { kind: 'none' }, align: 'start', ink: 'auto', blocks }] });
  const head = { ts: 'ts_headline', font: 'phudu', size: 72, weight: 900, lh: 95, ls: -2, upper: true };
  // A catalog saved before text styles and the palette existed: both are seeded on the first save
  fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [{ id: 'c_a', name: 'Our Brand', subs: [{ id: 's_one', name: 'Uno' }] }, { id: 'c_b', name: 'Voice', subs: [{ id: 's_two', name: 'Dos' }] }] }, leo.id);
  fake.seed('pages/s_one', { rows: [textRow('r_one', [blk('b_a')])] }, leo.id);
  fake.seed('pages/s_two', { rows: [textRow('r_two', [blk('b_far', head), blk('b_mod', { ...head, size: 50, tsOver: true })])] }, leo.id);
  const sctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1 });
  await fake.attach(sctx, 'leo'); await routes(sctx); await fake.signInContext(sctx, leo);
  const L = await sctx.newPage();
  const lerr = []; watch(L, lerr);
  await L.emulateMedia({ colorScheme: 'light' });
  await L.goto(SUPA_BASE + '#s_one');
  await L.waitForSelector('#s-s_one .row');
  await until(() => L.evaluate(() => document.documentElement.dataset.mode === 'admin'));
  await L.waitForTimeout(400);
  const row1 = L.locator('#stage .row[data-id="r_one"]');
  await row1.hover(); await row1.locator('[data-action="row-edit"]').click();
  await L.waitForSelector('#insp:not([hidden]) .insp-body');
  await L.locator('.row.is-editing .tb[data-block="b_a"]').click();
  await L.selectOption('#insp select[data-f="typestyle"]', 'ts_headline');
  await L.fill('#f-size', '64'); await L.dispatchEvent('#f-size', 'input');
  await L.click('#insp [data-action="type-style-update"]');
  await L.waitForTimeout(300);
  await L.fill('#f-pt', '24'); await L.dispatchEvent('#f-pt', 'input');
  await L.click('#insp [data-action="seg"][data-k="tcolor"][data-v="pc_azul"]');
  await L.keyboard.press('Control+Enter');
  const docOf = (p) => (fake.docs.get(p) || {}).data;
  const blockOf = (p, id) => { const d = docOf(p); return d && d.rows.flatMap(r => r.slots.flatMap(s => s.blocks || [])).find(b => b.id === id); };
  check(await until(() => { const t = docOf('catalog/tree'); const h = t && (t.textStyles || []).find(s => s.id === 'ts_headline'); return !!h && h.size === 64 && (t.palette || []).length === 3; }), 'the tree stores the seeded styles and palette, with the updated Headline');
  check(await until(() => { const f = blockOf('pages/s_two', 'b_far'), m = blockOf('pages/s_two', 'b_mod'); return !!f && f.size === 64 && f.ts === 'ts_headline' && !f.tsOver && m.size === 50 && m.tsOver === true; }), 'the update reached a page of another category, and skipped the modified text');
  check(await until(() => { const a = blockOf('pages/s_one', 'b_a'), s = docOf('pages/s_one').rows[0].slots[0]; return !!a && a.ts === 'ts_headline' && a.color === 'pc_azul' && !!s.pad && s.pad.t === 24 && s.pad.l === 24; }), 'the link, the color and the spacing are stored in the page');
  await L.waitForTimeout(500);
  await L.reload();
  await L.waitForSelector('#s-s_one .row .tpad');
  await L.waitForTimeout(500);
  const kk = await L.evaluate(() => { const el = document.querySelector('#s-s_one .slot-text'); return Math.min(1, el.clientWidth / 1114); });
  const after = await L.evaluate(() => { const tb = document.querySelector('#s-s_one .tb[data-block="b_a"]'); return { color: getComputedStyle(tb).color, fs: tb.style.getPropertyValue('--fs'), pad: parseFloat(getComputedStyle(document.querySelector('#s-s_one .tpad')).paddingTop) }; });
  check(after.color === 'rgb(0, 47, 167)' && after.fs === '64' && Math.abs(after.pad - 24 * kk) < .2, `after a reload the text keeps its style, color and spacing (${JSON.stringify(after)})`);
  // Someone else changes the style while a linked text is being edited: the text shows as modified, the list follows
  const ana = fake.addUser({ email: 'ana@paisanos.io', name: 'Ana Ruiz' });
  const remoteTree = (fn) => { const cur = fake.docs.get('catalog/tree'); const d = JSON.parse(JSON.stringify(cur.data)); fn(d); return fake.saveDoc(ana, { p_path: 'catalog/tree', p_data: d, p_expected: cur.version }); };
  await row1.hover(); await row1.locator('[data-action="row-edit"]').click();
  await L.waitForSelector('#insp:not([hidden]) .insp-body');
  await L.locator('.row.is-editing .tb[data-block="b_a"]').click();
  check(!(await L.locator('#insp .type-style-mod').count()), 'the linked text starts unmodified');
  remoteTree(d => { const h = d.textStyles.find(x => x.id === 'ts_headline'); h.size = 70; h.name = 'Titular'; });
  check(await until(async () => await L.locator('#insp .type-style-mod').count() === 1 && /^Titular/.test(await L.textContent('#insp select[data-f="typestyle"] option[value="ts_headline"]'))), 'a style changed by someone else marks the edited text as modified and renames it in the list');
  remoteTree(d => { d.textStyles = d.textStyles.filter(x => x.id !== 'ts_headline'); });
  check(await until(async () => await L.inputValue('#insp select[data-f="typestyle"]') === '' && await L.locator('#insp [data-action="type-style-new"]').count() === 1), 'a style removed by someone else unlinks the edited text');
  await L.click('#insp [data-action="cancel-edit"]');
  await L.waitForTimeout(300);
  check(lerr.length === 0, 'no page errors on the shared catalog' + (lerr.length ? ': ' + lerr.join(' | ') : ''));

  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll editor checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
