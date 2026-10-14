// Organizing blocks: duplicate, drag and drop (within a section, across sections, onto the rail), "Mover a…",
// Esc to cancel, and the file lifecycle of duplicated blocks (files are deleted only when nothing uses them).
// Part 1 runs on the local demo; part 2 on the fake Supabase project, where saves and the bucket can be inspected.
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
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
/* Aborted fonts, and on purpose: a revoked local file and a refused save (400) are answers the page handles */
const benign = /ERR_FAILED|ERR_FILE_NOT_FOUND|status of 400/;

async function libs(ctx) {
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/lenis/, r => r.fulfill({ path: FIX + 'lenis.min.js', contentType: 'text/javascript' }));
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/gsap@[^/]+\/dist\/(gsap|ScrollTrigger|SplitText)\.min\.js/, r => r.fulfill({ path: FIX + r.request().url().split('/').pop(), contentType: 'text/javascript' }));
}
function watch(page, label) {
  page.errors = [];
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !benign.test(m.text())) page.errors.push(label + ' ' + m.type() + ': ' + m.text()); });
  page.on('pageerror', e => page.errors.push(label + ' pageerror: ' + e.message));
}
async function openLocal(browser, label, { w = 1512, h = 900, phone = false, rm = false, hash = '#s_direccion' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, reducedMotion: rm ? 'reduce' : 'no-preference' });
  await libs(ctx);
  const page = await ctx.newPage();
  watch(page, label);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(BASE + hash);
  await page.waitForSelector('#s-s_direccion .row[data-id="r_t"]');
  await page.waitForTimeout(700);
  return page;
}

const ids = (p, sub) => p.evaluate((sub) => [...document.querySelectorAll(`#s-${sub} > .rows > .row`)].map(r => r.dataset.id), sub);
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
const scrollIdle = (p) => p.waitForFunction(() => !document.documentElement.classList.contains('lenis-scrolling'), null, { timeout: 5000 }).catch(() => {});
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
/* Puts a block well inside the window and shows its toolbar (it fades in on hover). A click on a toolbar that is still
   fading in makes Playwright scroll to retry, and a scroll closes the popovers. */
