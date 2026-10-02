// Builds the catalog from src/catalog.html.
//   dist/artifact.html  the page body that is published as the Claude artifact
//   dist/index.html     the same page wrapped in a full HTML document, for Vercel and local preview
//
// Shared storage: when SUPABASE_URL and a publishable key are set, the page saves to that Supabase project
// (see supabase/). Only the project URL and the publishable (anon) key are read, never a secret key.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

export function supabaseConfig(env = { ...localEnv(), ...process.env }) {
  const pick = (...names) => names.map(n => env[n]).find(v => v && String(v).trim());
  const url = pick('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const key = pick('SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !key) return null;
  if (!/^https?:\/\/[^\s"'<>]+$/.test(url)) throw new Error('SUPABASE_URL does not look like a URL');
  if (/^sb_secret_/.test(key) || /service_role/.test(Buffer.from(key.split('.')[1] || '', 'base64').toString())) {
    throw new Error('The Supabase key is a secret key. Use the publishable (anon) key: it ends up in the page.');
  }
  return { url: url.replace(/\/+$/, ''), key };
}

export function build({ outDir = join(root, 'dist'), supabase = supabaseConfig() } = {}) {
  const src = readFileSync(join(root, 'src/catalog.html'), 'utf8');
  const font = readFileSync(join(root, 'assets/fonts/phudu-subset.woff2')).toString('base64');

  if (!src.includes('__PHUDU_B64__')) throw new Error('src/catalog.html is missing the __PHUDU_B64__ placeholder');
  if (!src.includes('/*__SUPABASE__*/null')) throw new Error('src/catalog.html is missing the /*__SUPABASE__*/null placeholder');
  const cfg = supabase ? JSON.stringify(supabase).replace(/</g, '\\u003c') : 'null';
  const artifact = src.replace('__PHUDU_B64__', font).replace('/*__SUPABASE__*/null', cfg);

  // Mirrors the skeleton Claude wraps around an artifact page at publish time.
  const page = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
    + '</head><body>' + artifact + '</body></html>';

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'artifact.html'), artifact);
  writeFileSync(join(outDir, 'index.html'), page);
  return { outDir, supabase: !!supabase, size: artifact.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build();
  console.log(`Built dist/artifact.html (${(r.size / 1024).toFixed(0)} KB) and dist/index.html · storage: ${r.supabase ? 'Supabase' : 'artifact or local demo'}`);
}
