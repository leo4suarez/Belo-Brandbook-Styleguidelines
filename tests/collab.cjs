// Shared catalog on Supabase: sign-in, permissions, live updates, presence, conflicts and retries.
// Runs the real supabase-js against tests/fake-supabase.cjs (no network). Usage: through tests/run.cjs.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { FakeSupabase } = require('./fake-supabase.cjs');
const FIX = path.join(__dirname, 'fixtures') + path.sep;
const T = path.join(__dirname, 'output') + path.sep;
fs.mkdirSync(T, { recursive: true });
const BASE = process.env.SUPA_BASE_URL || 'http://localhost:8766/index.html';
const SUPA_URL = process.env.SUPA_URL || 'https://belotest.supabase.co';
const SB_JS = require.resolve('@supabase/supabase-js/dist/umd/supabase.js');
const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, what) => { log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what); };

const fake = new FakeSupabase(SUPA_URL);
const ana = fake.addUser({ email: 'ana@paisanoscreando.com', name: 'Ana Gómez' });
const leo = fake.addUser({ email: 'leo@paisanoscreando.com', name: 'Leo Suárez' });
const pat = fake.addUser({ email: 'pat@gmail.com', name: 'Pat Outside' });
const jo = fake.addUser({ email: 'jo@paisanos.io', name: 'Jo Venezia' });
const text = (id, t) => ({ id, layout: 'full', h: null, slots: [{ id: 'm_' + id, type: 'text', bg: { kind: 'none' }, align: 'start', ink: 'auto', blocks: [{ id: 'b_' + id, text: t, font: 'jakarta', size: 40, weight: 600, lh: 110, ls: -1, align: 'left', upper: false }] }] });
fake.seed('catalog/tree', { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [{ id: 'c_brand', name: 'Our Brand', subs: [{ id: 's_intro', name: 'Intro' }, { id: 's_logo', name: 'Logotipo' }] }, { id: 'c_voice', name: 'Voice & Tone', subs: [] }] }, leo.id);
fake.seed('pages/s_intro', { rows: [text('r_a', 'Hola Belo'), text('r_b', 'Segundo bloque')] }, leo.id);
fake.seed('pages/s_logo', { rows: [{ id: 'r_c', layout: 'full', h: null, slots: [{ id: 'm_c', type: 'color', color: '#002fa7' }] }] }, leo.id);
const rowsOf = (p) => (fake.docs.get(p) || { data: { rows: [] } }).data.rows;
const textOf = (r) => r && r.slots[0].blocks ? r.slots[0].blocks.map(b => b.text).join(' / ').toLowerCase() : '';
const lc = async (p, sel) => String(await p.textContent(sel)).toLowerCase();

