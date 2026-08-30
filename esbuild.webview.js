const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

async function copyAssets() {
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Copy xterm.css
  const xtermCssSrc = path.join(__dirname, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css');
  if (fs.existsSync(xtermCssSrc)) {
    fs.copyFileSync(xtermCssSrc, path.join(distDir, 'xterm.css'));
  }

  // Copy codicon.css & codicon.ttf
  const codiconDir = path.join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist');
  if (fs.existsSync(codiconDir)) {
    if (fs.existsSync(path.join(codiconDir, 'codicon.css'))) {
      fs.copyFileSync(path.join(codiconDir, 'codicon.css'), path.join(distDir, 'codicon.css'));
    }
    if (fs.existsSync(path.join(codiconDir, 'codicon.ttf'))) {
      fs.copyFileSync(path.join(codiconDir, 'codicon.ttf'), path.join(distDir, 'codicon.ttf'));
    }
  }

  // Copy media styles if present
  const stylesSrc = path.join(__dirname, 'media', 'styles.css');
  if (fs.existsSync(stylesSrc)) {
    fs.copyFileSync(stylesSrc, path.join(distDir, 'styles.css'));
  }
}

async function main() {
  await copyAssets();

  const ctx = await esbuild.context({
    entryPoints: ['src/webview/ui/index.ts'],
    bundle: true,
    format: 'iife',
    minify: false,
    sourcemap: true,
    platform: 'browser',
    outfile: 'dist/webview.js',
    logLevel: 'info',
  });

  if (isWatch) {
    await ctx.watch();
    console.log('Watching webview for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
