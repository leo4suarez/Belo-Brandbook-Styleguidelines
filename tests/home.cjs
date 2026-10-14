// Home: the opening spatial slider of the gallery media (cards on the inside of a curve in CSS 3D), its navigation
// (buttons, dots, keys, wheel, drag with inertia), hover and the lightbox, the way back to it from any page (logo, back
// button), the admin gallery (add, caption, reorder, remove, undo), reduced motion, phones, and the viewer/admin switch
// on the section pages. Local demo for most of it; the fake Supabase project for what must be stored (and seen by a visitor).
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
// The cards in view, left to right, with their screen box, item index and how they sit in 3D: z of their center and of
// their two side edges (from the computed transform), so the curve itself can be checked
const cards = (p) => p.evaluate(() => [...document.querySelectorAll('#hs-stage .hs-card:not(.is-off)')].map(el => {
  const r = el.getBoundingClientRect(), m = new DOMMatrix(getComputedStyle(el).transform), w = el.offsetWidth / 2;
  return { k: el.dataset.k, i: +el.dataset.i, x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height,
    z: m.m43, zl: m.transformPoint(new DOMPoint(-w, 0, 0)).z, zr: m.transformPoint(new DOMPoint(w, 0, 0)).z, ph: el.querySelector('.hs-media').dataset.ph ?? null };
}).sort((a, b) => a.x - b.x));
// The card in the middle of the viewport (by its screen center) and how far off center it is
const center = async (p) => { const W = await p.evaluate(() => innerWidth); const c = (await cards(p)).map(c => ({ ...c, dx: c.x - W / 2 })).sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx))[0]; return c; };
const dot = (p) => p.evaluate(() => { const d = document.querySelector('#hs-nav .hs-dot[aria-current="true"]'); if (d) return +d.dataset.i; const c = document.querySelector('#hs-nav .hs-count b'); return c ? +c.textContent - 1 : -1; });
const settled = async (p, ms = 1400) => { await p.waitForTimeout(ms); };
const lb = (p) => p.evaluate(() => {
  const h = document.querySelector('#home-lb'), f = h.querySelector('.hlb-frame');
  const r = f ? f.getBoundingClientRect() : null;
  return { open: !h.hidden, r: r && { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, rt: r.right, t: r.top, b: r.bottom }, img: f && f.querySelector('img') ? f.querySelector('img').getAttribute('src') : null, video: !!(f && f.querySelector('video')), anims: f ? f.getAnimations().length : 0, focusIn: h.contains(document.activeElement), out: [...document.querySelectorAll('#hs-stage .hs-card.is-out')].map(c => c.dataset.k), cap: (h.querySelector('.hlb-cap') || {}).textContent || '' };
});
const pageSwitch = (p) => p.evaluate(() => { const h = document.querySelector('#page-mode'); if (!h || h.hidden || !h.getClientRects().length) return null; const r = h.getBoundingClientRect(); return { left: r.left, bottom: innerHeight - r.bottom, ink: h.querySelector('.seg').dataset.ink, n: h.querySelectorAll('[data-action="mode"]').length }; });
const enterCategory = async (p, cat = 'c_ourbrand', sel = '#s-s_sepuede .row') => {
  await p.click('#btn-menu'); await p.waitForTimeout(700);
  await p.click(`.ov-cat[data-id="${cat}"]`);
  await p.waitForSelector(sel); await p.waitForTimeout(500);
};
// Neighbouring cards never cover each other: in screen order each one starts after the previous one ends
const overlaps = (cs) => cs.slice(1).map((c, j) => Math.round((cs[j].r - c.l) * 10) / 10).filter(o => o > .5);
const minGap = (cs) => Math.min(...cs.slice(1).map((c, j) => c.l - cs[j].r));
// Where the mouse can rest: over the controls (the drift pauses there, like over the cards) or above the cards (it drifts)
const park = async (p) => { const r = await p.locator('#hs-nav .hs-dots, #hs-nav .hs-count').first().boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); };
const away = (p) => p.mouse.move(1490, 140);
const xOf = (p, k) => p.evaluate((k) => { const r = document.querySelector(`#hs-stage .hs-card[data-k="${k}"]`).getBoundingClientRect(); return r.left + r.width / 2; }, k);
const thumbIds = (p) => p.evaluate(() => [...document.querySelectorAll('#home-gal .hg-th[data-index]')].map(t => t.dataset.id));
// A pointer drag across the slider, n steps of dx pixels, ms apart
const drag = async (p, x, y, dx, n = 10, ms = 16) => {
  await p.mouse.move(x, y); await p.mouse.down();
  for (let i = 1; i <= n; i++) { await p.mouse.move(x + dx * i / n, y); await p.waitForTimeout(ms); }
  await p.mouse.up();
};

