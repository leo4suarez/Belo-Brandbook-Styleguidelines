// v7: the theme opens light, the rail title and its category list, locked categories (in the page and in the
// database), moving a subcategory, the items of a text module (containers, auto-layout groups, dividers), module
// strokes, the width of a block and the split of a half row, and the carousel strip.
// Runs on the local demo (BASE_URL) and on the fake Supabase project (SUPA_BASE_URL). Usage: through tests/run.cjs.
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
const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, what) => { log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what); };
const near = (a, b, d = 2) => Math.abs(a - b) <= d;
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };

async function routes(ctx) {
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/lenis/, r => r.fulfill({ path: FIX + 'lenis.min.js', contentType: 'text/javascript' }));
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/gsap@[^/]+\/dist\/(gsap|ScrollTrigger|SplitText)\.min\.js/, r => r.fulfill({ path: FIX + r.request().url().split('/').pop(), contentType: 'text/javascript' }));
}
function watchErrors(page, label) {
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to fetch|status of 409|status of 403/.test(m.text())) page.errors.push(label + ': ' + m.text()); });
  page.on('pageerror', e => page.errors.push(label + ' pageerror: ' + e.message));
}

(async () => {
  const browser = await chromium.launch();
  const scrollIdle = (p) => p.waitForFunction(() => !document.documentElement.classList.contains('lenis-scrolling'), null, { timeout: 5000 }).catch(() => {});
  const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
  const railTitle = (p) => p.evaluate(() => (document.querySelector('.rail-title') || {}).textContent || '');
  const openMenu = async (p) => { await p.click('#btn-menu'); await p.waitForTimeout(900); };
  const closeMenu = async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(500); };
  const localPage = async (hash = '#s_direccion', init) => {
    const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1 });
    await routes(ctx);
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage(); watchErrors(page, 'local');
    await page.goto(BASE + hash);
    await page.waitForSelector('.rail-cat');
    await page.waitForTimeout(600);
    return page;
  };
  const editRow = async (p, rowId) => {
    const row = p.locator(`#stage .row[data-id="${rowId}"]`);
    await row.scrollIntoViewIfNeeded(); await scrollIdle(p);
    await row.hover();
    await row.locator('[data-action="row-edit"]').click();
    await p.waitForSelector('.row.is-editing');
    await p.waitForTimeout(200);
  };
  const fill = async (p, k, v) => { await p.fill('#f-' + k, String(v)); await p.waitForTimeout(120); };
  const seg = async (p, k, v) => { await p.click(`#insp [data-action="seg"][data-k="${k}"][data-v="${v}"]`); await p.waitForTimeout(150); };
  const confirm = async (p) => { await p.click('#insp [data-action="confirm-edit"]'); await p.waitForTimeout(600); };

  /* ---------- 1. Theme: every visit opens light ---------- */
  {
    const p = await localPage('#s_direccion', () => { try { if (!sessionStorage.getItem('t.seeded')) { localStorage.setItem('bc.scheme', 'dark'); sessionStorage.setItem('t.seeded', '1'); } } catch {} });
    check(await p.evaluate(() => document.documentElement.dataset.scheme) === 'light', 'opens light even with a dark theme saved by an earlier version');
    check(await p.evaluate(() => localStorage.getItem('bc.scheme')) === null, 'the old saved theme is dropped');
    await openMenu(p);
    await p.click('#menu [data-action="scheme"][data-scheme="dark"]'); await p.waitForTimeout(400);
    await p.reload(); await p.waitForSelector('.rail-cat'); await p.waitForTimeout(300);
    check(await p.evaluate(() => document.documentElement.dataset.scheme) === 'dark', 'the switch holds for the rest of the visit (reload)');
    const q = await p.context().newPage(); watchErrors(q, 'local-2');
    await q.goto(BASE + '#s_direccion'); await q.waitForSelector('.rail-cat');
    check(await q.evaluate(() => document.documentElement.dataset.scheme) === 'light', 'a new visit opens light again');
    await p.context().close();
  }

  const P = await localPage();

  /* ---------- 2. Rail title: body text with a chevron listing every category ---------- */
  {
    const st = await P.evaluate(() => { const a = getComputedStyle(document.querySelector('.rail-cat')), b = getComputedStyle(document.querySelector('#rail-nav .sub')); return { fs: [a.fontSize, b.fontSize], fw: [a.fontWeight, b.fontWeight], ff: a.fontFamily, chev: !!document.querySelector('.rail-cat .rail-chev') }; });
    check(st.fs[0] === st.fs[1] && st.fs[0] === '16px' && st.fw[0] === st.fw[1] && !/Phudu/.test(st.ff) && st.chev, `rail title in the body text of its sections, with a chevron (${st.fs[0]} ${st.fw[0]})`);
    await P.click('.rail-cat'); await P.waitForTimeout(250);
    const items = await P.evaluate(() => [...document.querySelectorAll('#pop [data-action="cat-go"]')].map(b => b.textContent.trim()));
    check(items.length === 4 && items[0] === 'Our Brand', 'the chevron lists every category: ' + items.join(', '));
    await P.screenshot({ path: T + 'v7-rail-categories.png' });
    await P.click('#pop [data-action="cat-go"][data-id="c_visual"]'); await P.waitForTimeout(400);
    check(await railTitle(P) === 'Visual Identity', 'picking one opens that category');
    await P.click('.rail-cat'); await P.click('#pop [data-action="cat-go"][data-id="c_ourbrand"]'); await P.waitForTimeout(400);
  }

  /* ---------- 3. Locked categories ---------- */
  {
    await openMenu(P);
    await P.click('.ov-item:has([data-id="c_voice"]) [data-action="item-menu"]');
    check(await P.locator('#pop [data-action="pop-lock"]').textContent() === 'Bloquear para Viewer', 'a category menu offers "Bloquear para Viewer"');
    await P.click('#pop [data-action="pop-lock"]'); await P.waitForTimeout(300);
    check(await P.evaluate(() => !!document.querySelector('.ov-item.is-locked .ov-cat[data-id="c_voice"] .ov-lock') && !document.querySelector('.ov-cat[data-id="c_voice"]').hasAttribute('aria-disabled')), 'admin sees the lock beside the name and can still open it');
    const lockBox = await P.evaluate(() => { const t = document.querySelector('.ov-cat[data-id="c_voice"] .ov-cat-t').getBoundingClientRect(), l = document.querySelector('.ov-cat[data-id="c_voice"] .ov-lock').getBoundingClientRect(); return { right: l.left >= t.right, mid: Math.abs((l.top + l.bottom) / 2 - (t.top + t.bottom) / 2) }; });
    check(lockBox.right && lockBox.mid < 14, 'the lock sits to the right of the name, centered on it');
    await P.click('#menu [data-action="mode"][data-mode="viewer"]'); await P.waitForTimeout(500);
    check(await P.getAttribute('.ov-cat[data-id="c_voice"]', 'aria-disabled') === 'true', 'in viewer mode the locked category is disabled');
    const op = await P.evaluate(() => +getComputedStyle(document.querySelector('.ov-cat[data-id="c_voice"]')).opacity);
    check(op < .5, 'and dimmed (' + op + ')');
    await P.screenshot({ path: T + 'v7-menu-locked-viewer.png' });
    await P.click('.ov-cat[data-id="c_voice"]', { force: true }); await P.waitForTimeout(400);
    check(await P.evaluate(() => document.querySelector('#menu').classList.contains('is-open')) && await railTitle(P) !== 'Voice & Tone', 'a viewer cannot enter it');
    check(/en preparación/.test(await toasts(P)), 'and is told it is being prepared');
    await closeMenu(P);
    await P.click('.rail-cat'); await P.waitForTimeout(200);
    check(await P.evaluate(() => document.querySelector('#pop [data-action="cat-go"][data-id="c_voice"]').disabled), 'the rail list shows it disabled too');
    await P.keyboard.press('Escape');
    await P.click('#btn-search'); await P.waitForTimeout(300);
    check(!(await P.evaluate(() => [...document.querySelectorAll('.qi h3')].some(h => /voice/i.test(h.textContent)))), 'search does not offer it to viewers');
    await P.keyboard.press('Escape'); await P.waitForTimeout(300);
    // An admin inside it who switches to Viewer is taken out of it
    await P.click('#page-mode [data-mode="admin"]'); await P.waitForTimeout(400);
    await P.click('.rail-cat'); await P.click('#pop [data-action="cat-go"][data-id="c_voice"]'); await P.waitForTimeout(400);
    check(await railTitle(P) === 'Voice & Tone', 'admin enters the locked category');
    check(await P.evaluate(() => !!document.querySelector('.rail-title .rail-lock')), 'its rail title carries the lock');
    await P.click('#page-mode [data-mode="viewer"]'); await P.waitForTimeout(600);
    check(await railTitle(P) !== 'Voice & Tone', 'switching to Viewer leaves the locked category (' + await railTitle(P) + ')');
    await P.click('#page-mode [data-mode="admin"]'); await P.waitForTimeout(400);
  }

  /* ---------- 4. A subcategory goes to another category ---------- */
  {
    await P.click('.rail-cat'); await P.click('#pop [data-action="cat-go"][data-id="c_ourbrand"]'); await P.waitForTimeout(500);
    await P.hover('.sub-item[data-sub="s_direccion"]');
    await P.click('.sub-item[data-sub="s_direccion"] [data-action="item-menu"]');
    await P.click('#pop [data-action="pop-move-cat"]'); await P.waitForTimeout(200);
    const targets = await P.evaluate(() => [...document.querySelectorAll('#pop [data-action="sub-move-to"]')].map(b => b.textContent.trim() + (b.disabled ? '(here)' : '')));
    check(targets.length === 4 && targets[0].includes('(here)'), 'the categories to send it to: ' + targets.join(', '));
    await P.click('#pop [data-action="sub-move-to"][data-cat="c_visual"]'); await P.waitForTimeout(500);
    check(!(await P.evaluate(() => !!document.querySelector('#rail-nav [data-sub="s_direccion"]'))), 'it leaves Our Brand');
    check(/se movió a «Visual Identity»/.test(await toasts(P)), 'a toast says where it went');
    await P.click('.toast-act'); await P.waitForTimeout(800);
    check(await railTitle(P) === 'Visual Identity' && await P.evaluate(() => !!document.querySelector('#s-s_direccion .row[data-id="r_t"]')), '"Ver" opens it in Visual Identity, with its content');
  }

  /* ---------- 5. Inside a text module: dividers, groups, containers; stroke; width ---------- */
  {
    await editRow(P, 'r_t');
    await P.click('#stage .row.is-editing .tb[data-block="b1"]');
    await P.click('#insp [data-action="add-div"]'); await P.waitForTimeout(250);
    const did = await P.evaluate(() => document.querySelector('#stage .row.is-editing .tdiv').dataset.item);
    check(await P.evaluate(() => document.querySelector('#stage .row.is-editing .tdiv').classList.contains('is-sel') && /Divisor/.test(document.querySelector('#insp').textContent)), 'a divider is added after the selected text and selected');
    const dv = await P.evaluate(() => { const r = document.querySelector('#stage .row.is-editing .tdiv').getBoundingClientRect(); return [Math.round(r.width), r.height]; });
    check(dv[0] > 1000 && near(dv[1], 1, .5), 'it spans the module, 1px thick (' + dv.join('×') + ')');
    await fill(P, 'divt', 3);
    check(await P.evaluate(() => document.querySelector('#stage .row.is-editing .tdiv').getBoundingClientRect().height) === 3, 'its thickness changes live');
    // Undo takes it back
    await P.click('#insp [data-action="add-div"]'); await P.waitForTimeout(200);
    const n0 = await P.locator('#stage .row.is-editing .tdiv').count();
    await P.click('#insp-back'); await P.waitForTimeout(250);
    check(await P.locator('#stage .row.is-editing .tdiv').count() === n0 - 1, 'undo removes a divider just added');
    // Group the first text and the divider (Shift + click in the layers)
    await P.click('#insp .layers [data-id="b1"]');
    await P.click(`#insp .layers [data-id="${did}"]`, { modifiers: ['Shift'] });
    check(await P.evaluate(() => document.querySelectorAll('#insp .layers button.is-range').length) === 2, 'Shift + click selects a run of items');
    await P.click('#insp [data-action="group"]'); await P.waitForTimeout(300);
    const grp = await P.evaluate(() => { const g = document.querySelector('#stage .row.is-editing .tgroup'); return g && { kids: [...g.children].map(c => c.className.split(' ')[0]), sel: g.classList.contains('is-sel') }; });
    check(grp && grp.kids.join() === 'tb,tdiv' && grp.sel, 'they become an auto-layout group, selected');
    check(await P.evaluate(() => /Auto layout/.test(document.querySelector('#insp').textContent)), 'the panel shows the auto layout of the group');
    await seg(P, 'gdir', 'h'); await fill(P, 'igap', 40);
    const gs = await P.evaluate(() => { const g = document.querySelector('#stage .row.is-editing .tgroup'); const cs = getComputedStyle(g); return { dir: cs.flexDirection, gap: cs.columnGap, div: Math.round(g.querySelector('.tdiv').getBoundingClientRect().width) }; });
    check(gs.dir === 'row' && gs.gap === '40px' && gs.div === 3, 'horizontal, 40px apart; the divider stands upright (' + JSON.stringify(gs) + ')');
    // Its inner spacing, in the auto layout: the four sides together, then one alone
    const gpad = () => P.evaluate(() => { const cs = getComputedStyle(document.querySelector('#stage .row.is-editing .tgroup')); return [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat).join(); });
    check(await P.evaluate(() => { const f = document.querySelector('#insp #f-ibpt'), sec = f && f.closest('.insp-sec'); return !!sec && /Auto layout/.test(sec.querySelector('h4').textContent) && /Espaciado interno/.test(sec.textContent); }), 'the auto layout of a group has its inner spacing');
    await fill(P, 'ibpt', 24);
    check(await gpad() === '24,24,24,24', 'one value sets the four sides (' + await gpad() + ')');
    await P.click('#insp [data-action="box-pad-link"]'); await P.waitForTimeout(150);
    await fill(P, 'ibpl', 48);
    check(await gpad() === '24,24,24,48' && await P.inputValue('#f-ibpr') === '24', 'unlinked, a side alone (' + await gpad() + ')');
    // Arrows: the text below steps into the group at its edge, and out again
    await P.click('#insp .layers [data-id="b2"]');
    await P.click('#insp [data-action="block-up"]'); await P.waitForTimeout(250);
    check(await P.evaluate(() => !!document.querySelector('#stage .row.is-editing .tgroup .tb[data-block="b2"]')), 'moving up into a group adds the item to it');
    await P.click('#insp [data-action="block-down"]'); await P.waitForTimeout(250);
    check(await P.evaluate(() => !document.querySelector('#stage .row.is-editing .tgroup .tb[data-block="b2"]')), 'moving down out of it takes it out');
    // Container of a text: fill, hug, inner spacing, radius, fixed height
    await P.click('#insp .layers [data-id="b2"]');
    if (!(await P.locator('#insp #f-ibpt').count())) await P.click('#insp [data-action="box-fold"]');
    await P.click('#insp [data-action="seg"][data-k="ibfill"][data-v="#002fa7"]');
    await seg(P, 'ibw', 'hug'); await fill(P, 'ibpt', 24); await P.click('#insp [data-action="box-pad-link"]'); await fill(P, 'ibpl', 32); await fill(P, 'ibr', 24);
    await seg(P, 'ibh', 'fix'); await fill(P, 'ibhv', 400);
    const bx = await P.evaluate(() => { const t = document.querySelector('#stage .row.is-editing .tb[data-block="b2"]'), cs = getComputedStyle(t); return { bg: cs.backgroundColor, pl: cs.paddingLeft, pt: cs.paddingTop, r: cs.borderTopLeftRadius, h: Math.round(t.getBoundingClientRect().height), bw: t.dataset.bw }; });
    check(bx.bg === 'rgb(0, 47, 167)' && bx.pl === '32px' && bx.pt === '24px' && bx.r === '24px' && bx.h >= 400 && bx.bw === 'hug', 'a text gets its own container: fill, spacing, radius, height (' + JSON.stringify(bx) + ')');
    await fill(P, 'ibsw', 2);
    check(await P.evaluate(() => getComputedStyle(document.querySelector('#stage .row.is-editing .tb[data-block="b2"]')).borderTopWidth) === '2px', 'and a stroke');
    // Module: stroke and gap
    await fill(P, 'mstw', 2);
    check(await P.evaluate(() => getComputedStyle(document.querySelector('#stage .row.is-editing .slot-text'), '::before').borderTopWidth) === '2px', 'the module gets a stroke');
    await P.click('#insp [data-action="seg"][data-k="msc"][data-v="#002fa7"]'); await P.waitForTimeout(100);
    check(await P.evaluate(() => getComputedStyle(document.querySelector('#stage .row.is-editing .slot-text'), '::before').borderTopColor) === 'rgb(0, 47, 167)', 'in a palette color');
    // Width of the block: field, alignment and the side handle
    const colW = await P.evaluate(() => document.querySelector('#stage .row.is-editing').getBoundingClientRect().width);
    await fill(P, 'rw', 60);
    const w60 = await P.evaluate(() => document.querySelector('#stage .row.is-editing').getBoundingClientRect().width);
    check(near(w60, colW * .6, 2), `the block takes 60% of its column (${Math.round(w60)} of ${Math.round(colW)})`);
    const l0 = await P.evaluate(() => document.querySelector('#stage .row.is-editing').getBoundingClientRect().left);
    await seg(P, 'rwa', 'c');
    const l1 = await P.evaluate(() => document.querySelector('#stage .row.is-editing').getBoundingClientRect().left);
    check(near(l1 - l0, colW * .2, 2), 'centered in it');
    const refOk = await P.evaluate(() => document.querySelector('#stage .row.is-editing .slot-text').style.getPropertyValue('--ref'));
    check(near(+refOk, 1114 * .6, 1), 'its text keeps its size (the module is drawn at its own width: ' + refOk + ')');
    const h = await P.locator('#stage .row.is-editing [data-rzw]').boundingBox();
    await P.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await P.mouse.down();
    await P.mouse.move(h.x + h.width / 2 + 120, h.y + h.height / 2, { steps: 6 }); await P.mouse.up();
    const wAfter = await P.evaluate(() => document.querySelector('#stage .row.is-editing').getBoundingClientRect().width);
    check(wAfter > w60 + 150, 'dragging the side handle widens it (both sides when centered): ' + Math.round(wAfter));
    check(+(await P.inputValue('#f-rw')) > 60, 'and the field follows');
    await P.screenshot({ path: T + 'v7-text-items-edit.png' });
    await confirm(P);
    const view = await P.evaluate(() => { const r = document.querySelector('#stage .row[data-id="r_t"]'); return { w: r.classList.contains('has-w'), g: !!r.querySelector('.tgroup[data-dir="h"] .tdiv'), fill: !!r.querySelector('.tb.has-fill'), stroke: r.querySelector('.slot-text').classList.contains('has-stroke') }; });
    check(view.w && view.g && view.fill && view.stroke, 'confirmed, the page shows all of it: ' + JSON.stringify(view));
    await P.screenshot({ path: T + 'v7-text-items-view.png' });
    // Narrow screens use the full width
    await P.setViewportSize({ width: 390, height: 844 }); await P.waitForTimeout(400);
    const mob = await P.evaluate(() => { const r = document.querySelector('#stage .row[data-id="r_t"]').getBoundingClientRect(); return Math.round(r.width); });
    check(mob >= 390 - 32 - 1, 'on a phone the block uses the full width (' + mob + ')');
    await P.setViewportSize({ width: 1512, height: 900 }); await P.waitForTimeout(400);
  }

  /* ---------- 6. Half row: the share of each module ---------- */
  {
    const sec = '#s-s_direccion';
    await P.locator(`${sec} [data-action="adder-open"]`).scrollIntoViewIfNeeded(); await scrollIdle(P);
    await P.click(`${sec} [data-action="adder-open"]`);
    await P.click(`${sec} [data-action="adder-layout"][data-layout="half"]`);
    const picks = P.locator('.row.is-editing [data-action="pick-type"][data-type="color"]');
    await picks.first().click(); await P.waitForTimeout(150);
    await P.locator('.row.is-editing [data-action="pick-type"][data-type="color"]').first().click(); await P.waitForTimeout(150);
    await fill(P, 'rsplit', 30);
    const ws = await P.evaluate(() => [...document.querySelectorAll('#stage .row.is-editing .row-grid > .slot')].map(s => s.getBoundingClientRect().width));
    check(ws.length === 2 && near(ws[0] / (ws[0] + ws[1]), .3, .01), 'a half row splits 30 / 70 (' + ws.map(Math.round).join(' / ') + ')');
    const sp = await P.locator('#stage .row.is-editing [data-rzs]').boundingBox();
    await P.mouse.move(sp.x + sp.width / 2, sp.y + 40); await P.mouse.down();
    await P.mouse.move(sp.x + sp.width / 2 + 200, sp.y + 40, { steps: 6 }); await P.mouse.up();
    check(+(await P.inputValue('#f-rsplit')) > 40, 'the handle between them moves the split (' + await P.inputValue('#f-rsplit') + ' %)');
    await P.dblclick('#stage .row.is-editing [data-rzs]'); await P.waitForTimeout(200);
    const ws2 = await P.evaluate(() => [...document.querySelectorAll('#stage .row.is-editing .row-grid > .slot')].map(s => s.getBoundingClientRect().width));
    check(near(ws2[0], ws2[1], 1), 'a double click goes back to half and half');
    await P.click('#insp [data-action="cancel-edit"]'); await P.waitForTimeout(600);
  }

  /* ---------- 7. Carousel strip ---------- */
  {
    const sec = '#s-s_direccion';
    await P.locator(`${sec} [data-action="adder-open"]`).scrollIntoViewIfNeeded(); await scrollIdle(P);
    await P.click(`${sec} [data-action="adder-open"]`);
    await P.click(`${sec} [data-action="adder-layout"][data-layout="full"]`);
    await P.click('.row.is-editing [data-action="pick-type"][data-type="carousel"]');
    await P.setInputFiles('.row.is-editing input[data-upload]', [FIX + 'img1.jpg', FIX + 'split.jpg', FIX + 'img3.jpg']);
    await P.waitForFunction(() => document.querySelectorAll('.row.is-editing .thumb[data-index]').length === 3);
    // The slides take a background too
    check(await P.evaluate(() => !!document.querySelector('#insp [data-k="bgpal"]')), 'the slides offer a background, like the other containers');
    await P.click('#insp [data-action="seg"][data-k="bgpal"][data-v="pc_negro"]'); await P.waitForTimeout(200);
    const sl = await P.evaluate(() => { const el = document.querySelector('#stage .row.is-editing .slot-carousel'), cs = getComputedStyle(el); return { r: cs.borderTopLeftRadius, bg: cs.backgroundColor, car: getComputedStyle(el.querySelector('.carousel')).backgroundColor }; });
    check(sl.r === '20px' && sl.bg === 'rgb(10, 10, 10)' && sl.car === 'rgba(0, 0, 0, 0)', 'a palette background fills the slides box (' + JSON.stringify(sl) + ')');
    await P.click('#insp [data-action="seg"][data-k="bg"][data-v="none"]'); await P.waitForTimeout(150);
    await seg(P, 'cmode', 'strip'); await P.waitForTimeout(300);
    const items = await P.evaluate(() => [...document.querySelectorAll('#stage .row.is-editing .cs-item .cs-frame')].map(f => { const r = f.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    check(items.length === 3 && items[0][1] === 480 && near(items[0][0], 768, 1) && near(items[1][0], 853, 1), 'a strip lines the images up, each in its own proportion (' + items.map(i => i.join('×')).join(', ') + ')');
    check(/Toca una imagen/.test(await P.textContent('#insp')), 'the panel asks to pick an image');
    await P.click('#stage .row.is-editing .cs-item[data-i="1"]'); await P.waitForTimeout(250);
    check(/Imagen 2 de 3/.test(await P.textContent('#insp')) && await P.evaluate(() => document.querySelector('#stage .row.is-editing .cs-item[data-i="1"]').classList.contains('is-sel')), 'a click picks one');
    await fill(P, 'ciw', 360);
    await P.selectOption('#insp select[data-f="ciratio"]', '4/5'); await P.waitForTimeout(150);
    await P.fill('#f-ccap', 'Tarjetas emitidas por belo.'); await P.waitForTimeout(150);
    let f1 = await P.evaluate(() => { const f = document.querySelector('#stage .row.is-editing .cs-item[data-i="1"]'), r = f.querySelector('.cs-frame').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), (f.querySelector('.cs-cap') || {}).textContent]; });
    check(f1[0] === 360 && f1[1] === 450 && f1[2] === 'Tarjetas emitidas por belo.', 'its size, proportion and caption: ' + f1.join(' · '));
    // Framing by dragging the picked image
    const fr = await P.locator('#stage .row.is-editing .cs-item.is-sel .cs-frame').boundingBox();
    await P.mouse.move(fr.x + fr.width / 2, fr.y + fr.height / 2); await P.mouse.down();
    await P.mouse.move(fr.x + fr.width / 2 + 60, fr.y + fr.height / 2, { steps: 5 }); await P.mouse.up();
    check(+(await P.inputValue('#f-cfx')) < 50, 'dragging the picked image moves its focal point (' + await P.inputValue('#f-cfx') + ' %)');
    // Resizing by its corner
    const rz = await P.locator('#stage .row.is-editing [data-csrz]').boundingBox();
    await P.mouse.move(rz.x + 8, rz.y + 8); await P.mouse.down();
    await P.mouse.move(rz.x + 48, rz.y + 8, { steps: 5 }); await P.mouse.up();
    check(near(+(await P.inputValue('#f-ciw')), 400, 2) && +(await P.inputValue('#f-cih')) === 450, 'its corner resizes it (' + await P.inputValue('#f-ciw') + '×' + await P.inputValue('#f-cih') + ')');
    // The box of the strip: rounded like every module, and a background of its own (with room around the images)
    const boxOf = () => P.evaluate(() => { const el = document.querySelector('#stage .row.is-editing .slot-carousel'), cs = getComputedStyle(el), sc = el.querySelector('.car-strip'); sc.scrollLeft = 0; const a = el.getBoundingClientRect(), b = sc.querySelector('.cs-item').getBoundingClientRect(); return { r: cs.borderTopLeftRadius, clip: cs.overflowX, bg: cs.backgroundColor, pad: Math.round(b.left - a.left), ink: el.dataset.ink || '' }; });
    let box = await boxOf();
    check(box.r === '20px' && box.clip === 'clip', 'the strip has the rounded corners of the other modules (' + box.r + ', ' + box.clip + ')');
    check(await P.evaluate(() => /Fondo/.test(document.querySelector('#insp').textContent) && !!document.querySelector('#insp [data-k="bgpal"]')), 'its container offers a background, like the others');
    await P.click('#insp [data-action="seg"][data-k="bgpal"][data-v="pc_negro"]'); await P.waitForTimeout(200);
    box = await boxOf();
    check(box.bg === 'rgb(10, 10, 10)' && box.pad >= 20 && box.ink === 'light', 'a palette background fills it, with room around the images and captions in the ink that reads on it (' + JSON.stringify(box) + ')');
    await fill(P, 'pl', 64);
    check((await boxOf()).pad === 64, 'its inner spacing can be set');
    await P.click('#insp [data-action="seg"][data-k="bg"][data-v="surface"]'); await P.waitForTimeout(150);
    check((await boxOf()).bg === 'rgb(242, 243, 246)', 'or the gray of the theme');
    await P.screenshot({ path: T + 'v7-strip-edit.png' });
    await confirm(P);
    const strip = P.locator('#s-s_direccion .carousel.is-strip').last();
    await strip.scrollIntoViewIfNeeded(); await scrollIdle(P); await P.waitForTimeout(300);
    f1 = await P.evaluate(() => { const c = [...document.querySelectorAll('#s-s_direccion .carousel.is-strip')].pop(), f = c.querySelectorAll('.cs-item')[1], r = f.querySelector('.cs-frame').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), (f.querySelector('.cs-cap') || {}).textContent, c.querySelectorAll('.cs-item').length]; });
    check(f1[0] === 400 && f1[1] === 450 && f1[2] === 'Tarjetas emitidas por belo.' && f1[3] === 3, 'the page shows the strip as edited: ' + f1.join(' · '));
    check(await P.evaluate(() => { const el = [...document.querySelectorAll('#s-s_direccion .slot-carousel.is-strip')].pop(), cs = getComputedStyle(el); return cs.borderTopLeftRadius === '20px' && cs.backgroundColor === 'rgb(242, 243, 246)'; }), 'and keeps its rounded, gray box');
    const sb = await strip.locator('.car-strip').boundingBox();
    await P.mouse.move(sb.x + sb.width - 80, sb.y + 120); await P.mouse.down();
    await P.mouse.move(sb.x + 200, sb.y + 120, { steps: 8 }); await P.mouse.up(); await P.waitForTimeout(900);
    check(await P.evaluate(() => [...document.querySelectorAll('#s-s_direccion .car-strip')].pop().scrollLeft) > 100, 'a mouse drags the strip sideways');
    await P.screenshot({ path: T + 'v7-strip-view.png' });
  }

  /* ---------- 8. Inspector: Fondo / Texto encima are centered in their tabs ---------- */
  {
    await P.click('.rail-cat'); await P.click('#pop [data-action="cat-go"][data-id="c_ourbrand"]'); await P.waitForTimeout(500);
    await editRow(P, 'r_sp');
    const tabs = await P.evaluate(() => [...document.querySelectorAll('#insp .insp-tabs button')].map(b => { const r = b.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(b); const t = rg.getBoundingClientRect(); return Math.round(Math.abs((t.left + t.right) / 2 - (r.left + r.right) / 2)); }));
    check(tabs.length === 2 && tabs.every(d => d <= 1), '"Fondo" and "Texto encima" are centered in their tabs (off by ' + tabs.join(', ') + ' px)');
    await P.click('#insp [data-action="cancel-edit"]'); await P.waitForTimeout(400);
  }

  /* ---------- 8b. The page scrollbar is only its indicator; the action chip follows the mouse ---------- */
  {
    const sb = () => P.evaluate(() => { const s = document.querySelector('#sbar'), r = s.querySelector('i').getBoundingClientRect(); return { on: !s.hidden && getComputedStyle(s).display !== 'none', gutter: innerWidth - document.documentElement.clientWidth, top: Math.round(r.top), h: Math.round(r.height), right: Math.round(innerWidth - r.right), y: Math.round(scrollY) }; });
    await P.evaluate(() => window.scrollTo(0, 0)); await P.waitForTimeout(300);
    const a = await sb();
    check(a.on && a.gutter === 0 && a.top <= 8 && a.right <= 4, 'the page shows no scrollbar track, only its indicator at the right edge (' + JSON.stringify(a) + ')');
    await P.mouse.move(760, 450); await P.mouse.wheel(0, 900); await P.waitForTimeout(400); await scrollIdle(P);
    const b = await sb();
    check(b.y > 300 && b.top > a.top + 20, 'the indicator moves down with the page (' + b.top + ' px at ' + b.y + ')');
    await P.mouse.move(1512 - 4, b.top + b.h / 2); await P.mouse.down();
    await P.mouse.move(1512 - 4, b.top + b.h / 2 + 120, { steps: 6 }); await P.mouse.up(); await P.waitForTimeout(300);
    check((await sb()).y > b.y + 200, 'dragging it scrolls the page');

    await P.click('.rail-cat'); await P.click('#pop [data-action="cat-go"][data-id="c_visual"]'); await P.waitForTimeout(500);
    const sec = '#s-s_direccion';
    await P.locator(`${sec} [data-action="adder-open"]`).scrollIntoViewIfNeeded(); await scrollIdle(P);
    await P.click(`${sec} [data-action="adder-open"]`);
    await P.click(`${sec} [data-action="adder-layout"][data-layout="full"]`);
    await P.click('.row.is-editing [data-action="pick-type"][data-type="color"]');
    await P.click('#insp [data-action="insp-view"][data-v="act"]');
    await P.click('#insp [data-action="seg"][data-k="act"][data-v="copy"]');
    await confirm(P);
    const sel = `${sec} .slot-color[data-act]`, slot = P.locator(sel).last();
    await slot.scrollIntoViewIfNeeded(); await scrollIdle(P);
    const sbx = await slot.boundingBox();
    const chip = () => P.evaluate((q) => { const s = [...document.querySelectorAll(q)].pop(), c = s.querySelector('.act-chip'), r = c.getBoundingClientRect(), o = s.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(o.right - r.right), b: Math.round(o.bottom - r.bottom), op: +getComputedStyle(c).opacity, inside: r.left >= o.left - .5 && r.right <= o.right + .5 && r.top >= o.top - .5 && r.bottom <= o.bottom + .5 }; }, sel);
    const top = Math.max(sbx.y, 0) + 80, p1 = [Math.round(sbx.x + 120), Math.round(top)], p2 = [Math.round(sbx.x + 460), Math.round(top + 140)];
    await P.mouse.move(p1[0], p1[1], { steps: 4 }); await P.waitForTimeout(500);
    const c1 = await chip();
    check(c1.op > .9 && near(c1.x, p1[0] + 16) && near(c1.y, p1[1] + 16), 'the action chip shows next to the cursor (' + JSON.stringify(c1) + ' for ' + p1 + ')');
    await P.mouse.move(p2[0], p2[1], { steps: 8 }); await P.waitForTimeout(700);
    const c2 = await chip();
    check(near(c2.x, p2[0] + 16) && near(c2.y, p2[1] + 16), 'and follows it over the module (' + c2.x + ', ' + c2.y + ')');
    const p3 = [Math.round(sbx.x + sbx.width - 12), Math.round(top + 200)];
    await P.mouse.move(p3[0], p3[1], { steps: 6 }); await P.waitForTimeout(700);
    const c3 = await chip();
    check(c3.inside && c3.x < p3[0], 'at the far edge it moves to the other side of the cursor and stays inside the module (' + JSON.stringify(c3) + ')');
    await P.screenshot({ path: T + 'v7-chip-follow.png' });
    await P.mouse.move(Math.round(sbx.x / 2), 450); await P.waitForTimeout(300); /* off the module, over the rail */
    await P.keyboard.press('Tab'); await slot.focus(); await P.waitForTimeout(400);
    const c4 = await chip();
    check(c4.op > .9 && near(c4.r, 14) && near(c4.b, 14), 'from the keyboard it shows in its corner (' + JSON.stringify(c4) + ')');
  }
  check(!P.errors.length, 'no page errors on the local demo' + (P.errors.length ? ': ' + P.errors.join(' | ') : ''));

  /* ---------- 9. Shared catalog: locked pages are for editors only; the new settings are stored ---------- */
  {
    const fake = new FakeSupabase(SUPA_URL);
    const ana = fake.addUser({ email: 'ana@paisanoscreando.com', name: 'Ana Gómez' });
    const text = (id, t) => ({ id, layout: 'full', h: null, slots: [{ id: 'm_' + id, type: 'text', bg: { kind: 'none' }, align: 'start', ink: 'auto', blocks: [{ id: 'b_' + id, text: t, font: 'jakarta', size: 40, weight: 600, lh: 110, ls: -1, align: 'left', upper: false }] }] });
    fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [{ id: 'c_brand', name: 'Our Brand', subs: [{ id: 's_intro', name: 'Intro' }] }, { id: 'c_logo', name: 'Logotype', locked: true, subs: [{ id: 's_logo', name: 'Logo' }] }] }, ana.id);
    fake.seed('pages/s_intro', { rows: [text('r_a', 'Hola Belo')] });
    fake.seed('pages/s_logo', { rows: [text('r_l', 'Secreto en preparación')] });
    const open = async (label, user, hash = '') => {
      const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1 });
      await fake.attach(ctx, label); await routes(ctx);
      await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js/, r => r.fulfill({ path: SB_JS, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
      if (user) await fake.signInContext(ctx, user);
      const page = await ctx.newPage(); watchErrors(page, label);
      await page.goto(SUPA_BASE + hash);
      await page.waitForSelector('.rail-cat');
      await page.waitForTimeout(700);
      return page;
    };
    const V = await open('viewer', null, '#s_logo');
    check(await railTitle(V) === 'Our Brand', 'a link to a locked section opens the first open category for a visitor');
    const leak = await V.evaluate(async (u) => { const r = await fetch(u + '/rest/v1/docs?select=data&path=eq.pages%2Fs_logo', { headers: { apikey: 'sb_publishable_test' } }); return (await r.json()).length; }, SUPA_URL);
    check(leak === 0, 'the database does not hand a locked page to a visitor');
    await openMenu(V);
    check(await V.getAttribute('.ov-cat[data-id="c_logo"]', 'aria-disabled') === 'true' && await V.locator('.ov-cat[data-id="c_logo"] .ov-lock').count() === 1, 'the visitor sees it locked in the menu');
    await V.screenshot({ path: T + 'v7-sb-menu-locked.png' });
    await closeMenu(V);
    const A = await open('ana', ana, '#s_logo');
    check(await railTitle(A) === 'Logotype' && await until(() => A.evaluate(() => /Secreto/.test((document.querySelector('#s-s_logo .row') || {}).textContent || ''))), 'an editor opens it and reads its content');
    // Ana unlocks it: the visitor can now go in and read it
    await openMenu(A);
    await A.click('.ov-item:has([data-id="c_logo"]) [data-action="item-menu"]');
    await A.click('#pop [data-action="pop-lock"]');
    await closeMenu(A);
    check(await until(() => !fake.docs.get('catalog/tree').data.categories[1].locked), 'unlocking is saved');
    const unlocked = await until(async () => { await V.click('.rail-cat'); await V.waitForTimeout(150); const ok = await V.evaluate(() => { const b = document.querySelector('#pop [data-action="cat-go"][data-id="c_logo"]'); return !!b && !b.disabled; }); await V.keyboard.press('Escape'); return ok; });
    check(unlocked, 'the visitor sees it unlocked live');
    await V.evaluate(() => { location.hash = '#s_logo'; });
    await V.waitForTimeout(800);
    check(await until(() => V.evaluate(() => /Secreto/.test((document.querySelector('#s-s_logo .row') || {}).textContent || ''))), 'and now reads it');
    // Ana locks the category the visitor is reading: the visitor is taken out of it
    await openMenu(A);
    await A.click('.ov-item:has([data-id="c_logo"]) [data-action="item-menu"]');
    await A.click('#pop [data-action="pop-lock"]');
    await closeMenu(A);
    check(await until(() => V.evaluate(() => document.querySelector('.rail-title').textContent === 'Our Brand')), 'a visitor inside a category that gets locked is taken out of it');
    check(/en preparación/.test(await toasts(V)), 'and told why');
    // Stored: a divider, a group, a container, a stroke and a width
    await A.click('.rail-cat'); await A.click('#pop [data-action="cat-go"][data-id="c_brand"]'); await A.waitForTimeout(500);
    await editRow(A, 'r_a');
    await A.click('#stage .row.is-editing .tb[data-block="b_r_a"]');
    await A.click('#insp [data-action="add-div"]'); await A.waitForTimeout(200);
    await A.click('#insp .layers [data-id="b_r_a"]');
    await A.click('#insp [data-action="group"]'); await A.waitForTimeout(200);
    await seg(A, 'gdir', 'h');
    await fill(A, 'mstw', 1.5); await fill(A, 'rw', 75);
    await confirm(A);
    const stored = await until(() => { const r = fake.docs.get('pages/s_intro').data.rows[0], s = r.slots[0]; return r.w === 75 && s.stroke && s.stroke.w === 1.5 && s.blocks.some(b => b.kind === 'div') && s.groups && Object.values(s.groups)[0].dir === 'h' && s.blocks[0].g; });
    check(stored, 'the divider, the group, the stroke and the width are saved with the block');
    check(!V.errors.length && !A.errors.length, 'no page errors on the shared catalog' + ([...V.errors, ...A.errors].length ? ': ' + [...V.errors, ...A.errors].join(' | ') : ''));
  }

  /* ---------- 10. Loading: early and grouped reads, lazy media, optimized copies (and the originals if they fail) ---------- */
  {
    const fake = new FakeSupabase(SUPA_URL);
    const img = (id, file) => { fake.files.set(id + '.jpg', { body: fs.readFileSync(FIX + file), type: 'image/jpeg' }); return { id: 'r_' + id, layout: 'full', h: null, slots: [{ id: 'm_' + id, type: 'image', asset: id + '.jpg', w: 1600, h: 1000 }] }; };
    const text = (id, t) => ({ id, layout: 'full', h: null, slots: [{ id: 'm_' + id, type: 'text', bg: { kind: 'none' }, align: 'start', ink: 'auto', blocks: [{ id: 'b_' + id, text: t, font: 'jakarta', size: 40, weight: 600, lh: 110, ls: -1, align: 'left', upper: false }] }] });
    fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [
      { id: 'c_media', name: 'Fotografía', subs: [{ id: 's_m1', name: 'Estilo' }, { id: 's_m2', name: 'Retrato' }, { id: 's_m3', name: 'Producto' }] },
      { id: 'c_other', name: 'Recursos', subs: [{ id: 's_o', name: 'Descargas' }] }] });
    fake.seed('pages/s_m1', { rows: [img('p1', 'img1.jpg'), img('p2', 'img2.jpg'), img('p3', 'img3.jpg'), img('p4', 'img4.jpg'), img('p5', 'img1.jpg')] });
    fake.seed('pages/s_m2', { rows: [text('r_m2', 'Retrato')] });
    fake.seed('pages/s_m3', { rows: [text('r_m3', 'Producto')] });
    fake.seed('pages/s_o', { rows: [text('r_o', 'Descargas de marca')] });
    const opened = async (label, optimizer) => {
      const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1 });
      await fake.attach(ctx, label); await routes(ctx);
      await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js/, r => r.fulfill({ path: SB_JS, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
      await ctx.addInitScript(() => { try { localStorage.setItem('bc.opt', '1'); } catch {} });
      const asked = [];
      /* Vercel's optimizer, stood in for: it answers with the original's bytes (or fails, to test the way back) */
      await ctx.route(/\/_vercel\/image\?/, r => {
        const q = new URL(r.request().url()).searchParams, f = fake.files.get(decodeURIComponent(new URL(q.get('url')).pathname.split('/').pop()));
        asked.push(+q.get('w'));
        return optimizer && f ? r.fulfill({ status: 200, contentType: 'image/webp', body: f.body }) : r.fulfill({ status: 404, body: 'not found' });
      });
      const page = await ctx.newPage(); watchErrors(page, label);
      return { page, ctx, asked };
    };
    fake.readLog = [];
    const { page: L, ctx: lctx, asked } = await opened('loader', true);
    await L.goto(SUPA_BASE + '#s_m1');
    await L.waitForSelector('#s-s_m1 .row'); await L.waitForTimeout(900);
    check(fake.readLog.some(w => ['pages/s_m1', 'pages/s_m2', 'pages/s_m3'].every(p => w.includes(p))), 'the three sections of the category come in one request (' + fake.readLog.map(w => w.length).join(', ') + ' documents per read)');
    const imgs = await L.evaluate(() => [...document.querySelectorAll('#s-s_m1 .media img')].map(i => { const r = i.getBoundingClientRect(); return { src: i.getAttribute('src') || '', lazy: !!i.dataset.lazy, top: Math.round(r.top), w: Math.round(r.width), done: i.classList.contains('is-loaded') }; }));
    const first = imgs[0], far = imgs.filter(i => i.top > 900 * 2.2);
    check(/\/_vercel\/image\?url=.+&w=1280&q=80$/.test(first.src) && first.done, 'an image on screen loads an optimized copy at its drawn width (' + first.w + ' px → w=1280)');
    check(far.length >= 1 && far.every(i => i.lazy && !i.src), 'images further than a screen below are not asked for yet (' + far.length + ' waiting)');
    check(asked.every(w => [384, 640, 960, 1280, 1920, 2560].includes(w)), 'only the sizes set in vercel.json are asked for (' + [...new Set(asked)].join(', ') + ')');
    await L.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await L.waitForTimeout(1200);
    check(await L.evaluate(() => [...document.querySelectorAll('#s-s_m1 .media img')].every(i => !i.dataset.lazy && i.classList.contains('is-loaded'))), 'scrolling down loads them');
    // The other category was read in the background: it opens at once, without a placeholder
    check(await until(() => fake.readLog.some(w => w.includes('pages/s_o'))), 'the pages of the other categories are read in the background');
    await L.click('.rail-cat'); await L.click('#pop [data-action="cat-go"][data-id="c_other"]'); await L.waitForTimeout(120);
    check(await L.evaluate(() => !!document.querySelector('#s-s_o .row') && !document.querySelector('#s-s_o .skel')), 'so another category opens at once');
    // The next visit asks for the tree and the open category's pages before the page scripts run
    fake.readLog = [];
    await L.goto('about:blank'); await L.goto(SUPA_BASE + '#s_m1'); await L.waitForSelector('#s-s_m1 .row');
    check(fake.readLog[0] && ['catalog/tree', 'pages/s_m1', 'pages/s_m2', 'pages/s_m3'].every(p => fake.readLog[0].includes(p)), 'on the next visit the first request already brings the tree and the pages (' + (fake.readLog[0] || []).join(', ') + ')');
    await lctx.close();
    // Without the optimizer (another host, over quota): the originals load and nothing breaks
    const { page: F, ctx: fctx } = await opened('fallback', false);
    await F.goto(SUPA_BASE + '#s_m1'); await F.waitForSelector('#s-s_m1 .row'); await F.waitForTimeout(1200);
    const fb = await F.evaluate(() => [...document.querySelectorAll('#s-s_m1 .media img')].filter(i => i.getAttribute('src')).map(i => ({ src: i.getAttribute('src'), done: i.classList.contains('is-loaded'), broken: i.parentElement.classList.contains('is-broken') })));
    check(fb.length >= 1 && fb.every(i => /\/storage\/v1\/object\/public\/assets\//.test(i.src) && i.done && !i.broken), 'if the optimizer fails, the original files load instead (' + fb.length + ' images)');
    const errs = [...L.errors, ...F.errors.filter(e => !/status of 404/.test(e))]; /* the failed copies themselves are expected */
    check(!errs.length, 'no page errors while loading' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await fctx.close();
  }

  await browser.close();
  log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll layout checks passed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
