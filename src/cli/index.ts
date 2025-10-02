#!/usr/bin/env node
import 'dotenv/config';
import path from 'node:path';
import { RegistrarConfig, buildPriceIndex, generatePricelists, listRegistrars, writePricelistsToDirectory } from '../index.js';
import type { RegistrarId } from '../index.js';

interface CliArgs {
  registrars?: string;
  outDir: string;
  verbose: boolean;
  list: boolean;
  help?: boolean;
  ttl?: string;
}

function printHelp(): void {
  console.log(`Usage: npx registrar-pricelist [options]\n\n` +
    `Options:\n` +
    `  --registrars=<list>   Comma separated registrar ids (default: all)\n` +
    `  --outDir=<path>       Directory for JSON files (default: ./data)\n` +
    `  --ttl=<ms|infinity>   Cache TTL in milliseconds (default: 0 for fresh fetch)\n` +
    `  --list                Print available registrar ids\n` +
    `  --verbose             Enable verbose logging\n` +
    `  -h, --help            Show this message\n`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { outDir: './data', verbose: false, list: false };
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
    if (raw.startsWith('--ttl=')) {
      args.ttl = raw.split('=')[1];
      continue;
    }
  }
  return args;
}

function parseTtl(value: string | undefined): number {
  if (!value) return 0;
  if (value.toLowerCase() === 'infinity' || value.toLowerCase() === 'inf') {
    return Infinity;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const aliasMap: Record<string, string> = {
  openprrovider: 'openprovider',
};

async function run(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (args.list) {
    const config = RegistrarConfig.fromEnv(process.env, { cacheDir: args.outDir, logger: undefined });
    const infos = listRegistrars(config);
    console.log(
      infos
        .map((info) => (info.available ? info.id : `${info.id} (disabled)`))
        .join('\n'),
    );
    return;
  }

  const outDir = path.resolve(process.cwd(), args.outDir || './data');
  const config = RegistrarConfig.fromEnv(process.env, { cacheDir: outDir });
  const infos = listRegistrars(config);

  const selectedIds = args.registrars
    ? args.registrars.split(',').map((id) => id.trim()).filter(Boolean)
    : infos.filter((info) => info.available).map((info) => info.id);

  const normalizedIds = selectedIds.map((id) => (aliasMap[id] || id) as RegistrarId) as RegistrarId[];
  const unavailable = normalizedIds.filter((id) => !infos.some((info) => info.id === id && info.available));
  if (unavailable.length) {
    throw new Error(`Registrar(s) not configured: ${unavailable.join(', ')}`);
  }
  const ttl = parseTtl(args.ttl);

  const logger = args.verbose
    ? (entry: { level?: string; message: string }) => {
        const level = entry.level || 'info';
        console.log(`[${level}] ${entry.message}`);
      }
    : undefined;

  const results = await generatePricelists({
    registrars: normalizedIds,
    ttl,
    cacheDir: outDir,
    logger,
    config,
  });

  await writePricelistsToDirectory(results, outDir);

  if (args.verbose) {
    const index = buildPriceIndex(results);
    console.log(`Indexed ${Object.keys(index).length} TLDs across ${Object.keys(results).length} registrars.`);
  }
}

run().catch((err) => {
  console.error(err.message || err);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