(async () => {
  const browser = await chromium.launch();
  const open = async (label, user) => {
    const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 1 });
    await fake.attach(ctx, label);
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/lenis/, r => r.fulfill({ path: FIX + 'lenis.min.js', contentType: 'text/javascript' }));
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/gsap@[^/]+\/dist\/(gsap|ScrollTrigger|SplitText)\.min\.js/, r => r.fulfill({ path: FIX + r.request().url().split('/').pop(), contentType: 'text/javascript' }));
    // The page loads supabase-js with an integrity hash: serving the npm copy also proves the hash matches the release.
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\/dist\/umd\/supabase\.js/, r => r.fulfill({ path: SB_JS, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
    if (user) await fake.signInContext(ctx, user);
    const page = await ctx.newPage();
    page.errors = [];
    // 409 (conflict) and 403 (edit rights revoked) are answers the page handles; the browser still logs them.
    page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/ERR_FAILED|ERR_CONNECTION_RESET|Failed to fetch|status of 409|status of 403/.test(m.text())) page.errors.push(label + ' ' + m.type() + ': ' + m.text()); });
    page.on('pageerror', e => page.errors.push(label + ' pageerror: ' + e.message));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(BASE);
    await page.waitForSelector('#s-s_intro .row');
    await page.waitForTimeout(500);
    return page;
  };
  const mode = (p) => p.evaluate(() => document.documentElement.dataset.mode);
  const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
  const scrollIdle = (p) => p.waitForFunction(() => !document.documentElement.classList.contains('lenis-scrolling'), null, { timeout: 5000 }).catch(() => {});
  const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
  const editRow = async (p, rowId) => {
    const row = p.locator(`#stage .row[data-id="${rowId}"]`);
    await row.scrollIntoViewIfNeeded(); await scrollIdle(p);
    await row.hover();
    await row.locator('[data-action="row-edit"]').click();
    await p.waitForSelector('.row.is-editing');
  };
  const addText = async (p, sub, words) => {
    await p.locator(`#s-${sub} [data-action="adder-open"]`).scrollIntoViewIfNeeded(); await scrollIdle(p);
    await p.click(`#s-${sub} [data-action="adder-open"]`);
    await p.click(`#s-${sub} [data-action="adder-layout"][data-layout="full"]`);
    await p.click('.row.is-editing [data-action="pick-type"][data-type="text"]');
    const tb = p.locator('.row.is-editing .tb[data-block]');
    await tb.nth(1).click(); await p.keyboard.type(words);
    await p.keyboard.press('Control+Enter');
    await p.waitForTimeout(300);
  };

  const menuUp = (p) => p.evaluate(() => document.querySelector('#menu').classList.contains('is-open') && getComputedStyle(document.querySelector('#menu-bg')).opacity === '1');

  // 1. A visitor lands on the menu, sees the shared content read-only, and has a way to sign in.
  const A = await open('ana');
  check(await menuUp(A), 'the link opens on the menu, fully drawn');
  check(await mode(A) === 'viewer', 'visitor starts in viewer mode');
  check((await A.textContent('#s-s_intro .row[data-id="r_a"]')).includes('Hola Belo'), 'visitor sees content from Supabase');
  check(await A.locator('#menu [data-action="mode"]').count() === 0, 'visitor has no Admin switch');
  check(await A.locator('#menu .acct-in').count() === 1, 'menu offers "Iniciar sesión"');
  await A.screenshot({ path: T + 'sb-01-menu-signed-out.png' });

  // 2. Google sign-in round trip (PKCE): Ana comes back signed in, in Admin, on the section she was viewing.
  await A.keyboard.press('Escape'); await A.waitForTimeout(400);
  await A.evaluate(() => history.replaceState(null, '', '#s_logo'));
  await A.click('#btn-menu'); await A.waitForTimeout(800);
  fake.nextLogin = ana.id;
  await Promise.all([A.waitForNavigation({ url: /code=/ }), A.click('#menu .acct-in')]);
  await A.waitForSelector('#s-s_intro .row');
  await until(async () => await mode(A) === 'admin');
  check(await mode(A) === 'admin', 'after Google sign-in Ana is in Admin');
  check(/Hola, Ana/.test(await toasts(A)), 'welcome toast after sign-in');
  check(await A.evaluate(() => !location.search.includes('code=') && location.hash === '#s_logo'), 'auth code removed from the URL and section restored');

  check(!(await A.evaluate(() => document.querySelector('#menu').classList.contains('is-open'))), 'coming back from sign-in skips the opening menu');

  // 3. Leo is already signed in; Pat (gmail) can sign in but not edit. Jo signs in with @paisanos.io.
  const L = await open('leo', leo);
  check(await mode(L) === 'admin', 'Leo (paisanos) opens in Admin');
  await L.screenshot({ path: T + 'sb-03-menu-editor.png' });
  const O = await open('pat', pat);
  check(await mode(O) === 'viewer', 'Pat (gmail) stays in viewer');
  check((await O.textContent('#menu .acct')).includes('Solo lectura') && await O.locator('#menu [data-action="mode"]').count() === 0, 'Pat sees "Solo lectura" and no Admin switch');
  await O.screenshot({ path: T + 'sb-02-menu-read-only.png' });
  await O.keyboard.press('Escape');
  const J = await open('jo', jo);
  check(await mode(J) === 'admin', 'Jo (@paisanos.io) opens in Admin');
  await J.close();
  // Opening the menu with the button: the background lands even when every animation frame stalls.
  await L.keyboard.press('Escape'); await L.waitForTimeout(400);
  await L.evaluate(() => { const o = Element.prototype.animate; window.__stall = true; Element.prototype.animate = function (...a) { const an = o.apply(this, a); if (window.__stall && this.closest && this.closest('.ov')) an.pause(); return an; }; });
  await L.click('#btn-menu'); await L.waitForTimeout(1600);
  check(await menuUp(L), 'menu fully drawn after a stalled reveal (safety timer)');
  await L.evaluate(() => { window.__stall = false; });
  await L.keyboard.press('Escape'); await L.waitForTimeout(300);

  // 4. Presence: Ana opens a block; Leo sees her in the rail and on the block.
  await editRow(A, 'r_a');
  const seen = await until(() => L.evaluate(() => !!document.querySelector('#stage .row[data-id="r_a"] .row-peer') && !!document.querySelector('#rail-nav .sub-item[data-sub="s_intro"] .peer')));
  check(seen, 'Leo sees "Ana está editando" on the block and her initials in the rail');
  if (seen) log('     chip:', await L.textContent('#stage .row[data-id="r_a"] .row-peer'), '| rail:', await L.textContent('#rail-nav .sub-item[data-sub="s_intro"] .peers'));
  await L.evaluate(() => scrollTo(0, 0)); await L.waitForTimeout(400);
  await L.screenshot({ path: T + 'sb-04-presence.png' });

  // 5. Live update: Leo adds a block; Ana and Pat get it without reloading.
  await addText(L, 's_logo', 'Nuevo de Leo');
  const live = await until(async () => (await lc(A, '#s-s_logo')).includes('nuevo de leo') && (await lc(O, '#s-s_logo')).includes('nuevo de leo'));
  check(live, 'Leo\'s new block appears live for Ana (editing elsewhere) and Pat');

  // 6. Conflict: Ana's connection lags, Leo saves the same section, then Ana confirms. Both changes survive.
  fake.hold('ana');
  await addText(L, 's_intro', 'Leo en Intro');
  await until(() => rowsOf('pages/s_intro').length === 3);
  const tb = A.locator('.row.is-editing .tb[data-block]').first();
  await tb.click(); await A.keyboard.press('End'); await A.keyboard.type(' editado por Ana');
  await A.keyboard.press('Control+Enter');
  await until(() => textOf(rowsOf('pages/s_intro').find(r => r.id === 'r_a')).includes('editado por ana'));
  fake.release();
  const intro = rowsOf('pages/s_intro');
  check(intro.length === 3 && intro.some(r => textOf(r).includes('leo en intro')) && textOf(intro.find(r => r.id === 'r_a')).includes('hola belo editado por ana'), 'stale save is rebased: Leo\'s block and Ana\'s edit are both stored (' + intro.map(textOf).join(' | ') + ')');
  check(await until(async () => (await lc(A, '#s-s_intro')).includes('leo en intro')), 'Ana\'s page shows Leo\'s block after the rebase');
  check(await until(async () => (await L.textContent('#s-s_intro')).includes('editado por Ana')), 'Leo\'s page shows Ana\'s edit live');

  // 7. Tree conflict: Leo renames a section while Ana (lagging) adds one.
  fake.hold('ana');
  await L.hover('#rail-nav .sub-item[data-sub="s_logo"]');
  await L.click('#rail-nav .sub-item[data-sub="s_logo"] [data-action="item-menu"]');
  await L.click('#pop [data-action="pop-rename"]');
  await L.fill('#inline-input', 'Logo'); await L.keyboard.press('Enter');
  await until(() => fake.docs.get('catalog/tree').version >= 2);
  await A.click('#rail-nav [data-action="add-sub"]');
  await A.fill('#inline-input', 'Paleta'); await A.keyboard.press('Enter');
  await until(() => fake.docs.get('catalog/tree').data.categories[0].subs.some(s => s.name === 'Paleta'));
  fake.release();
  const subs = fake.docs.get('catalog/tree').data.categories[0].subs.map(s => s.name);
  check(subs.join(',') === 'Intro,Logo,Paleta', 'tree rebase keeps the rename and the new section: ' + subs.join(','));
  check(await until(async () => (await A.textContent('#rail-nav')).includes('Logo') && !(await A.textContent('#rail-nav')).includes('Logotipo')), 'Ana\'s rail shows Leo\'s rename');

  // 8. Upload to the bucket, shown to others, removed when the block goes.
  await A.locator('#s-s_logo [data-action="adder-open"]').scrollIntoViewIfNeeded(); await scrollIdle(A);
  await A.click('#s-s_logo [data-action="adder-open"]');
  await A.click('#s-s_logo [data-action="adder-layout"][data-layout="full"]');
  await A.click('.row.is-editing [data-action="pick-type"][data-type="image"]');
  fake.uploadBytes = fs.readFileSync(FIX + 'img1.jpg');
  await A.setInputFiles('.row.is-editing input[data-upload]', FIX + 'img1.jpg');
  await A.waitForSelector('.row.is-editing img.is-loaded', { state: 'attached' });
  await A.keyboard.press('Control+Enter');
  await until(() => rowsOf('pages/s_logo').some(r => r.slots[0].type === 'image'));
  const imgRow = rowsOf('pages/s_logo').find(r => r.slots[0].type === 'image');
  const asset = imgRow && imgRow.slots[0].asset;
  check(!!asset && /^[0-9a-f-]{36}\.jpg$/.test(asset) && fake.files.has(asset), 'image stored in the assets bucket as ' + asset);
  check(await until(() => L.evaluate((id) => { const i = document.querySelector(`#stage .row[data-id="${id}"] img.is-loaded`); return !!i && i.naturalWidth > 0; }, imgRow && imgRow.id)), 'Leo sees the uploaded image from the public URL');
  const ar = A.locator(`#stage .row[data-id="${imgRow.id}"]`);
  await ar.scrollIntoViewIfNeeded(); await scrollIdle(A); await ar.hover();
  await ar.locator('[data-action="row-delete"]').click();
  await A.click(`#stage .row[data-id="${imgRow.id}"] [data-action="row-delete-confirm"]`);
  check(await until(() => !fake.files.has(asset) && !rowsOf('pages/s_logo').some(r => r.id === imgRow.id)), 'deleting the block removes its file from the bucket');

  // 9. Last edit, in Leo's status pill for the section he is looking at.
  await L.evaluate(() => scrollTo(0, 0)); await L.waitForTimeout(3200);
  await L.evaluate(() => document.querySelector('.sub[data-id="s_intro"]').click()); await L.waitForTimeout(1500);
  const status = await L.textContent('#status');
  check(/Editado por (Ana Gómez|ti) · hace un momento/.test(status), 'status shows the last edit: "' + status + '"');
  await L.screenshot({ path: T + 'sb-05-status.png' });

  // 9b. Animations save through Supabase: a preset on one title, saved as a linked style and applied to every title.
  await editRow(L, 'r_b');
  await L.click('#insp [data-action="insp-view"][data-v="anim"]');
  await L.waitForSelector('#insp select[data-f="tenter"]');
  await L.selectOption('#insp select[data-f="tenter"]', 'split-mask');
  await L.click('#insp [data-action="style-new"][data-kind="text"]');
  await L.fill('#style-name', 'Título hero'); await L.keyboard.press('Enter');
  await L.waitForTimeout(200);
  await L.click('#insp [data-action="style-ask"][data-mode="apply"][data-kind="text"]');
  await L.click('#insp [data-action="style-apply"][data-kind="text"]');
  await L.waitForTimeout(300);
  await L.keyboard.press('Control+Enter');
  const heroId = () => ((fake.docs.get('catalog/tree').data.animStyles || []).find(x => x.name === 'Título hero') || {}).id;
  const linked = (r) => !!r && (r.slots[0].blocks || []).some(b => b.anim && b.anim.style === heroId());
  check(await until(() => !!heroId() && linked(rowsOf('pages/s_intro').find(r => r.id === 'r_b')) && linked(rowsOf('pages/s_intro').find(r => r.id === 'r_a'))), 'animation style stored in the tree and applied to the titles of the page through Supabase');
  check(await until(() => rowsOf('pages/s_logo').filter(r => r.slots[0].type === 'text').every(linked)), 'apply-to-all also saved the titles of the other section');
  check(textOf(rowsOf('pages/s_intro').find(r => r.id === 'r_a')).includes('hola belo editado por ana'), 'applying the style kept the rest of each block');
  await L.waitForTimeout(800);

  // 10. A dropped connection: the save is retried and lands.
  fake.down = 2;
  const before = rowsOf('pages/s_intro').map(r => r.id).join(',');
  const r0 = L.locator('#stage .row[data-id="r_a"]');
  await r0.scrollIntoViewIfNeeded(); await scrollIdle(L); await r0.hover();
  await r0.locator('[data-action="row-down"]').click();
  await L.waitForTimeout(1200);
  const st = await L.evaluate(() => document.querySelector('#status').dataset.state);
  check(st === 'error' && /conexión/.test(await toasts(L)), 'failed save shows "Sin guardar" and a toast (state=' + st + ')');
  check(await until(() => rowsOf('pages/s_intro').map(r => r.id).join(',') !== before, 8000), 'the move is saved by the automatic retry');
  check(await until(() => L.evaluate(() => document.querySelector('#status').dataset.state === 'ok')), 'status back to saved');

  // 11. Edit rights revoked mid-session: the save is refused and Leo drops to viewer.
  fake.revoked.add(leo.id);
  const v0 = fake.docs.get('pages/s_intro').version;
  const r1 = L.locator('#stage .row[data-id="r_a"]');
  await r1.scrollIntoViewIfNeeded(); await scrollIdle(L); await r1.hover();
  await r1.locator('[data-action="row-up"]').click();
  check(await until(async () => await mode(L) === 'viewer'), 'refused save switches Leo to viewer');
  check(fake.docs.get('pages/s_intro').version === v0, 'refused save left the stored page untouched');
  check(await until(async () => (await L.evaluate(() => [...document.querySelectorAll('#s-s_intro .row')].map(r => r.dataset.id).join(','))) === rowsOf('pages/s_intro').map(r => r.id).join(',')), 'Leo\'s page reverts to what is stored');

  // 12. One-time import: an editor drops an artifact export (json + images) on the page.
  const OLD1 = 'a'.repeat(32), OLD2 = 'b'.repeat(32);
  const exp = { format: 'belo-catalog-export', version: 1, assets: { [OLD1]: { file: 'belo-01.jpg', type: 'image/jpeg' }, [OLD2]: { file: 'belo-02.jpg', type: 'image/jpeg' } }, docs: {
    'catalog/tree': { logo: null, menu: { bg: { kind: 'color', color: '#002fa7' } }, categories: [{ id: 'c_imp', name: 'Importada', subs: [{ id: 's_imp', name: 'Sección importada' }] }] },
    'pages/s_imp': { rows: [
      { id: 'r_i1', layout: 'full', h: null, slots: [{ id: 'm_i1', type: 'image', asset: OLD1, w: 1600, h: 1000, ratio: 'auto', dim: 0, scrim: true }] },
      { id: 'r_i2', layout: 'full', h: null, slots: [{ id: 'm_i2', type: 'carousel', images: [{ id: OLD2, w: 1600, h: 1000 }, { id: OLD1, w: 1600, h: 1000 }], ratio: 'auto', pace: 5, autoplay: true }] }
    ] } } };
  fake.uploadBytes = fs.readFileSync(FIX + 'img2.jpg');
  await A.evaluate(() => scrollTo(0, 0)); await A.waitForTimeout(300);
  const dt = await A.evaluateHandle(({ json, img }) => {
    const d = new DataTransfer();
    const bin = Uint8Array.from(atob(img), c => c.charCodeAt(0));
    d.items.add(new File([json], 'belo-export.json', { type: 'application/json' }));
    d.items.add(new File([bin], 'belo-01.jpg', { type: 'image/jpeg' }));
    d.items.add(new File([bin], 'belo-02.jpg', { type: 'image/jpeg' }));
    return d;
  }, { json: JSON.stringify(exp), img: fake.uploadBytes.toString('base64') });
  A.once('dialog', d => d.accept());
  await A.dispatchEvent('#stage', 'dragover', { dataTransfer: dt });
  await A.dispatchEvent('#stage', 'drop', { dataTransfer: dt });
  const imported = await until(() => { const p = fake.docs.get('pages/s_imp'); return !!p && fake.docs.get('catalog/tree').data.categories[0].id === 'c_imp'; }, 10000);
  const imp = fake.docs.get('pages/s_imp');
  const ids = imp ? [imp.data.rows[0].slots[0].asset, ...imp.data.rows[1].slots[0].images.map(i => i.id)] : [];
  check(imported && ids.length === 3 && ids.every(id => /^[0-9a-f-]{36}\.jpg$/.test(id) && fake.files.has(id)) && ids[0] === ids[2] && ids[0] !== ids[1], 'import uploads each asset once and rewrites the ids (' + ids.join(', ') + ')');
  check(await until(async () => (await A.textContent('.rail-title')) === 'Importada' && await A.evaluate(() => !!document.querySelector('#s-s_imp img.is-loaded'))), 'Ana sees the imported category with its images');
  check(await until(async () => (await O.textContent('.rail-title')) === 'Importada'), 'the import reaches other viewers live');
  await A.screenshot({ path: T + 'sb-06-imported.png' });

  // 13. Sign out.
  await A.evaluate(() => scrollTo(0, 0)); await A.waitForTimeout(300);
  await A.click('#btn-menu'); await A.waitForTimeout(800);
  await A.click('#menu [data-action="signout"]');
  check(await until(async () => await mode(A) === 'viewer' && await A.locator('#menu .acct-in').count() === 1), 'sign-out returns to viewer with "Iniciar sesión"');

  const errors = [...A.errors, ...L.errors, ...O.errors];
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + JSON.stringify(errors, null, 1) : ''));
  log('saves:', fake.log.map(x => `${x.path}@${x.version}(${x.by.split(' ')[0]})`).join(' '));
  await browser.close();
  if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
