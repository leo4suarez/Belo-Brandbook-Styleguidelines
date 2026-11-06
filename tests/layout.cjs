// v7: the theme opens light, the rail title and its category list, locked categories (in the page and in the
// database), moving a subcategory, the items of a text module (containers, auto-layout groups, dividers), module
// strokes, the width of a block and the split of a half row, the carousel strip, and phones (three text styles, the
// sections dropdown, search in the menu), the section paths of the published site (/voice-tone/como-hablamos), the
// "Ver de nuevo" button of animation examples, the Manifiesto module (a card of sheets that opens into a reader) and the
// pillar titles on phones (60px, a round "+" on their right), the Open Graph image of shared links, and the password
// gate (the screen, a wrong and a right password, the 24 hours, editors, phones).
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
    // Spanish, never machine-translated (a browser "translating" it rewrote the texts the word animations then put back)
    check(await p.evaluate(() => { const h = document.documentElement, m = document.querySelector('meta[name="google"]'); return h.lang === 'es' && h.getAttribute('translate') === 'no' && h.classList.contains('notranslate') && !!m && m.content === 'notranslate'; }), 'the page says it is in Spanish and asks browsers not to translate it');
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

  /* ---------- 11. Phones: three text styles, text 8px in, the sections dropdown, search in the menu ---------- */
  {
    /* blocks like the real catalog's: big titles (one in light gray, one in Phudu), headings, bold labels, gray bold
       notes, text in gray and in ink; one module on a color */
    const fake = new FakeSupabase(SUPA_URL);
    const blk = (t, size, weight, extra = {}) => ({ id: 'b' + Math.random().toString(36).slice(2, 8), text: t, font: 'jakarta', size, weight, lh: 120, ls: -1, align: 'left', upper: false, ...extra });
    const mod = (id, blocks, bg = { kind: 'none' }) => ({ id: 'r_' + id, layout: 'full', h: null, slots: [{ id: 'm_' + id, type: 'text', bg, align: 'start', ink: 'auto', blocks }] });
    const para = 'Queremos que una moneda, una frontera o un sistema no decidan hasta dónde puede llegar una persona. El poder ya está ahí.';
    fake.files.set('hero.jpg', { body: fs.readFileSync(FIX + 'hero.jpg'), type: 'image/jpeg' });
    fake.files.set('clip.webm', { body: fs.readFileSync(FIX + 'clip.webm'), type: 'video/webm' });
    const hero = (k) => ({ id: 'r_' + k + 'h', layout: 'fullscreen', h: null, slots: [{ id: 'm_' + k + 'h', type: 'image', asset: 'hero.jpg', w: 1600, h: 1000 }],
      overlay: { pos: 'br', width: 'content', slot: { id: 't_' + k + 'h', type: 'text', bg: { kind: 'none' }, align: 'end', ink: 'auto', blocks: [blk('VOICE & TONE', 120, 900, { font: 'phudu', upper: true, align: 'right' })] } } });
    const video = (k) => ({ id: 'r_' + k + 'v', layout: 'full', h: null, slots: [{ id: 'm_' + k + 'v', type: 'video', asset: 'clip.webm', w: 640, h: 360 }] });
    const page = (k, name) => ({ rows: [
      ...(k === 'a' ? [hero(k)] : []),
      mod(k + '1', [blk(name, 72, 600), blk('Propósito', 68, 600, { color: 'pc_light' }), blk(para, 16, 500, { color: 'pc_gray' })]),
      mod(k + '2', [blk('Color en imagen', 32, 600), blk('Más natural, igual de intencional', 14, 600), blk(para, 14, 500)]),
      mod(k + '3', [blk('PODER', 200, 900, { font: 'phudu', upper: true }), blk('Pone primero lo que la persona puede hacer.', 13, 600, { color: 'pc_gray' }), blk('Personas', 24, 600, { color: 'pc_gray' })]),
      mod(k + '4', [blk('Entendemos la complejidad', 48, 600), blk(para, 16, 500)], { kind: 'color', color: '#002fa7' }),
      mod(k + '5', [blk(para + ' ' + para, 16, 500), blk(para, 16, 500, { box: { pl: 40, pr: 20 } }), blk(para, 16, 500)]),
      ...(k === 'a' ? [video(k)] : [])
    ] });
    fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } },
      palette: [{ id: 'pc_azul', hex: '#002fa7', name: 'Azul Belo' }, { id: 'pc_gray', hex: '#868686', name: 'Gray' }, { id: 'pc_light', hex: '#bfbfbf', name: 'Light text Gray' }],
      categories: [{ id: 'c_f', name: 'Foundations', subs: [{ id: 's_a', name: 'Dirección estratégica' }, { id: 's_b', name: 'Pilares creativos' }, { id: 's_c', name: 'Propósito, misión y visión' }] }] });
    fake.seed('pages/s_a', page('a', 'Dirección estratégica'));
    fake.seed('pages/s_b', page('b', 'Pilares creativos'));
    fake.seed('pages/s_c', page('c', 'Propósito, misión y visión'));
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await fake.attach(ctx, 'phone'); await routes(ctx);
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js/, r => r.fulfill({ path: SB_JS, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
    const M = await ctx.newPage(); watchErrors(M, 'phone');
    await M.goto(SUPA_BASE + '#s_a'); await M.waitForSelector('#s-s_c .tb'); await M.waitForTimeout(900);
    const styles = () => M.evaluate(() => [...document.querySelectorAll('#stage .tb[data-mr]')].map(t => {
      const cs = getComputedStyle(t), slot = t.closest('.slot-text');
      return { hero: !!t.closest('.fs-overlay'), mr: t.dataset.mr, font: t.dataset.font, gray: t.hasAttribute('data-gray'), fs: cs.fontSize, lh: cs.lineHeight, fw: cs.fontWeight, color: cs.color, ink: slot ? getComputedStyle(slot).color : null, x: Math.round(t.getBoundingClientRect().left), box: t.classList.contains('has-fill') || t.classList.contains('has-bst') };
    }));
    const ts = (await styles()).filter(t => !t.hero), by = (r) => ts.filter(t => t.mr === r);
    const roles = await M.evaluate(() => Object.fromEntries([...document.querySelectorAll('#s-s_a .tb[data-mr]')].map(t => [t.textContent.slice(0, 24), t.dataset.mr])));
    const want = { 'Dirección estratégica': 't', 'Propósito': 't', 'PODER': 't', 'Entendemos la complejida': 't', 'Color en imagen': 't', 'Personas': 's', 'Más natural, igual de in': 's', 'Pone primero lo que la p': 'b', 'Queremos que una moneda,': 'b' };
    check(Object.entries(want).every(([k, v]) => roles[k] === v), 'each block takes its style by use: 28px and up as titles, smaller headings and bold labels as subtitles, gray notes and paragraphs as text ' + JSON.stringify(roles));
    check(ts.every(t => t.fs === (t.font === 'phudu' ? '40px' : { t: '22px', s: '14px', b: '14px' }[t.mr])), 'on a phone: titles 22px (40px in Phudu), subtitles and text 14px (' + [...new Set(ts.map(t => t.mr + ' ' + t.font + ' ' + t.fs))].join(', ') + ')');
    check(ts.every(t => Math.abs(parseFloat(t.lh) / parseFloat(t.fs) - (t.mr === 't' ? 1.1 : 1.2)) < .01), 'titles have their lines 110% apart, subtitles and text 120% (' + [...new Set(ts.map(t => t.mr + ' ' + t.lh))].join(', ') + ')');
    // The hero: no list of sections over it, its Phudu title big, on the left and white; videos without their buttons
    const hv = await M.evaluate(() => { const t = document.querySelector('#s-s_a .fs-overlay .tb'), r = t.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(t); const g = rg.getClientRects()[0]; return { fs: getComputedStyle(t).fontSize, x: Math.round(g.left), color: getComputedStyle(t).color, nav: !!document.querySelector('#rail-nav').getClientRects().length, ctrls: [...document.querySelectorAll('#stage .media-ctrls')].map(c => !!c.getClientRects().length) }; });
    check(!hv.nav, 'no list of sections on a phone');
    check(hv.fs === '64px' && hv.x === 30 && hv.color === 'rgb(255, 255, 255)', `the hero title: 64px, from the left (${hv.x}px), white (${hv.fs}, ${hv.color})`);
    check(hv.ctrls.length > 0 && hv.ctrls.every(v => !v), `videos show no pause or sound buttons (${hv.ctrls.length} video)`);
    check(by('t').every(t => t.font === 'phudu' || t.fw === '600') && by('s').every(t => t.fw === '600') && by('b').every(t => t.fw === '500'), 'titles and subtitles semibold, text medium');
    check(by('s').length >= 2 && by('s').every(t => t.color === t.ink), 'subtitles in the full ink of their module, never gray (a gray heading too)');
    check(by('b').some(t => t.gray && t.color === 'rgb(134, 134, 134)'), 'gray text stays gray');
    const pads = await M.evaluate(() => [...document.querySelectorAll('#stage .slot-text .tpad')].map(p => getComputedStyle(p).paddingLeft));
    check(pads.length && pads.every(v => v === '14px'), `every text module has 14px of inner space on the left (${pads.length} modules)`);
    const xs = [...new Set(ts.filter(t => !t.box).map(t => t.x))];
    check(xs.length === 1 && xs[0] === 30, `every text starts 30px in from the screen, its own box padding too (${xs.join(', ')})`);
    // The same blocks keep their own size on a wide screen
    await M.setViewportSize({ width: 1512, height: 900 }); await M.waitForTimeout(500);
    const wide = await styles();
    check(wide.some(t => t.mr === 't' && parseFloat(t.fs) > 20), 'on a wide screen the titles keep their own size');
    await M.setViewportSize({ width: 390, height: 844 }); await M.waitForTimeout(500);
    // Top right: the sections dropdown next to the menu; no search button there
    const bar = () => M.evaluate(() => { const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, h: b.height, on: !!e.getClientRects().length, text: e.textContent.trim() }; }; return { secs: r('#btn-secs'), menu: r('#btn-menu'), search: r('#btn-search') }; });
    let b = await bar();
    check(b.secs.on && !b.search.on && b.secs.r <= b.menu.l - 6 && near(b.secs.t, b.menu.t, 1) && b.secs.h === 44, `the dropdown sits left of the menu, no search button (${Math.round(b.secs.l)}–${Math.round(b.secs.r)}, menu at ${Math.round(b.menu.l)})`);
    const fills = await M.evaluate(() => ['#btn-secs', '#btn-menu'].map(s => { const cs = getComputedStyle(document.querySelector(s)); return cs.backgroundColor + ' ' + (cs.backdropFilter || cs.webkitBackdropFilter || 'none'); }));
    check(fills.every(f => f === 'rgb(255, 255, 255) none'), 'the dropdown and the menu are solid white, no blur (' + fills.join(' | ') + ')');
    check(b.secs.text === 'Dirección estratégica', 'it shows the section in view (' + b.secs.text + ')');
    const pad = await M.evaluate(() => { const s = document.querySelector('#s-s_a .row[data-id="r_a4"] .slot-text'), t = s.querySelector('.tb'); return Math.round(t.getBoundingClientRect().left - s.getBoundingClientRect().left); });
    check(pad === 14, `on a colored module too the text starts 14px in (${pad}px)`);
    // Scrolling to another section: it stays where it is and changes its name
    await M.evaluate(() => window.scrollTo(0, document.getElementById('s-s_c').getBoundingClientRect().top + scrollY - 120)); await M.waitForTimeout(900);
    const b2 = await bar();
    check(b2.secs.on && near(b2.secs.t, b.secs.t, .5), 'scrolling, the dropdown stays in the corner');
    check(b2.secs.text === 'Propósito, misión y visión', 'and reaching a section it takes its name (' + b2.secs.text + ')');
    await M.screenshot({ path: T + 'v7-phone-section.png' });
    // Picking a section from the list goes there
    await M.tap('#btn-secs'); await M.waitForTimeout(300);
    const items = await M.evaluate(() => [...document.querySelectorAll('#pop .mi[data-action="sec-go"]')].map(m => ({ id: m.dataset.id, on: m.getAttribute('aria-checked') === 'true' })));
    check(items.length === 3 && (items.find(i => i.on) || {}).id === 's_c', `the list has every section of the category, the current one checked (${items.length})`);
    await M.tap('#pop .mi[data-id="s_b"]'); await M.waitForTimeout(1800);
    b = await bar();
    const top = await M.evaluate(() => Math.round(document.getElementById('s-s_b').getBoundingClientRect().top));
    check(b.secs.text === 'Pilares creativos' && top >= 0 && top < 200 && await M.evaluate(() => location.hash) === '#s_b', `picking one scrolls to it (top at ${top}px) and the dropdown follows`);
    // Search lives in the open menu
    await M.tap('#btn-menu'); await M.waitForTimeout(900);
    check(await M.evaluate(() => !!document.querySelector('#menu-search').getClientRects().length), 'the open menu has the search button');
    await M.tap('#menu-search'); await M.waitForTimeout(600);
    check(await M.evaluate(() => document.querySelector('#search').classList.contains('is-open') && document.activeElement.id === 'search-input' && !document.querySelector('#menu').classList.contains('is-open')), 'it opens the search, ready to type');
    await M.keyboard.press('Escape'); await M.waitForTimeout(500);
    // Home has no sections: no dropdown
    await M.tap('#rail-logo'); await M.waitForTimeout(1200);
    b = await bar();
    check(!b.secs.on && !b.search.on && b.menu.on, 'on Home only the menu is there');
    await M.screenshot({ path: T + 'v7-phone-home.png' });
    check(!M.errors.length, 'no page errors on the phone' + (M.errors.length ? ': ' + M.errors.join(' | ') : ''));
    await ctx.close();
    // A wide screen keeps its search button and has no dropdown
    const D = await localPage('#s_direccion');
    check(await D.evaluate(() => !!document.querySelector('#btn-search').getClientRects().length && !document.querySelector('#btn-secs').getClientRects().length && !document.querySelector('#menu-search').getClientRects().length), 'a wide screen keeps the search button in the top bar and no dropdown');
    await D.context().close();
  }

  /* ---------- 12. Section links: /voice-tone, /voice-tone/como-hablamos (the published site); old #s_… links ---------- */
  {
    const fake = new FakeSupabase(SUPA_URL);
    const tall = (id, t) => ({ id, layout: 'full', h: null, slots: [{ id: 'm_' + id, type: 'text', bg: { kind: 'none' }, align: 'start', ink: 'auto', blocks: [{ id: 'b_' + id, text: t + '\n' + 'Texto de la sección. '.repeat(60), font: 'jakarta', size: 40, weight: 600, lh: 110, ls: -1, align: 'left', upper: false }] }] });
    fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [
      { id: 'c_f', name: 'Foundations', subs: [{ id: 's_f1', name: 'Dirección estratégica' }, { id: 's_f2', name: 'Propósito, misión y visión' }] },
      { id: 'c_v', name: 'Voice & Tone', subs: [{ id: 's_v1', name: 'Introducción' }, { id: 's_v2', name: 'Cómo hablamos' }, { id: 's_v3', name: 'Voz de marca' }] }] });
    ['s_f1', 's_f2', 's_v1', 's_v2', 's_v3'].forEach((id, i) => fake.seed('pages/' + id, { rows: [tall('r_' + id + 'a', 'Sección ' + (i + 1)), tall('r_' + id + 'b', 'Más')] }));
    const site = new URL(SUPA_BASE).origin; /* served at the root, like Vercel: every section path is the page */
    const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1 });
    await fake.attach(ctx, 'routes'); await routes(ctx);
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js/, r => r.fulfill({ path: SB_JS, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
    const R = await ctx.newPage(); watchErrors(R, 'routes');
    const where = () => R.evaluate(() => ({ path: location.pathname, hash: location.hash, view: document.documentElement.dataset.view, active: (document.querySelector('#rail-nav .sub.is-active') || {}).textContent || '' }));
    const go = async (path) => { await R.goto(site + path); await R.waitForTimeout(1600); return where(); };
    let w = await go('/');
    check(w.view === 'home' && w.path === '/', 'the root opens Home (' + JSON.stringify(w) + ')');
    w = await go('/voice-tone');
    check(w.view === 'cat' && w.path === '/voice-tone' && w.active === 'Introducción', '/voice-tone opens the category on its first section (' + JSON.stringify(w) + ')');
    w = await go('/voice-tone/como-hablamos');
    const top = await R.evaluate(() => Math.round(document.getElementById('s-s_v2').getBoundingClientRect().top));
    check(w.active === 'Cómo hablamos' && w.path === '/voice-tone/como-hablamos' && top > -40 && top < 120, `/voice-tone/como-hablamos opens that section, scrolled to it (${top}px from the top)`);
    await R.evaluate(() => window.scrollTo(0, document.getElementById('s-s_v3').getBoundingClientRect().top + scrollY - 40)); await R.waitForTimeout(900);
    w = await where();
    check(w.path === '/voice-tone/voz-de-marca' && !w.hash, 'scrolling to the next section, the address follows it (' + w.path + ')');
    await R.click('#rail-nav .sub[data-id="s_v1"]'); await R.waitForTimeout(1600);
    check((await where()).path === '/voice-tone', 'picking the first section in the rail: the category path again');
    w = await go('/#s_f2');
    check(w.active === 'Propósito, misión y visión' && w.path === '/foundations/proposito-mision-y-vision' && !w.hash, 'an old #s_… link opens its section and the address becomes its path (' + w.path + ')');
    await R.click('#rail-logo'); await R.waitForTimeout(900);
    check((await where()).path === '/' && (await where()).view === 'home', 'the logo goes Home at /');
    await R.goBack(); await R.waitForTimeout(1200);
    w = await where();
    check(w.view === 'cat' && w.path === '/foundations/proposito-mision-y-vision' && w.active === 'Propósito, misión y visión', 'the browser back button returns to the section (' + w.path + ')');
    w = await go('/voice-tone/una-seccion-renombrada');
    check(w.view === 'cat' && w.active === 'Introducción' && w.path === '/voice-tone', 'a path that no longer matches opens its category (' + w.path + ')');
    /* the next visit reads that category's pages before the page scripts run (bc.nav keeps the names of the paths) */
    fake.readLog = [];
    await R.goto('about:blank'); await R.goto(site + '/voice-tone/voz-de-marca'); await R.waitForSelector('#s-s_v3 .row'); await R.waitForTimeout(600);
    check(fake.readLog[0] && ['catalog/tree', 'pages/s_v1', 'pages/s_v2', 'pages/s_v3'].every(p => fake.readLog[0].includes(p)), 'on the next visit, a section path brings its category in the first request (' + (fake.readLog[0] || []).join(', ') + ')');
    check((await where()).active === 'Voz de marca', 'and opens on that section');
    check(!R.errors.length, 'no page errors with section paths' + (R.errors.length ? ': ' + R.errors.join(' | ') : ''));
    await ctx.close();
  }

  /* ---------- 13. Animation examples: "Ver de nuevo" plays a module's animation again ---------- */
  {
    const fake = new FakeSupabase(SUPA_URL);
    const word = { enter: 'split-fade', by: 'words', dur: .3, stagger: .06, order: 'start', delay: 0, dir: 'bottom', dist: 56, ease: 'power1.out', scroll: 'none' };
    const card = (id, t) => ({ id: 'm_' + id, type: 'text', bg: { kind: 'color', color: '#ffffff' }, stroke: { c: '#e3e3e3', w: 1 }, align: 'start', ink: 'auto', pad: { t: 32, r: 32, b: 32, l: 32 },
      blocks: [{ id: 'b_' + id, text: t, font: 'jakarta', size: 48, weight: 600, lh: 95, ls: -4, align: 'left', upper: false, anim: word }] });
    fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [{ id: 'c_t', name: 'Typography', subs: [{ id: 's_m', name: 'Motion' }] }] });
    fake.seed('pages/s_m', { rows: [
      { id: 'r_head', layout: 'full', h: null, slots: [{ id: 'm_head', type: 'text', bg: { kind: 'none' }, align: 'start', ink: 'auto', blocks: [{ id: 'b_head', text: 'Apariciones', font: 'jakarta', size: 48, weight: 600, lh: 110, ls: -2, align: 'left', upper: false, anim: word }] }] },
      { id: 'r_ex', layout: 'half', h: 350, anim: { stagger: .15, tstagger: .12, replay: true }, slots: [card('x1', 'Una billetera para todas tus monedas'), card('x2', 'Hacé más con lo tuyo')] }
    ] });
    const opened = async (label, opts = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1, ...opts });
      await fake.attach(ctx, label); await routes(ctx);
      await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js/, r => r.fulfill({ path: SB_JS, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
      const page = await ctx.newPage(); watchErrors(page, label);
      await page.goto(SUPA_BASE + '#s_m'); await page.waitForSelector('#s-s_m .row[data-id="r_ex"]'); await page.waitForTimeout(2500);
      return { page, ctx };
    };
    const split = (p, id) => p.evaluate((id) => { const t = document.querySelector(`.tb[data-block="${id}"]`); const w = [...t.querySelectorAll('.sw')]; return { words: w.length, hidden: w.filter(x => +getComputedStyle(x).opacity < .99).length, text: t.textContent, opacity: +getComputedStyle(t).opacity }; }, id);
    const { page: V, ctx: vctx } = await opened('replay');
    const btns = await V.evaluate(() => [...document.querySelectorAll('.replay')].map(b => ({ slot: b.closest('.slot').dataset.slot, label: b.getAttribute('aria-label'), w: Math.round(b.getBoundingClientRect().width) })));
    check(btns.length === 2 && btns.every(b => b.label === 'Ver la animación de nuevo' && b.w === 36) && btns.map(b => b.slot).join() === 'm_x1,m_x2', 'a block marked "Ver de nuevo" shows a reload button on each animated module, and only there (' + btns.map(b => b.slot).join(', ') + ')');
    const spot = await V.evaluate(() => { const b = document.querySelector('.slot[data-slot="m_x1"] .replay'), r = b.getBoundingClientRect(), s = b.closest('.slot').getBoundingClientRect(); return { right: Math.round(s.right - r.right), bottom: Math.round(s.bottom - r.bottom), bg: getComputedStyle(b).backgroundColor }; });
    check(spot.right === 12 && spot.bottom === 12 && spot.bg === 'rgb(255, 255, 255)', 'it is white and sits in the bottom right corner of the module (' + spot.right + ', ' + spot.bottom + ', ' + spot.bg + ')');
    const rest = await split(V, 'b_x1');
    check(rest.words === 0 && rest.opacity === 1, 'once its animation has played, the text is whole');
    await V.click('.slot[data-slot="m_x1"] .replay'); await V.waitForTimeout(120);
    const mid = await split(V, 'b_x1'), other = await split(V, 'b_x2');
    check(mid.words === 6 && mid.hidden > 0 && other.words === 0, `the button plays that module's animation again, word by word (${mid.hidden} of ${mid.words} words still to come; the other module stays still)`);
    await V.waitForTimeout(1600);
    const after = await split(V, 'b_x1');
    check(after.words === 0 && after.text === 'Una billetera para todas tus monedas' && after.opacity === 1, 'and leaves the text whole again');
    await V.click('.slot[data-slot="m_x1"] .replay'); await V.waitForTimeout(60); await V.click('.slot[data-slot="m_x1"] .replay'); await V.waitForTimeout(1600);
    check((await split(V, 'b_x1')).words === 0 && (await split(V, 'b_x1')).text === 'Una billetera para todas tus monedas', 'pressed twice in a row, it starts over and still ends whole');
    check(!V.errors.length, 'no page errors replaying' + (V.errors.length ? ': ' + V.errors.join(' | ') : ''));
    await vctx.close();
    // On a phone nothing animates by itself, but the button still plays the example
    const { page: M, ctx: mctx } = await opened('replay-phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await M.locator('.slot[data-slot="m_x2"]').scrollIntoViewIfNeeded(); await M.waitForTimeout(800);
    check((await split(M, 'b_x2')).words === 0 && await M.locator('.slot[data-slot="m_x2"] .replay').isVisible(), 'on a phone the example sits still, with its button');
    await M.tap('.slot[data-slot="m_x2"] .replay'); await M.waitForTimeout(120);
    check((await split(M, 'b_x2')).hidden > 0, 'and a tap plays its animation');
    await mctx.close();
    // Reduced motion: no animations, so no button
    const { page: R, ctx: rctx } = await opened('replay-rm', { reducedMotion: 'reduce' });
    check(await R.locator('.replay').count() === 0, 'with reduced motion there is no reload button');
    await rctx.close();
    // The switch: Animación → Ver de nuevo, on a block of the local demo
    const E = await localPage('#s_direccion');
    check(await E.locator('.row[data-id="r_t"] .replay').count() === 0, 'a block starts without the button');
    await editRow(E, 'r_t');
    await E.click('#insp [data-action="insp-view"][data-v="anim"]'); await E.waitForTimeout(200);
    check(await E.locator('#insp [data-action="seg"][data-k="rrep"][data-v="off"][aria-pressed="true"]').count() === 1, 'the Animación view has "Ver de nuevo", off');
    await E.click('#insp [data-action="seg"][data-k="rrep"][data-v="on"]'); await E.waitForTimeout(150);
    await confirm(E);
    check(await E.locator('.row[data-id="r_t"] .replay').count() >= 1, 'turned on and confirmed, the block shows its reload button');
    await E.context().close();
  }

  /* ---------- 14. Manifiesto: a card of sheets that opens into a reader ---------- */
  {
    const fake = new FakeSupabase(SUPA_URL);
    const filler = '\n\n' + Array(8).fill('Un párrafo de prueba, lo bastante largo para ocupar varias líneas de la hoja en un teléfono.').join('\n\n');
    const doc = '# Primera hoja\nUno.\n\nDos,\nen dos líneas.\n---\n# Segundo\n# título\nTres.' + filler + '\n===\n# Hoja dos\nCuatro.' + filler + '\n===\nCinco, la última.' + filler;
    fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [{ id: 'c_f', name: 'Foundations', subs: [{ id: 's_mf', name: 'Manifiesto' }] }] });
    fake.seed('pages/s_mf', { rows: [
      { id: 'r_head', layout: 'full', h: null, slots: [{ id: 'm_head', type: 'text', bg: { kind: 'none' }, align: 'start', ink: 'auto', blocks: [{ id: 'b_head', text: 'Manifiesto', font: 'jakarta', size: 48, weight: 600, lh: 110, ls: -2, align: 'left', upper: false }] }] },
      { id: 'r_mf', layout: 'full', h: null, slots: [{ id: 'm_mf', type: 'reader', name: 'Manifiesto', doc }] },
      { id: 'r_tail', layout: 'full', h: 900, slots: [{ id: 'm_tail', type: 'color', color: '#111111', ratio: '16/9', label: true }] }
    ] });
    const opened = async (label, opts = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1, ...opts });
      await fake.attach(ctx, label); await routes(ctx);
      await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js/, r => r.fulfill({ path: SB_JS, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
      const page = await ctx.newPage(); watchErrors(page, label);
      await page.goto(SUPA_BASE + '#s_mf'); await page.waitForSelector('#s-s_mf .slot-reader'); await page.waitForTimeout(2000);
      return { page, ctx };
    };
    const state = (p) => p.evaluate(() => {
      const m = document.getElementById('mreader'), sc = m.querySelector('.mr-scroll');
      return { open: !m.hidden, pages: m.querySelectorAll('.mf-page').length, y: sc ? Math.round(sc.scrollTop) : -1, prev: !!(m.querySelector('[data-action="mr-prev"]') || {}).disabled, next: !!(m.querySelector('[data-action="mr-next"]') || {}).disabled,
        focusIn: m.contains(document.activeElement), locked: document.documentElement.classList.contains('lenis-stopped') || document.documentElement.classList.contains('ov-open') };
    });
    const { page: V, ctx: vctx } = await opened('reader');
    const card = await V.evaluate(() => { const s = document.querySelector('.slot-reader'), r = s.getBoundingClientRect(), f = s.querySelector('.mf-sheet.is-f');
      return { role: s.getAttribute('role'), label: s.getAttribute('aria-label'), sheets: s.querySelectorAll('.mf-sheet').length, title: (f.querySelector('.mf-h') || {}).textContent, ratio: r.width / r.height, chip: (s.querySelector('.act-chip') || {}).textContent }; });
    check(card.role === 'button' && card.label === 'Leer: Manifiesto' && card.chip === 'Leer', 'the Manifiesto module is a button that says "Leer" (' + card.label + ')');
    check(card.sheets === 3 && card.title === 'Primera hoja' && near(card.ratio, 1105 / 530, .02), 'its card shows the first sheet over two more, in the wide gray card of the design');
    await V.locator('.slot-reader').scrollIntoViewIfNeeded(); await scrollIdle(V);
    await V.screenshot({ path: T + 'layout-14a-manifiesto-card.png' });
    const pageY = await V.evaluate(() => scrollY);
    await V.click('.slot-reader'); await V.waitForTimeout(250);
    check(await V.locator('#mreader .mr-fly .mf-sheet').count() === 3, 'opening, the sheets fly out of the card');
    await V.waitForTimeout(900);
    await V.screenshot({ path: T + 'layout-14b-manifiesto-open.png' });
    let st = await state(V);
    check(st.open && st.pages === 3 && st.focusIn && st.locked && await V.locator('#mreader .mr-fly').count() === 0, 'and it opens into the reader: the three sheets, the focus inside, the page behind still');
    const geo = await V.evaluate(() => { const b = document.querySelector('.mr-box'), cs = getComputedStyle(b), p = document.querySelector('#mreader .mf-page').getBoundingClientRect(), x = document.querySelector('.mr-x').getBoundingClientRect(), n = document.querySelector('.mr-nav').getBoundingClientRect();
      return { clip: cs.clipPath, pw: Math.round(p.width), pl: Math.round(p.left), pr: Math.round(p.right), xr: Math.round(innerWidth - x.right), xt: Math.round(x.top), nl: Math.round(n.left), nmid: Math.round(n.top + n.height / 2), h: innerHeight, title: document.querySelector('#mreader .mf-h').textContent }; });
    check(/inset\(16px/.test(geo.clip) && geo.pw === 595 && near(geo.pl + geo.pw / 2, 756, 6), 'the reader takes the whole window (16px in) with the sheet centered at 595px (' + geo.clip + ')');
    check(geo.xr === 40 && geo.xt === 40 && near(geo.nl, geo.pr + 19, 6) && near(geo.nmid, geo.h / 2, 2), 'close sits at the top right, the two chevrons beside the sheet, centered');
    check(st.prev && !st.next, 'on the first sheet, "up" is off and "down" is on');
    await V.click('#mreader [data-action="mr-next"]'); await V.waitForTimeout(900);
    const top2 = await V.evaluate(() => { const sc = document.querySelector('.mr-scroll'), p = sc.querySelectorAll('.mf-page')[1]; return Math.round(p.getBoundingClientRect().top - sc.getBoundingClientRect().top); });
    st = await state(V);
    check(top2 === 24 && !st.prev, 'down brings the next sheet to the top (' + top2 + 'px under the edge)');
    await V.click('#mreader [data-action="mr-next"]'); await V.waitForTimeout(900);
    await V.click('#mreader [data-action="mr-next"]'); await V.waitForTimeout(900);
    st = await state(V);
    check(st.next && st.y === await V.evaluate(() => { const sc = document.querySelector('.mr-scroll'); return sc.scrollHeight - sc.clientHeight; }), 'on the last sheet "down" reads it to its end, and then it is off');
    await V.click('#mreader [data-action="mr-prev"]'); await V.waitForTimeout(900);
    await V.click('#mreader [data-action="mr-prev"]'); await V.waitForTimeout(900); await V.click('#mreader [data-action="mr-prev"]'); await V.waitForTimeout(900);
    st = await state(V);
    check(st.y === 0 && st.prev, 'and "up" goes back sheet by sheet to the first');
    await V.mouse.move(756, 500); await V.mouse.wheel(0, 700); await V.waitForTimeout(500);
    st = await state(V);
    check(st.y > 300 && await V.evaluate(() => scrollY) === pageY, 'the wheel scrolls the sheets, not the page behind (' + st.y + ')');
    const tabs = [];
    for (let i = 0; i < 5; i++) { await V.keyboard.press('Tab'); tabs.push(await V.evaluate(() => document.getElementById('mreader').contains(document.activeElement))); }
    check(tabs.every(Boolean), 'Tab stays inside the reader');
    await V.keyboard.press('Escape'); await V.waitForTimeout(250);
    check(await V.locator('#mreader .mr-fly').count() === 1, 'closing, the sheets fly back into the card');
    const back = await V.evaluate(() => { const fp = document.querySelector('#mreader .mr-flypage'), pages = [...document.querySelectorAll('#mreader .mr-scroll .mf-page')];
      return { title: fp && (fp.querySelector('.mf-h') || {}).textContent, opacity: fp ? +getComputedStyle(fp).opacity : -1, left: pages.map((p, i) => p.style.visibility === 'hidden' ? i : -1).filter(i => i >= 0).join() }; });
    check(back.title === 'Hoja dos' && back.opacity === 1 && back.left === '1', `the sheet being read flies back whole, without fading, and is not left behind in the reader (${back.title}, opacity ${back.opacity})`);
    await V.waitForTimeout(800);
    st = await state(V);
    check(!st.open && await V.evaluate(() => document.activeElement && document.activeElement.classList.contains('slot-reader')) && await V.evaluate(() => !document.documentElement.classList.contains('ov-open')), 'Escape closes it and gives the focus back to the card');
    check(await V.evaluate(() => document.querySelector('.slot-reader .mf-sheet.is-f .mf-h').textContent) === 'Hoja dos', 'and it stays on top of the card');
    await V.keyboard.press('Enter'); await V.waitForTimeout(1100);
    const re = await V.evaluate(() => { const sc = document.querySelector('.mr-scroll'), p = sc.querySelectorAll('.mf-page')[1]; return Math.round(p.getBoundingClientRect().top - sc.getBoundingClientRect().top); });
    check((await state(V)).open && re === 24, 'Enter on the card opens it again, on that sheet (' + re + 'px under the edge)');
    await V.click('#mreader .mr-x'); await V.waitForTimeout(900);
    check(!(await state(V)).open, 'and the close button closes it');
    check(!V.errors.length, 'no page errors in the reader' + (V.errors.length ? ': ' + V.errors.join(' | ') : ''));
    await vctx.close();
    // Phone: a square card, the sheet takes the width, the buttons in a bar above the sheets
    const { page: M, ctx: mctx } = await opened('reader-phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await M.locator('.slot-reader').scrollIntoViewIfNeeded(); await M.waitForTimeout(500);
    const mcard = await M.evaluate(() => { const r = document.querySelector('.slot-reader').getBoundingClientRect(); return r.width / r.height; });
    check(near(mcard, 1, .02), 'on a phone the card is square');
    await M.tap('.slot-reader'); await M.waitForTimeout(1200);
    await M.screenshot({ path: T + 'layout-14c-manifiesto-phone.png' });
    const mg = await M.evaluate(() => { const p = document.querySelector('#mreader .mf-page').getBoundingClientRect(), sc = document.querySelector('.mr-scroll').getBoundingClientRect(), n = document.querySelector('.mr-nav').getBoundingClientRect(), x = document.querySelector('.mr-x').getBoundingClientRect();
      return { pw: Math.round(p.width), fs: parseFloat(getComputedStyle(document.querySelector('#mreader .mf-h')).fontSize), navAbove: n.bottom <= sc.top && x.bottom <= sc.top }; });
    check(mg.pw === 390 - 16 - 16 && mg.fs === 34 && mg.navAbove, 'on a phone the sheet takes the width, its titles shrink and the buttons sit in a bar above the text (' + mg.pw + 'px)');
    await M.tap('#mreader [data-action="mr-next"]'); await M.waitForTimeout(900);
    check((await state(M)).y > 0, 'and the chevrons turn the sheets');
    await mctx.close();
    // Reduced motion: no flight, it just appears
    const { page: Q, ctx: qctx } = await opened('reader-rm', { reducedMotion: 'reduce' });
    await Q.click('.slot-reader'); await Q.waitForTimeout(60);
    check(await Q.locator('#mreader .mr-fly').count() === 0 && (await state(Q)).open, 'with reduced motion it opens without the flight');
    await qctx.close();
    // The editor: "Manifiesto" among the types, the text in plain lines, the card follows
    const E = await localPage('#s_direccion');
    const sec = '#s-s_direccion';
    await E.locator(`${sec} [data-action="adder-open"]`).scrollIntoViewIfNeeded(); await scrollIdle(E);
    await E.click(`${sec} [data-action="adder-open"]`);
    await E.click(`${sec} [data-action="adder-layout"][data-layout="full"]`);
    check(await E.locator('.row.is-editing [data-action="pick-type"][data-type="reader"]').textContent().then(t => t.includes('Manifiesto')), 'the type picker offers "Manifiesto"');
    await E.click('.row.is-editing [data-action="pick-type"][data-type="reader"]'); await E.waitForTimeout(200);
    check(await E.locator('#insp [data-action="confirm-edit"]').isDisabled() && (await E.textContent('#mf-count')) === '0 hojas', 'empty, it cannot be confirmed yet');
    await E.fill('#f-mfdoc', doc); await E.waitForTimeout(150);
    check((await E.textContent('#mf-count')) === '3 hojas' && !(await E.locator('#insp [data-action="confirm-edit"]').isDisabled()), 'with the text in, the panel counts 3 sheets and it can be confirmed');
    check(await E.evaluate(() => (document.querySelector('.row.is-editing .mf-sheet.is-f .mf-h') || {}).textContent) === 'Primera hoja', 'the card in the editor shows the first sheet as it is typed');
    await E.screenshot({ path: T + 'layout-14d-manifiesto-editor.png' });
    await confirm(E);
    const made = E.locator(`${sec} .slot-reader[role="button"]`);
    check(await made.count() === 1, 'confirmed, the new card is in the section, ready to open');
    await made.click(); await E.waitForTimeout(1100);
    check((await state(E)).pages === 3, 'and opens with its three sheets');
    await E.keyboard.press('Escape'); await E.waitForTimeout(800);
    await E.click('#btn-search'); await E.waitForSelector('#search-input');
    await E.fill('#search-input', 'la última'); await E.waitForTimeout(250);
    check(await E.locator('#search-results .sr').count() >= 1, 'search finds the text inside the sheets');
    check(!E.errors.length, 'no page errors in the editor' + (E.errors.length ? ': ' + E.errors.join(' | ') : ''));
    await E.context().close();
  }

  /* ---------- 15. Phones: a Phudu title that opens a detail (Poder, Frontera, Sonrisa) ---------- */
  {
    const fake = new FakeSupabase(SUPA_URL);
    const pillar = (id, t) => ({ id: 'm_' + id, type: 'text', bg: { kind: 'surface' }, align: 'start', ink: 'auto', action: { kind: 'modal', title: t, body: 'Detalle de ' + t },
      blocks: [{ id: 'b_' + id, text: t, font: 'phudu', size: 120, weight: 900, lh: 95, ls: -2, align: 'left', upper: true }] });
    fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [{ id: 'c_f', name: 'Foundations', subs: [{ id: 's_p', name: 'Pilares creativos' }] }] });
    fake.seed('pages/s_p', { rows: [{ id: 'r_p', layout: 'full', h: null, slots: [pillar('p1', 'Poder')] }, { id: 'r_f', layout: 'full', h: null, slots: [pillar('p2', 'Frontera')] }] });
    const look = (p) => p.evaluate(() => { const s = document.querySelector('.slot[data-slot="m_p1"]'), t = s.querySelector('.tb'), c = s.querySelector('.act-chip'), tr = t.getBoundingClientRect(), cr = c.getBoundingClientRect(), lab = c.querySelector('span');
      return { fs: parseFloat(getComputedStyle(t).fontSize), cw: Math.round(cr.width), ch: Math.round(cr.height), right: cr.left >= tr.right - 1, midY: Math.abs((cr.top + cr.bottom) / 2 - (tr.top + tr.bottom) / 2), label: getComputedStyle(lab).display, plus: !!c.querySelector('.ac-plus') && getComputedStyle(c.querySelector('.ac-plus')).display }; });
    for (const [label, opts] of [['pillar-phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['pillar-desk', {}]]) {
      const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1, ...opts });
      await fake.attach(ctx, label); await routes(ctx);
      await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js/, r => r.fulfill({ path: SB_JS, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
      const p = await ctx.newPage(); watchErrors(p, label);
      await p.goto(SUPA_BASE + '#s_p'); await p.waitForSelector('.slot[data-slot="m_p1"] .act-chip'); await p.waitForTimeout(1500);
      const l = await look(p);
      if (label === 'pillar-phone') {
        await p.screenshot({ path: T + 'layout-15-pillars-phone.png' });
        check(l.fs === 60 && l.cw === 44 && l.ch === 44 && l.right && l.midY < 2 && l.label === 'none' && l.plus === 'block', `on a phone the pillar title is 60px and its "Ver detalle" a round "+" on its right (${l.fs}px, ${l.cw}×${l.ch})`);
        await p.tap('.slot[data-slot="m_p1"]'); await p.waitForTimeout(500);
        check(await p.evaluate(() => !document.getElementById('amodal').hidden), 'and a tap still opens the detail');
      } else check(l.fs > 60 && l.label !== 'none' && l.plus === 'none', 'on a computer it keeps its size and the "Ver detalle" chip');
      check(!p.errors.length, 'no page errors (' + label + ')' + (p.errors.length ? ': ' + p.errors.join(' | ') : ''));
      await ctx.close();
    }
  }

  /* ---------- 16. Shared links: the Open Graph image and tags ---------- */
  {
    const root = new URL('/', BASE).href;
    const html = await (await fetch(root + 'voice-tone')).text();
    const tag = (k) => { const m = new RegExp(`<meta (?:property|name)="${k}" content="([^"]*)"`).exec(html); return m ? m[1] : null; };
    const head = html.slice(0, html.indexOf('</head>'));
    check(head.includes('og:image') && tag('og:image') === 'https://belo-brandbook.vercel.app/og.png' && tag('og:image:width') === '1200' && tag('og:image:height') === '630', 'every page carries the Open Graph image, by its full address, in its head (' + tag('og:image') + ')');
    check(tag('og:title') === 'Belo Brand Catalog' && tag('twitter:card') === 'summary_large_image' && tag('twitter:image') === tag('og:image') && !!tag('og:description'), 'with the page title, a description and the large card for X');
    const img = await fetch(root + 'og.png'), buf = Buffer.from(await img.arrayBuffer());
    check(img.status === 200 && img.headers.get('content-type') === 'image/png' && buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 630, 'and /og.png is served: a 1200 × 630 PNG (' + img.status + ', ' + buf.length + ' bytes)');
  }

  /* ---------- 17. Password gate: only editors and visitors with the password read the catalog ---------- */
  {
    const fake = new FakeSupabase(SUPA_URL);
    const PASS = 'clave-de-prueba-123';
    fake.gate = { password: PASS };
    const leo = fake.addUser({ email: 'leo@paisanoscreando.com', name: 'Leo Suarez' });
    fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [{ id: 'c_f', name: 'Foundations', subs: [{ id: 's_a', name: 'Valores de marca' }] }] });
    fake.seed('pages/s_a', { rows: [{ id: 'r_a', layout: 'full', h: null, slots: [{ id: 'm_a', type: 'text', bg: { kind: 'none' }, align: 'start', ink: 'auto', blocks: [{ id: 'b_a', text: 'Contenido privado', font: 'jakarta', size: 48, weight: 600, lh: 110, ls: -2, align: 'left', upper: false }] }] }] });
    const open = async (label, opts = {}, user) => {
      const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1, ...opts });
      await fake.attach(ctx, label); await routes(ctx);
      await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js/, r => r.fulfill({ path: SB_JS, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
      if (user) await fake.signInContext(ctx, user);
      const page = await ctx.newPage(); watchErrors(page, label);
      await page.goto(SUPA_BASE + '#s_a', { waitUntil: 'domcontentloaded' });
      return { page, ctx };
    };
    const gated = (p) => p.evaluate(() => { const h = document.documentElement; return { gated: h.classList.contains('gated'), ask: h.classList.contains('gate-ask') }; });
    const msg = (p) => p.textContent('#gate-msg');
    const { page: G, ctx: gctx } = await open('gate');
    const first = await gated(G);
    check(first.gated && first.ask, 'a new visitor gets the password screen from the first paint');
    const ty = () => G.evaluate(() => { const t = getComputedStyle(document.querySelector('.gate-rise')).transform; return t === 'none' ? 0 : Math.round(new DOMMatrix(t).m42); });
    const rising = await ty(), pocket = await G.evaluate(() => getComputedStyle(document.querySelector('.gate-pocket')).clipPath);
    await G.waitForTimeout(1500);
    check(rising > 0 && /^path\(/.test(pocket) && await ty() === 0, `its card rises out of the blue smile, cut by its shape (${rising}px below at first, then in place)`);
    const behind = await G.evaluate(() => ({ rail: document.querySelectorAll('.rail-cat').length, tree: localStorage.getItem('bc.tree'), stage: getComputedStyle(document.getElementById('stage')).visibility, text: document.body.innerText.includes('Contenido privado') }));
    check(behind.rail === 0 && !behind.tree && behind.stage === 'hidden' && !behind.text && !fake.reads, 'nothing of the catalog is read, drawn or kept behind it');
    const look = await G.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), cs = (s) => getComputedStyle(document.querySelector(s));
      return { title: document.querySelector('.gate-title').textContent, tfs: cs('.gate-title').fontSize, tff: cs('.gate-title').fontFamily, input: [Math.round(r('.gate-input').width), Math.round(r('.gate-input').height)], btn: [Math.round(r('.gate-btn').width), Math.round(r('.gate-btn').height), cs('.gate-btn').backgroundColor], ph: document.getElementById('gate-pass').placeholder, label: document.querySelector('.gate-btn').textContent.trim(), bg: cs('#gate').backgroundColor, legal: document.querySelector('.gate-legal').textContent.startsWith('® 2026 belo.') }; });
    check(look.tfs === '60px' && /Phudu/.test(look.tff) && look.input.join() === '351,54' && look.btn.join() === '351,54,rgb(0, 47, 167)' && look.ph === 'Contraseña' && look.label === 'Ingresar' && look.bg === 'rgb(252, 252, 252)' && look.legal, `it is the Figma design: "${look.title}" in Phudu 60px, a 351 × 54 field and blue button, the legal line (${look.input.join('×')}, ${look.btn.join(', ')})`);
    await G.screenshot({ path: T + 'layout-17a-gate.png' });
    await G.click('#gate [data-action="gate-eye"]');
    const shown = await G.evaluate(() => [document.getElementById('gate-pass').type, document.querySelector('#gate [data-action="gate-eye"]').getAttribute('aria-pressed')].join());
    await G.click('#gate [data-action="gate-eye"]');
    check(shown === 'text,true' && await G.evaluate(() => document.getElementById('gate-pass').type) === 'password', 'the eye shows and hides the password');
    await G.fill('#gate-pass', 'no-es-esta'); await G.click('.gate-btn'); await G.waitForTimeout(600);
    check((await msg(G)) === 'Contraseña incorrecta.' && (await gated(G)).gated && await G.evaluate(() => document.getElementById('gate').classList.contains('is-error')), 'a wrong password says so and keeps the catalog closed');
    await G.screenshot({ path: T + 'layout-17b-gate-wrong.png' });
    await G.fill('#gate-pass', PASS); await G.keyboard.press('Enter');
    check(await until(async () => !(await gated(G)).gated), 'the right password opens the catalog');
    await G.waitForTimeout(1200);
    const inside = await G.evaluate(() => ({ rail: (document.querySelector('.rail-cat') || {}).textContent, text: document.body.innerText.includes('Contenido privado'), pass: +localStorage.getItem('bc.pass') }));
    check(inside.rail === 'Foundations' && inside.text && Math.abs(inside.pass - (Date.now() + 864e5)) < 120e3 && fake.anonCount === 1, 'with its content, and the device is remembered for 24 hours (a visitor session, no account)');
    await G.click('#btn-menu'); await G.waitForTimeout(800);
    check(await G.locator('#menu .acct-in').count() === 1 && await G.evaluate(() => document.documentElement.dataset.mode) === 'viewer', 'the visitor is not signed in: to edit, "Iniciar sesión" in the menu, as before');
    await G.keyboard.press('Escape'); await G.waitForTimeout(500);
    await G.reload({ waitUntil: 'domcontentloaded' });
    const again = await gated(G);
    await G.waitForTimeout(1500);
    check(!again.gated && await G.evaluate(() => document.body.innerText.includes('Contenido privado')), 'within the 24 hours it opens straight away, without the screen');
    // 24 hours later
    const vid = [...fake.viewers.keys()][0];
    fake.viewers.set(vid, Date.now() - 25 * 3600e3);
    await G.evaluate(() => localStorage.setItem('bc.pass', String(Date.now() - 1000)));
    await G.reload({ waitUntil: 'domcontentloaded' });
    check((await gated(G)).gated, 'after 24 hours the screen comes back');
    await G.waitForTimeout(1500);
    const later = await G.evaluate(() => ({ ask: document.documentElement.classList.contains('gate-ask'), tree: localStorage.getItem('bc.tree'), nav: localStorage.getItem('bc.nav'), text: document.body.innerText.includes('Contenido privado') }));
    check(later.ask && !later.tree && !later.nav && !later.text, 'asking for the password again, with the copy of the catalog this browser kept gone');
    // access lost while the page is open (the password was changed)
    await G.fill('#gate-pass', PASS); await G.keyboard.press('Enter');
    await until(async () => !(await gated(G)).gated); await G.waitForTimeout(1000);
    fake.viewers.clear(); await G.waitForTimeout(5200);
    await G.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    check(await until(async () => (await gated(G)).ask), 'when the password changes, an open page goes back to the screen (on returning to the tab)');
    check(!G.errors.length, 'no page errors behind the gate' + (G.errors.length ? ': ' + G.errors.join(' | ') : ''));
    await gctx.close();
    // Guessing is slowed down
    const { page: Q, ctx: qctx } = await open('gate-guess');
    await Q.waitForTimeout(1200);
    for (let i = 0; i < 5; i++) { await Q.fill('#gate-pass', 'intento-' + i); await Q.click('.gate-btn'); await Q.waitForTimeout(250); }
    await Q.fill('#gate-pass', PASS); await Q.click('.gate-btn'); await Q.waitForTimeout(400);
    check((await msg(Q)) === 'Demasiados intentos. Prueba de nuevo en unos minutos.' && (await gated(Q)).gated, 'after 5 wrong passwords it stops trying for a while, even with the right one');
    await qctx.close();
    // Editors skip it, and get it back when they sign out
    const { page: E, ctx: ectx } = await open('gate-editor', {}, leo);
    await E.waitForTimeout(1800);
    check(!(await gated(E)).gated && await E.evaluate(() => document.body.innerText.includes('Contenido privado')) && await E.evaluate(() => document.documentElement.dataset.mode) === 'admin', 'an editor signed in with Google goes straight in, in Admin');
    await E.click('#btn-menu'); await E.waitForTimeout(800);
    await E.click('#menu [data-action="signout"]');
    check(await until(async () => (await gated(E)).ask), 'and signing out brings the password screen');
    await ectx.close();
    // A project where the gate is not installed yet: the catalog opens as before
    fake.gateMissing = true;
    const { page: N, ctx: nctx } = await open('gate-missing');
    N.errors = []; N.on('console', m => { if (m.type() === 'error' && /status of 404/.test(m.text())) N.errors.push('(expected 404)'); });
    check(await until(async () => !(await gated(N)).gated) && await until(() => N.evaluate(() => document.body.innerText.includes('Contenido privado'))), 'without the gate in the database (the migration not applied yet) the catalog opens as before');
    await nctx.close();
    fake.gateMissing = false;
    // Phone
    const { page: M, ctx: mctx } = await open('gate-phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await M.waitForTimeout(1200);
    const mg = await M.evaluate(() => { const c = document.querySelector('.gate-input').getBoundingClientRect(), b = document.querySelector('.gate-btn').getBoundingClientRect(), k = document.querySelector('.gate-card rect').getBoundingClientRect();
      return { mid: Math.round((c.left + c.right) / 2), w: Math.round(c.width), bh: Math.round(b.height), card: [Math.round(k.left), Math.round(k.right)], fs: getComputedStyle(document.getElementById('gate-pass')).fontSize }; });
    check(Math.abs(mg.mid - 195) <= 1 && mg.card[0] >= 8 && mg.card[1] <= 382 && mg.w >= 280 && mg.bh >= 44 && mg.fs === '16px', `on a phone the card fits the width, centered, with a field and button easy to tap and 16px text (no zoom on focus) (card ${mg.card.join('–')}, field ${mg.w}px, button ${mg.bh}px tall)`);
    await M.screenshot({ path: T + 'layout-17c-gate-phone.png' });
    await mctx.close();
  }

  await browser.close();
  log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll layout checks passed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