(async () => {
  const browser = await chromium.launch();

  // ---------- 1. Landing on Home (local demo, OS in dark mode: the page still starts light) ----------
  const { page, ctx } = await open(browser, BASE, { colorScheme: 'dark' });
  await page.waitForSelector('#home .hs-card');
  await settled(page, 1800); /* the intro sweep settles */
  const land = await page.evaluate(() => ({
    view: document.documentElement.dataset.view, scheme: document.documentElement.dataset.scheme, hash: location.hash,
    home: getComputedStyle(document.querySelector('#home')).display, stage: getComputedStyle(document.querySelector('#stage')).display,
    nav: getComputedStyle(document.querySelector('#rail-nav')).display, menu: document.querySelector('#menu').classList.contains('is-open'),
    n: document.querySelectorAll('#hs-stage .hs-card').length, ph: document.querySelectorAll('#hs-stage .hs-media[data-ph]').length,
    persp: getComputedStyle(document.querySelector('#hs-stage')).perspective,
    btns: [...document.querySelectorAll('#hs-nav .hs-btn')].map(b => b.getAttribute('aria-label')).join(','), dots: document.querySelectorAll('#hs-nav .hs-dot').length,
    over: document.documentElement.scrollWidth - innerWidth, scroll: document.documentElement.scrollHeight - innerHeight,
    logo: (() => { const l = document.querySelector('#rail-logo [data-action="home"]'); return l ? l.textContent.trim() + '|' + l.getClientRects().length : ''; })(),
    hint: (document.querySelector('#home-tools .home-hint') || {}).textContent || ''
  }));
  check(land.view === 'home' && land.home === 'block' && land.stage === 'none' && land.nav === 'none' && !land.menu && land.hash === '', 'the page opens on Home: slider shown, section list and stage hidden, no hash, menu closed');
  check(land.scheme === 'light', 'light theme by default even when the OS prefers dark (' + land.scheme + ')');
  check(land.n >= 8 && land.n % 8 === 0 && land.ph === land.n && land.dots === 8, `with no media yet the slider loops ${land.n} placeholder cards, one dot per placeholder (${land.dots})`);
  check(land.btns === 'Anterior,Siguiente', 'Prev / Next buttons are labeled in Spanish');
  check(land.over <= 0 && land.scroll <= 0, 'Home fills the screen: no page scroll either way');
  check(land.logo === 'belo|1', 'no logo uploaded: the "belo" wordmark is the way Home (' + land.logo + ')');
  check(land.hint === 'Añade imágenes o videos a la galería', 'admins see the hint to fill the gallery');
  check(await pageSwitch(page) === null, 'no viewer/admin switch on Home');
  {
    const cs = await cards(page), c = await center(page), W = 1512;
    check(Math.abs(c.dx) < 90 && c.ph === '4' && await page.evaluate((k) => !!document.querySelector(`.hs-card[data-k="${k}"] .hs-b`), c.k), 'the brand blue placeholder with the small "b" opens in the middle');
    check(cs[0].l < 0 && cs[cs.length - 1].r > W && cs.length >= 4, `the row runs off both edges (${cs.length} cards in view: ${Math.round(cs[0].l)} … ${Math.round(cs[cs.length - 1].r)})`);
    const side = cs.filter(x => Math.abs(x.x - W / 2) > 200);
    check(Math.abs(c.zl - c.zr) < 40 && side.length >= 3 && side.every(x => (x.x < W / 2 ? x.zl > x.zr : x.zr > x.zl)), 'real 3D: the middle card faces the viewer, the side ones turn to face the axis of the curve');
    const R = cs.filter(x => x.x > W / 2).sort((a, b) => a.x - b.x);
    check(R.length >= 2 && R[1].zr - R[1].zl > R[0].zr - R[0].zl, 'the farther from the middle, the more a card turns (the row wraps around)');
    check(overlaps(cs).length === 0 && minGap(cs) > 2, `no card is drawn over its neighbour, out to both edges (smallest gap ${Math.round(minGap(cs))}px)`);
    const shapes = await page.evaluate(() => [...document.querySelectorAll('#hs-stage .hs-card')].map(e => { const m = e.querySelector('.hs-media'), cs = getComputedStyle(e); return { bg: cs.backgroundColor, pad: cs.paddingTop, fill: m.offsetWidth === e.offsetWidth && m.offsetHeight === e.offsetHeight, ar: Math.round(e.offsetWidth / e.offsetHeight * 100) / 100, h: e.offsetHeight }; }));
    check(shapes.every(x => x.bg === 'rgba(0, 0, 0, 0)' && x.pad === '0px' && x.fill), 'no card frames: each card is the image itself, edge to edge');
    check(new Set(shapes.map(x => x.ar)).size >= 3 && new Set(shapes.map(x => x.h)).size === 1, 'cards share one height and their widths follow their shapes (placeholders mix 4:5, 1:1 and 16:9)');
  }
  await page.screenshot({ path: T + 'home-01-landing.png' });

  // Autoplay: the row drifts slowly on its own; the mouse over the cards (or the controls) eases it to a stop, leaving
  // starts it again; the dot follows whatever card is in the middle
  {
    await away(page); await page.waitForTimeout(1200);
    const k = (await center(page)).k;
    const a0 = await xOf(page, k); await page.waitForTimeout(1000); const a1 = await xOf(page, k); await page.waitForTimeout(1000); const a2 = await xOf(page, k);
    check(a1 < a0 - 8 && a2 < a1 - 8 && Math.abs((a0 - a1) - (a1 - a2)) < 8 && a0 - a2 < 120, `the row drifts on its own, slowly and evenly (${Math.round(a0 - a1)} and ${Math.round(a1 - a2)} px/s)`);
    const c = await center(page);
    check(await dot(page) === c.i, 'the dot follows the card in the middle while it drifts');
    const cs = await cards(page);
    check(overlaps(cs).length === 0, 'mid-drift, still no card over its neighbour');
    await page.screenshot({ path: T + 'home-02-drift.png' });
    await page.mouse.move(c.x, c.y); await page.waitForTimeout(900);
    const h0 = await xOf(page, c.k); await page.waitForTimeout(1000); const h1 = await xOf(page, c.k);
    check(Math.abs(h1 - h0) < 1, `the mouse over the cards brings the drift to a stop (${(h1 - h0).toFixed(1)}px in 1s)`);
    await page.click('#hs-nav [data-action="hs-next"]'); await settled(page);
    const n = await center(page);
    check(n.i === (c.i + 1) % 8 && Math.abs(n.dx) < 1, 'it can still be moved by hand meanwhile (Siguiente)');
    await page.mouse.move(n.x, n.y); await page.waitForTimeout(800);
    const s0 = await xOf(page, n.k); await page.waitForTimeout(800);
    check(Math.abs(await xOf(page, n.k) - s0) < 1, 'and it stays put while the mouse is there');
    await away(page); await page.waitForTimeout(2000);
    const r0 = await xOf(page, n.k); await page.waitForTimeout(800); const r1 = await xOf(page, n.k);
    check(r1 < r0 - 6, `leaving the cards starts the drift again (${Math.round(r0 - r1)}px in 0.8s)`);
  }

  // Prev / Next glide along the curve and loop; the dots follow (the mouse on the controls keeps the drift paused)
  await page.click('#hs-nav .hs-dot[data-i="0"]'); await settled(page);
  await page.click('#hs-nav [data-action="hs-next"]'); await page.waitForTimeout(110);
  const mid = await center(page);
  check(Math.abs(mid.dx) > 20, `Siguiente glides (the row is between cards ${Math.round(mid.dx)}px after 110ms)`);
  await settled(page);
  let c1 = await center(page);
  check(c1.i === 1 && Math.abs(c1.dx) < 1 && await dot(page) === 1, 'Siguiente brings the next card to the middle and moves the dot');
  await page.click('#hs-nav [data-action="hs-prev"]'); await settled(page, 900);
  await page.click('#hs-nav [data-action="hs-prev"]'); await settled(page);
  c1 = await center(page);
  check(c1.i === 7 && await dot(page) === 7, 'Anterior twice from the second card loops around to the last one');
  await page.click('#hs-nav .hs-dot[data-i="3"]'); await settled(page);
  check((await center(page)).i === 3 && await dot(page) === 3, 'a dot brings its card to the middle');
  await page.keyboard.press('ArrowRight'); await settled(page);
  check((await center(page)).i === 4, 'ArrowRight moves to the next card');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await settled(page);
  check((await center(page)).i === 2, 'ArrowLeft moves back (twice)');
  await page.mouse.move(756, 450); await page.mouse.wheel(0, 100); await settled(page);
  check((await center(page)).i === 3, 'a mouse wheel notch steps one card');
  await page.mouse.wheel(60, 0); await page.waitForTimeout(30); await page.mouse.wheel(40, 0); await settled(page);
  c1 = await center(page);
  check(c1.i === 4 && Math.abs(c1.dx) < 1, 'a horizontal trackpad swipe moves the row and settles on a card');

  // Drag: a short pull snaps to the next card, a tiny one back, a flick carries further; none of them opens a card
  await park(page); await page.waitForTimeout(200);
  await drag(page, 900, 450, -110, 10, 30); await settled(page);
  c1 = await center(page);
  check(c1.i === 5 && Math.abs(c1.dx) < 1 && !(await lb(page)).open, 'a short slow drag snaps to the next card, centered, and opens nothing');
  await drag(page, 900, 450, 25, 5, 30); await settled(page);
  c1 = await center(page);
  check(c1.i === 5 && Math.abs(c1.dx) < 1 && !(await lb(page)).open, 'a tiny drag snaps back to the same card');
  await drag(page, 1100, 450, -520, 6, 12); await page.waitForTimeout(200);
  const flying = await center(page);
  await settled(page, 1800);
  c1 = await center(page);
  const went = (c1.i - 5 + 8) % 8;
  check(went >= 2 && Math.abs(c1.dx) < 1 && !(await lb(page)).open, `a flick carries on with inertia and lands on a card (${went} cards on)`);
  check(Math.abs(flying.dx) > 2, 'the throw is animated, not a jump');

  // Hover: the card under the pointer lifts (closer, slightly bigger) with a pointer cursor; the neighbour too
  {
    const c = await center(page);
    await page.mouse.move(c.x, c.y); await page.waitForTimeout(600);
    const h = await page.evaluate(() => { const el = document.querySelector('#hs-stage .hs-card.is-hover'); return el ? { k: el.dataset.k, cursor: getComputedStyle(document.querySelector('#home')).cursor, z: new DOMMatrix(getComputedStyle(el).transform).m43 } : null; });
    const after = (await cards(page)).find(x => x.k === c.k);
    check(!!h && h.k === c.k && h.cursor === 'pointer' && h.z > c.z + 5 && after.w > c.w + 2, `hovering a card lifts it toward the viewer (z ${Math.round(c.z)} → ${Math.round(h && h.z)}, width ${Math.round(c.w)} → ${Math.round(after.w)}) with a pointer cursor`);
    await page.screenshot({ path: T + 'home-03-hover.png' });
    const n = (await cards(page)).filter(x => x.x > c.x + 50 && x.x < 1450)[0];
    await page.mouse.move(n.x, n.y); await page.waitForTimeout(400);
    check(await page.evaluate(() => (document.querySelector('#hs-stage .hs-card.is-hover') || {}).dataset?.k) === n.k, 'hover follows the pointer to a side card');
    await page.mouse.move(c.x, 140); await page.waitForTimeout(400);
    check(await page.evaluate(() => !document.querySelector('#hs-stage .hs-card.is-hover') && getComputedStyle(document.querySelector('#home')).cursor !== 'pointer'), 'off the cards nothing is lifted');
  }

  // Click: the card grows into a centered lightbox; Esc, the X and the backdrop close it; the card glides to the middle
  {
    const n = (await cards(page)).filter(x => x.x > 900 && x.x < 1450)[0];
    await page.mouse.click(n.x, n.y); await page.waitForTimeout(150);
    let L = await lb(page);
    check(L.open && L.anims > 0 && L.out.length === 1 && L.out[0] === n.k, 'clicking a side card opens that card in the lightbox with a grow animation');
    await page.waitForTimeout(900);
    L = await lb(page);
    check(L.open && Math.abs(L.r.cx - 756) < 2 && Math.abs(L.r.cy - 450) < 2 && L.r.w <= 1512 * .72 + 1 && L.r.h <= 900 * .72 + 1, `the lightbox is centered and fits 72vw × 72vh (${Math.round(L.r.w)}×${Math.round(L.r.h)})`);
    check((await center(page)).k === n.k, 'behind the veil, the opened card glides to the middle');
    check(L.focusIn, 'focus moves into the lightbox');
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    check((await lb(page)).focusIn, 'Tab stays inside the lightbox');
    await page.screenshot({ path: T + 'home-04-lightbox.png' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(900);
    check(!(await lb(page)).open && (await lb(page)).out.length === 0, 'Esc closes the lightbox and the card is back');
    let c = await center(page); await page.mouse.click(c.x, c.y); await page.waitForTimeout(800);
    await page.click('#home-lb .hlb-x'); await page.waitForTimeout(800);
    check(!(await lb(page)).open, 'the X closes the lightbox');
    c = await center(page); await page.mouse.click(c.x, c.y); await page.waitForTimeout(800);
    await page.mouse.click(40, 450); await page.waitForTimeout(800);
    check(!(await lb(page)).open, 'clicking the backdrop closes the lightbox');
    await page.focus('#hs'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const kc = await lb(page), cc = await center(page);
    check(kc.open && kc.out[0] === cc.k, 'Enter on the slider opens the card in the middle');
    await page.keyboard.press('Escape'); await page.waitForTimeout(800);
    check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'hs'), 'and closing returns the focus to the slider');
  }
  // Every card in view answers the pointer despite the 3D turn: aimed at the middle of the part that shows (the ones
  // nearer the middle are drawn over their outer neighbours) and near its outer edge, the click opens that same card
  {
    let ok = 0, n = 0; const miss = [];
    for (const side of [0, 1]) {
      await park(page); await settled(page, 300);
      const ks = (await cards(page)).map(c => c.k);
      for (const k of ks) {
        const cs = await cards(page), j = cs.findIndex(x => x.k === k); if (j < 0) continue;
        const c = cs[j], left = c.x < 756 - 5, right = c.x > 756 + 5;
        const a = Math.max(c.l, right && cs[j - 1] ? cs[j - 1].r : -Infinity, 4), b = Math.min(c.r, left && cs[j + 1] ? cs[j + 1].l : Infinity, 1508);
        if (b - a < 40) continue;
        const x = side ? (left ? a + (b - a) * .15 : b - (b - a) * .15) : (a + b) / 2;
        n++;
        await page.mouse.click(x, c.y); await page.waitForTimeout(160);
        const L = await lb(page);
        if (L.open && L.out[0] === c.k) ok++; else miss.push(c.k + '@' + Math.round(x) + '→' + L.out.join(','));
        await page.keyboard.press('Escape'); await page.waitForTimeout(900);
      }
    }
    check(n >= 8 && ok === n, `clicks open the card under the pointer, middle and outer edge (${ok}/${n}${miss.length ? '; missed ' + miss.join(' ') : ''})`);
  }

  // ---------- 2. Admin gallery: add, captions, lightbox of real media, reorder, remove + undo, files freed ----------
  await page.mouse.move(1490, 880); await page.waitForTimeout(300);
  await page.click('#home-tools [data-action="home-gal"]');
  await page.waitForSelector('#home-gal:not([hidden]) #home-file', { state: 'attached' });
  await page.setInputFiles('#home-file', ['img1.jpg', 'img2.jpg', 'img3.jpg', 'clip.webm'].map(f => FIX + f));
  check(await until(() => page.evaluate(() => /Subiendo/.test(document.querySelector('#home-tools .hbtn').textContent) && document.querySelector('#home-gal .hgal-title small').textContent === 'Subiendo 4 archivos…'), 1500), 'the Galería button and the panel show the upload in progress');
  check(await until(async () => (await thumbIds(page)).length === 4), 'the four files are in the gallery');
  await page.waitForTimeout(800);
  const filled = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('#hs-stage .hs-card')];
    const key = (c) => { const i = c.querySelector('img'); return i ? i.getAttribute('src') : c.querySelector('video') ? 'video' : 'ph'; };
    let same = 0; for (let k = 0; k < cs.length; k++) if (key(cs[k]) === key(cs[(k + 1) % cs.length])) same++;
    return { n: cs.length, img: document.querySelectorAll('#hs-stage .hs-card img').length, vid: document.querySelectorAll('#hs-stage .hs-card video').length, ph: document.querySelectorAll('#hs-stage .hs-media[data-ph]').length, srcs: new Set(cs.map(key)).size, same, dots: document.querySelectorAll('#hs-nav .hs-dot').length, hint: !!document.querySelector('#home-tools .home-hint'), cnt: (document.querySelector('#home-tools .hbtn-n') || {}).textContent };
  });
  check(filled.ph === 0 && filled.img > 0 && filled.vid > 0 && filled.srcs === 4 && filled.n % 4 === 0 && filled.n >= 8, `the media fill the slider, repeated to fill the curve (${filled.n} cards: ${filled.img} images, ${filled.vid} videos, no placeholders)`);
  check(filled.same === 0 && filled.dots === 4, 'the same item is never next to itself, and there is one dot per item');
  // Shapes: each card keeps its file's proportions; the gallery can make one horizontal, vertical or square, and back
  const shape = (i) => page.evaluate((i) => [...document.querySelectorAll(`#hs-stage .hs-card[data-i="${i}"]`)].map(e => Math.round(e.offsetWidth / e.offsetHeight * 100) / 100), i);
  check(await until(() => page.evaluate(() => [...document.querySelectorAll('#hs-stage .hs-card')].every(e => { const i = e.querySelector('img'), v = e.querySelector('video'); const nw = i ? i.naturalWidth : v.videoWidth, nh = i ? i.naturalHeight : v.videoHeight; return nh && Math.abs(e.offsetWidth / e.offsetHeight - nw / nh) < .03; }))), 'each card keeps the proportions of its own file (the images and the video)');
  check(await page.evaluate(() => new Set([...document.querySelectorAll('#hs-stage .hs-card')].map(e => e.offsetHeight)).size === 1), 'all cards share one height; widths follow the files');
  const own0 = (await shape(0))[0];
  check(await page.evaluate(() => document.querySelector('#home-gal [data-action="home-ratio"][aria-pressed="true"]')?.dataset.v === 'auto'), 'the gallery shows "Original" for a new item');
  await page.click('#home-gal [data-action="home-ratio"][data-v="1/1"]'); await page.waitForTimeout(300);
  check((await shape(0)).every(a => a === 1), 'Cuadrada makes its cards square');
  await page.click('#home-gal [data-action="home-ratio"][data-v="4/5"]'); await page.waitForTimeout(300);
  check((await shape(0)).every(a => a === .8), 'Vertical makes them 4:5');
  await page.click('#home-gal [data-action="home-ratio"][data-v="16/9"]'); await page.waitForTimeout(300);
  check((await shape(0)).every(a => a === 1.78) && (await shape(1)).every(a => a !== 1.78 || a === own0), 'Horizontal makes them 16:9, only for that item');
  check(overlaps(await cards(page)).length === 0, 'with mixed shapes, still no card over its neighbour');
  await page.mouse.move(1490, 140); await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  check((await shape(0)).every(a => a === .8), 'Ctrl+Z goes back to the previous shape');
  await page.click('#home-gal [data-action="home-ratio"][data-v="auto"]'); await page.waitForTimeout(300);
  check((await shape(0)).every(a => a === own0), 'Original brings back the file\'s own proportions');
  // Corners: one control for every card
  const corner = () => page.evaluate(() => { const m = document.querySelector('#hs-stage .hs-card .hs-media'); return { r: parseFloat(getComputedStyle(m).borderTopLeftRadius), h: Math.max(...[...document.querySelectorAll('#hs-stage .hs-card')].map(e => e.offsetHeight)) }; });
  const setRadius = (v) => page.evaluate((v) => { const r = document.querySelector('#home-radius'); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  let cr = await corner();
  check(Math.abs(cr.r - 16 * cr.h / 420) < .2 && await page.evaluate(() => document.querySelector('#home-radius').value === '16'), `the corners start at the default (16, ${cr.r}px on a ${cr.h}px card)`);
  await setRadius(32); await page.waitForTimeout(300); cr = await corner();
  check(Math.abs(cr.r - 32 * cr.h / 420) < .2 && await page.evaluate(() => document.querySelector('#home-radius-v').textContent === '32 px'), `the Esquinas control rounds every card (32 → ${cr.r}px)`);
  await setRadius(0); await page.waitForTimeout(300);
  check((await corner()).r === 0, 'and down to square corners');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  check(Math.abs((await corner()).r - 32 * cr.h / 420) < .2, 'Ctrl+Z undoes a corner change');
  await setRadius(16); await page.waitForTimeout(200);
  check(!filled.hint && filled.cnt === '4', 'the hint is gone and the Galería button counts 4');
  await page.click('#home-gal .hg-th[data-index="3"]'); await settled(page);
  check(await until(() => page.evaluate(() => { const vs = [...document.querySelectorAll('#hs-stage .hs-card video')]; return vs.some(v => !v.paused) && vs.every(v => v.paused === !!v.closest('.is-off')); }), 5000), 'videos play (muted, looping) on the cards in view only; the rest hold still');
  await page.click('#home-gal .hg-th[data-index="0"]'); await settled(page);
  check(await page.evaluate(() => [...document.querySelectorAll('#hs-stage video')].every(v => v.muted && v.loop)), 'card videos are muted and loop');
  // Captions: the field edits the selected thumbnail; the label strip appears under its cards
  check(await page.evaluate(() => document.querySelector('#home-gal .hg-th.is-sel')?.dataset.index === '0' && document.querySelector('#home-cap').value === '' && !document.querySelector('#hs-stage .hs-cap')), 'the first thumbnail is selected, without a caption, and no card has a label strip yet');
  await page.fill('#home-cap', 'Campaña 2026'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const capCards = await page.evaluate(() => [...document.querySelectorAll('#hs-stage .hs-card')].filter(c => c.querySelector('.hs-cap')).map(c => ({ i: c.dataset.i, t: c.querySelector('.hs-cap-t').textContent, n: c.querySelector('.hs-n').textContent, tt: getComputedStyle(c.querySelector('.hs-cap')).textTransform, bg: getComputedStyle(c.querySelector('.hs-cap')).backgroundColor, below: c.querySelector('.hs-cap').offsetTop >= c.querySelector('.hs-media').offsetHeight })));
  check(capCards.length > 0 && capCards.every(c => c.i === '0' && c.t === 'Campaña 2026' && c.n === '01' && c.tt === 'uppercase' && c.bg === 'rgba(0, 0, 0, 0)' && c.below), `the caption shows as plain uppercase text under every card of that item, no strip behind it (${capCards.length})`);
  await page.click('#home-gal .hg-th[data-index="2"]'); await settled(page);
  check(await page.evaluate(() => document.querySelector('#home-gal .hg-th.is-sel')?.dataset.index === '2' && document.querySelector('#home-cap').value === '') && (await center(page)).i === 2, 'selecting another thumbnail edits its own caption and brings its card to the middle');
  await page.mouse.move(1490, 880);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  check(await page.evaluate(() => !document.querySelector('#hs-stage .hs-cap')), 'Ctrl+Z takes the caption back off');
  await page.click('#home-gal .hg-th[data-index="0"]'); await page.waitForTimeout(200);
  await page.fill('#home-cap', 'Campaña 2026'); await page.locator('#home-cap').blur(); await page.waitForTimeout(300);
  check(await page.evaluate(() => document.querySelectorAll('#hs-stage .hs-cap').length > 0), 'leaving the field also saves the caption');
  await page.screenshot({ path: T + 'home-04-gallery.png' });
  await page.click('#home-gal [data-action="home-gal"]'); await page.waitForTimeout(500);
  await page.mouse.move(1490, 880); await settled(page, 1000);
  await page.screenshot({ path: T + 'home-05-slider-media.png' });
  {
    await page.click('#hs-nav .hs-dot[data-i="0"]'); await settled(page);
    const c = await center(page);
    await page.mouse.click(c.x, c.y); await page.waitForTimeout(900);
    const L = await lb(page);
    check(L.open && !!L.img && L.img.startsWith('blob:') && L.cap === 'Campaña 2026', 'an image card opens the image itself in the lightbox, with its caption under it');
    await page.screenshot({ path: T + 'home-06-lightbox-image.png' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(900);
  }
  {
    await page.mouse.move(1490, 880);
    await page.click('#hs-nav .hs-dot[data-i="3"]'); await settled(page);
    const c = await center(page);
    await page.mouse.click(c.x, c.y); await page.waitForTimeout(900);
    const L = await lb(page);
    check(L.open && L.video && await page.evaluate(() => { const v = document.querySelector('#home-lb video'); return v.muted && v.loop && v.controls; }), 'a video card opens the video (muted, looping, with controls)');
    check(await page.evaluate(() => [...document.querySelectorAll('#hs-stage video')].every(v => v.paused)), 'the card videos pause under the lightbox');
    await page.keyboard.press('Escape'); await page.waitForTimeout(900);
  }

  await page.click('#home-tools [data-action="home-gal"]'); await page.waitForTimeout(400);
  let ids = await thumbIds(page);
  // drag the first thumbnail onto the third
  const r0 = await page.locator('#home-gal .hg-th[data-index="0"]').boundingBox(), r2 = await page.locator('#home-gal .hg-th[data-index="2"]').boundingBox();
  await page.mouse.move(r0.x + r0.width / 2, r0.y + r0.height / 2); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(r0.x + r0.width / 2 + (r2.x - r0.x) * i / 8, r0.y + r0.height / 2 + 2 * i, { steps: 1 }); await page.waitForTimeout(16); }
  await page.mouse.up(); await page.waitForTimeout(500);
  let ids2 = await thumbIds(page);
  check(ids2[2] === ids[0] && ids2.length === 4, 'dragging a thumbnail reorders the gallery');
  check(await page.evaluate(() => [...document.querySelectorAll('#hs-stage .hs-card')].filter(c => c.querySelector('.hs-cap')).every(c => c.dataset.i === '2' && c.querySelector('.hs-n').textContent === '03')), 'the caption moves with its item');
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
  check(await page.evaluate(() => !document.querySelector('#hs-stage .hs-media[data-ph]') && document.querySelectorAll('#hs-nav .hs-dot').length === 3 && document.querySelectorAll('#hs-stage .hs-card').length % 3 === 0), 'the slider now cycles the three remaining items');
  // files dropped anywhere on Home open the gallery and are added
  const dt = await page.evaluateHandle((b64) => { const d = new DataTransfer(); d.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'dropped.jpg', { type: 'image/jpeg' })); return d; }, fs.readFileSync(FIX + 'img4.jpg').toString('base64'));
  await page.dispatchEvent('#home', 'dragover', { dataTransfer: dt });
  check(await page.evaluate(() => !document.querySelector('#home-gal').hidden), 'dragging files over Home opens the gallery as the place to drop them');
  await page.dispatchEvent('#home', 'drop', { dataTransfer: dt });
  check(await until(async () => (await thumbIds(page)).length === 4), 'dropped files are added to the gallery');
  // a removal not yet freed (panel open) is freed when the tab is left, and can't be undone after that
  const gone2 = (await thumbIds(page))[0];
  const gone2Url = await page.evaluate((id) => document.querySelector(`#home-gal .hg-th[data-id="${id}"] img, #home-gal .hg-th[data-id="${id}"] video`).getAttribute('src').split('#')[0], gone2);
  await page.locator(`#home-gal .hg-th[data-id="${gone2}"]`).focus();
  await page.keyboard.press('Delete'); await page.waitForTimeout(300);
  check(await loads(gone2Url), 'a removed file is kept while the panel is open');
  page.revoked.add(gone2Url);
  await page.evaluate(() => dispatchEvent(new Event('pagehide')));
  check(await until(async () => !(await loads(gone2Url))), 'leaving the page with the panel open deletes the removed file');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  check(!(await thumbIds(page)).includes(gone2), 'and Ctrl+Z no longer brings it back (it undoes the drop before it instead)');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // a catalog export (.json) is an import, not gallery media: dragging it over Home leaves the gallery closed
  const dj = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['{}'], 'catalogo.json', { type: 'application/json' })); return d; });
  await page.dispatchEvent('#home', 'dragover', { dataTransfer: dj });
  check(await page.evaluate(() => document.querySelector('#home-gal').hidden), 'dragging a catalog export over Home does not open the gallery');
  const db = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['{}'], 'catalogo.json', { type: 'application/json' })); d.items.add(new File([new Uint8Array(8)], 'asset-1.jpg', { type: 'image/jpeg' })); return d; });
  await page.dispatchEvent('#home', 'dragover', { dataTransfer: db });
  check(await page.evaluate(() => document.querySelector('#home-gal').hidden), 'nor does an export bundle (the .json with its image files)');

  // ---------- 3. Leaving Home, the logo, the back button, and the viewer/admin switch on the pages ----------
  await enterCategory(page);
  const cat = await page.evaluate(() => ({ view: document.documentElement.dataset.view, hash: location.hash, stage: getComputedStyle(document.querySelector('#stage')).display, nav: getComputedStyle(document.querySelector('#rail-nav')).display }));
  check(cat.view === 'cat' && cat.stage !== 'none' && cat.nav !== 'none' && cat.hash === '#s_direccion', 'a category in the menu leaves Home for its page (' + cat.hash + ')');
  check(await page.evaluate(() => document.querySelector('#home').getClientRects().length === 0 && [...document.querySelectorAll('#hs-stage video')].every(v => v.paused)), 'Home is hidden on the page and its videos are paused');
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
    check(await view(p) === 'cat' && await p.evaluate(() => document.querySelectorAll('#hs-stage .hs-card').length === 0), 'a link to a section opens it directly (the slider is not even built)');
    await p.click('#rail-logo [data-action="home"]'); await p.waitForTimeout(1200);
    check(await view(p) === 'home' && await p.evaluate(() => document.querySelectorAll('#hs-stage .hs-card').length >= 8) && Math.abs((await center(p)).dx) < 60, 'the logo builds and shows Home (' + Math.round((await center(p)).dx) + ')');
    check(p.errors.length === 0, 'no page errors (section link): ' + p.errors.join(' | '));
    await c.close();
  }

  // ---------- 5. Reduced motion ----------
  {
    const { page: p, ctx: c } = await open(browser, BASE, { reducedMotion: 'reduce' });
    await p.waitForSelector('#home .hs-card'); await p.waitForTimeout(300);
    check(Math.abs((await center(p)).dx) < 1, 'reduced motion: no intro sweep, the first card is in the middle at once');
    await p.mouse.move(1490, 140); const k0 = (await center(p)).k, x0 = await xOf(p, k0); await p.waitForTimeout(1500);
    check(Math.abs(await xOf(p, k0) - x0) < .5, 'reduced motion: no autoplay drift');
    await p.click('#hs-nav [data-action="hs-next"]'); await p.waitForTimeout(40);
    let m = await center(p);
    check(m.i === 1 && Math.abs(m.dx) < 1, 'reduced motion: Siguiente changes the card at once');
    await drag(p, 900, 450, -700, 4, 8); await p.waitForTimeout(40);
    m = await center(p);
    check(Math.abs(m.dx) < 1 && m.i !== 1, `reduced motion: a flick has no inertia, it lands on the nearest card at once (card ${m.i + 1})`);
    await p.mouse.move(1490, 880); await p.waitForTimeout(300); /* a click right after a drag is part of the drag */
    await p.mouse.click(m.x, m.y); await p.waitForTimeout(60);
    const l = await lb(p);
    check(l.open && l.anims === 0 && Math.abs(l.r.cx - 756) < 2, 'reduced motion: the lightbox opens at once, centered');
    await p.keyboard.press('Escape'); await p.waitForTimeout(60);
    check(!(await lb(p)).open, 'reduced motion: it closes at once');
    check(p.errors.length === 0, 'no page errors (reduced motion): ' + p.errors.join(' | '));
    await c.close();
  }

  // ---------- 6. Phone ----------
  {
    const { page: p, ctx: c } = await open(browser, BASE, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.waitForSelector('#home .hs-card'); await p.waitForTimeout(1800);
    const m = await p.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const mid = [...document.querySelectorAll('#hs-stage .hs-card:not(.is-off)')].map(e => e.getBoundingClientRect()).sort((a, b) => Math.abs(a.left + a.width / 2 - 195) - Math.abs(b.left + b.width / 2 - 195))[0];
      const nav = r('#hs-nav'), tools = r('#home-tools .hbtn');
      return { over: document.documentElement.scrollWidth - innerWidth, w: mid.width, top: mid.top, bottom: mid.bottom, bar: r('.rail-top').bottom, navTop: nav.top, navL: nav.left, navR: nav.right, toolsR: tools.right };
    });
    check(m.over <= 0 && m.w <= 390 * .8 && m.top > m.bar && m.bottom < m.navTop, `phone: the middle card fits between the top bar and the controls, no sideways scroll (${Math.round(m.w)}px wide)`);
    check(m.navL > m.toolsR && m.navR <= 390, 'phone: the controls and the gallery button share the bottom row without touching');
    await p.screenshot({ path: T + 'home-07-phone.png' });
    // a swipe (real touch events) moves to the next card
    const cdp = await c.newCDPSession(p);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', 300, 430);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', 300 - i * 14, 430); await p.waitForTimeout(16); }
    await touch('touchEnd'); await p.waitForTimeout(1400);
    const s = await center(p);
    check(s.i === 1 && Math.abs(s.dx) < 1 && !(await lb(p)).open, 'phone: a swipe moves to the next card without opening it');
    await p.touchscreen.tap(s.x, s.y); await p.waitForTimeout(900);
    const l = await lb(p);
    check(l.open && l.r.l >= 0 && l.r.rt <= 390 && l.r.t >= 0 && l.r.b <= 844, 'phone: a tap opens the lightbox inside the screen');
    await p.screenshot({ path: T + 'home-08-phone-lightbox.png' });
    await p.tap('#home-lb .hlb-x'); await p.waitForTimeout(800);
    check(!(await lb(p)).open, 'phone: the X closes it');
    {
      const k = (await center(p)).k, x0 = await xOf(p, k); await p.waitForTimeout(700);
      check(Math.abs(await xOf(p, k) - x0) < .5, 'phone: right after a touch the row holds still');
      await p.waitForTimeout(3000); const x1 = await xOf(p, k); await p.waitForTimeout(800);
      check(await xOf(p, k) < x1 - 4, 'phone: a couple of seconds later it drifts again on its own');
      const cs = await cards(p);
      check(overlaps(cs).length === 0 && cs.length >= 2, 'phone: no card over its neighbour');
    }
    await p.tap('#btn-menu'); await p.waitForTimeout(700);
    await p.tap('.ov-cat[data-id="c_ourbrand"]'); await p.waitForTimeout(900);
    const sw = await pageSwitch(p);
    check(!!sw && Math.round(sw.left) === 16 && await p.evaluate(() => getComputedStyle(document.querySelector('#rail-nav')).paddingBottom === '12px'), 'phone: the page switch sits 16px from the left and the section list keeps its padding');
    check(p.errors.length === 0, 'no page errors (phone): ' + p.errors.join(' | '));
    await c.close();
  }

  // ---------- 7. Stored for everyone (fake Supabase): an editor adds an image and its caption, a visitor sees them, removing frees it ----------
  {
    const fake = new FakeSupabase(SUPA_URL);
    const leo = fake.addUser({ email: 'leo@paisanoscreando.com', name: 'Leo Suárez' });
    fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [{ id: 'c_brand', name: 'Our Brand', subs: [{ id: 's_intro', name: 'Intro' }] }] }, leo.id);
    fake.seed('pages/s_intro', { rows: [] }, leo.id);
    const ed = await open(browser, SUPA_BASE, {}, async (c) => { await fake.attach(c, 'leo'); await fake.signInContext(c, leo); });
    const E = ed.page;
    await E.waitForSelector('#home .hs-card');
    check(await until(() => E.evaluate(() => document.documentElement.dataset.mode === 'admin')), 'Supabase: Leo (editor) lands on Home in admin');
    await E.click('#home-tools [data-action="home-gal"]');
    fake.uploadBytes = fs.readFileSync(FIX + 'img1.jpg');
    await E.setInputFiles('#home-file', FIX + 'img1.jpg');
    const stored = await until(() => { const t = fake.docs.get('catalog/tree'); return !!(t && t.data.home && t.data.home.media.length === 1); }, 8000);
    const media = stored ? fake.docs.get('catalog/tree').data.home.media[0] : {};
    check(stored && media.kind === 'image' && fake.files.has(media.id) && media.w > 0 && media.h > 0, 'Supabase: the image is stored in the bucket and in the catalog tree (' + media.id + ')');
    await E.waitForSelector('#home-cap');
    await E.fill('#home-cap', 'Lanzamiento'); await E.keyboard.press('Enter');
    check(await until(() => (fake.docs.get('catalog/tree').data.home.media[0] || {}).label === 'Lanzamiento', 8000), 'Supabase: the caption is stored with the item (label)');
    await E.click('#home-gal [data-action="home-ratio"][data-v="1/1"]');
    await E.evaluate(() => { const r = document.querySelector('#home-radius'); r.value = 28; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    check(await until(() => { const h = fake.docs.get('catalog/tree').data.home; return h.media[0].ratio === '1/1' && h.radius === 28; }, 8000), 'Supabase: the card shape (ratio) and the corners (home.radius) are stored');
    const vis = await open(browser, SUPA_BASE, {}, (c) => fake.attach(c, 'visitor'));
    const V = vis.page;
    await V.waitForSelector('#home .hs-card');
    check(await until(() => V.evaluate((id) => [...document.querySelectorAll('#hs-stage .hs-card img')].some(i => i.src.includes(id)) && !document.querySelector('#hs-stage .hs-media[data-ph]'), media.id)), 'Supabase: a visitor sees the slider made of that image');
    check(await until(() => V.evaluate(() => [...document.querySelectorAll('#hs-stage .hs-cap-t')].some(t => t.textContent === 'Lanzamiento'))), 'Supabase: and its caption');
    check(await until(() => V.evaluate(() => { const e = document.querySelector('#hs-stage .hs-card'), m = e.querySelector('.hs-media'); return e.offsetWidth === e.offsetHeight && Math.abs(parseFloat(getComputedStyle(m).borderTopLeftRadius) - 28 * e.offsetHeight / 420) < .2; })), 'Supabase: and its square shape and corners');
    check(await V.evaluate(() => !document.querySelector('#home-tools').getClientRects().length && !document.querySelector('#page-mode').getClientRects().length && !!document.querySelector('#hs-nav .hs-btn')), 'Supabase: the visitor has the slider controls but no gallery tools and no view switch');
    await E.reload(); await E.waitForSelector('#home .hs-card');
    check(await until(() => E.evaluate((id) => [...document.querySelectorAll('#hs-stage .hs-card img')].some(i => i.src.includes(id)), media.id)), 'Supabase: after a reload the slider still shows it');
    await until(() => E.evaluate(() => document.documentElement.dataset.mode === 'admin'));
    await E.click('#home-tools [data-action="home-gal"]'); await E.waitForTimeout(300);
    await E.locator('#home-gal .hg-th[data-index="0"]').hover();
    await E.click('#home-gal .hg-th[data-index="0"] [data-action="home-remove"]');
    await E.click('#home-gal [data-action="home-gal"]');
    check(await until(() => !fake.files.has(media.id) && fake.docs.get('catalog/tree').data.home.media.length === 0, 8000), 'Supabase: removing it and closing the gallery deletes the file and the entry');
    check(await until(() => V.evaluate(() => document.querySelectorAll('#hs-stage .hs-media[data-ph]').length === document.querySelectorAll('#hs-stage .hs-card').length)), 'Supabase: the visitor\'s slider goes back to placeholders live');
    const errs = [...E.errors, ...V.errors].filter(e => !/status of 40[49]/.test(e));
    check(errs.length === 0, 'no page errors (Supabase): ' + errs.join(' | '));
    await ed.ctx.close(); await vis.ctx.close();
  }

  await browser.close();
  if (fails) { console.error(`${fails} home check(s) failed`); process.exit(1); }
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
