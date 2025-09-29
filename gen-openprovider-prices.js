#!/usr/bin/env node
// gen-openprovider-prices.js (ESM)
// -------------------------------------------------------------
// Reads a OpenProvider's public price sheet
// https://docs.google.com/spreadsheets/d/1fHBHaxICLF7yhyEI5ir4jvY4H5h4nSa-aIgSMaP0500/edit?gid=1726709886#gid=1726709886
// downloads it as CSV, cleans & validates rows, and writes a compact
// prices.json organized for humans and machines.
//
// Usage:
//   node gen-openprovider-prices.js [sheetUrl] [outPath]
//   # example:
//   node gen-openprovider-prices.js \
//     "https://docs.google.com/spreadsheets/d/1fHBHaxICLF7yhyEI5ir4jvY4H5h4nSa-aIgSMaP0500/edit?gid=1726709886#gid=1726709886" prices.json
//   If omitted, the default sheet URL above is used.
//
// Dependencies (install once):
//   npm i csv-parse@5
//
// Notes:
//  * The sheet must be publicly accessible (no auth). If your link
//    opens in a browser without logging in, this script can fetch it.
//  * Handles sheets with >=10k rows easily using streaing parsing.
//  * Only rows with Years=1 are stored in the output price maps, max years is tracked.
//  * The output JSON has a "meta" section with info about the source,
//    generation time, detected headers, etc.
//  * Columns expected (case-insensitive):
//      - TLD
//      - Years
//      - Operation
//      - One or more price columns (any headers beyond the first 3)
//    Price columns can have values like "$8.27", "8.27", "non-member price",
//    "N/A", empty cells, etc. These are normalized to numbers or null.
// -------------------------------------------------------------

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'csv-parse';

// ---------------------------- helpers ----------------------------
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1fHBHaxICLF7yhyEI5ir4jvY4H5h4nSa-aIgSMaP0500/edit?gid=1726709886#gid=1726709886';
const REQUIRED_HEADERS = [
  'TLD',
  'Years',
  'Operation',
  'Price',
  'Basic \\ Pro \\ Expert',
  'Supreme', // present in sheet but intentionally ignored in output
];

