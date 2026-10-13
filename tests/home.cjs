// Home: the opening globe of the gallery media, the way back to it from any page (logo, back button), the lightbox,
// the admin gallery (add, reorder, remove, undo), reduced motion, phones, and the viewer/admin switch on the section
// pages. Local demo for most of it; the fake Supabase project for what must be stored (and seen by a visitor).
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

async function open(browser, url, opts = {}, prep) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1, ...opts });
  if (prep) await prep(ctx);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/lenis/, r => r.fulfill({ path: FIX + 'lenis.min.js', contentType: 'text/javascript' }));
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/gsap@[^/]+\/dist\/(gsap|ScrollTrigger|SplitText)\.min\.js/, r => r.fulfill({ path: FIX + r.request().url().split('/').pop(), contentType: 'text/javascript' }));
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js/, r => r.fulfill({ path: SB_JS, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
  const page = await ctx.newPage();
  page.errors = []; page.revoked = new Set(); /* blob URLs the test fetches on purpose after they were freed */
  page.on('console', m => { if (m.type() === 'error' && !page.revoked.has((m.location() || {}).url) && !/ERR_FAILED|ERR_CONNECTION_RESET|Failed to fetch|status of 409|status of 403/.test(m.text())) page.errors.push(m.text()); });
  page.on('pageerror', e => page.errors.push('pageerror: ' + e.message));
  await page.goto(url);
  return { page, ctx };
}
const view = (p) => p.evaluate(() => document.documentElement.dataset.view);
const turn = (p) => p.evaluate(() => { const m = /rotateY\(([-\d.]+)deg\)/.exec(document.querySelector('#globe').style.transform); return m ? +m[1] : NaN; });
const dAngle = (a, b) => Math.abs(((b - a + 540) % 360) - 180);
// The tile nearest to the middle of the globe that matches sel (fully drawn), as a point to aim the pointer at
const frontTile = (p, sel = '.gt') => p.evaluate((sel) => {
  const w = document.querySelector('#globe-wrap').getBoundingClientRect(), cx = w.left + w.width / 2, cy = w.top + w.height / 2;
  const c = [...document.querySelectorAll('#globe ' + sel)].filter(t => +getComputedStyle(t).opacity === 1).map(t => { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, i: t.dataset.i, d: Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy) }; }).sort((a, b) => a.d - b.d)[0];
  return c || null;
}, sel);
const lb = (p) => p.evaluate(() => {
  const h = document.querySelector('#home-lb'), f = h.querySelector('.hlb-frame');
  const r = f ? f.getBoundingClientRect() : null;
  return { open: !h.hidden, r: r && { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, rt: r.right, t: r.top, b: r.bottom }, img: f && f.querySelector('img') ? f.querySelector('img').getAttribute('src') : null, video: !!(f && f.querySelector('video')), anims: f ? f.getAnimations().length : 0, focusIn: h.contains(document.activeElement) };
});
const pageSwitch = (p) => p.evaluate(() => { const h = document.querySelector('#page-mode'); if (!h || h.hidden || !h.getClientRects().length) return null; const r = h.getBoundingClientRect(); return { left: r.left, bottom: innerHeight - r.bottom, ink: h.querySelector('.seg').dataset.ink, n: h.querySelectorAll('[data-action="mode"]').length }; });
const enterCategory = async (p, cat = 'c_ourbrand', sel = '#s-s_sepuede .row') => {
  await p.click('#btn-menu'); await p.waitForTimeout(700);
  await p.click(`.ov-cat[data-id="${cat}"]`);
  await p.waitForSelector(sel); await p.waitForTimeout(500);
};
const thumbIds = (p) => p.evaluate(() => [...document.querySelectorAll('#home-gal .hg-th[data-index]')].map(t => t.dataset.id));

