#!/usr/bin/env node
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getRegistrarGenerator, listRegistrarIds, generateUnifiedList, generateCheapestOpRows, rowsToCsv } from './generators/index.js';
import exchangeRatesGenerator from './generators/exchange-rates.js';

function printHelp() {
  console.log(`Usage: npx registrar-pricelist [options]\n\n` +
    `Options:\n` +
    `  --registrars=<list>   Comma separated registrar ids (default: all)\n` +
    `  --outDir=<path>       Directory where JSON files will be written (default: ./data)\n` +
    `  --unified             Also write combined TLD unified list\n` +
    `  --unifiedOut=<file>   Filename for unified list (default: unified-prices.json)\n` +
    `  --list                Print available registrar ids\n` +
    `  --verbose             Enable verbose logging\n` +
    `  -h, --help            Show this message\n`);
}

function parseArgs(argv) {
  const args = { registrars: null, outDir: './data', unified: false, unifiedOut: 'unified-prices.json', verbose: false, list: false };
  let deprecatedMasterFlag = false;
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
    if (raw === '--unified') {
      args.unified = true;
      continue;
    }
    if (raw.startsWith('--unifiedOut=')) {
      args.unifiedOut = raw.split('=')[1];
      continue;
    }
    // Backwards compatibility: deprecated flags
    if (raw === '--master') {
      args.unified = true;
      deprecatedMasterFlag = true;
      continue;
    }
    if (raw.startsWith('--masterOut=')) {
      args.unifiedOut = raw.split('=')[1];
      deprecatedMasterFlag = true;
      continue;
    }
  }
  if (deprecatedMasterFlag) args._deprecatedMaster = true;
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

  if (args._deprecatedMaster) {
    console.warn('[deprecation] --master/--masterOut are deprecated. Use --unified/--unifiedOut instead.');
  }

  // Always generate exchange rates first
  console.log(`Generating ${exchangeRatesGenerator.label}...`);
  const exchangeRates = await exchangeRatesGenerator.generate({ env: process.env, logger: verboseLogger });
  const exchangeOutPath = path.join(outDir, exchangeRatesGenerator.defaultOutput || `${exchangeRatesGenerator.id}.json`);
  await fs.writeFile(exchangeOutPath, JSON.stringify(exchangeRates, null, 2));
  console.log(`  ✔ Saved ${exchangeRatesGenerator.label} to ${path.relative(process.cwd(), exchangeOutPath)}`);

  const resultsById = {};

  for (const generator of generators) {
    console.log(`Generating ${generator.label} price list...`);
    const result = await generator.generate({ env: process.env, logger: verboseLogger });
    const outPath = path.join(outDir, generator.defaultOutput || `${generator.id}-prices.json`);
    await fs.writeFile(outPath, JSON.stringify(result, null, 2));
    console.log(`  ✔ Saved ${generator.label} prices to ${path.relative(process.cwd(), outPath)}`);
    resultsById[generator.id] = result;
  }

  if (args.unified) {
    console.log('Building unified TLD list...');
    const unified = generateUnifiedList(resultsById, { providers: normalizedIds });
    const unifiedPath = path.join(outDir, args.unifiedOut || 'unified-prices.json');
    await fs.writeFile(unifiedPath, JSON.stringify(unified, null, 2));
    console.log(`  ✔ Saved unified list to ${path.relative(process.cwd(), unifiedPath)}`);

    console.log('Building unified CSVs (create, renew, transfer)...');
    const createRows = generateCheapestOpRows(resultsById, 'create', normalizedIds);
    const renewRows = generateCheapestOpRows(resultsById, 'renew', normalizedIds);
    const transferRows = generateCheapestOpRows(resultsById, 'transfer', normalizedIds);
    const createCsv = rowsToCsv(createRows);
    const renewCsv = rowsToCsv(renewRows);
    const transferCsv = rowsToCsv(transferRows);
    const createPath = path.join(outDir, 'unified-create-prices.csv');
    const renewPath = path.join(outDir, 'unified-renew-prices.csv');
    const transferPath = path.join(outDir, 'unified-transfer-prices.csv');
    await fs.writeFile(createPath, createCsv);
    await fs.writeFile(renewPath, renewCsv);
    await fs.writeFile(transferPath, transferCsv);
    console.log(`  ✔ Saved unified create CSV to ${path.relative(process.cwd(), createPath)}`);
    console.log(`  ✔ Saved unified renew CSV to ${path.relative(process.cwd(), renewPath)}`);
    console.log(`  ✔ Saved unified transfer CSV to ${path.relative(process.cwd(), transferPath)}`);
  }
}

run().catch((err) => {
  console.error(err.message || err);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
