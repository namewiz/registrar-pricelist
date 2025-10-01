#!/usr/bin/env node
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getRegistrarGenerator, listRegistrarIds } from '../generators/index.js';

function printHelp() {
  console.log(`Usage: npx registrar-pricelist [options]\n\n` +
    `Options:\n` +
    `  --registrars=<list>   Comma separated registrar ids (default: all)\n` +
    `  --outDir=<path>       Directory where JSON files will be written (default: ./data)\n` +
    `  --list                Print available registrar ids\n` +
    `  --verbose             Enable verbose logging\n` +
    `  -h, --help            Show this message\n`);
}

function parseArgs(argv) {
  const args = { registrars: null, outDir: './data', verbose: false, list: false };
  for (const raw of argv.slice(2)) {
    if (raw === '--help' || raw === '-h') {
      args.help = true;
      continue;
    }
    if (raw === '--verbose' || raw === '-v') {
      args.verbose = true;
      continue;
    }
    if (raw === '--list') {
      args.list = true;
      continue;
    }
    if (raw.startsWith('--registrars=')) {
      args.registrars = raw.split('=')[1];
      continue;
    }
    if (raw.startsWith('--outDir=')) {
      args.outDir = raw.split('=')[1];
      continue;
    }
  }
  return args;
}

const aliasMap = {
  openprrovider: 'openprovider',
};

async function run() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (args.list) {
    console.log(listRegistrarIds().join('\n'));
    return;
  }

  const outDir = path.resolve(process.cwd(), args.outDir || './data');
  const selectedIds = args.registrars
    ? args.registrars.split(',').map((id) => id.trim()).filter(Boolean)
    : listRegistrarIds();

  const normalizedIds = selectedIds.map((id) => aliasMap[id] || id);

  const generators = normalizedIds.map((id) => {
    const generator = getRegistrarGenerator(id);
    if (!generator) {
      throw new Error(`Unknown registrar generator: ${id}`);
    }
    return generator;
  });

  if (!generators.length) {
    console.error('No registrars selected. Use --list to see options.');
    process.exit(1);
  }

  const verboseLogger = args.verbose
    ? (entry) => {
        const level = entry.level || 'info';
        console.log(`[${level}] ${entry.message}`);
      }
    : () => {};

  await fs.mkdir(outDir, { recursive: true });

  for (const generator of generators) {
    console.log(`Generating ${generator.label} price list...`);
    const result = await generator.generate({ env: process.env, logger: verboseLogger });
    const outPath = path.join(outDir, generator.defaultOutput || `${generator.id}-prices.json`);
    await fs.writeFile(outPath, JSON.stringify(result, null, 2));
    console.log(`  ✔ Saved ${generator.label} prices to ${path.relative(process.cwd(), outPath)}`);
  }
}

run().catch((err) => {
  console.error(err.message || err);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