(async () => {
  const browser = await chromium.launch();

  // ---------- 1. Landing on Home (local demo, OS in dark mode: the page still starts light) ----------
  const { page, ctx } = await open(browser, BASE, { colorScheme: 'dark' });
  await page.waitForSelector('#home #globe .gt');
  await page.waitForTimeout(600);
  const land = await page.evaluate(() => ({
    view: document.documentElement.dataset.view, scheme: document.documentElement.dataset.scheme, hash: location.hash,
    home: getComputedStyle(document.querySelector('#home')).display, stage: getComputedStyle(document.querySelector('#stage')).display,
    nav: getComputedStyle(document.querySelector('#rail-nav')).display, menu: document.querySelector('#menu').classList.contains('is-open'),
    tiles: document.querySelectorAll('#globe .gt').length, ph: document.querySelectorAll('#globe .gt[data-ph]').length,
    rings: new Set([...document.querySelectorAll('#globe .gt')].map(t => t.style.getPropertyValue('--lat'))).size,
    logo: (() => { const l = document.querySelector('#rail-logo [data-action="home"]'); return l ? l.textContent.trim() + '|' + l.getClientRects().length : ''; })(),
    hint: (document.querySelector('#home-tools .home-hint') || {}).textContent || ''
  }));
  check(land.view === 'home' && land.home === 'block' && land.stage === 'none' && land.nav === 'none' && !land.menu && land.hash === '', 'the page opens on Home: globe shown, section list and stage hidden, no hash, menu closed');
  check(land.scheme === 'light', 'light theme by default even when the OS prefers dark (' + land.scheme + ')');
  check(land.tiles >= 120 && land.rings >= 9 && land.rings <= 11, `globe of ${land.tiles} tiles on ${land.rings} latitude rings`);
  check(land.ph === land.tiles, 'with no media yet every tile is a placeholder');
  check(land.logo === 'belo|1', 'no logo uploaded: the "belo" wordmark is the way Home (' + land.logo + ')');
  check(land.hint === 'Añade imágenes o videos a la galería', 'admins see the hint to fill the gallery');
  check(await pageSwitch(page) === null, 'no viewer/admin switch on Home');
  await page.waitForTimeout(2600); /* the intro spin settles */
  await page.mouse.move(1490, 880);
  const a0 = await turn(page); await page.waitForTimeout(1000); const a1 = await turn(page);
  const free = dAngle(a0, a1);
  check(free > 3 && free < 20, `the globe turns on its own (${free.toFixed(1)}°/s)`);
  await page.screenshot({ path: T + 'home-01-landing.png' });

  // Hover: the tile lifts and the turn slows down a lot, without stopping
  let ft = await frontTile(page);
  await page.mouse.move(ft.x, ft.y); await page.waitForTimeout(900);
  const hov = await page.evaluate(() => { const h = document.querySelector('#globe .gt.is-hover'); return h ? { i: h.dataset.i, tf: getComputedStyle(h).transform, shadow: document.querySelector('#globe-shadow').classList.contains('is-on'), cursor: getComputedStyle(h).cursor } : null; });
  check(!!hov && hov.shadow && hov.cursor === 'pointer', 'hovering a tile lifts it (shadow on, pointer cursor)');
  const h0 = await turn(page); await page.waitForTimeout(1000); const h1 = await turn(page);
  const slow = dAngle(h0, h1);
  check(slow > 0.05 && slow < free * .35, `the turn slows down while a tile is hovered but keeps moving (${slow.toFixed(2)}°/s vs ${free.toFixed(1)}°/s)`);
  await page.screenshot({ path: T + 'home-02-hover.png' });

  // Click: the tile grows into a centered lightbox; Esc, the X and the backdrop close it
  ft = await frontTile(page);
  await page.mouse.click(ft.x, ft.y); await page.waitForTimeout(150);
  let L = await lb(page);
  check(L.open && L.anims > 0, 'clicking a tile opens the lightbox with a grow animation');
  await page.waitForTimeout(800);
  L = await lb(page);
  check(L.open && Math.abs(L.r.cx - 756) < 2 && Math.abs(L.r.cy - 450) < 2 && L.r.w <= 1512 * .72 + 1 && L.r.h <= 900 * .72 + 1, `the lightbox is centered and fits 72vw × 72vh (${Math.round(L.r.w)}×${Math.round(L.r.h)})`);
  check(L.focusIn && await page.evaluate(() => document.querySelectorAll('#globe .gt.is-out').length === 1), 'focus moves into the lightbox and the tile leaves the globe meanwhile');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  check((await lb(page)).focusIn, 'Tab stays inside the lightbox');
  await page.screenshot({ path: T + 'home-03-lightbox.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  check(!(await lb(page)).open && await page.evaluate(() => !document.querySelector('#globe .gt.is-out')), 'Esc closes the lightbox and the tile is back on the globe');
  ft = await frontTile(page); await page.mouse.click(ft.x, ft.y); await page.waitForTimeout(800);
  await page.click('#home-lb .hlb-x'); await page.waitForTimeout(800);
  check(!(await lb(page)).open, 'the X closes the lightbox');
  ft = await frontTile(page); await page.mouse.click(ft.x, ft.y); await page.waitForTimeout(800);
  await page.mouse.click(40, 450); await page.waitForTimeout(800);
  check(!(await lb(page)).open, 'clicking the backdrop closes the lightbox');

  // Drag spins the globe and is not a click
  const g0 = await turn(page);
  await page.mouse.move(600, 470); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(600 + i * 20, 470); await page.waitForTimeout(16); }
  await page.mouse.up(); await page.waitForTimeout(60);
  const g1 = await turn(page);
  check(dAngle(g0, g1) > 15 && !(await lb(page)).open, `dragging spins the globe (${dAngle(g0, g1).toFixed(0)}°) without opening a tile`);

  // ---------- 2. Admin gallery: add, lightbox of real media, reorder, remove + undo, files freed ----------
  await page.mouse.move(1490, 880); await page.waitForTimeout(300);
  await page.click('#home-tools [data-action="home-gal"]');
  await page.waitForSelector('#home-gal:not([hidden]) #home-file', { state: 'attached' });
  await page.setInputFiles('#home-file', ['img1.jpg', 'img2.jpg', 'img3.jpg', 'clip.webm'].map(f => FIX + f));
  check(await until(() => page.evaluate(() => /Subiendo/.test(document.querySelector('#home-tools .hbtn').textContent)), 1500), 'the Galería button shows the upload in progress');
  check(await until(async () => (await thumbIds(page)).length === 4), 'the four files are in the gallery');
  await page.waitForTimeout(600);
  const filled = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('#globe .gt')];
    const key = (t) => { const i = t.querySelector('img'); return i ? i.getAttribute('src') : t.querySelector('canvas') ? 'video' : 'ph'; };
    let same = 0;
    for (let k = 1; k < tiles.length; k++) if (tiles[k].style.getPropertyValue('--lat') === tiles[k - 1].style.getPropertyValue('--lat') && key(tiles[k]) === key(tiles[k - 1])) same++;
    return { img: document.querySelectorAll('#globe .gt img').length, cv: document.querySelectorAll('#globe .gt canvas').length, ph: document.querySelectorAll('#globe .gt[data-ph]').length, srcs: new Set(tiles.map(key)).size, same, hint: !!document.querySelector('#home-tools .home-hint'), n: (document.querySelector('#home-tools .hbtn-n') || {}).textContent };
  });
  check(filled.ph === 0 && filled.img > 0 && filled.cv > 0 && filled.srcs === 4, `the media fill every tile (${filled.img} images, ${filled.cv} video tiles, no placeholders)`);
  check(filled.same === 0, 'the same item is never next to itself on a ring');
  check(!filled.hint && filled.n === '4', 'the hint is gone and the Galería button counts 4');
  check(await until(() => page.evaluate(() => !!document.querySelector('#globe .gt canvas.is-on')), 5000), 'video tiles are painted from the shared hidden video');
  check(await page.evaluate(() => document.querySelectorAll('#home-vids video').length === 1), 'one hidden video element per video, not one per tile');
  await page.screenshot({ path: T + 'home-04-gallery.png' });
  await page.click('#home-gal [data-action="home-gal"]'); await page.waitForTimeout(500);
  await page.mouse.move(1490, 880); await page.waitForTimeout(800);
  await page.screenshot({ path: T + 'home-05-globe-media.png' });
  ft = await frontTile(page, '.gt:has(img.is-loaded)');
  await page.mouse.click(ft.x, ft.y); await page.waitForTimeout(900);
  L = await lb(page);
  check(L.open && !!L.img && L.img.startsWith('blob:'), 'an image tile opens the image itself in the lightbox');
  await page.screenshot({ path: T + 'home-06-lightbox-image.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  await page.mouse.move(1490, 880);
  ft = await frontTile(page, '.gt:has(canvas)');
  await page.mouse.click(ft.x, ft.y); await page.waitForTimeout(900);
  L = await lb(page);
  check(L.open && L.video && await page.evaluate(() => { const v = document.querySelector('#home-lb video'); return v.muted && v.loop && v.controls; }), 'a video tile opens the video (muted, looping, with controls)');
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);

  await page.click('#home-tools [data-action="home-gal"]'); await page.waitForTimeout(400);
  let ids = await thumbIds(page);
  // drag the first thumbnail onto the third
  const r0 = await page.locator('#home-gal .hg-th[data-index="0"]').boundingBox(), r2 = await page.locator('#home-gal .hg-th[data-index="2"]').boundingBox();
  await page.mouse.move(r0.x + r0.width / 2, r0.y + r0.height / 2); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(r0.x + r0.width / 2 + (r2.x - r0.x) * i / 8, r0.y + r0.height / 2 + 2 * i, { steps: 1 }); await page.waitForTimeout(16); }
  await page.mouse.up(); await page.waitForTimeout(500);
  let ids2 = await thumbIds(page);
  check(ids2[2] === ids[0] && ids2.length === 4, 'dragging a thumbnail reorders the gallery');
  await page.locator('#home-gal .hg-th[data-index="3"]').focus();
  await page.keyboard.press('Alt+ArrowLeft'); await page.waitForTimeout(300);
  const ids3 = await thumbIds(page);
  check(ids3[2] === ids2[3], 'Alt + arrow moves the focused thumbnail');
  // remove + undo
  const gone = ids3[1];
  const goneUrl = await page.evaluate((id) => document.querySelector(`#home-gal .hg-th[data-id="${id}"] img, #home-gal .hg-th[data-id="${id}"] video`).getAttribute('src').split('#')[0], gone);
  await page.locator(`#home-gal .hg-th[data-id="${gone}"]`).hover();
  await page.click(`#home-gal .hg-th[data-id="${gone}"] [data-action="home-remove"]`); await page.waitForTimeout(300);
  check(!(await thumbIds(page)).includes(gone) && (await thumbIds(page)).length === 3, 'the × removes an item from the gallery');
  await page.mouse.move(1490, 880);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  check((await thumbIds(page)).join() === ids3.join(), 'Ctrl+Z puts it back in the same place');
  const loads = (u) => page.evaluate(async (u) => { try { const r = await fetch(u); return r.ok; } catch { return false; } }, u);
  check(await loads(goneUrl), 'its file is still there after the undo');
  await page.locator(`#home-gal .hg-th[data-id="${gone}"]`).focus();
  await page.keyboard.press('Delete'); await page.waitForTimeout(300);
  check((await thumbIds(page)).length === 3, 'Delete on a focused thumbnail removes it');
  check(await loads(goneUrl), 'the file is kept while the gallery is open (undo is still possible)');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  check(await page.evaluate(() => document.querySelector('#home-gal').hidden), 'Esc closes the gallery');
  page.revoked.add(goneUrl);
  check(await until(async () => !(await loads(goneUrl))), 'closing the gallery deletes the removed file');
  check(await page.evaluate(() => document.querySelectorAll('#globe .gt img, #globe .gt canvas').length === document.querySelectorAll('#globe .gt').length), 'the globe now shows the three remaining items');
  // files dropped anywhere on Home open the gallery and are added
  const dt = await page.evaluateHandle((b64) => { const d = new DataTransfer(); d.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'dropped.jpg', { type: 'image/jpeg' })); return d; }, fs.readFileSync(FIX + 'img4.jpg').toString('base64'));
  await page.dispatchEvent('#home', 'dragover', { dataTransfer: dt });
  check(await page.evaluate(() => !document.querySelector('#home-gal').hidden), 'dragging files over Home opens the gallery as the place to drop them');
  await page.dispatchEvent('#home', 'drop', { dataTransfer: dt });
  check(await until(async () => (await thumbIds(page)).length === 4), 'dropped files are added to the gallery');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // a catalog export (.json) is an import, not gallery media: dragging it over Home leaves the gallery closed
  const dj = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['{}'], 'catalogo.json', { type: 'application/json' })); return d; });
  await page.dispatchEvent('#home', 'dragover', { dataTransfer: dj });
  check(await page.evaluate(() => document.querySelector('#home-gal').hidden), 'dragging a catalog export over Home does not open the gallery');

  // ---------- 3. Leaving Home, the logo, the back button, and the viewer/admin switch on the pages ----------
  await enterCategory(page);
  const cat = await page.evaluate(() => ({ view: document.documentElement.dataset.view, hash: location.hash, stage: getComputedStyle(document.querySelector('#stage')).display, nav: getComputedStyle(document.querySelector('#rail-nav')).display }));
  check(cat.view === 'cat' && cat.stage !== 'none' && cat.nav !== 'none' && cat.hash === '#s_direccion', 'a category in the menu leaves Home for its page (' + cat.hash + ')');
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#globe')).display !== 'none' && document.querySelector('#home').getClientRects().length === 0), 'Home is hidden on the page');
  let sw = await pageSwitch(page);
  check(!!sw && sw.n === 2 && Math.round(sw.left) === 20 && Math.round(sw.bottom) === 20 && !!sw.ink, `editors get the viewer/admin switch bottom left on the page (${sw && Math.round(sw.left)}, ${sw && Math.round(sw.bottom)}, ink ${sw && sw.ink})`);
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#rail-nav')).paddingBottom === '96px'), 'the section list keeps room for the switch');
  await page.screenshot({ path: T + 'home-07-page-switch.png' });
  await page.click('#page-mode [data-mode="viewer"]'); await page.waitForTimeout(500);
  check(await page.evaluate(() => document.documentElement.dataset.mode === 'viewer' && document.querySelector('#page-mode [data-mode="viewer"]').getAttribute('aria-pressed') === 'true') && !!(await pageSwitch(page)), 'the switch turns the page to viewer and stays visible');
  await page.click('#page-mode [data-mode="admin"]'); await page.waitForTimeout(500);
  check(await page.evaluate(() => document.documentElement.dataset.mode === 'admin' && document.querySelector('#page-mode .seg').dataset.v === '1'), 'and back to admin');
  await page.click('#btn-menu'); await page.waitForTimeout(500);
  check(await pageSwitch(page) === null, 'the page switch hides while the menu is open (the menu has its own)');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  check(!!(await pageSwitch(page)), 'and comes back when the menu closes');
  await page.locator('#stage .row[data-id="r_t"]').hover();
  await page.click('#stage .row[data-id="r_t"] [data-action="row-edit"]');
  await page.waitForSelector('.row.is-editing');
  check(await pageSwitch(page) === null, 'the page switch hides while a block is edited (the inspector uses that corner)');
  await page.click('#insp [data-action="cancel-edit"]'); await page.waitForTimeout(500);
  check(!!(await pageSwitch(page)), 'and comes back after the edit');

  await page.click('#rail-logo [data-action="home"]'); await page.waitForTimeout(700);
  check(await view(page) === 'home' && await page.evaluate(() => location.hash === '' && !document.querySelector('#page-mode').getClientRects().length), 'the logo goes back Home from a section page (no hash, no page switch)');
  await page.goBack(); await page.waitForTimeout(700);
  check(await view(page) === 'cat' && await page.evaluate(() => location.hash) === '#s_direccion', 'the browser back button returns to the section');
  await page.goForward(); await page.waitForTimeout(700);
  check(await view(page) === 'home', 'and forward goes Home again');
  await page.click('#btn-search'); await page.waitForTimeout(400);
  await page.keyboard.type('se puede'); await page.waitForTimeout(300); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  check(await view(page) === 'cat' && await page.evaluate(() => location.hash) === '#s_sepuede', 'a search result from Home opens its section');
  await page.click('#btn-menu'); await page.waitForTimeout(700);
  await page.click('#menu [data-logo-slot] [data-action="home"]'); await page.waitForTimeout(700);
  check(await view(page) === 'home' && await page.evaluate(() => !document.querySelector('#menu').classList.contains('is-open')), 'the logo inside the menu closes it and goes Home');
  // viewer mode on Home: no gallery tools
  await page.click('#btn-menu'); await page.waitForTimeout(700);
  await page.click('#menu [data-action="mode"][data-mode="viewer"]'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  check(await page.evaluate(() => !document.querySelector('#home-tools').getClientRects().length && !!document.querySelector('#rail-logo [data-action="home"]').getClientRects().length), 'viewers see neither the Galería button nor the hint; the logo stays');
  check(page.errors.length === 0, 'no page errors (desktop): ' + page.errors.join(' | '));
  await ctx.close();

  // ---------- 4. A link to a section skips Home ----------
  {
    const { page: p, ctx: c } = await open(browser, BASE + '#s_sepuede');
    await p.waitForSelector('#s-s_sepuede .row');
    await p.waitForTimeout(500);
    check(await view(p) === 'cat' && await p.evaluate(() => document.querySelectorAll('#globe .gt').length === 0), 'a link to a section opens it directly (the globe is not even built)');
    await p.click('#rail-logo [data-action="home"]'); await p.waitForTimeout(800);
    check(await view(p) === 'home' && await p.evaluate(() => document.querySelectorAll('#globe .gt').length >= 120), 'the logo builds and shows Home');
    check(p.errors.length === 0, 'no page errors (section link): ' + p.errors.join(' | '));
    await c.close();
  }

  // ---------- 5. Reduced motion ----------
  {
    const { page: p, ctx: c } = await open(browser, BASE, { reducedMotion: 'reduce' });
    await p.waitForSelector('#home #globe .gt'); await p.waitForTimeout(400);
    const b0 = await turn(p); await p.waitForTimeout(1200); const b1 = await turn(p);
    check(b0 === b1 && Number.isFinite(b0), 'reduced motion: the globe holds still');
    const f = await frontTile(p);
    await p.mouse.click(f.x, f.y); await p.waitForTimeout(60);
    const l = await lb(p);
    check(l.open && l.anims === 0 && Math.abs(l.r.cx - 756) < 2, 'reduced motion: the lightbox opens at once, centered');
    await p.keyboard.press('Escape'); await p.waitForTimeout(60);
    check(!(await lb(p)).open, 'reduced motion: it closes at once');
    check(await turn(p) === b0, 'reduced motion: still no rotation afterwards');
    check(p.errors.length === 0, 'no page errors (reduced motion): ' + p.errors.join(' | '));
    await c.close();
  }

  // ---------- 6. Phone ----------
  {
    const { page: p, ctx: c } = await open(browser, BASE, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.waitForSelector('#home #globe .gt'); await p.waitForTimeout(1800);
    const m = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, R: parseFloat(document.querySelector('#home').style.getPropertyValue('--gr')), top: document.querySelector('.rail-top').getBoundingClientRect().bottom, gy: parseFloat(document.querySelector('#home').style.getPropertyValue('--gy')) }));
    check(m.over <= 0 && m.R * 2 <= 390 * 1.03 && m.gy - m.R > m.top, `phone: the globe spans the width under the top bar, no sideways scroll (diameter ${Math.round(m.R * 2)})`);
    await p.screenshot({ path: T + 'home-08-phone.png' });
    const f = await frontTile(p);
    await p.touchscreen.tap(f.x, f.y); await p.waitForTimeout(900);
    const l = await lb(p);
    check(l.open && l.r.l >= 0 && l.r.rt <= 390 && l.r.t >= 0 && l.r.b <= 844, 'phone: a tap opens the lightbox inside the screen');
    await p.screenshot({ path: T + 'home-09-phone-lightbox.png' });
    await p.tap('#home-lb .hlb-x'); await p.waitForTimeout(800);
    check(!(await lb(p)).open, 'phone: the X closes it');
    await p.tap('#btn-menu'); await p.waitForTimeout(700);
    await p.tap('.ov-cat[data-id="c_ourbrand"]'); await p.waitForTimeout(900);
    const s = await pageSwitch(p);
    check(!!s && Math.round(s.left) === 16 && await p.evaluate(() => getComputedStyle(document.querySelector('#rail-nav')).paddingBottom === '12px'), 'phone: the page switch sits 16px from the left and the section list keeps its padding');
    check(p.errors.length === 0, 'no page errors (phone): ' + p.errors.join(' | '));
    await c.close();
  }

  // ---------- 7. Stored for everyone (fake Supabase): an editor adds an image, a visitor sees it, removing frees it ----------
  {
    const fake = new FakeSupabase(SUPA_URL);
    const leo = fake.addUser({ email: 'leo@paisanoscreando.com', name: 'Leo Suárez' });
    fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [{ id: 'c_brand', name: 'Our Brand', subs: [{ id: 's_intro', name: 'Intro' }] }] }, leo.id);
    fake.seed('pages/s_intro', { rows: [] }, leo.id);
    const ed = await open(browser, SUPA_BASE, {}, async (c) => { await fake.attach(c, 'leo'); await fake.signInContext(c, leo); });
    const E = ed.page;
    await E.waitForSelector('#home #globe .gt');
    check(await until(() => E.evaluate(() => document.documentElement.dataset.mode === 'admin')), 'Supabase: Leo (editor) lands on Home in admin');
    await E.click('#home-tools [data-action="home-gal"]');
    fake.uploadBytes = fs.readFileSync(FIX + 'img1.jpg');
    await E.setInputFiles('#home-file', FIX + 'img1.jpg');
    const stored = await until(() => { const t = fake.docs.get('catalog/tree'); return !!(t && t.data.home && t.data.home.media.length === 1); }, 8000);
    const media = stored ? fake.docs.get('catalog/tree').data.home.media[0] : {};
    check(stored && media.kind === 'image' && fake.files.has(media.id) && media.w > 0 && media.h > 0, 'Supabase: the image is stored in the bucket and in the catalog tree (' + media.id + ')');
    const vis = await open(browser, SUPA_BASE, {}, (c) => fake.attach(c, 'visitor'));
    const V = vis.page;
    await V.waitForSelector('#home #globe .gt');
    check(await until(() => V.evaluate((id) => [...document.querySelectorAll('#globe .gt img')].some(i => i.src.includes(id)) && !document.querySelector('#globe .gt[data-ph]'), media.id)), 'Supabase: a visitor sees the globe made of that image');
    check(await V.evaluate(() => !document.querySelector('#home-tools').getClientRects().length && !document.querySelector('#page-mode').getClientRects().length), 'Supabase: the visitor has no gallery tools and no view switch');
    await E.reload(); await E.waitForSelector('#home #globe .gt');
    check(await until(() => E.evaluate((id) => [...document.querySelectorAll('#globe .gt img')].some(i => i.src.includes(id)), media.id)), 'Supabase: after a reload the globe still shows it');
    await until(() => E.evaluate(() => document.documentElement.dataset.mode === 'admin'));
    await E.click('#home-tools [data-action="home-gal"]'); await E.waitForTimeout(300);
    await E.locator('#home-gal .hg-th[data-index="0"]').hover();
    await E.click('#home-gal .hg-th[data-index="0"] [data-action="home-remove"]');
    await E.click('#home-gal [data-action="home-gal"]');
    check(await until(() => !fake.files.has(media.id) && fake.docs.get('catalog/tree').data.home.media.length === 0, 8000), 'Supabase: removing it and closing the gallery deletes the file and the entry');
    check(await until(() => V.evaluate(() => document.querySelectorAll('#globe .gt[data-ph]').length === document.querySelectorAll('#globe .gt').length)), 'Supabase: the visitor\'s globe goes back to placeholders live');
    const errs = [...E.errors, ...V.errors].filter(e => !/status of 40[49]/.test(e));
    check(errs.length === 0, 'no page errors (Supabase): ' + errs.join(' | '));
    await ed.ctx.close(); await vis.ctx.close();
  }

  await browser.close();
  if (fails) { console.error(`${fails} home check(s) failed`); process.exit(1); }
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
