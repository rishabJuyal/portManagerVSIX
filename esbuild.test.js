const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function buildTests() {
  const testDir = path.join(__dirname, 'test', 'unit');
  const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.ts'));
  const entryPoints = files.map(f => path.join(testDir, f));

  await esbuild.build({
    entryPoints,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outdir: 'dist-test',
    external: ['vscode'],
    sourcemap: true,
    logLevel: 'info',
  });
}

buildTests().catch(err => {
  console.error(err);
  process.exit(1);
});
