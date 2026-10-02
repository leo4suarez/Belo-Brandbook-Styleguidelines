// Builds the catalog from src/catalog.html.
//   dist/artifact.html  the page body that is published as the Claude artifact
//   dist/index.html     the same page wrapped in a full HTML document, for local preview
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/catalog.html'), 'utf8');
const font = readFileSync(join(root, 'assets/fonts/phudu-subset.woff2')).toString('base64');

if (!src.includes('__PHUDU_B64__')) throw new Error('src/catalog.html is missing the __PHUDU_B64__ placeholder');
const artifact = src.replace('__PHUDU_B64__', font);

// Mirrors the skeleton Claude wraps around an artifact page at publish time.
const page = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  + '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
  + '</head><body>' + artifact + '</body></html>';

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/artifact.html'), artifact);
writeFileSync(join(root, 'dist/index.html'), page);
console.log(`Built dist/artifact.html (${(artifact.length / 1024).toFixed(0)} KB) and dist/index.html`);
