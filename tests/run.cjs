// Builds two test copies of the page and runs the end-to-end checks in sequence. Usage: npm test
// (or node tests/run.cjs layout.cjs … to run some suites only)
//   flows, panel, menu, motion  the local demo (no Supabase), so they never touch real data
//   collab                      wired to a fake Supabase project (tests/fake-supabase.cjs)
//   blocks                      duplicate / move / drag blocks, on the local demo and the fake Supabase project
//   home                        both: the local demo, plus the fake Supabase project for what must be stored
//   editor, media               both: editing flows on the local demo, what is stored on the fake Supabase
//   layout                      both: locks, rail, text-module items, widths, carousel strip (v7)
const { spawn } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const { serve } = await import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'serve.mjs')).href);
  const { build } = await import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'build.mjs')).href);
  const port = Number(process.env.PORT) || 8765;
  const localDir = path.join(__dirname, 'output', 'dist-local');
  const supaDir = path.join(__dirname, 'output', 'dist-supabase');
  const supaUrl = 'https://belotest.supabase.co';
  build({ outDir: localDir, supabase: null });
  build({ outDir: supaDir, supabase: { url: supaUrl, key: 'sb_publishable_test' } });
  const server = await serve(port, localDir);
  const supaServer = await serve(port + 1, supaDir);
  const env = { ...process.env, BASE_URL: `http://localhost:${port}/index.html`, SUPA_BASE_URL: `http://localhost:${port + 1}/index.html`, SUPA_URL: supaUrl };
  let failed = 0;
  const all = ['flows.cjs', 'panel.cjs', 'menu.cjs', 'motion.cjs', 'collab.cjs', 'blocks.cjs', 'home.cjs', 'editor.cjs', 'media.cjs', 'layout.cjs'];
  const only = process.argv.slice(2);
  for (const file of only.length ? all.filter(f => only.includes(f)) : all) {
    console.log(`\n=== ${file}`);
    const code = await new Promise(res => spawn(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', env }).on('exit', res));
    if (code !== 0) failed++;
  }
  server.close(); supaServer.close();
  console.log(failed ? `\n${failed} suite(s) failed` : '\nAll suites finished. Screenshots are in tests/output/.');
  process.exit(failed ? 1 : 0);
})();
