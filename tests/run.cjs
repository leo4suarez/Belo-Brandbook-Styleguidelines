// Serves dist/ and runs the end-to-end checks in sequence. Usage: npm test
// collab.cjs runs on a second build wired to a fake Supabase project (tests/fake-supabase.cjs).
const { spawn } = require('child_process');
const path = require('path');

(async () => {
  const { serve } = await import(path.join(__dirname, '..', 'scripts', 'serve.mjs'));
  const { build } = await import(path.join(__dirname, '..', 'scripts', 'build.mjs'));
  const port = Number(process.env.PORT) || 8765;
  const supaDir = path.join(__dirname, 'output', 'dist-supabase');
  const supaUrl = 'https://belotest.supabase.co';
  build({ outDir: supaDir, supabase: { url: supaUrl, key: 'sb_publishable_test' } });
  const server = await serve(port);
  const supaServer = await serve(port + 1, supaDir);
  const env = { ...process.env, BASE_URL: `http://localhost:${port}/index.html`, SUPA_BASE_URL: `http://localhost:${port + 1}/index.html`, SUPA_URL: supaUrl };
  let failed = 0;
  for (const file of ['flows.cjs', 'panel.cjs', 'menu.cjs', 'collab.cjs']) {
    console.log(`\n=== ${file}`);
    const code = await new Promise(res => spawn(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', env }).on('exit', res));
    if (code !== 0) failed++;
  }
  server.close(); supaServer.close();
  console.log(failed ? `\n${failed} suite(s) failed` : '\nAll suites finished. Screenshots are in tests/output/.');
  process.exit(failed ? 1 : 0);
})();
