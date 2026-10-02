// Serves dist/ and runs the end-to-end checks in sequence. Usage: npm test
const { spawn } = require('child_process');
const path = require('path');

(async () => {
  const { serve } = await import(path.join(__dirname, '..', 'scripts', 'serve.mjs'));
  const port = Number(process.env.PORT) || 8765;
  const server = await serve(port);
  const env = { ...process.env, BASE_URL: `http://localhost:${port}/index.html` };
  let failed = 0;
  for (const file of ['flows.cjs', 'panel.cjs', 'menu.cjs']) {
    console.log(`\n=== ${file}`);
    const code = await new Promise(res => spawn(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', env }).on('exit', res));
    if (code !== 0) failed++;
  }
  server.close();
  console.log(failed ? `\n${failed} suite(s) failed` : '\nAll suites finished. Screenshots are in tests/output/.');
  process.exit(failed ? 1 : 0);
})();
