// Animation presets: module and text-block presets, direction, stagger, order, easing curves, split view, preview transport, reduced motion.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const FIX = path.join(__dirname, 'fixtures') + path.sep;
const T = path.join(__dirname, 'output') + path.sep;
fs.mkdirSync(T, { recursive: true });
const BASE = process.env.BASE_URL || 'http://localhost:8765/index.html';
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/lenis/, r => r.fulfill({ path: FIX + 'lenis.min.js', contentType: 'text/javascript' }));
  await page.route(/cdn\.jsdelivr\.net\/npm\/gsap@[^/]+\/dist\/(gsap|ScrollTrigger|SplitText)\.min\.js/, r => r.fulfill({ path: FIX + r.request().url().split('/').pop(), contentType: 'text/javascript' }));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(BASE);
  await page.waitForSelector('#s-s_sepuede .row');
  return { page, ctx, errors };
}
const settled = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].every(el => {
  const cs = getComputedStyle(el); return cs.opacity === '1' && (cs.transform === 'none' || cs.transform === 'matrix(1, 0, 0, 1, 0, 0)');
}), sel);
const options = (page, k) => page.evaluate((k) => [...document.querySelectorAll(`#insp select[data-f="${k}"] option`)].map(o => o.value), k);
const val = (page, k) => page.inputValue(`#insp select[data-f="${k}"]`);
const pressed = (page, k) => page.evaluate((k) => (document.querySelector(`#insp [data-action="seg"][data-k="${k}"][aria-pressed="true"]`) || {}).dataset?.v, k);