const toInt = (v) => {
  if (v === undefined || v === null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const cleanHeader = (h) => String(h ?? '')
  .replace(/\uFEFF/g, '') // strip BOM
  .trim();

const looksLikeCurrency = (s) => /\d/.test(s);

const parsePrice = (raw) => {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === 'na' || s === 'n/a' ||
      s === 'nonmemberprice' || s === 'non-memberprice' ||
      s === 'non-member' || s === 'non member' || s === 'nonmember') {
    return null;
  }
  if (!looksLikeCurrency(s)) return null;
  const cleaned = s
    .replace(/[^0-9.\-]/g, '')
    .replace(/\.(?=.*\.)/g, '') // keep only last dot
    .trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

function buildCsvExportUrl(inputUrl) {
  try {
    const u = new URL(inputUrl);
    const isSheets = u.hostname.includes('docs.google.com') && u.pathname.includes('/spreadsheets/');
    const isCsvExport = isSheets && u.pathname.includes('/export') && u.searchParams.get('format') === 'csv';
    if (isCsvExport) return u.toString();

    if (!isSheets) throw new Error('Not a Google Sheets URL.');

    let gid = '0';
    if (u.hash && u.hash.includes('gid=')) {
      const m = u.hash.match(/gid=(\d+)/);
      if (m) gid = m[1];
    }
    const parts = u.pathname.split('/');
    const docIdIndex = parts.findIndex(p => p === 'd') + 1;
    const docId = parts[docIdIndex];
    if (!docId) throw new Error('Could not parse spreadsheet ID from URL.');

    const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${docId}/export`);
    exportUrl.searchParams.set('format', 'csv');
    exportUrl.searchParams.set('gid', gid);
    return exportUrl.toString();
  } catch (e) {
    throw new Error(`Invalid sheet URL: ${e.message}`);
  }
}

async function fetchWithRetry(url, { retries = 3, backoffMs = 500 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'prices-bot/1.1' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (i < retries) await delay(backoffMs * Math.pow(2, i));
    }
  }
  throw lastErr;
}

function findHeaderRow(allRows) {
  // Find a row that contains ALL required headers verbatim (case-sensitive)
  const MAX_SCAN = Math.min(15, allRows.length);
  for (let i = 0; i < MAX_SCAN; i++) {
    const row = (allRows[i] ?? []).map(cleanHeader);
    // The original (not normalized) headers must be present as-is
    const present = REQUIRED_HEADERS.every(h => row.includes(h));
    if (present) return { headerRow: row, dataStartIndex: i + 1 };
  }
  const err = new Error('Required headers not found verbatim in the first rows of the sheet.');
  err.headers = allRows[0] ?? [];
  throw err;
}

function inferColumnIndexes(headers) {
  for (const h of REQUIRED_HEADERS) {
    if (!headers.includes(h)) {
      const err = new Error(`Required header not found: ${h}`);
      err.headers = headers;
      throw err;
    }
  }
  const tldIdx = headers.indexOf('TLD');
  const yearsIdx = headers.indexOf('Years');
  const opIdx = headers.indexOf('Operation');
  const priceIdx = headers.indexOf('Price');
  const memberIdx = headers.indexOf('Basic \\ Pro \\ Expert');
  return { tldIdx, yearsIdx, opIdx, priceIdx, memberIdx };
}

// ------------------------------ main ------------------------------
async function main() {
  const [,, sheetUrlArg, outPathArg] = process.argv;
  const sheetUrl = sheetUrlArg || DEFAULT_SHEET_URL;
  if (!sheetUrlArg) {
    console.log('No sheetUrl provided; using default sheet URL.');
  }

  const outPath = outPathArg || path.join('data', 'openprovider-prices.json');
  const csvUrl = buildCsvExportUrl(sheetUrl);
  console.log('Downloading CSV from:', csvUrl);
  const res = await fetchWithRetry(csvUrl, { retries: 4, backoffMs: 700 });

  const parser = parse({
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
  });

  const rows = [];
  parser.on('readable', () => {
    let record;
    while ((record = parser.read()) !== null) {
      rows.push(record);
    }
  });
  await pipeline(res.body, parser);

  if (rows.length === 0) throw new Error('Empty sheet or missing header row.');

  // Identify header row and data start
  const { headerRow, dataStartIndex } = findHeaderRow(rows);
  const { tldIdx, yearsIdx, opIdx, priceIdx, memberIdx } = inferColumnIndexes(headerRow);
  const dataRows = rows.slice(dataStartIndex);

  // Output structure
  const output = {}; // { [tld]: { maxYears: number, 'non-member-price': {op: price}, 'member-price': {op: price} }}
  const flat = [];

  for (const r of dataRows) {
    if (!r || r.length === 0 || r.every(v => String(v ?? '').trim() === '')) continue;

    const tld = String(r[tldIdx] ?? '').trim();
    const years = toInt(r[yearsIdx]);
    const op = String(r[opIdx] ?? '').trim().toLowerCase();

    if (!tld || years === null || !op) continue;

    const nonMember = parsePrice(r[priceIdx]);
    const memberCell = String(r[memberIdx] ?? '').trim();
    const member = (/^non[-\s]?member price$/i.test(memberCell)) ? nonMember : parsePrice(memberCell);

    if (!output[tld]) output[tld] = { maxYears: 0, 'non-member-price': {}, 'member-price': {} };

    // update maxYears if any price present on the row
    if (nonMember !== null || member !== null) {
      output[tld].maxYears = Math.max(output[tld].maxYears, years);
    }

    // Only store prices for year 1 in the op maps
    if (years === 1) {
      if (nonMember !== null) output[tld]['non-member-price'][op] = nonMember;
      if (member !== null) output[tld]['member-price'][op] = member;
      flat.push({ tld, years, operation: op, 'non-member-price': nonMember, 'member-price': member });
    }
  }

  const result = {
    meta: {
      source: csvUrl,
      generated_at: new Date().toISOString(),
      header_row_index: dataStartIndex - 1,
      data_start_index: dataStartIndex,
      rows_processed: dataRows.length,
      rows_emitted_year1: flat.length,
      headers_original: headerRow,
      required_headers: REQUIRED_HEADERS,
    },
    data: output,
  };

  const json = JSON.stringify(result, null, 2);
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, json, 'utf8');
  console.log(`Saved ${flat.length} year=1 price rows into nested structure at: ${outPath}`);
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  if (err.headers) {
    console.error('Detected headers were:', JSON.stringify(err.headers));
  }
  process.exit(1);
});
