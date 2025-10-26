#!/usr/bin/env node
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getRegistrarGenerator, listRegistrarIds, generateMasterList, generateCheapestOpRows, rowsToCsv } from '../generators/index.js';
import exchangeRatesGenerator from '../generators/exchange-rates.js';

function printHelp() {
  console.log(`Usage: npx registrar-pricelist [options]\n\n` +
    `Options:\n` +
    `  --registrars=<list>   Comma separated registrar ids (default: all)\n` +
    `  --outDir=<path>       Directory where JSON files will be written (default: ./data)\n` +
    `  --master              Also write combined TLD master list\n` +
    `  --masterOut=<file>    Filename for master list (default: master-prices.json)\n` +
    `  --list                Print available registrar ids\n` +
    `  --verbose             Enable verbose logging\n` +
    `  -h, --help            Show this message\n`);
}

function parseArgs(argv) {
  const args = { registrars: null, outDir: './data', master: false, masterOut: 'master-prices.json', verbose: false, list: false };
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
    if (raw === '--master') {
      args.master = true;
      continue;
    }
    if (raw.startsWith('--masterOut=')) {
      args.masterOut = raw.split('=')[1];
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

  if (args.master) {
    console.log('Building master TLD list...');
    const master = generateMasterList(resultsById, { providers: normalizedIds });
    const masterPath = path.join(outDir, args.masterOut || 'master-prices.json');
    await fs.writeFile(masterPath, JSON.stringify(master, null, 2));
    console.log(`  ✔ Saved master list to ${path.relative(process.cwd(), masterPath)}`);

    console.log('Building master CSVs (create, renew)...');
    const createRows = generateCheapestOpRows(resultsById, 'create', normalizedIds);
    const renewRows = generateCheapestOpRows(resultsById, 'renew', normalizedIds);
    const createCsv = rowsToCsv(createRows);
    const renewCsv = rowsToCsv(renewRows);
    const createPath = path.join(outDir, 'master-create-prices.csv');
    const renewPath = path.join(outDir, 'master-renew-prices.csv');
    await fs.writeFile(createPath, createCsv);
    await fs.writeFile(renewPath, renewCsv);
    console.log(`  ✔ Saved master create CSV to ${path.relative(process.cwd(), createPath)}`);
    console.log(`  ✔ Saved master renew CSV to ${path.relative(process.cwd(), renewPath)}`);
  }
}

run().catch((err) => {
  console.error(err.message || err);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
