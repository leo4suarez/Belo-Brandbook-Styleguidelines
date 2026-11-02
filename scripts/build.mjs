// Builds the catalog from src/catalog.html.
//   dist/artifact.html  the page body that is published as the Claude artifact
//   dist/index.html     the same page wrapped in a full HTML document, for Vercel and local preview
//   dist/og.png         the image a shared link shows (Open Graph and X cards), from assets/og.png
//
// Shared storage: the page saves to the Supabase project in supabase/public.json, or to the one named by
// SUPABASE_URL and a publishable key in the environment (which win). Only the project URL and the publishable
// key are used: both end up in the page by design, and the database permissions decide who can write.
// A secret (service_role) key is refused.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Reads KEY=value lines from .env.local (ignored by git) for local builds. Real environment variables win.
function localEnv() {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function committedConfig() {
  const file = join(root, 'supabase/public.json');
  if (!existsSync(file)) return {};
  const { url, key } = JSON.parse(readFileSync(file, 'utf8'));
  return { url, key };
}

export function supabaseConfig(env = { ...localEnv(), ...process.env }) {
  const pick = (...names) => names.map(n => env[n]).find(v => v && String(v).trim());
  const fromEnv = { url: pick('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'), key: pick('SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY') };
  const { url, key } = fromEnv.url && fromEnv.key ? fromEnv : committedConfig();
  if (!url || !key) return null;
  if (!/^https?:\/\/[^\s"'<>]+$/.test(url)) throw new Error('SUPABASE_URL does not look like a URL');
  if (/^sb_secret_/.test(key) || /service_role/.test(Buffer.from(key.split('.')[1] || '', 'base64').toString())) {
    throw new Error('The Supabase key is a secret key. Use the publishable (anon) key: it ends up in the page.');
  }
  return { url: url.replace(/\/+$/, ''), key };
}

// Where the published site lives: link previews need the image's full address. On Vercel the production domain comes
// from the build environment; SITE_URL overrides it.
export function siteUrl(env = process.env) {
  const u = env.SITE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + env.VERCEL_PROJECT_PRODUCTION_URL : 'https://belo-brandbook.vercel.app');
  return u.replace(/\/+$/, '');
}

// What a shared link shows (WhatsApp, Slack, LinkedIn, X…): the page title, a line about it and assets/og.png (1200 × 630)
function shareTags(title, site) {
  const a = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const desc = 'Catálogo de marca de Belo.', img = site + '/og.png';
  return `<meta name="description" content="${a(desc)}">`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="Belo"><meta property="og:url" content="${a(site + '/')}">`
    + `<meta property="og:title" content="${a(title)}"><meta property="og:description" content="${a(desc)}">`
    + `<meta property="og:image" content="${a(img)}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Belo · Brand Guidelines">`
    + `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${a(title)}"><meta name="twitter:description" content="${a(desc)}"><meta name="twitter:image" content="${a(img)}">`;
}

export function build({ outDir = join(root, 'dist'), supabase = supabaseConfig(), site = siteUrl() } = {}) {
  const src = readFileSync(join(root, 'src/catalog.html'), 'utf8');
  const font = readFileSync(join(root, 'assets/fonts/phudu-subset.woff2')).toString('base64');

  if (!src.includes('__PHUDU_B64__')) throw new Error('src/catalog.html is missing the __PHUDU_B64__ placeholder');
  if (!src.includes('/*__SUPABASE__*/null')) throw new Error('src/catalog.html is missing the /*__SUPABASE__*/null placeholder');
  const cfg = supabase ? JSON.stringify(supabase).replace(/</g, '\\u003c') : 'null';
  const artifact = src.replace('__PHUDU_B64__', font).replace('/*__SUPABASE__*/null', cfg);

  // Mirrors the skeleton Claude wraps around an artifact page at publish time.
  // Spanish, and never machine-translated: Chrome took the mixed English titles for an English page and "translated" it,
  // and the word animations then showed the translation before giving the real text back.
  const title = (/<title>([^<]*)<\/title>/.exec(src) || [])[1] || 'Belo';
  const page = '<!doctype html><html lang="es" translate="no" class="notranslate"><head><meta charset="utf-8"><meta name="google" content="notranslate"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + shareTags(title, site)
    + '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
    + '</head><body>' + artifact + '</body></html>';

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'artifact.html'), artifact);
  writeFileSync(join(outDir, 'index.html'), page);
  copyFileSync(join(root, 'assets/og.png'), join(outDir, 'og.png'));
  return { outDir, supabase: !!supabase, size: artifact.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build();
  console.log(`Built dist/artifact.html (${(r.size / 1024).toFixed(0)} KB) and dist/index.html · storage: ${r.supabase ? 'Supabase' : 'artifact or local demo'}`);
}
