import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

async function run() {
  await rm(distDir, { recursive: true, force: true });
  await runTypeChecker();

  await Promise.all([
    build({
      entryPoints: [path.join(rootDir, 'src/index.ts')],
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'node',
      target: ['node22'],
      outfile: path.join(distDir, 'index.js'),
      external: ['node:fs', 'node:fs/promises', 'node:path'],
    }),
    build({
      entryPoints: [path.join(rootDir, 'src/cli/index.ts')],
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'node',
      target: ['node22'],
      outfile: path.join(distDir, 'cli/index.js'),
      banner: { js: '#!/usr/bin/env node' },
      external: ['node:fs', 'node:fs/promises', 'node:path'],
    }),
    build({
      entryPoints: [path.join(rootDir, 'src/browser.ts')],
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2020'],
      outfile: path.join(rootDir, 'docs/registrar-pricelist.js'),
      external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'fs/promises', 'path'],
    }),
  ]);
}

async function runTypeChecker() {
  const tscPath = require.resolve('typescript/bin/tsc');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tscPath, '--emitDeclarationOnly', '-p', path.join(rootDir, 'tsconfig.json')], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tsc exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
