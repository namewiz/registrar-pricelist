import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const isCurrency = (value) => typeof value === 'string' && /^[A-Z]{3}$/i.test(value);
const isPriceMap = (value) => isObject(value) && Object.values(value).every(Number.isFinite);

function parseUnified(text) {
  const entries = JSON.parse(text);
  validate(entries, (entry) => isObject(entry) && isText(entry.tld) && isText(entry.provider)
    && isPriceMap(entry['regular-price']) && (entry.currency === undefined || isCurrency(entry.currency))
    && (entry.currencies === undefined || (isObject(entry.currencies)
      && Object.entries(entry.currencies).every(([code, extra]) => isCurrency(code) && isObject(extra) && isPriceMap(extra['regular-price'])))),
  (entry) => entry.tld);
  return entries;
}

function parseOperationRows(text) {
  const [header, ...records] = parse(text, { bom: true, skip_empty_lines: true });
  if (JSON.stringify(header) !== JSON.stringify(['tld', 'provider', 'currency', 'amount'])) {
    throw new Error('expected CSV header tld,provider,currency,amount');
  }
  const rows = records.map(([tld, provider, currency, amount]) => ({ tld, provider, currency, amount }));
  validate(rows, (row) => isText(row.tld) && isText(row.provider) && isCurrency(row.currency)
    && isText(row.amount) && Number.isFinite(Number(row.amount)),
  (row) => JSON.stringify([row.tld, row.currency.toUpperCase()]));
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

function validate(entries, valid, key) {
  if (!Array.isArray(entries) || !entries.every(valid)) throw new Error('invalid price entries');
  if (new Set(entries.map(key)).size !== entries.length) throw new Error('duplicate price entries');
}

async function readBaseline(filename, parseContents) {
  try {
    return parseContents(await fs.readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Invalid publication baseline ${filename}: ${error.message}`, { cause: error });
  }
}

/** Load every baseline before overwriting any output; missing files start fresh. */
export async function loadPublicationBaseline(outDir, unifiedOut = 'unified-prices.json') {
  const unified = await readBaseline(path.join(outDir, unifiedOut), parseUnified);
  const operationRows = {};
  for (const op of ['create', 'renew', 'transfer']) {
    operationRows[op] = await readBaseline(path.join(outDir, `unified-${op}-prices.csv`), parseOperationRows);
  }
  return { unified, operationRows };
}