async function bring(p, id) {
  await p.evaluate((id) => { const r = document.querySelector(`#stage .row[data-id="${id}"]`); scrollTo(0, r.getBoundingClientRect().top + scrollY - 180); }, id);
  await p.waitForTimeout(350); await scrollIdle(p);
  await p.locator(`#stage .row[data-id="${id}"]`).hover(); await p.waitForTimeout(300);
}
/* Presses the handle of a block (shown on hover) and returns where the pointer is */
async function grab(p, id) {
  const row = p.locator(`#stage .row[data-id="${id}"]`);
  await row.scrollIntoViewIfNeeded(); await scrollIdle(p);
  await row.hover(); await p.waitForTimeout(250);
  const at = center(await row.locator('[data-action="row-drag"]').boundingBox());
  await p.mouse.move(at.x, at.y); await p.mouse.down();
  return at;
}
async function glide(p, from, to, steps = 12) {
  for (let i = 1; i <= steps; i++) { await p.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await p.waitForTimeout(16); }
  await p.waitForTimeout(250);
  return to;
}
const dragState = (p) => p.evaluate(() => {
  const line = document.querySelector('#stage > .drop-line');
  const g = document.querySelector('.drag-ghost');
  return {
    on: document.documentElement.classList.contains('is-row-drag'),
    line: !!line && line.classList.contains('is-on') && getComputedStyle(line).opacity !== '0',
    lineBox: line ? (() => { const r = line.getBoundingClientRect(); return { l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
    ghost: g ? g.textContent : null,
    dim: [...document.querySelectorAll('#stage .row.is-dragging')].map(r => r.dataset.id + ':' + getComputedStyle(r).opacity),
    rail: [...document.querySelectorAll('#rail-nav .sub-item.is-drop')].map(n => n.dataset.sub),
    empty: [...document.querySelectorAll('#stage .sec.is-drop')].map(n => n.dataset.sub)
  };
});

(async () => {
  const browser = await chromium.launch();

  /* ================= Part 1: local demo ================= */
  const P = await openLocal(browser, 'local');

  // 1. Toolbar: handle, Duplicar and "Mover a…" join Editar / Subir / Bajar / Eliminar
  const r0 = P.locator('#stage .row[data-id="r_t"]');
  await r0.hover(); await P.waitForTimeout(250);
  const tools = await r0.evaluate(el => [...el.querySelectorAll('.row-tools [data-action]')].map(b => b.dataset.action + (b.getAttribute('aria-label') ? '=' + b.getAttribute('aria-label') : '')));
  check(tools.join(',') === 'row-drag=Arrastrar para mover,row-edit,row-dup=Duplicar,row-move=Mover a…,row-up=Subir bloque,row-down=Bajar bloque,row-delete=Eliminar bloque,row-more=Más acciones', 'row toolbar: ' + tools.join(', '));
  check(await r0.evaluate(el => el.querySelector('[data-action="row-more"]').offsetWidth === 0 && [...el.querySelectorAll('.row-tools .rt-wide')].every(b => b.offsetWidth > 0)), 'wide screen: every action is a button of its own (no "…")');
  const tb = await r0.locator('.row-tools').boundingBox();
  await P.screenshot({ path: T + 'blocks-00-toolbar.png', clip: { x: tb.x - 24, y: tb.y - 16, width: tb.width + 48, height: tb.height + 32 } });

  // 2. Duplicate: a copy right below, with new ids for the block, its modules and its text blocks
  await r0.locator('[data-action="row-dup"]').click();
  await P.waitForTimeout(150);
  let dir = await ids(P, 's_direccion');
  const dup = dir[1];
  check(dir.length === 2 && dir[0] === 'r_t' && dup && dup !== 'r_t', 'duplicate is inserted right below the original (' + dir.join(', ') + ')');
  const same = await P.evaluate((dup) => {
    const a = document.querySelector('#stage .row[data-id="r_t"]'), b = document.querySelector(`#stage .row[data-id="${dup}"]`);
    const slots = (r) => [...r.querySelectorAll('[data-slot]')].map(s => s.dataset.slot), blocks = (r) => [...r.querySelectorAll('.tb[data-block]')].map(s => s.dataset.block);
    const words = (r) => r.textContent.replace(/\s+/g, ' ').trim();
    return { text: words(a) === words(b), slots: slots(b).every(id => !slots(a).includes(id)) && slots(b).length === slots(a).length, blocks: blocks(b).every(id => !blocks(a).includes(id)) && blocks(b).length === 2, entering: b.classList.contains('is-entering') || b.classList.contains('is-flash') };
  }, dup);
  check(same.text && same.slots && same.blocks, 'duplicate keeps the content with fresh module and text block ids ' + JSON.stringify(same));
  check(same.entering && /Bloque duplicado/.test(await toasts(P)), 'duplicate enters, flashes and says "Bloque duplicado"');

  // 3. Drag within a section: the copy goes above the original
  await P.evaluate(() => scrollTo(0, 0)); await P.waitForTimeout(300);
  let at = await grab(P, dup);
  const top0 = await P.locator('#stage .row[data-id="r_t"]').boundingBox();
  at = await glide(P, at, { x: at.x - 420, y: top0.y + 40 });
  let st = await dragState(P);
  const stage = await P.evaluate(() => { const s = document.querySelector('#stage').getBoundingClientRect(); return { l: s.left + s.width * .25, w: s.width * .75 - 20 }; });
  check(st.on && st.line && Math.abs(st.lineBox.l - stage.l) < 2 && Math.abs(st.lineBox.w - stage.w) < 2 && st.lineBox.h === 3, 'mid-drag: the drop line spans the content column ' + JSON.stringify(st.lineBox));
  check(/Tu dinero puede llegar más lejos/.test(st.ghost || '') && /Ancho completo/.test(st.ghost) && st.dim.length === 1 && st.dim[0].startsWith(dup + ':0.3'), 'mid-drag: compact ghost with the title, original dimmed in place (' + st.dim.join() + ')');
  await P.screenshot({ path: T + 'blocks-01-drag-within.png' });
  await P.mouse.up(); await P.waitForTimeout(700);
  dir = await ids(P, 's_direccion');
  check(dir.join(',') === dup + ',r_t', 'drop reorders the section (' + dir.join(', ') + ')');
  check(await P.evaluate(() => !document.querySelector('.drag-ghost, .drop-line, .row.is-dragging') && !document.documentElement.classList.contains('is-row-drag')), 'drag leaves nothing behind');

  // 4. Dropping at the same place changes nothing
  at = await grab(P, dup);
  at = await glide(P, at, { x: at.x - 200, y: at.y + 30 }, 4);
  st = await dragState(P);
  await P.mouse.up(); await P.waitForTimeout(400);
  check(!st.line && (await ids(P, 's_direccion')).join(',') === dup + ',r_t', 'no line and no change when dropped where it was');

  // 5. Drag into another section on the page: an empty one shows "Suelta aquí"
  await P.evaluate(() => { window.__moved = document.querySelector('#stage .row[data-id="r_t"]'); });
  at = await grab(P, 'r_t');
  const poder = await P.locator('#s-s_poder .adder').boundingBox();
  at = await glide(P, at, { x: poder.x + 260, y: poder.y + 60 });
  st = await dragState(P);
  const hint = await P.evaluate(() => getComputedStyle(document.querySelector('#s-s_poder .adder'), '::after').content);
  check(st.empty.join() === 's_poder' && hint === '"Suelta aquí"' && /Mover a «Poder, frontera y sonrisa»/.test(st.ghost), 'empty section is a dashed "Suelta aquí" target and the ghost names it (' + hint + ')');
  await P.screenshot({ path: T + 'blocks-02-drag-empty-section.png' });
  await P.mouse.up(); await P.waitForTimeout(800);
  check((await ids(P, 's_poder')).join() === 'r_t' && (await ids(P, 's_direccion')).join() === dup, 'block moved to «Poder, frontera y sonrisa»');
  check(/Bloque movido a «Poder, frontera y sonrisa»/.test(await toasts(P)), 'toast "Bloque movido a «Poder, frontera y sonrisa»"');
  check(await P.evaluate(() => document.querySelector('#stage .row[data-id="r_t"]') === window.__moved && window.__moved.dataset.sub === 's_poder'), 'the same element changes section (media and animations carry over)');

  // 6. Between two blocks of another section
  at = await grab(P, dup);
  const sp = await P.locator('#stage .row[data-id="r_sp"]').boundingBox();
  at = await glide(P, at, { x: at.x - 300, y: sp.y + 60 });
  st = await dragState(P);
  check(st.line && /Mover a «Se puede»/.test(st.ghost), 'line before the first block of «Se puede»');
  await P.mouse.up(); await P.waitForTimeout(800);
  check((await ids(P, 's_sepuede')).join(',') === dup + ',r_sp' && (await ids(P, 's_direccion')).length === 0, 'block placed before «Se puede» (' + (await ids(P, 's_sepuede')).join(', ') + ')');

  // 7. Drop onto a section of the rail: it goes to the end of that section, and the page follows it
  at = await grab(P, dup);
  const item = await P.locator('#rail-nav .sub-item[data-sub="s_proposito"]').boundingBox();
  at = await glide(P, at, { x: item.x + 40, y: item.y + item.height / 2 });
  st = await dragState(P);
  check(st.rail.join() === 's_proposito' && !st.line && /Mover a «Propósito, misión y visión»/.test(st.ghost), 'rail item highlighted as a drop target');
  await P.screenshot({ path: T + 'blocks-03-drag-rail.png' });
  await P.mouse.up();
  check(await until(async () => (await ids(P, 's_proposito')).join() === dup && (await ids(P, 's_sepuede')).join() === 'r_sp'), 'drop on the rail moves the block to «Propósito, misión y visión»');
  check(await until(() => P.evaluate(() => location.hash === '#s_proposito'), 3000), 'the page follows the block to its new section');

  // 7b. Beside the page, only the sections of the rail take a block: over its title nothing is marked and nothing moves
  await P.waitForTimeout(800);
  at = await grab(P, 'r_t');
  const title = await P.locator('#rail-nav .rail-title').boundingBox();
  at = await glide(P, at, { x: title.x + 40, y: title.y + title.height / 2 });
  st = await dragState(P);
  check(st.on && !st.line && !st.rail.length && !st.empty.length && !/Mover a/.test(st.ghost), 'over the rail title: no target');
  await P.mouse.up(); await P.waitForTimeout(500);
  check((await ids(P, 's_poder')).join() === 'r_t', 'dropped over the rail title: nothing moved');

  // 8. Esc cancels the drag
  await P.waitForTimeout(800);
  at = await grab(P, 'r_t');
  at = await glide(P, at, { x: at.x - 300, y: at.y + 200 });
  check((await dragState(P)).on, 'drag in progress before Esc');
  await P.keyboard.press('Escape'); await P.waitForTimeout(450);
  st = await dragState(P);
  await P.mouse.move(at.x - 100, at.y + 100); await P.mouse.up(); await P.waitForTimeout(300);
  check(!st.on && !st.line && !st.ghost && st.dim.length === 0 && (await ids(P, 's_poder')).join() === 'r_t', 'Esc cancels: no ghost, no line, nothing moved');

  // 9. "Mover a…" lists every category; picking a section of another category moves the block to its end
  await P.click('#btn-menu'); await P.waitForTimeout(700);
  await P.click('#menu [data-action="menu-cat"][data-id="c_voice"]'); await P.waitForTimeout(700);
  await P.click('#stage [data-action="add-sub"]');
  await P.fill('#inline-input', 'Tono'); await P.keyboard.press('Enter'); await P.waitForTimeout(500);
  const tono = await P.evaluate(() => document.querySelector('#rail-nav .sub-item[data-sub]').dataset.sub);
  await P.click('#btn-menu'); await P.waitForTimeout(700);
  await P.click('#menu [data-action="menu-cat"][data-id="c_ourbrand"]'); await P.waitForTimeout(900);
  const mv = P.locator('#stage .row[data-id="r_t"]');
  await bring(P, 'r_t');
  await mv.locator('[data-action="row-move"]').click(); await P.waitForTimeout(250);
  const pop = await P.evaluate(() => ({ heads: [...document.querySelectorAll('#pop .mi-h')].map(h => h.textContent), items: [...document.querySelectorAll('#pop [data-action="row-move-to"]')].map(b => b.textContent), here: (document.querySelector('#pop [aria-current]') || {}).textContent }));
  check(pop.heads.join(',') === 'Our Brand,Voice & Tone,Visual Identity,Resources' && pop.items.length === 9 && pop.items.includes('Tono') && /Poder, frontera y sonrisa/.test(pop.here || ''), '"Mover a…" lists every category and section: ' + pop.heads.join(' / '));
  check(await P.evaluate(() => getComputedStyle(document.querySelector('#stage .row[data-id="r_t"] .row-tools')).opacity === '1'), 'the toolbar stays visible while its popover is open');
  await P.screenshot({ path: T + 'blocks-04-move-to.png' });
  const keys = [];
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp']) { await P.keyboard.press(k); keys.push(await P.evaluate(() => document.activeElement.textContent)); }
  check(keys[0] === 'Se puede' && keys[1] === 'Propósito, misión y visión' && keys[2] === 'Se puede' && keys[3] === 'Dirección estratégica', 'arrow keys walk the list, skipping where the block already is: ' + keys.join(' / '));
  await P.click(`#pop [data-action="row-move-to"][data-sub="${tono}"]`);
  check(await until(async () => (await ids(P, 's_poder')).length === 0), 'block leaves «Poder, frontera y sonrisa»');
  check(/Bloque movido a «Tono»/.test(await toasts(P)), 'toast "Bloque movido a «Tono»"');
  await P.waitForTimeout(400);
  // The page stays where it was, and the toast's "Ver" goes to the block in its new category
  await P.screenshot({ path: T + 'blocks-04b-moved-away.png' });
  await P.click('.toast [data-action="row-follow"]');
  check(await until(() => P.evaluate((t) => {
    const r = document.querySelector('#stage .row[data-id="r_t"]'); if (!r || location.hash !== '#' + t || !document.querySelector(`#s-${t}`)) return false;
    const b = r.getBoundingClientRect(); return b.top >= 0 && b.top < innerHeight * .6 && !document.querySelector('.toast.has-act');
  }, tono)), '"Ver" on the toast opens «Tono» with the block in view');
  await P.waitForTimeout(600);
  await P.screenshot({ path: T + 'blocks-04c-followed.png' });
  await P.click('#btn-menu'); await P.waitForTimeout(700);
  await P.click('#menu [data-action="menu-cat"][data-id="c_ourbrand"]'); await P.waitForTimeout(900);

  // 10. What was saved: opening the categories again reads every section back from storage
  await P.click('#btn-menu'); await P.waitForTimeout(700);
  await P.click('#menu [data-action="menu-cat"][data-id="c_voice"]');
  check(await until(async () => (await ids(P, tono)).join() === 'r_t'), 'the block is stored in «Tono» (Voice & Tone)');
  check(await until(() => P.evaluate(() => /Tu dinero puede llegar más lejos/.test(((document.querySelector('#stage .row[data-id="r_t"]') || {}).textContent || '').replace(/\s+/g, ' ')))), 'and shows its content there');
  await P.click('#btn-menu'); await P.waitForTimeout(700);
  await P.click('#menu [data-action="menu-cat"][data-id="c_ourbrand"]');
  check(await until(async () => (await ids(P, 's_proposito')).join() === dup && (await ids(P, 's_direccion')).length === 0 && (await ids(P, 's_poder')).length === 0 && (await ids(P, 's_sepuede')).join() === 'r_sp'), 'Our Brand reloads with every move in place');

  // 11. Duplicates share their files: deleting one keeps the file for the other; deleting the last one frees it
  await P.evaluate(() => scrollTo(0, 0)); await P.waitForTimeout(400);
  await P.click('#s-s_direccion [data-action="adder-open"]');
  await P.click('#s-s_direccion [data-action="adder-layout"][data-layout="full"]');
  await P.click('.row.is-editing [data-action="pick-type"][data-type="image"]');
  await P.setInputFiles('.row.is-editing input[data-upload]', FIX + 'img1.jpg');
  await P.waitForSelector('.row.is-editing img.is-loaded');
  await P.keyboard.press('Control+Enter'); await P.waitForTimeout(500);
  const imgRow = (await ids(P, 's_direccion'))[0];
  const src = await P.evaluate((id) => document.querySelector(`#stage .row[data-id="${id}"] img`).src, imgRow);
  const alive = () => P.evaluate((src) => fetch(src).then(r => r.ok, () => false), src);
  const ir = P.locator(`#stage .row[data-id="${imgRow}"]`);
  await ir.hover(); await ir.locator('[data-action="row-dup"]').click(); await P.waitForTimeout(500);
  const imgDup = (await ids(P, 's_direccion'))[1];
  check(!!imgDup && await P.evaluate((id) => document.querySelector(`#stage .row[data-id="${id}"] img`).src, imgDup) === src, 'the duplicate shows the same file');
  const dr = P.locator(`#stage .row[data-id="${imgDup}"]`);
  await dr.scrollIntoViewIfNeeded(); await scrollIdle(P); await dr.hover();
  await dr.locator('[data-action="row-delete"]').click();
  await P.click(`#stage .row[data-id="${imgDup}"] [data-action="row-delete-confirm"]`);
  await P.waitForTimeout(1200);
  check((await ids(P, 's_direccion')).join() === imgRow && await alive(), 'deleting the duplicate keeps the original\'s file');
  check(await P.evaluate((id) => { const i = document.querySelector(`#stage .row[data-id="${id}"] img`); return !!i && i.naturalWidth > 0; }, imgRow), 'the original image still shows');
  await P.evaluate(() => scrollTo(0, 0)); await P.waitForTimeout(300);
  await ir.hover(); await ir.locator('[data-action="row-delete"]').click();
  await P.click(`#stage .row[data-id="${imgRow}"] [data-action="row-delete-confirm"]`);
  check(await until(async () => !(await alive())), 'deleting the last block that uses the file frees it');

  // 12. A fullscreen block with text on top: every id is new in the copy, overlay included
  const fs0 = P.locator('#stage .row[data-id="r_sp"]');
  await fs0.scrollIntoViewIfNeeded(); await scrollIdle(P); await fs0.hover();
  await fs0.locator('[data-action="row-dup"]').click(); await P.waitForTimeout(500);
  const fsIds = await P.evaluate(() => [...document.querySelectorAll('#s-s_sepuede > .rows > .row')].map(r => ({ id: r.dataset.id, slots: [...r.querySelectorAll('[data-slot]')].map(s => s.dataset.slot), blocks: [...r.querySelectorAll('.tb[data-block]')].map(b => b.dataset.block), text: r.innerText.trim() })));
  check(fsIds.length === 2 && fsIds[0].id === 'r_sp' && fsIds[1].slots.length === 2 && fsIds[1].slots.every(s => !fsIds[0].slots.includes(s)) && fsIds[1].blocks.every(b => !fsIds[0].blocks.includes(b)) && fsIds[1].text === fsIds[0].text, 'fullscreen duplicate: new ids for the background, the text on top and its text blocks');

  // 13. Not while editing, and never for visitors
  const fsDup = fsIds[1] && fsIds[1].id;
  await fs0.hover(); await fs0.locator('[data-action="row-edit"]').click();
  await P.waitForSelector('.row.is-editing');
  await P.evaluate((id) => {
    const g = document.querySelector(`#stage .row[data-id="${id}"] [data-action="row-drag"]`);
    const r = g.getBoundingClientRect(), o = { bubbles: true, pointerId: 7, button: 0, isPrimary: true, clientX: r.left + 5, clientY: r.top + 5 };
    g.dispatchEvent(new PointerEvent('pointerdown', o));
    document.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: o.clientX - 200, clientY: o.clientY + 200 }));
  }, fsDup);
  await P.waitForTimeout(200);
  check(!(await dragState(P)).on, 'no drag while a block is being edited');
  await P.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 })));
  await P.click('#insp [data-action="cancel-edit"]'); await P.waitForTimeout(400);
  await P.click('#btn-menu'); await P.waitForTimeout(700);
  await P.click('#menu [data-action="mode"][data-mode="viewer"]'); await P.waitForTimeout(400);
  await P.keyboard.press('Escape'); await P.waitForTimeout(500);
  check(await P.evaluate(() => [...document.querySelectorAll('[data-action="row-drag"], [data-action="row-dup"], [data-action="row-move"]')].every(b => !b.getClientRects().length)), 'viewer mode has no handle, Duplicar or "Mover a…"');
  await P.click('#btn-menu'); await P.waitForTimeout(700);
  await P.click('#menu [data-action="mode"][data-mode="admin"]'); await P.waitForTimeout(400);
  await P.keyboard.press('Escape'); await P.waitForTimeout(500);

  // 14. A click on the handle explains it
  const hr = P.locator(`#stage .row[data-id="${fsDup}"]`);
  await hr.scrollIntoViewIfNeeded(); await scrollIdle(P); await hr.hover();
  await hr.locator('[data-action="row-drag"]').click();
  check(/Arrastra para mover el bloque/.test(await toasts(P)), 'a click on the handle says "Arrastra para mover el bloque"');
  const errsLocal = P.errors;
  await P.context().close();

  /* ---------- Narrow screen (touch) and reduced motion ---------- */
  const M = await openLocal(browser, 'mobile', { w: 390, h: 844, phone: true });
  const mr = M.locator('#stage .row[data-id="r_t"]');
  await mr.scrollIntoViewIfNeeded(); await M.waitForTimeout(300);
  // The toolbar stays compact over the block: the handle, Editar as an icon and "…" with the rest
  const bar = await M.evaluate(() => {
    const t = document.querySelector('#stage .row[data-id="r_t"] .row-tools'); const r = t.getBoundingClientRect();
    return { w: Math.round(r.width), shown: [...t.querySelectorAll('[data-action]')].filter(b => b.offsetWidth > 0).map(b => b.dataset.action).join(','), edit: t.querySelector('[data-action="row-edit"]').textContent.trim() };
  });
  check(bar.shown === 'row-drag,row-edit,row-more' && bar.w <= 124 && bar.edit === 'Editar', 'narrow screen: a compact toolbar (handle, Editar, "…") ' + JSON.stringify(bar));
  await M.screenshot({ path: T + 'blocks-05a-mobile-toolbar.png' });
  await mr.locator('[data-action="row-more"]').click(); await M.waitForTimeout(250);
  const more = await M.evaluate(() => [...document.querySelectorAll('#pop .mi')].map(b => b.textContent.trim() + (b.disabled ? '(off)' : '')).join(','));
  check(more === 'Duplicar,Mover a…,Subir(off),Bajar(off),Eliminar', '"…" holds the other actions: ' + more);
  await M.screenshot({ path: T + 'blocks-05b-mobile-more.png' });
  await M.click('#pop [data-action="row-move"]'); await M.waitForTimeout(250);
  check(await M.evaluate(() => document.querySelectorAll('#pop [data-action="row-move-to"]').length === 8 && !!document.querySelector('#pop [aria-current][data-sub="s_direccion"]') && document.querySelector('#stage .row[data-id="r_t"] [data-action="row-more"]').getAttribute('aria-expanded') === 'true'), '"Mover a…" from "…" opens the list of sections under the same button');
  await M.keyboard.press('Escape'); await M.waitForTimeout(200);
  await mr.locator('[data-action="row-more"]').click(); await M.waitForTimeout(250);
  await M.click('#pop [data-action="row-dup"]'); await M.waitForTimeout(600);
  const mdup = (await ids(M, 's_direccion'))[1];
  check(!!mdup && await M.evaluate(() => !!document.querySelector('#pop').hidden), 'Duplicar from "…" duplicates and closes the menu');
  check(await M.evaluate(() => document.documentElement.scrollWidth - innerWidth) === 0, 'narrow screen: the toolbar does not overflow');
  const mrow = M.locator(`#stage .row[data-id="${mdup}"]`);
  await mrow.scrollIntoViewIfNeeded(); await M.waitForTimeout(300);
  let ma = center(await mrow.locator('[data-action="row-drag"]').boundingBox());
  await M.mouse.move(ma.x, ma.y); await M.mouse.down();
  const mt = await M.locator('#stage .row[data-id="r_t"]').boundingBox();
  ma = await glide(M, ma, { x: 120, y: mt.y + 30 });
  st = await dragState(M);
  check(st.line && st.lineBox.l === 16 && st.lineBox.w === 358, 'narrow screen: the line spans the column between the 16px gutters ' + JSON.stringify(st.lineBox));
  await M.screenshot({ path: T + 'blocks-05-mobile-drag.png' });
  await M.mouse.up(); await M.waitForTimeout(700);
  check((await ids(M, 's_direccion')).join(',') === mdup + ',r_t', 'narrow screen: drop reorders');
  // Auto-scroll near the bottom edge
  const y0 = await M.evaluate(() => scrollY);
  ma = center(await M.locator(`#stage .row[data-id="${mdup}"] [data-action="row-drag"]`).boundingBox());
  await M.mouse.move(ma.x, ma.y); await M.mouse.down();
  await glide(M, ma, { x: 200, y: 600 }, 6);
  await M.mouse.move(200, 836); await M.waitForTimeout(900);
  const y1 = await M.evaluate(() => scrollY);
  await M.keyboard.press('Escape'); await M.mouse.up(); await M.waitForTimeout(300);
  check(y1 > y0 + 200, `the page scrolls while dragging near the bottom edge (${Math.round(y0)} → ${Math.round(y1)})`);
  // A finger on the handle carries the block (the page does not pan) and the ghost rides above the finger
  const cdp = await M.context().newCDPSession(M);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await M.evaluate(() => { const r = document.querySelector('#stage .row[data-id="r_t"]'); scrollTo(0, r.getBoundingClientRect().top + scrollY - 420); }); await M.waitForTimeout(500);
  const tg = center(await M.locator('#stage .row[data-id="r_t"] [data-action="row-drag"]').boundingBox());
  const tTop = (await M.locator(`#stage .row[data-id="${mdup}"]`).boundingBox()).y + 20;
  const ty0 = await M.evaluate(() => scrollY);
  await touch('touchStart', tg.x, tg.y);
  for (let i = 1; i <= 16; i++) { await touch('touchMove', tg.x - i * 10, tg.y + (tTop - tg.y) * i / 16); await M.waitForTimeout(20); }
  await M.waitForTimeout(250);
  const tState = await dragState(M);
  const above = await M.evaluate((y) => document.querySelector('.drag-ghost').getBoundingClientRect().bottom < y, tTop);
  const ty1 = await M.evaluate(() => scrollY);
  await touch('touchEnd'); await M.waitForTimeout(700);
  check(tState.on && tState.line && above && ty1 === ty0 && (await ids(M, 's_direccion')).join(',') === 'r_t,' + mdup, 'touch: the finger drags the block from its handle, the page does not pan, the ghost stays above the finger');
  const errsMobile = M.errors;
  await M.context().close();

  const R = await openLocal(browser, 'reduced', { rm: true });
  const rr = R.locator('#stage .row[data-id="r_t"]');
  await rr.hover(); await rr.locator('[data-action="row-dup"]').click(); await R.waitForTimeout(300);
  const rdup = (await ids(R, 's_direccion'))[1];
  at = await grab(R, rdup);
  const rt = await R.locator('#stage .row[data-id="r_t"]').boundingBox();
  at = await glide(R, at, { x: at.x - 400, y: rt.y + 30 });
  const rState = await dragState(R);
  const tilt = await R.evaluate(() => (document.querySelector('.drag-ghost') || {}).style.transform || '');
  await R.mouse.up(); await R.waitForTimeout(200);
  check(rState.line && !/rotate/.test(tilt) && (await ids(R, 's_direccion')).join(',') === rdup + ',r_t' && await R.evaluate(() => !document.querySelector('.drag-ghost')), 'reduced motion: same drag, no tilt, ghost gone at once');
  const errsRm = R.errors;
  await R.context().close();

  /* ================= Part 2: fake Supabase (saves and the bucket) ================= */
  const fake = new FakeSupabase(SUPA_URL);
  const jo = fake.addUser({ email: 'jo@paisanos.io', name: 'Jo Venezia' });
  const A = '3f0f8a52-6d3c-4d27-9e3f-1a2b3c4d5e6f.jpg';
  fake.files.set(A, { body: fs.readFileSync(FIX + 'img1.jpg'), type: 'image/jpeg' });
  const text = (id, t) => ({ id, layout: 'full', h: null, slots: [{ id: 'm_' + id, type: 'text', bg: { kind: 'none' }, align: 'start', ink: 'auto', blocks: [{ id: 'b_' + id, text: t, font: 'jakarta', size: 40, weight: 600, lh: 110, ls: -1, align: 'left', upper: false }] }] });
  fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [{ id: 'c_a', name: 'Marca', subs: [{ id: 's_one', name: 'Uno' }, { id: 's_two', name: 'Dos' }] }, { id: 'c_b', name: 'Recursos', subs: [{ id: 's_three', name: 'Tres' }] }] }, jo.id);
  fake.seed('pages/s_one', { rows: [{ id: 'r_img', layout: 'full', h: null, slots: [{ id: 'm_img', type: 'image', asset: A, w: 1600, h: 1000, ratio: 'auto', dim: 0, scrim: true }] }, text('r_x', 'Bloque X')] }, jo.id);
  fake.seed('pages/s_two', { rows: [text('r_y', 'Bloque Y')] }, jo.id);
  const rowsOf = (p) => ((fake.docs.get(p) || { data: { rows: [] } }).data.rows || []);
  const sctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1 });
  await fake.attach(sctx, 'jo');
  await libs(sctx);
  await sctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js/, r => r.fulfill({ path: SB_JS, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
  await fake.signInContext(sctx, jo);
  const Q = await sctx.newPage();
  watch(Q, 'supabase');
  await Q.emulateMedia({ colorScheme: 'light' });
  await Q.goto(SUPA_BASE + '#s_one');
  await Q.waitForSelector('#s-s_one .row[data-id="r_img"]');
  await until(() => Q.evaluate(() => document.documentElement.dataset.mode === 'admin'));
  await Q.waitForTimeout(500);
  const qrow = (id) => Q.locator(`#stage .row[data-id="${id}"]`);
  const act = async (id, action) => { await bring(Q, id); await qrow(id).locator(`[data-action="${action}"]`).click(); };
  const del = async (id) => { await act(id, 'row-delete'); await Q.click(`#stage .row[data-id="${id}"] [data-action="row-delete-confirm"]`); };

  // 15. Duplicate is saved with the same file
  await act('r_img', 'row-dup');
  check(await until(() => rowsOf('pages/s_one').length === 3 && rowsOf('pages/s_one').filter(r => r.slots[0].asset === A).length === 2), 'the duplicate is saved and points at the same file');
  const sDup = (rowsOf('pages/s_one')[1] || {}).id;
  check(!!sDup && sDup !== 'r_img' && rowsOf('pages/s_one')[1].slots[0].id !== 'm_img', 'saved copy has its own ids (' + sDup + ')');

  // 16. Deleting the copy keeps the file in the bucket
  await del(sDup);
  await until(() => rowsOf('pages/s_one').length === 2);
  await Q.waitForTimeout(1500);
  check(fake.files.has(A), 'deleting the duplicate keeps the file in the bucket');

  // 17. Replacing the image of a copy keeps the original's file; deleting the original then frees it
  await act('r_img', 'row-dup');
  await until(() => rowsOf('pages/s_one').length === 3);
  const sDup2 = rowsOf('pages/s_one')[1].id;
  await act(sDup2, 'row-edit');
  await Q.waitForSelector('#insp input[data-upload]', { state: 'attached' });
  fake.uploadBytes = fs.readFileSync(FIX + 'img2.jpg');
  await Q.setInputFiles('#insp input[data-upload]', FIX + 'img2.jpg');
  await until(() => Q.evaluate(() => { const i = document.querySelector('.row.is-editing img'); return !!i && !i.src.includes('3f0f8a52'); }));
  await Q.waitForTimeout(300);
  await Q.keyboard.press('Control+Enter');
  const Bid = await until(() => { const r = rowsOf('pages/s_one').find(x => x.id === sDup2); return r && r.slots[0].asset !== A; }) ? rowsOf('pages/s_one').find(x => x.id === sDup2).slots[0].asset : null;
  await Q.waitForTimeout(1500);
  check(!!Bid && fake.files.has(Bid) && fake.files.has(A), 'confirming a new image on the copy keeps the original\'s file (and the new one)');
  await del('r_img');
  check(await until(() => !fake.files.has(A)) && fake.files.has(Bid), 'deleting the original, now the only user, removes its file; the copy\'s file stays');

  // 18. "Mover a…" into another category: the target is saved first, then the block leaves its section
  const v1 = fake.docs.get('pages/s_one').version;
  await act('r_x', 'row-move');
  await Q.click('#pop [data-action="row-move-to"][data-sub="s_three"]');
  check(await until(() => rowsOf('pages/s_three').some(r => r.id === 'r_x') && !rowsOf('pages/s_one').some(r => r.id === 'r_x')), 'block stored in «Tres» (another category) and removed from «Uno»');
  const iThree = fake.log.findIndex(e => e.path === 'pages/s_three'), iOne = fake.log.findIndex(e => e.path === 'pages/s_one' && e.version === v1 + 1);
  check(iThree >= 0 && iOne > iThree, `the insert was saved before the removal (log #${iThree} then #${iOne})`);
  check(/Bloque movido a «Tres»/.test(await toasts(Q)) && await until(async () => !(await Q.locator('#stage .row[data-id="r_x"]').count())), 'the block leaves the page with a toast');

  // 19. When the target refuses the save, the block stays where it was (a failure never loses a block)
  const refuse = (r) => { const b = JSON.parse(r.request().postData() || '{}'); return b.p_path === 'pages/s_two' ? r.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: '23514', message: 'new row violates check constraint', details: null, hint: null }) }) : r.fallback(); };
  await Q.route(/\/rest\/v1\/rpc\/save_doc/, refuse);
  const keepRows = rowsOf('pages/s_one').map(r => r.id).join(',');
  await act(sDup2, 'row-move');
  await Q.click('#pop [data-action="row-move-to"][data-sub="s_two"]');
  check(await until(() => Q.evaluate((id) => !!document.querySelector(`#s-s_one .row[data-id="${id}"]`) && !document.querySelector(`#s-s_two .row[data-id="${id}"]`), sDup2)), 'refused move: the block comes back to «Uno» on the page');
  check(/No se pudo mover el bloque/.test(await toasts(Q)), 'refused move: "No se pudo mover el bloque…"');
  await Q.waitForTimeout(800);
  check(rowsOf('pages/s_one').map(r => r.id).join(',') === keepRows && rowsOf('pages/s_two').map(r => r.id).join() === 'r_y', 'refused move: both stored sections are unchanged');
  await Q.unroute(/\/rest\/v1\/rpc\/save_doc/, refuse);

  // 20. Drag between the sections of the page, saved
  let qa;
  { const r = qrow(sDup2); await r.scrollIntoViewIfNeeded(); await scrollIdle(Q); await r.hover(); await Q.waitForTimeout(200); qa = center(await r.locator('[data-action="row-drag"]').boundingBox()); }
  await Q.mouse.move(qa.x, qa.y); await Q.mouse.down();
  const ry = await qrow('r_y').boundingBox();
  await glide(Q, qa, { x: qa.x - 300, y: ry.y + ry.height - 10 });
  await Q.mouse.up();
  check(await until(() => rowsOf('pages/s_two').map(r => r.id).join(',') === 'r_y,' + sDup2 && !rowsOf('pages/s_one').some(r => r.id === sDup2)), 'drag into «Dos» is saved in both sections');

  // 21. Back and forth before the saves land: each removal waits only for its own insert, so nothing waits forever
  const slow = async (r) => { await new Promise(res => setTimeout(res, 1200)); return r.fallback(); };
  await Q.route(/\/rest\/v1\/rpc\/save_doc/, slow);
  await act('r_y', 'row-move');
  await Q.click('#pop [data-action="row-move-to"][data-sub="s_one"]');
  await Q.waitForSelector('#s-s_one .row[data-id="r_y"]');
  await act('r_y', 'row-move');
  await Q.click('#pop [data-action="row-move-to"][data-sub="s_two"]');
  const settled = await until(() => Q.evaluate(() => document.querySelector('#status').dataset.state === 'ok'), 20000);
  await Q.unroute(/\/rest\/v1\/rpc\/save_doc/, slow);
  const two = rowsOf('pages/s_two').map(r => r.id), one = rowsOf('pages/s_one').map(r => r.id);
  check(settled && two.filter(x => x === 'r_y').length === 1 && two.includes(sDup2) && !one.includes('r_y'), `moved there and back while saving: everything saved once («Uno» ${one.join(', ')} · «Dos» ${two.join(', ')})`);
  check(await Q.evaluate(() => [...document.querySelectorAll('#stage .row[data-id="r_y"]')].map(r => r.dataset.sub).join()) === 's_two', 'and the page shows it once, in «Dos»');

  const errors = [...errsLocal, ...errsMobile, ...errsRm, ...Q.errors];
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + JSON.stringify(errors, null, 1) : ''));
  await browser.close();
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
