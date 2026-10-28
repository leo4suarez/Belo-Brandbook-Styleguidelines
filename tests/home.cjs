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
// Bring item i (of m) to the middle with Siguiente, then let the glide settle (the mouse stays on the controls: no drift)
const goTo = async (p, i, m) => { for (let k = 0; k < 2 * m; k++) { const c = await center(p); if (c.i === i && Math.abs(c.dx) < 1) return; await p.click('#hs-nav [data-action="hs-next"]'); await p.waitForTimeout(c.i === (i - 1 + m) % m ? 1400 : 500); } };
// The round prev / next buttons as drawn
const navBtns = (p) => p.evaluate(() => [...document.querySelectorAll('#hs-nav .hs-btn')].map(b => { const r = b.getBoundingClientRect(), cs = getComputedStyle(b), sv = b.querySelector('svg'); return { label: b.getAttribute('aria-label'), w: r.width, h: r.height, l: r.left, r: r.right, cx: r.left + r.width / 2, radius: cs.borderTopLeftRadius, bw: parseFloat(cs.borderTopWidth), bc: cs.borderTopColor, bg: cs.backgroundColor, shadow: cs.boxShadow, text: b.textContent.trim(), icon: sv ? sv.getBoundingClientRect().width : 0, stroke: sv ? parseFloat(getComputedStyle(sv).strokeWidth) : 0 }; }));
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
const park = async (p) => { const r = await p.locator('#hs-nav').boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); };
const away = (p) => p.mouse.move(1490, 140);
// The search + menu buttons: distance from the right edge and the top, and whether they are sliding
const bar = (p) => p.evaluate(() => { const a = document.querySelector('.rail-actions'), r = a.getBoundingClientRect(), l = document.querySelector('#rail-logo').getBoundingClientRect(); return { right: innerWidth - r.right, left: r.left, top: r.top, logoLeft: l.left, anims: a.getAnimations().length }; });
// Measured drift speed (px/s) of the card in the middle, after letting the drift ease in
const driftSpeed = async (p, wait = 3000) => { await p.waitForTimeout(wait); const k = (await center(p)).k, x0 = await xOf(p, k); await p.waitForTimeout(1000); return x0 - await xOf(p, k); };
const setRange = (p, id, v, change = true) => p.evaluate(([id, v, change]) => { const r = document.querySelector('#' + id); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); if (change) r.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v, change]);
const xOf = (p, k) => p.evaluate((k) => { const r = document.querySelector(`#hs-stage .hs-card[data-k="${k}"]`).getBoundingClientRect(); return r.left + r.width / 2; }, k);
// The page as drawn (the WebGL ring included): a screenshot decoded in the page, kept in window.__px for the probes below
const grab = async (p) => { const buf = await p.screenshot(); await p.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); window.__px = x.getImageData(0, 0, c.width, c.height); }, buf.toString('base64')); };
// How far a pixel is from the page background (sum of the channel differences)
const offBg = (p, x, y) => p.evaluate(([x, y]) => { const { data, width } = window.__px, bg = getComputedStyle(document.documentElement).getPropertyValue('--home-bg').trim(), b = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16)), o = (Math.round(y) * width + Math.round(x)) * 4; return Math.abs(data[o] - b[0]) + Math.abs(data[o + 1] - b[1]) + Math.abs(data[o + 2] - b[2]); }, [x, y]);
// The top edge of the ring as drawn: for every 3rd column, the first pixel from above that is clearly not background
const topEdge = (p, y0, y1) => p.evaluate(([y0, y1]) => { const { data, width } = window.__px, bg = getComputedStyle(document.documentElement).getPropertyValue('--home-bg').trim(), b = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16)), out = [];
  for (let x = 0; x < width; x += 3) for (let y = y0; y < y1; y++) { const o = (y * width + x) * 4; if (Math.abs(data[o] - b[0]) + Math.abs(data[o + 1] - b[1]) + Math.abs(data[o + 2] - b[2]) > 60) { out.push([x, y]); break; } }
  return out; }, [y0, y1]);
// Least squares fit of y = a + b t² + c t⁴ + d t⁶ (t from the middle of the screen): one smooth, symmetric curve
const evenFit = (pts, cx, W) => { const B = (x) => { const t = (x - cx) / W, t2 = t * t; return [1, t2, t2 * t2, t2 * t2 * t2]; }; const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], v = [0, 0, 0, 0];
  for (const [x, y] of pts) { const b = B(x); for (let i = 0; i < 4; i++) { v[i] += b[i] * y; for (let j = 0; j < 4; j++) A[i][j] += b[i] * b[j]; } }
  for (let i = 0; i < 4; i++) { let m = i; for (let r = i + 1; r < 4; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r; [A[i], A[m]] = [A[m], A[i]]; [v[i], v[m]] = [v[m], v[i]]; for (let r = 0; r < 4; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < 4; c++) A[r][c] -= f * A[i][c]; v[r] -= f * v[i]; } }
  const k = v.map((x, i) => x / A[i][i]); return (x) => B(x).reduce((s, b, i) => s + b * k[i], 0); };
