import { parse } from 'csv-parse/sync';
import { createRegistrarPriceGenerator } from '../core/registrar-generator.js';
import { fetchWithRetry } from '../core/http.js';

const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1fHBHaxICLF7yhyEI5ir4jvY4H5h4nSa-aIgSMaP0500/edit?gid=1726709886#gid=1726709886';
const REQUIRED_HEADERS = [
  'TLD',
  'Years',
  'Operation',
  'Price',
  'Basic \\ Pro \\ Expert',
  'Supreme',
];

const normalizeHeader = (value) => String(value ?? '').replace(/\uFEFF/g, '').trim();

function resolveCsvExportUrl(url) {
  const input = new URL(url);
  const isSheets = input.hostname.includes('docs.google.com') && input.pathname.includes('/spreadsheets/');
  const isExport = isSheets && input.pathname.includes('/export') && input.searchParams.get('format') === 'csv';
  if (isExport) return input.toString();
  if (!isSheets) throw new Error('Not a Google Sheets URL');

  let gid = '0';
  if (input.hash && input.hash.includes('gid=')) {
    const match = input.hash.match(/gid=(\d+)/);
    if (match) gid = match[1];
  }
  const parts = input.pathname.split('/');
  const docIdIndex = parts.findIndex((p) => p === 'd') + 1;
  const docId = parts[docIdIndex];
  if (!docId) throw new Error('Could not determine spreadsheet id');
  const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${docId}/export`);
  exportUrl.searchParams.set('format', 'csv');
  exportUrl.searchParams.set('gid', gid);
  return exportUrl.toString();
}

function parsePrice(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text || text === 'na' || text === 'n/a' || text === 'nonmemberprice' || text === 'non-memberprice' || text === 'non-member' || text === 'non member') {
    return null;
  }
  if (!/\d/.test(text)) return null;
  const cleaned = text
    .replace(/[^0-9.\-]/g, '')
    .replace(/\.(?=.*\.)/g, '')
    .trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toInt(value) {
  if (value === undefined || value === null) return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function inferColumns(headerRow) {
  for (const required of REQUIRED_HEADERS) {
    if (!headerRow.includes(required)) {
      const err = new Error(`Required header missing: ${required}`);
      err.headers = headerRow;
      throw err;
    }
  }
  return {
    tld: headerRow.indexOf('TLD'),
    years: headerRow.indexOf('Years'),
    operation: headerRow.indexOf('Operation'),
    price: headerRow.indexOf('Price'),
    member: headerRow.indexOf('Basic \\ Pro \\ Expert'),
  };
}

export const openproviderGenerator = createRegistrarPriceGenerator({
  id: 'openprovider',
  label: 'OpenProvider',
  defaultOutput: 'openprovider-prices.json',
  async generate({ env = {}, options = {}, logger, signal } = {}) {
    const sheetUrl = options.sheetUrl || env.OPENPROVIDER_SHEET_URL || DEFAULT_SHEET_URL;
    const csvUrl = resolveCsvExportUrl(sheetUrl);
    logger({ level: 'info', message: `Fetching OpenProvider CSV from ${csvUrl}` });
    const res = await fetchWithRetry(csvUrl, { retries: 4, backoffMs: 700, signal, logger });
    const csv = await res.text();
    const records = parse(csv, { relax_column_count: true, relax_quotes: true });
    if (!records.length) throw new Error('OpenProvider sheet appears to be empty');

    const normalized = records.map((row) => row.map(normalizeHeader));
    const headerIndex = normalized.findIndex((row) => REQUIRED_HEADERS.every((header) => row.includes(header)));
    if (headerIndex === -1) {
      const err = new Error('Required headers not found within first rows of sheet');
      err.headers = normalized[0] || [];
      throw err;
    }

    const headerRow = normalized[headerIndex];
    const dataRows = records.slice(headerIndex + 1);
    const columns = inferColumns(headerRow);
    const data = {};
    const flat = [];

    for (const rawRow of dataRows) {
      if (!rawRow || rawRow.length === 0) continue;
      const tld = String(rawRow[columns.tld] ?? '').trim();
      const years = toInt(rawRow[columns.years]);
      const op = String(rawRow[columns.operation] ?? '').trim().toLowerCase();
      if (!tld || years === null || !op) continue;
      const nonMember = parsePrice(rawRow[columns.price]);
      const memberCell = String(rawRow[columns.member] ?? '').trim();
      const member = (/^non[-\s]?member price$/i.test(memberCell)) ? nonMember : parsePrice(memberCell);
      if (!data[tld]) {
        data[tld] = { maxYears: 0, 'regular-price': {}, 'member-price': {} };
      }
      if (nonMember !== null || member !== null) {
        data[tld].maxYears = Math.max(data[tld].maxYears, years);
      }
      if (years === 1) {
        if (nonMember !== null) data[tld]['regular-price'][op] = nonMember;
        if (member !== null) data[tld]['member-price'][op] = member;
        flat.push({ tld, years, operation: op, 'regular-price': nonMember, 'member-price': member });
      }
    }

    return {
      meta: {
        source: csvUrl,
        generated_at: new Date().toISOString(),
        header_row_index: headerIndex,
        data_start_index: headerIndex + 1,
        rows_processed: dataRows.length,
        rows_emitted_year1: flat.length,
        headers_original: records[headerIndex] || [],
        required_headers: REQUIRED_HEADERS,
      },
      data,
    };
  },
});

export default openproviderGenerator;