(async () => {
  const browser = await chromium.launch();
  const { page, errors } = await open(browser);

  // 1. Seeded presets run once the page loads
  check(await page.evaluate(() => !!(window.gsap && window.ScrollTrigger && window.SplitText)), 'GSAP, ScrollTrigger and SplitText loaded');
  await page.waitForTimeout(150);
  check(await page.evaluate(() => ScrollTrigger.getAll().length > 0), 'scroll triggers were created for animated blocks');
  await page.waitForTimeout(2800);
  check(await page.evaluate(() => !document.querySelector('#stage .sl, #stage .sw, #stage .sc')), 'enter splits are reverted after playing');
  check(await settled(page, '#s-s_direccion .tb'), 'animated text blocks end fully visible');
  check(await page.evaluate(() => document.querySelector('#s-s_direccion .tb:last-child').textContent) === 'Tu dinero puede llegar más lejos', 'text content is intact after the split');
  check(await settled(page, '#s-s_sepuede .slot, #s-s_sepuede .tb'), 'fullscreen modules end fully visible');

  // 2. Module scroll preset (parallax on the text box over the color) follows the scroll
  const ty = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#s-s_sepuede .fs-overlay .tpad')).transform).m42);
  const y0 = await ty();
  await page.mouse.wheel(0, 500); await page.waitForTimeout(1400);
  const y1 = await ty();
  check(Math.abs(y1 - y0) > 4, `parallax moves the overlay text with the scroll (${y0.toFixed(1)} -> ${y1.toFixed(1)})`);
  await page.mouse.wheel(0, -2000); await page.waitForTimeout(1400);

  // 3. Animation view on a text block
  const tRow = page.locator('#s-s_direccion .row[data-layout="full"]').first();
  await tRow.hover();
  await tRow.locator('[data-action="row-edit"]').click();
  await page.waitForSelector('#insp .insp-views');
  await page.click('#insp [data-action="insp-view"][data-v="design"]');
  check(await page.locator('#insp select[data-f="menter"]').count() === 0, 'Design view has no animation options');
  await page.click('#insp [data-action="insp-view"][data-v="anim"]');
  check(await page.locator('#insp [data-k="font"]').count() === 0, 'Animation view has no design options');
  const mEnter = await options(page, 'menter');
  check(!mEnter.some(v => v.startsWith('split')) && !mEnter.includes('zoom'), 'text module offers no split or media-only presets');
  check((await options(page, 'tenter')).filter(v => v.startsWith('split')).length === 6, 'text block offers six split presets');
  check(await page.locator('#insp .alist button').count() === 2, 'text block list shows every text block');
  await page.locator('#insp .alist button').nth(1).click();
  check(await val(page, 'tenter') === 'split-mask' && await pressed(page, 'tby') === 'lines', 'second text block shows its own split preset and unit');

  // Direction, unit, stagger, order
  check(await pressed(page, 'tdir') === 'bottom', 'split comes from below by default');
  await page.click('#insp [data-action="seg"][data-k="tdir"][data-v="left"]');
  check(await pressed(page, 'tdir') === 'left', 'direction can be changed');
  await page.click('#insp [data-action="seg"][data-k="tby"][data-v="chars"]');
  check(await page.inputValue('#f-tstep') === '0.02', 'changing the unit to letters sets a letter stagger');
  await page.fill('#f-tstep', '0.04'); await page.dispatchEvent('#f-tstep', 'input');
  await page.selectOption('#insp select[data-f="torder"]', 'center');
  await page.waitForTimeout(450);
  const xs = await page.evaluate(() => [...document.querySelectorAll('.row.is-editing .tb[data-block="b2"] .sc')].map(c => new DOMMatrix(getComputedStyle(c).transform).m41));
  check(xs.length > 20, `preview splits the block into letters (${xs.length})`);
  check(xs.some(x => x < -1), 'letters come from the left');
  await page.screenshot({ path: T + 'motion-01-split-controls.png' });
  await page.keyboard.press('Escape');
  check(await page.locator('.row.is-editing .sc').count() === 0, 'Escape leaves the preview and reverts the split');

  // Easing: family, in/out, custom curve
  check(await val(page, 'teasefam') === 'expo' && await pressed(page, 'teasetype') === 'out', 'curve shows the preset ease (expo out)');
  await page.selectOption('#insp select[data-f="teasefam"]', 'back');
  await page.click('#insp [data-action="seg"][data-k="teasetype"][data-v="inOut"]');
  check(await val(page, 'teasefam') === 'back' && await pressed(page, 'teasetype') === 'inOut', 'ease family and in/out can be picked');
  await page.click('#insp [data-action="ease-edit"][data-k="tease"]');
  await page.waitForSelector('#insp .ease-svg');
  const h2 = page.locator('#insp .ez-h[data-h="2"]');
  const bb = await h2.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down(); await page.mouse.move(bb.x - 30, bb.y + 40, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(100);
  check(await val(page, 'teasefam') === 'custom', 'dragging a handle turns the ease into a custom curve');
  check(/^cubic-bezier\(/.test(await page.textContent('#insp .ez-code')), 'editor shows the cubic-bezier value');
  await page.fill('#insp [data-bz="1"][data-k="tease"]', '1.4'); await page.dispatchEvent('#insp [data-bz="1"][data-k="tease"]', 'input');
  check((await page.textContent('#insp .ez-code')).includes(',1.4,'), 'curve can be typed with numbers, overshoot included');
  await page.screenshot({ path: T + 'motion-02-curve-editor.png' });
  await page.click('#insp [data-action="ease-reset"][data-k="tease"]');
  check(await val(page, 'teasefam') === 'expo', 'reset brings back the preset curve');
  await page.click('#insp [data-action="ease-edit"][data-k="tease"]');

  // Preview transport: scrub and speed
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.fill('#anim-scrub', '500'); await page.dispatchEvent('#anim-scrub', 'input');
  check(await page.evaluate(() => document.querySelector('.row.is-editing').classList.contains('is-previewing')), 'scrubbing holds the preview');
  check(parseFloat(await page.textContent('#anim-t')) > 0, 'scrub shows the time of the frame');
  check(await page.isVisible('#insp [data-action="pv-stop"]'), 'a button leaves the held preview');
  await page.click('#insp [data-action="pv-stop"]');
  check(await page.evaluate(() => !document.querySelector('.row.is-editing.is-previewing')), 'preview stops');
  await page.click('#insp [data-action="pv-speed"][data-v="0.25"]');
  check(await page.getAttribute('#insp [data-action="pv-speed"][data-v="0.25"]', 'aria-pressed') === 'true', 'preview speed can be slowed down');
  await page.click('#insp [data-action="pv-speed"][data-v="1"]');

  // Paragraph with line breaks: split keeps them, split view shows the cut
  await page.click('#insp [data-action="insp-view"][data-v="design"]');
  const para = page.locator('.row.is-editing .tb[data-block="b1"]');
  await para.click(); await page.keyboard.press('End');
  await page.keyboard.type(' de marca'); await page.keyboard.press('Enter'); await page.keyboard.type('Segunda línea'); await page.keyboard.press('Enter'); await page.keyboard.type('Tercera línea');
  await page.click('#insp [data-action="insp-view"][data-v="anim"]');
  await page.locator('#insp .alist button').nth(0).click();
  const hBefore = await page.evaluate(() => document.querySelector('.row.is-editing .tb[data-block="b1"]').getBoundingClientRect().height);
  await page.click('#insp [data-action="split-view"]');
  await page.waitForTimeout(100);
  check((await page.textContent('#split-info')).startsWith('3 líneas'), 'split view counts the lines of a paragraph with line breaks: ' + await page.textContent('#split-info'));
  const hAfter = await page.evaluate(() => document.querySelector('.row.is-editing .tb[data-block="b1"]').getBoundingClientRect().height);
  check(Math.abs(hAfter - hBefore) < 1, `split keeps the paragraph height (${hBefore} -> ${hAfter})`);
  await page.selectOption('#insp select[data-f="tenter"]', 'split-mask');
  await page.click('#insp [data-action="seg"][data-k="tby"][data-v="lines"]');
  await page.waitForTimeout(100);
  check(await page.locator('.row.is-editing .tb[data-split-by="lines"] .sl').count() === 3, 'split view outlines each line');
  await page.screenshot({ path: T + 'motion-03-split-view.png' });
  await page.click('#insp [data-action="anim-preview"]');
  await page.waitForTimeout(200);
  const hMask = await page.evaluate(() => document.querySelector('.row.is-editing .tb[data-block="b1"]').getBoundingClientRect().height);
  check(Math.abs(hMask - hBefore) < 1, `line masks keep the paragraph height (${hBefore} -> ${hMask})`);
  await page.waitForTimeout(2600);
  check(await page.locator('.row.is-editing .tb[data-split-by="lines"] .sl').count() === 3, 'split view comes back after the preview');
  await page.click('#insp [data-action="split-view"]');
  check(await page.locator('.row.is-editing .sl').count() === 0, 'hiding the split view reverts it');
  check(await page.evaluate(() => document.querySelector('.row.is-editing .tb[data-block="b1"]').innerText) === 'Dirección estratégica de marca\nSegunda línea\nTercera línea', 'paragraph text keeps its line breaks');

  // Module: direction for wipe, independent from text presets
  await page.selectOption('#insp select[data-f="menter"]', 'wipe');
  await page.click('#insp [data-action="seg"][data-k="mdir"][data-v="left"]');
  check(await page.evaluate(() => document.querySelector('.row.is-editing .slot').dataset.anim) === 'Cortina', 'module shows its preset as a label on the canvas');
  check(await val(page, 'tenter') === 'split-mask', 'module preset does not override text presets');
  await page.selectOption('#insp select[data-f="tscroll"]', 'split-read');
  check(await val(page, 'tenter') === 'fade', 'scroll reading turns a split enter into a whole-block one');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(400);
  check(await page.locator('.row.is-editing').count() === 0, 'edit confirmed');
  check(await page.locator('#s-s_direccion .sw').count() > 0, 'scroll reading splits the text block into words');
  check(await page.evaluate(() => document.querySelector('#s-s_direccion .tb').getAttribute('aria-label')) === 'Dirección estratégica de marca\nSegunda línea\nTercera línea', 'split text keeps an aria-label');

  // 4. Fullscreen block: background and text over it
  await page.click('.sub[data-id="s_sepuede"]'); await page.waitForTimeout(1500);
  const fsRow = page.locator('#s-s_sepuede .row[data-layout="fullscreen"]');
  await fsRow.hover();
  await fsRow.locator('[data-action="row-edit"]').click();
  await page.waitForSelector('#insp select[data-f="menter"]');
  check(await val(page, 'menter') === 'fade', 'opens on the Animation view it was left on');
  check(JSON.stringify(await options(page, 'mscroll')) === '["none","fade-out"]', 'color background only offers scroll fade-out');
  await page.locator('#insp [data-action="tab"]').nth(1).click();
  check(await val(page, 'tenter') === 'split-rotate' && await pressed(page, 'tby') === 'chars', 'text over the background shows its own split preset');
  check(await page.inputValue('#f-tdelay') === '0.1', 'text block shows its own delay');
  await page.selectOption('#insp select[data-f="menter"]', 'blur');
  await page.click('#insp [data-action="anim-copy"]');
  check(await page.evaluate(() => document.querySelector('.row.is-editing .fs-media').dataset.anim) === 'Desenfoque', 'copy applies the module preset to the other modules');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(3000);
  check(await settled(page, '#s-s_sepuede .slot, #s-s_sepuede .tb'), 'confirmed presets end fully visible');

  // 5. Linked animation styles
  await page.click('.sub[data-id="s_direccion"]'); await page.waitForTimeout(1500);
  const tRow2 = page.locator('#s-s_direccion .row[data-layout="full"]').first();
  await tRow2.hover();
  await tRow2.locator('[data-action="row-edit"]').click();
  await page.waitForSelector('#insp .alist');
  await page.locator('#insp .alist button').nth(1).click();
  await page.click('#insp [data-action="style-new"][data-kind="text"]');
  await page.fill('#style-name', 'Título hero'); await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const styleText = () => page.evaluate(() => { const s = document.querySelector('#insp select[data-f="tstyle"]'); return s && s.selectedOptions[0].textContent; });
  check(await styleText() === 'Título hero', 'text animation saved as a named style and linked');
  check((await page.textContent('#insp .astyle-meta')).includes('Usado en 1 elemento'), 'style shows where it is used');
  check((await page.textContent('#insp .alist button:nth-child(2) .alist-v')).startsWith('★ Título hero'), 'text block list shows the linked style');
  await page.click('#insp [data-action="seg"][data-k="tdir"][data-v="right"]');
  check(await page.isVisible('#insp .astyle-mod'), 'editing a linked text marks it as modified');
  await page.click('#insp [data-action="style-update"][data-kind="text"]');
  await page.waitForTimeout(200);
  check(await page.locator('#insp .astyle-mod').count() === 0 && await pressed(page, 'tdir') === 'right', 'updating the style keeps the change and clears the override');
  await page.click('#insp [data-action="style-ask"][data-mode="apply"][data-kind="text"]');
  check((await page.textContent('#insp .astyle-q')).includes('1 título'), 'apply-to-all only targets texts of the same role (titles)');
  await page.screenshot({ path: T + 'motion-04-styles.png' });
  await page.click('#insp [data-action="style-apply"][data-kind="text"]');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+Enter'); await page.waitForTimeout(400);
  await page.click('.sub[data-id="s_sepuede"]'); await page.waitForTimeout(1500);
  const fsRow2 = page.locator('#s-s_sepuede .row[data-layout="fullscreen"]');
  await fsRow2.hover();
  await fsRow2.locator('[data-action="row-edit"]').click();
  await page.waitForSelector('#insp [data-action="tab"]');
  await page.locator('#insp [data-action="tab"]').nth(1).click();
  await page.locator('#insp .alist button').nth(0).click();
  check(await styleText() === 'Título hero' && await pressed(page, 'tdir') === 'right', 'the other title of the catalog is linked and follows the style');
  check(await val(page, 'tenter') === 'split-mask', 'linked title takes the style preset');
  await page.locator('#insp .alist button').nth(1).click();
  check(await styleText() === 'Sin estilo (propia)', 'the paragraph (another role) is not linked');
  await page.locator('#insp .alist button').nth(0).click();
  await page.click('#insp [data-action="style-ask"][data-mode="delete"][data-kind="text"]');
  await page.click('#insp [data-action="style-delete"][data-kind="text"]');
  await page.waitForTimeout(300);
  check(await styleText() === 'Sin estilo (propia)' && await val(page, 'tenter') === 'split-mask' && await pressed(page, 'tdir') === 'right', 'deleting the style unlinks it and keeps the animation');
  await page.keyboard.press('Control+Enter'); await page.waitForTimeout(3000);
  check(await settled(page, '#s-s_sepuede .slot, #s-s_sepuede .tb'), 'blocks end fully visible after the style changes');
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

  // 6. Reduced motion: nothing is animated or hidden
  const rm = await open(browser, { reducedMotion: 'reduce' });
  await rm.page.waitForTimeout(800);
  check(await rm.page.evaluate(() => ScrollTrigger.getAll().length === 0), 'reduced motion creates no triggers');
  check(await settled(rm.page, '#stage .slot, #stage .tb'), 'reduced motion shows all content');
  check(rm.errors.length === 0, 'no console errors with reduced motion');

  await browser.close();
  console.log(fails ? `\n${fails} check(s) failed` : '\nAll motion checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