// The edge points split into runs (one per card) with their rounded ends left out
const runs = (pts, trim = 30) => { const out = []; let cur = []; for (const q of pts) { if (cur.length && q[0] - cur[cur.length - 1][0] > 6) { out.push(cur); cur = []; } cur.push(q); } if (cur.length) out.push(cur); return out.map(r => r.filter(q => q[0] > r[0][0] + trim && q[0] < r[r.length - 1][0] - trim)).filter(r => r.length > 4); };
const thumbIds = (p) => p.evaluate(() => [...document.querySelectorAll('#home-gal .hg-th[data-index]')].map(t => t.dataset.id));
// A pointer drag across the slider, n steps of dx pixels, ms apart
const drag = async (p, x, y, dx, n = 10, ms = 16) => {
  await p.mouse.move(x, y); await p.mouse.down();
  for (let i = 1; i <= n; i++) { await p.mouse.move(x + dx * i / n, y); await p.waitForTimeout(ms); }
  await p.mouse.up();
};

(async () => {
  /* the ring is drawn with WebGL: the headless browser needs the GPU switched on for it (without it, see 1b) */
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu'] });

  // ---------- 1. Landing on Home (local demo, OS in dark mode: the page still starts light) ----------
  /* the ring's draws are counted (one clear per draw), to check it never draws twice in a frame */
  const countDraws = (c) => c.addInitScript(() => { window.__draws = 0; for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!P) continue; const f = P.prototype.clear; P.prototype.clear = function (...a) { window.__draws++; return f.apply(this, a); }; } });
  const { page, ctx } = await open(browser, BASE, { colorScheme: 'dark' }, countDraws);
  await page.waitForSelector('#home .hs-card');
  await settled(page, 1800); /* the intro sweep settles */
  const land = await page.evaluate(() => ({
    view: document.documentElement.dataset.view, scheme: document.documentElement.dataset.scheme, hash: location.hash,
    home: getComputedStyle(document.querySelector('#home')).display, stage: getComputedStyle(document.querySelector('#stage')).display,
    nav: getComputedStyle(document.querySelector('#rail-nav')).display, menu: document.querySelector('#menu').classList.contains('is-open'),
    n: document.querySelectorAll('#hs-stage .hs-card').length, ph: document.querySelectorAll('#hs-stage .hs-media[data-ph]').length,
    persp: getComputedStyle(document.querySelector('#hs-stage')).perspective,
    btns: [...document.querySelectorAll('#hs-nav .hs-btn')].map(b => b.getAttribute('aria-label')).join(','), dots: document.querySelectorAll('#hs-nav .hs-dot, #hs-nav .hs-count, #hs-nav .hs-dots').length,
    over: document.documentElement.scrollWidth - innerWidth, scroll: document.documentElement.scrollHeight - innerHeight,
    logo: (() => { const l = document.querySelector('#rail-logo [data-action="home"]'); return l ? l.textContent.trim() + '|' + l.getClientRects().length : ''; })(),
    hint: (document.querySelector('#home-tools .home-hint') || {}).textContent || ''
  }));
  check(land.view === 'home' && land.home === 'block' && land.stage === 'none' && land.nav === 'none' && !land.menu && land.hash === '', 'the page opens on Home: slider shown, section list and stage hidden, no hash, menu closed');
  check(land.scheme === 'light', 'light theme by default even when the OS prefers dark (' + land.scheme + ')');
  check(land.n >= 8 && land.n % 8 === 0 && land.ph === land.n && land.dots === 0, `with no media yet the slider loops ${land.n} placeholder cards, no dots or counter (${land.dots})`);
  check(land.btns === 'Anterior,Siguiente', 'Prev / Next buttons are labeled in Spanish');
  {
    const [a, b] = await navBtns(page);
    check(a.w === 56 && a.h === 56 && b.w === 56 && a.radius === '50%' && !a.text && !b.text && a.icon === 20 && a.stroke === 1.5, `the controls are two round 56px buttons with a thin 20px chevron, no words (${a.w}×${a.h}, stroke ${a.stroke})`);
    check(b.l - a.r >= 16 && b.l - a.r <= 20 && Math.abs((a.l + b.r) / 2 - 756) < 1, `side by side, ${Math.round(b.l - a.r)}px apart, centered at the bottom`);
    check(a.bw >= 1 && a.bw <= 1.5 && a.bg === 'rgba(0, 0, 0, 0)' && a.shadow === 'none', `thin light border, page background showing through, no shadow (${a.bw}px ${a.bc})`);
    await page.hover('#hs-nav [data-action="hs-next"]'); await page.waitForTimeout(300);
    const h = (await navBtns(page))[1];
    check(h.bc !== b.bc, `hover darkens the border (${b.bc} → ${h.bc})`);
    await page.screenshot({ path: T + 'home-01b-controls-hover.png', clip: { x: 556, y: 760, width: 400, height: 140 } });
    await page.mouse.move(1490, 140); await page.keyboard.press('Tab');
    let ring = '', guard = 0;
    while (guard++ < 12) { ring = await page.evaluate(() => { const e = document.activeElement; return e && e.classList.contains('hs-btn') ? getComputedStyle(e).outlineStyle + ' ' + getComputedStyle(e).outlineWidth : ''; }); if (ring) break; await page.keyboard.press('Tab'); }
    check(/solid 2px/.test(ring), 'the keyboard reaches them with a visible focus ring (' + ring + ')');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
  }
  check(land.over <= 0 && land.scroll <= 0, 'Home fills the screen: no page scroll either way');
  check(land.logo === 'belo|1', 'no logo uploaded: the "belo" wordmark is the way Home (' + land.logo + ')');
  check(land.hint === 'Añade imágenes o videos a la galería', 'admins see the hint to fill the gallery');
  check(await pageSwitch(page) === null, 'no viewer/admin switch on Home');
  {
    const b = await bar(page);
    check(Math.abs(b.right - 20) < 1 && Math.abs(b.logoLeft - 20) < 1 && Math.abs(b.top - 20) < 1, `on Home, search and menu sit in the top right corner, 20px in like the logo on the left (${Math.round(b.right)}px)`);
    const c = await page.evaluate(() => { const r = document.querySelector('#btn-menu').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.click('#btn-menu'); await page.waitForTimeout(120);
    const rv = await page.evaluate(() => { const r = document.querySelector('#menu-reveal').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    check(Math.abs(rv.x - c.x) < 2 && Math.abs(rv.y - c.y) < 2, 'the menu reveal grows from the menu button in its new corner');
    await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  }
  {
    const cs = await cards(page), c = await center(page), W = 1512;
    check(Math.abs(c.dx) < 90 && c.ph === '4' && await page.evaluate((k) => !!document.querySelector(`.hs-card[data-k="${k}"] .hs-b`), c.k), 'the brand blue placeholder with the small "b" opens in the middle');
    check(cs[0].l < 0 && cs[cs.length - 1].r > W && cs.length >= 4, `the row runs off both edges (${cs.length} cards in view: ${Math.round(cs[0].l)} … ${Math.round(cs[cs.length - 1].r)})`);
    check(await page.evaluate(() => document.querySelector('#hs').classList.contains('is-gl') && getComputedStyle(document.querySelector('#hs-gl')).display === 'block'), 'the ring is drawn with WebGL, as one bent surface (the DOM cards are invisible stand-ins)');
    const out = cs.map(x => ({ d: Math.max(Math.abs(x.l - W / 2), Math.abs(x.r - W / 2)), h: x.h })).sort((a, b) => a.d - b.d);
    check(out.every((x, i) => !i || x.h >= out[i - 1].h - .5) && out[out.length - 1].h > out[0].h * 1.08, `the ring wraps around: cards look taller toward the edges, the farther the more (${Math.round(out[0].h)} → ${Math.round(out[out.length - 1].h)}px)`);
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
  await park(page); await goTo(page, 0, 8);
  await page.click('#hs-nav [data-action="hs-next"]'); await page.waitForTimeout(110);
  const mid = await center(page);
  check(Math.abs(mid.dx) > 20, `Siguiente glides (the row is between cards ${Math.round(mid.dx)}px after 110ms)`);
  await settled(page);
  let c1 = await center(page);
  check(c1.i === 1 && Math.abs(c1.dx) < 1, 'Siguiente brings the next card to the middle');
  await page.click('#hs-nav [data-action="hs-prev"]'); await settled(page, 900);
  await page.click('#hs-nav [data-action="hs-prev"]'); await settled(page);
  c1 = await center(page);
  check(c1.i === 7, 'Anterior twice from the second card loops around to the last one');
  await goTo(page, 3, 8);
  check((await center(page)).i === 3, 'Siguiente several times in a row adds up (to the fourth card)');
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
    const h = await page.evaluate(() => { const el = document.querySelector('#hs-stage .hs-card.is-hover'); return el ? { k: el.dataset.k, cursor: getComputedStyle(document.querySelector('#home')).cursor } : null; });
    const after = (await cards(page)).find(x => x.k === c.k);
    check(!!h && h.k === c.k && h.cursor === 'pointer' && after.w > c.w + 2 && after.h > c.h + 2, `hovering a card lifts it toward the viewer (${Math.round(c.w)}×${Math.round(c.h)} → ${Math.round(after.w)}×${Math.round(after.h)}) with a pointer cursor`);
    await page.screenshot({ path: T + 'home-03-hover.png' });
    const n = (await cards(page)).filter(x => x.x > c.x + 50 && x.x < 1450)[0];
    await page.mouse.move(n.x, n.y); await page.waitForTimeout(400);
    check(await page.evaluate(() => (document.querySelector('#hs-stage .hs-card.is-hover') || {}).dataset?.k) === n.k, 'hover follows the pointer to a side card');
    await page.mouse.move(c.x, 140); await page.waitForTimeout(400);
    check(await page.evaluate(() => !document.querySelector('#hs-stage .hs-card.is-hover') && getComputedStyle(document.querySelector('#home')).cursor !== 'pointer'), 'off the cards nothing is lifted');
    // Hovering from card to card never starts a second frame loop: once the mouse leaves, the drifting ring is drawn
    // once a frame, not once per card it went over
    for (let i = 0; i < 3; i++) for (const x of [300, 700, 1100, 700]) { await page.mouse.move(x, c.y); await page.waitForTimeout(90); }
    await away(page); await page.waitForTimeout(1600);
    const per = await page.evaluate(() => new Promise(res => { const d0 = window.__draws; let n = 0; const t0 = performance.now(); const f = (t) => { n++; if (t - t0 < 1500) requestAnimationFrame(f); else res({ draws: window.__draws - d0, frames: n }); }; requestAnimationFrame(f); }));
    check(per.frames > 5 && per.draws <= per.frames + 1, `after hovering card after card, the ring is still drawn once a frame (${per.draws} draws in ${per.frames} frames)`);
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
    return { n: cs.length, img: document.querySelectorAll('#hs-stage .hs-card img').length, vid: document.querySelectorAll('#hs-stage .hs-card video').length, ph: document.querySelectorAll('#hs-stage .hs-media[data-ph]').length, srcs: new Set(cs.map(key)).size, same, dots: document.querySelectorAll('#hs-nav .hs-dot, #hs-nav .hs-count, #hs-nav .hs-dots').length, hint: !!document.querySelector('#home-tools .home-hint'), cnt: (document.querySelector('#home-tools .hbtn-n') || {}).textContent };
  });
  check(filled.ph === 0 && filled.img > 0 && filled.vid > 0 && filled.srcs === 4 && filled.n % 4 === 0 && filled.n >= 8, `the media fill the slider, repeated to fill the curve (${filled.n} cards: ${filled.img} images, ${filled.vid} videos, no placeholders)`);
  check(filled.same === 0 && filled.dots === 0, 'the same item is never next to itself (and there are no dots to count them)');
  // Shapes: each card keeps its file's proportions; the gallery can make one horizontal, vertical or square, and back
  const shape = (i) => page.evaluate((i) => [...document.querySelectorAll(`#hs-stage .hs-card[data-i="${i}"]`)].map(e => Math.round(e.offsetWidth / e.offsetHeight * 100) / 100), i);
  check(await until(() => page.evaluate(() => [...document.querySelectorAll('#hs-stage .hs-card')].every(e => { const i = e.querySelector('img'), v = e.querySelector('video'); const nw = i ? i.naturalWidth : v.videoWidth, nh = i ? i.naturalHeight : v.videoHeight; return nh && Math.abs(e.offsetWidth / e.offsetHeight - nw / nh) < .03; }))), 'each card keeps the proportions of its own file (the images and the video)');
  check(await page.evaluate(() => new Set([...document.querySelectorAll('#hs-stage .hs-card')].map(e => e.offsetHeight)).size === 1), 'all cards share one height; widths follow the files');
  // Videos: a still made from the file on upload shows at once; with WebGL one card per video loads the file
  check(await until(() => page.evaluate(() => { const vc = [...document.querySelectorAll('#hs-stage .hs-card')].filter(c => c.querySelector('video')); return vc.length > 1 && vc.every(c => { const st = c.querySelector('img.hs-still'); return st && st.naturalWidth > 0; }); })), 'each video card shows a still of its video until it plays');
  const vload = await page.evaluate(() => ({ gl: document.querySelector('#hs').classList.contains('is-gl'), vids: document.querySelectorAll('#hs-stage .hs-card video').length, src: document.querySelectorAll('#hs-stage .hs-card video[src]').length }));
  check(vload.vids > 1 && (vload.gl ? vload.src === 1 : vload.src === vload.vids), `the video file loads once for the ring, not once per card (${vload.src} of ${vload.vids} cards, ${vload.gl ? 'WebGL' : 'DOM'})`);
  // A lighter copy made outside ("<file>.web.mp4", named after the video's file) attaches to that video, not as a new item
  {
    const vid = await page.evaluate(() => { const v = document.querySelector('#hs-stage .hs-card video'); const c = v.closest('.hs-card'); return [...document.querySelectorAll('#home-gal .hg-th[data-id]')][+c.dataset.i].dataset.id; });
    const before = await page.evaluate(() => [...document.querySelectorAll('#hs-stage .hs-card video')].map(v => v.getAttribute('src') || v.dataset.src).find(Boolean));
    const copy = T + vid.replace(/\.[^.]+$/, '') + '.web.mp4'; require('fs').copyFileSync(FIX + 'clip.webm', copy);
    await page.setInputFiles('#home-file', copy);
    const after = await until(() => page.evaluate((b) => { const a = [...document.querySelectorAll('#hs-stage .hs-card video')].map(v => v.getAttribute('src') || v.dataset.src).find(Boolean); return !!a && a !== b && document.querySelectorAll('#home-gal .hg-th[data-id]').length === 4; }, before));
    check(after, 'a lighter copy named after a video attaches to it (the ring plays it) instead of joining the gallery');
  }
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
  {
    const m = await page.evaluate(() => { const e = document.querySelector('#hs-stage .hs-card.is-mid'), r = e.getBoundingClientRect(); return { x: r.left + 3, y: r.top + 3 }; });
    await grab(page); const round = await offBg(page, m.x, m.y);
    await setRadius(0); await page.waitForTimeout(300);
    await grab(page); const square = await offBg(page, m.x, m.y);
    check(round < 40 && square > 100, `the ring draws the corners too: rounded, the very corner is background (${round}); square, it is the image (${square})`);
  }
  check((await corner()).r === 0, 'and down to square corners');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  check(Math.abs((await corner()).r - 32 * cr.h / 420) < .2, 'Ctrl+Z undoes a corner change');
  await setRadius(16); await page.waitForTimeout(200);
  check(!filled.hint && filled.cnt === '4', 'the hint is gone and the Galería button counts 4');
  await page.click('#home-gal .hg-th[data-index="3"]'); await settled(page);
  check(await until(() => page.evaluate(() => { const vs = [...document.querySelectorAll('#hs-stage .hs-card video')]; return vs.some(v => !v.paused) && vs.every(v => v.paused === !!v.closest('.is-off')); }), 5000), 'videos play (muted, looping) on the cards in view only; the rest hold still');
  await page.click('#home-gal .hg-th[data-index="0"]'); await settled(page);
  check(await page.evaluate(() => [...document.querySelectorAll('#hs-stage video')].every(v => v.muted && v.loop)), 'card videos are muted and loop');
  // Titular and Descripción: two fields for the selected thumbnail, with limits and live counters; nothing under the cards
  const fields = () => page.evaluate(() => ({ sel: document.querySelector('#home-gal .hg-th.is-sel')?.dataset.index, t: document.querySelector('#home-title').value, d: document.querySelector('#home-desc').value, tn: document.querySelector('#home-title-n').textContent, dn: document.querySelector('#home-desc-n').textContent, tmax: document.querySelector('#home-title').maxLength, dmax: document.querySelector('#home-desc').maxLength, area: document.querySelector('#home-desc').tagName }));
  let F = await fields();
  check(F.sel === '0' && F.t === '' && F.d === '' && F.tn === '0/60' && F.dn === '0/160' && F.tmax === 60 && F.dmax === 160 && F.area === 'TEXTAREA', 'the first thumbnail is selected, with an empty Titular (0/60) and a Descripción text area (0/160)');
  await page.click('#home-title'); await page.keyboard.type('T'.repeat(64));
  F = await fields();
  check(F.t.length === 60 && F.tn === '60/60', `Titular stops at 60 characters and counts them (${F.tn})`);
  await page.fill('#home-title', 'Campaña 2026'); F = await fields();
  check(F.tn === '12/60', 'the counter follows the text (' + F.tn + ')');
  await page.click('#home-desc'); await page.keyboard.type('d'.repeat(165));
  F = await fields();
  check(F.d.length === 160 && F.dn === '160/160', `Descripción stops at 160 characters (${F.dn})`);
  await page.fill('#home-desc', 'Fotos de la campaña de lanzamiento, con la luz de la tarde.'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  check(await page.evaluate(() => !document.querySelector('#hs-stage .hs-cap') && [...document.querySelectorAll('#hs-stage .hs-card')].every(c => !c.textContent.trim())), 'nothing is written under the cards: the texts are for the lightbox');
  await page.click('#home-gal .hg-th[data-index="2"]'); await settled(page);
  F = await fields();
  check(F.sel === '2' && F.t === '' && F.d === '' && (await center(page)).i === 2, 'selecting another thumbnail shows its own texts and brings its card to the middle');
  await page.mouse.move(1490, 880);
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  await page.click('#home-gal .hg-th[data-index="0"]'); await page.waitForTimeout(200);
  F = await fields();
  check(F.t === 'Campaña 2026' && F.d === '', 'Ctrl+Z takes the description back off, the title stays');
  await page.fill('#home-desc', 'Fotos de la campaña de lanzamiento, con la luz de la tarde.'); await page.locator('#home-desc').blur(); await page.waitForTimeout(300);
  await page.click('#home-gal .hg-th[data-index="1"]'); await page.waitForTimeout(200); await page.click('#home-gal .hg-th[data-index="0"]'); await page.waitForTimeout(200);
  check((await fields()).d === 'Fotos de la campaña de lanzamiento, con la luz de la tarde.', 'leaving the field also saves it');
  // Velocidad: the drift speed for everyone, previewed live while it is being set
  check(await page.evaluate(() => document.querySelector('#home-speed').value === '24' && document.querySelector('#home-speed-v').textContent === '24'), 'Velocidad starts at the default (24)');
  await page.focus('#home-speed'); await setRange(page, 'home-speed', 100, false);
  const live = await driftSpeed(page, 2500);
  check(live > 40, `while Velocidad is being set the row drifts at that speed, with the panel open (${Math.round(live)} px/s)`);
  await page.locator('#home-speed').blur(); await page.waitForTimeout(1500);
  check(Math.abs(await driftSpeed(page, 0)) < 1, 'leaving the control, the open panel holds the row still again');
  await setRange(page, 'home-speed', 100); await page.waitForTimeout(200);
  check(await page.evaluate(() => document.querySelector('#home-speed-v').textContent === '100'), 'Velocidad set to 100');
    await page.screenshot({ path: T + 'home-04-gallery.png' });
  await page.click('#home-gal [data-action="home-gal"]'); await page.waitForTimeout(500);
  await page.mouse.move(1490, 880); await settled(page, 1000);
  await page.screenshot({ path: T + 'home-05-slider-media.png' });
  // One continuous ring: the top edges of all the cards lie on one smooth curve across the screen (no card has its own
  // tilt), and each card is bent along it (its top edge is curved, not straight)
  {
    await park(page); await page.waitForTimeout(900);
    await grab(page);
    const cy = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#home')).getPropertyValue('--hs-cy')));
    const pts = await topEdge(page, 100, Math.round(cy)), R = runs(pts), all = R.flat();
    const fit = evenFit(all, 756, 756), res = Math.max(...all.map(([x, y]) => Math.abs(y - fit(x))));
    check(R.length >= 3 && all.some(q => q[0] < 60) && all.some(q => q[0] > 1450), `the cards' top edges were found across the screen (${R.length} cards, ${all.length} points)`);
    check(res < 2.5, `they all lie on one smooth curve: the ring is continuous, no card is tilted on its own (largest gap to the curve ${res.toFixed(2)}px)`);
    const mid = R.find(r => r[0][0] < 756 && r[r.length - 1][0] > 756) || R.sort((a, b) => Math.abs((a[0][0] + a[a.length - 1][0]) / 2 - 756) - Math.abs((b[0][0] + b[b.length - 1][0]) / 2 - 756))[0];
    const [a, b] = [mid[0], mid[mid.length - 1]], m = mid[Math.floor(mid.length / 2)], sag = m[1] - (a[1] + (b[1] - a[1]) * (m[0] - a[0]) / (b[0] - a[0]));
    check(Math.abs(sag) > 2, `each card is bent with the ring: the middle card's top edge curves (${sag.toFixed(1)}px off a straight line)`);
    const L = R.filter(r => r[r.length - 1][0] < 400).flat(), Rr = R.filter(r => r[0][0] > 1112).flat();
    check(L.length && Rr.length && Math.min(...L.map(q => q[1])) < fit(756) - 15 && Math.min(...Rr.map(q => q[1])) < fit(756) - 15, 'toward both edges of the screen the ring rises: a marked curve, like the reference');
    await page.screenshot({ path: T + 'home-05b-ring.png' });
    await page.mouse.move(1490, 880);
  }
  {
    const H = await page.evaluate(() => Math.max(...[...document.querySelectorAll('#hs-stage .hs-card')].map(e => e.offsetHeight))), want = 80 * H / 320;
    const v = await driftSpeed(page, 1500);
    check(v > want * .75 && v < want * 1.5, `at 100 the row drifts fast (${Math.round(v)} px/s, ~${Math.round(want)} expected)`);
    await page.click('#home-tools [data-action="home-gal"]'); await page.waitForTimeout(300);
    await setRange(page, 'home-speed', 60); await page.waitForTimeout(100);
    await page.mouse.move(1490, 140); await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
    check(await page.evaluate(() => document.querySelector('#home-speed').value === '100'), 'Ctrl+Z undoes a speed change');
    await setRange(page, 'home-speed', 0); await page.waitForTimeout(100);
    check(await page.evaluate(() => document.querySelector('#home-speed-v').textContent === 'Quieto'), 'at 0 the control reads "Quieto"');
    await page.click('#home-gal [data-action="home-gal"]'); await page.mouse.move(1490, 880);
    check(Math.abs(await driftSpeed(page, 1500)) < .5, 'and the row holds still');
    await page.click('#home-tools [data-action="home-gal"]'); await page.waitForTimeout(300);
    await setRange(page, 'home-speed', 24); await page.waitForTimeout(100);
    await page.click('#home-gal [data-action="home-gal"]'); await page.waitForTimeout(300);
  }
  {
    await park(page); await goTo(page, 0, 4);
    const c = await center(page);
    await page.mouse.click(c.x, c.y); await page.waitForTimeout(900);
    const L = await lb(page);
    check(L.open && !!L.img && L.img.startsWith('blob:'), 'an image card opens the image itself in the lightbox');
    const tx = await page.evaluate(() => { const f = document.querySelector('#home-lb .hlb-frame').getBoundingClientRect(), c = document.querySelector('#home-lb .hlb-cap'), t = c.querySelector('.hlb-t'), d = c.querySelector('.hlb-d'), cs = (e) => getComputedStyle(e), r = c.getBoundingClientRect();
      return { t: t.textContent, d: d.textContent, ts: cs(t).fontSize, ds: cs(d).fontSize, tw: cs(t).fontWeight, dw: cs(d).fontWeight, tc: cs(t).color, dc: cs(d).color, fam: cs(t).fontFamily, mid: (r.left + r.right) / 2 - (f.left + f.right) / 2, ta: [cs(c).textAlign, cs(t).textAlign, cs(d).textAlign], tmid: (t.getBoundingClientRect().left + t.getBoundingClientRect().right) / 2 - (f.left + f.right) / 2, dmid: (d.getBoundingClientRect().left + d.getBoundingClientRect().right) / 2 - (f.left + f.right) / 2, dw2: d.getBoundingClientRect().width, fw: f.width, gap: r.top - f.bottom, lh: parseFloat(cs(d).lineHeight) / parseFloat(cs(d).fontSize) }; });
    check(tx.t === 'Campaña 2026' && tx.d === 'Fotos de la campaña de lanzamiento, con la luz de la tarde.', 'the title and the description show right under the opened image');
    check(tx.ts === '14px' && tx.ds === '14px' && tx.tw === '600' && tx.dw === '400' && tx.tc !== tx.dc && /Plus Jakarta Sans/.test(tx.fam) && tx.lh >= 1.35, `title 14px semibold, description 14px regular in a softer color, Plus Jakarta Sans, comfortable line height (${tx.ts}/${tx.tw}, ${tx.ds}/${tx.dw}, ${tx.lh.toFixed(2)})`);
    check(tx.ta.every(a => a === 'center') && Math.abs(tx.mid) < 1 && Math.abs(tx.tmid) < 1 && Math.abs(tx.dmid) < 1 && tx.dw2 <= tx.fw + .5 && tx.gap > 4 && tx.gap < 30, `centered under the image, just under it (${Math.round(tx.gap)}px), no wider than it`);
    await page.screenshot({ path: T + 'home-06-lightbox-image.png' });
    await page.keyboard.press('Escape'); await page.waitForTimeout(900);
  }
  {
    await page.mouse.move(1490, 880);
    await park(page); await goTo(page, 3, 4);
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
  await page.click('#home-gal .hg-th[data-index="2"]'); await page.waitForTimeout(200);
  check(await page.evaluate(() => document.querySelector('#home-title').value === 'Campaña 2026'), 'the texts move with their item');
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
  check(await page.evaluate(() => !document.querySelector('#hs-stage .hs-media[data-ph]') &&  document.querySelectorAll('#hs-stage .hs-card').length % 3 === 0), 'the slider now cycles the three remaining items');
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
  {
    const b = await bar(page);
    check(b.left + 96 < 1512 * .25 + 1 && Math.abs(b.top - 20) < 1, `on the section pages search and menu are back next to the section list (${Math.round(b.left)}px from the left)`);
  }
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

  await page.click('#rail-logo [data-action="home"]'); await page.waitForTimeout(60);
  const slide = await bar(page);
  await page.waitForTimeout(640);
  check(await view(page) === 'home' && await page.evaluate(() => location.hash === '' && !document.querySelector('#page-mode').getClientRects().length), 'the logo goes back Home from a section page (no hash, no page switch)');
  {
    const b = await bar(page);
    check(slide.anims > 0 && slide.right > b.right + 20 && Math.abs(b.right - 20) < 1, `going Home, search and menu slide over to the top right corner (${Math.round(slide.right)} → ${Math.round(b.right)}px from the edge)`);
  }
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

  // ---------- 1b. Without WebGL the DOM cards are drawn instead ----------
  {
    const plain = await chromium.launch();
    const { page: p, ctx: c } = await open(plain, BASE);
    await p.waitForSelector('#home .hs-card'); await p.waitForTimeout(1500);
    const g = await p.evaluate(() => ({ gl: document.querySelector('#hs').classList.contains('is-gl'), vis: getComputedStyle(document.querySelector('#hs-stage .hs-card .hs-media')).opacity }));
    const cs = await cards(p);
    check(!g.gl && cs.length >= 4 && overlaps(cs).length === 0, `no WebGL (plain headless): the DOM cards are drawn themselves, still without overlaps (${cs.length} in view)`);
    const m = await center(p); await p.mouse.click(m.x, m.y); await p.waitForTimeout(900);
    check((await lb(p)).open && (await lb(p)).out[0] === m.k, 'and a click still opens the card under the pointer');
    check(p.errors.length === 0, 'no page errors (no WebGL): ' + p.errors.join(' | '));
    await c.close(); await plain.close();
  }

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
    await enterCategory(p);
    await p.click('#rail-logo [data-action="home"]'); await p.waitForTimeout(40);
    const rb = await bar(p);
    check(rb.anims === 0 && Math.abs(rb.right - 20) < 1, 'reduced motion: search and menu jump to their corner, no slide');
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
    { const [a, b] = await navBtns(p); check(a.w === 44 && b.w === 44 && a.radius === '50%' && b.l - a.r >= 16 && b.l - a.r <= 20 && Math.abs((a.l + b.r) / 2 - 195) < 1, `phone: the same two round buttons, 44px, centered (${a.w}px, ${Math.round(b.l - a.r)}px apart)`); }
    { const b = await bar(p); check(Math.abs(b.right - 16) < 1 && Math.abs(b.logoLeft - 16) < 1, `phone: the menu top right, 16px in like the logo (${Math.round(b.right)}px)`); }
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
    await E.waitForSelector('#home-title');
    await E.fill('#home-title', 'Lanzamiento'); await E.keyboard.press('Enter');
    await E.fill('#home-desc', 'La tarjeta, de frente.'); await E.keyboard.press('Enter');
    check(await until(() => { const m = fake.docs.get('catalog/tree').data.home.media[0] || {}; return m.title === 'Lanzamiento' && m.desc === 'La tarjeta, de frente.' && !('label' in m); }, 8000), 'Supabase: the title and the description are stored with the item');
    await E.evaluate(() => { const r = document.querySelector('#home-speed'); r.value = 50; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    check(await until(() => fake.docs.get('catalog/tree').data.home.speed === 50, 8000), 'Supabase: the speed is stored (home.speed)');
    await E.click('#home-gal [data-action="home-ratio"][data-v="1/1"]');
    await E.evaluate(() => { const r = document.querySelector('#home-radius'); r.value = 28; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    check(await until(() => { const h = fake.docs.get('catalog/tree').data.home; return h.media[0].ratio === '1/1' && h.radius === 28; }, 8000), 'Supabase: the card shape (ratio) and the corners (home.radius) are stored');
    const vis = await open(browser, SUPA_BASE, {}, (c) => fake.attach(c, 'visitor'));
    const V = vis.page;
    await V.waitForSelector('#home .hs-card');
    check(await until(() => V.evaluate((id) => [...document.querySelectorAll('#hs-stage .hs-card img')].some(i => i.src.includes(id)) && !document.querySelector('#hs-stage .hs-media[data-ph]'), media.id)), 'Supabase: a visitor sees the slider made of that image');
    check(await until(() => V.evaluate(() => document.querySelector('#hs').classList.contains('is-gl'))), 'Supabase: the stored files load with CORS, so the ring keeps drawing them with WebGL');
    {
      const c = await center(V); await V.mouse.click(c.x, c.y); await V.waitForTimeout(60);
      await V.waitForTimeout(840);
      check(await V.evaluate(() => (document.querySelector('#home-lb .hlb-t') || {}).textContent === 'Lanzamiento' && (document.querySelector('#home-lb .hlb-d') || {}).textContent === 'La tarjeta, de frente.'), 'Supabase: a visitor opening it sees the title and the description');
      await V.keyboard.press('Escape'); await V.waitForTimeout(800);
    }
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
    // a caption saved before (label) shows as the title
    {
      const T0 = fake.docs.get('catalog/tree').data;
      fake.seed('catalog/tree', { ...T0, home: { media: [{ id: media.id, kind: 'image', w: media.w, h: media.h, label: 'Leyenda vieja' }] } }, leo.id);
      const old = await open(browser, SUPA_BASE, {}, (c) => fake.attach(c, 'visitor'));
      await old.page.waitForSelector('#home .hs-card img');
      const c = await center(old.page); await old.page.mouse.click(c.x, c.y); await old.page.waitForTimeout(900);
      check(await old.page.evaluate(() => (document.querySelector('#home-lb .hlb-t') || {}).textContent === 'Leyenda vieja' && !document.querySelector('#home-lb .hlb-d')), 'Supabase: an old caption (label) shows as the title; no empty description');
      await old.ctx.close();
    }
    const errs = [...E.errors, ...V.errors].filter(e => !/status of 40[49]/.test(e));
    check(errs.length === 0, 'no page errors (Supabase): ' + errs.join(' | '));
    await ed.ctx.close(); await vis.ctx.close();
  }

  await browser.close();
  if (fails) { console.error(`${fails} home check(s) failed`); process.exit(1); }
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
