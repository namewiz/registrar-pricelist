#!/usr/bin/env node
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getRegistrarGenerator, listRegistrarIds, generateUnifiedList, generateCheapestOpRows, rowsToCsv, generateCatalogRows, catalogRowsToCsv } from './generators/index.js';
import exchangeRatesGenerator from './generators/exchange-rates.js';
import { extensionsToCsv, filterResultsByTld, generateExtensionList, isAbridgedTld, isExcludedTld } from './extensions.js';

function printHelp() {
  console.log(`Usage: npx registrar-pricelist [options]\n\n` +
    `Options:\n` +
    `  --registrars=<list>   Comma separated registrar ids (default: all)\n` +
    `  --outDir=<path>       Directory where JSON files will be written (default: ./data)\n` +
    `  --unified             Also write combined TLD unified list\n` +
    `  --unifiedOut=<file>   Filename for unified list (default: unified-prices.json)\n` +
    `  --fromData            Skip fetching; rebuild unified outputs from existing JSON in --outDir\n` +
    `  --list                Print available registrar ids\n` +
    `  --verbose             Enable verbose logging\n` +
    `  -h, --help            Show this message\n`);
}

function parseArgs(argv) {
  const args = { registrars: null, outDir: './data', unified: false, unifiedOut: 'unified-prices.json', verbose: false, list: false, fromData: false };
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
    if (raw === '--fromData') {
      args.fromData = true;
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

  const resultsById = {};

  if (args.fromData) {
    for (const generator of generators) {
      const inPath = path.join(outDir, generator.defaultOutput || `${generator.id}-prices.json`);
      console.log(`Loading ${generator.label} prices from ${path.relative(process.cwd(), inPath)}...`);
      resultsById[generator.id] = JSON.parse(await fs.readFile(inPath, 'utf8'));
    }
  } else {
    // Always generate exchange rates first
    console.log(`Generating ${exchangeRatesGenerator.label}...`);
    const exchangeRates = await exchangeRatesGenerator.generate({ env: process.env, logger: verboseLogger });
    const exchangeOutPath = path.join(outDir, exchangeRatesGenerator.defaultOutput || `${exchangeRatesGenerator.id}.json`);
    await fs.writeFile(exchangeOutPath, JSON.stringify(exchangeRates, null, 2));
    console.log(`  ✔ Saved ${exchangeRatesGenerator.label} to ${path.relative(process.cwd(), exchangeOutPath)}`);

    for (const generator of generators) {
      console.log(`Generating ${generator.label} price list...`);
      const result = await generator.generate({ env: process.env, logger: verboseLogger });
      const outPath = path.join(outDir, generator.defaultOutput || `${generator.id}-prices.json`);
      await fs.writeFile(outPath, JSON.stringify(result, null, 2));
      console.log(`  ✔ Saved ${generator.label} prices to ${path.relative(process.cwd(), outPath)}`);
      resultsById[generator.id] = result;
    }
  }

  if (args.unified) {
    const writeOut = async (filename, contents, label) => {
      const outPath = path.join(outDir, filename);
      await fs.writeFile(outPath, contents);
      console.log(`  ✔ Saved ${label} to ${path.relative(process.cwd(), outPath)}`);
    };

    // Excluded extensions are dropped from every published unified output.
    const supportedResults = filterResultsByTld(resultsById, (tld) => !isExcludedTld(tld));
    const abridgedResults = filterResultsByTld(supportedResults, isAbridgedTld);

    console.log('Building unified TLD list...');
    const unified = generateUnifiedList(supportedResults, { providers: normalizedIds });
    await writeOut(args.unifiedOut || 'unified-prices.json', JSON.stringify(unified, null, 2), 'unified list');

    console.log('Building unified CSVs (create, renew, transfer)...');
    for (const op of ['create', 'renew', 'transfer']) {
      const rows = generateCheapestOpRows(supportedResults, op, normalizedIds);
      await writeOut(`unified-${op}-prices.csv`, rowsToCsv(rows), `unified ${op} CSV`);
    }

    console.log('Building unified catalog CSV (price-quotes format)...');
    const catalogRows = generateCatalogRows(supportedResults, normalizedIds);
    await writeOut('unified-catalog.csv', catalogRowsToCsv(catalogRows), 'unified catalog CSV');

    console.log('Building abridged list (.ng + top 100 global extensions)...');
    const abridged = generateUnifiedList(abridgedResults, { providers: normalizedIds });
    await writeOut('abridged-prices.json', JSON.stringify(abridged, null, 2), 'abridged list');
    const abridgedCatalogRows = generateCatalogRows(abridgedResults, normalizedIds);
    await writeOut('abridged-catalog.csv', catalogRowsToCsv(abridgedCatalogRows), 'abridged catalog CSV');

    console.log('Building abridged extension metadata CSV...');
    await writeOut('abridged-extensions.csv', extensionsToCsv(generateExtensionList(abridged)), 'abridged extension CSV');
  }
}

run().catch((err) => {
  console.error(err.message || err);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
