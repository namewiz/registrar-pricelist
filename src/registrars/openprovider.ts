import { parse } from 'csv-parse/sync';
import { fetchWithRetry } from '../utils/http.js';
import { RegistrarParams, RegistrarPricelist, TldPricing, XRegistrar } from './base.js';

export const DEFAULT_OPENPROVIDER_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1fHBHaxICLF7yhyEI5ir4jvY4H5h4nSa-aIgSMaP0500/edit?gid=1726709886#gid=1726709886';
const REQUIRED_HEADERS = [
  'TLD',
  'Years',
  'Operation',
  'Price',
  'Basic \\ Pro \\ Expert',
  'Supreme',
];

export interface OpenproviderParams extends RegistrarParams {
  sheetUrl?: string;
}

interface OpenproviderRaw {
  csvUrl: string;
  csv: string;
}

interface OpenproviderParsedTld {
  maxYears: number;
  regular: Record<string, number>;
  member: Record<string, number>;
}

interface OpenproviderParsed {
  csvUrl: string;
  fetchedAt: string;
  headerIndex: number;
  rowsProcessed: number;
  emittedYear1: number;
  headersOriginal: string[];
  data: Record<string, OpenproviderParsedTld>;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '').replace(/\uFEFF/g, '').trim();
}

function resolveCsvExportUrl(url: string): string {
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

function parsePrice(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text || text === 'na' || text === 'n/a' || text === 'nonmemberprice' || text === 'non-memberprice' || text === 'non-member' || text === 'non member') {
    return null;
  }
  if (!/\d/.test(text)) return null;
  const cleaned = text.replace(/[^0-9.\-]/g, '').replace(/\.(?=.*\.)/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toInt(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function inferColumns(headerRow: string[]): { tld: number; years: number; operation: number; price: number; member: number } {
  for (const required of REQUIRED_HEADERS) {
    if (!headerRow.includes(required)) {
      const err = new Error(`Required header missing: ${required}`);
      (err as any).headers = headerRow;
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

export class OpenproviderRegistrar extends XRegistrar<OpenproviderParams, OpenproviderRaw, OpenproviderParsed> {
  readonly id = 'openprovider';
  readonly label = 'OpenProvider';

  protected getCacheKey(): string {
    return 'openprovider-prices';
  }

  protected async fetch(): Promise<OpenproviderRaw> {
    const csvUrl = resolveCsvExportUrl(this.params.sheetUrl ?? DEFAULT_OPENPROVIDER_SHEET_URL);
    this.log(`[openprovider] GET ${csvUrl}`);
    const res = await fetchWithRetry(csvUrl, { retries: 4, backoffMs: 700, logger: this.logger });
    const csv = await res.text();
    return { csvUrl, csv };
  }

  protected async parse(raw: OpenproviderRaw): Promise<OpenproviderParsed> {
    const records = parse(raw.csv, { relax_column_count: true, relax_quotes: true }) as string[][];
    if (!records.length) {
      throw new Error('OpenProvider sheet appears to be empty');
    }

    const normalized = records.map((row) => row.map(normalizeHeader));
    const headerIndex = normalized.findIndex((row) => REQUIRED_HEADERS.every((header) => row.includes(header)));
    if (headerIndex === -1) {
      const err = new Error('Required headers not found within first rows of sheet');
      (err as any).headers = normalized[0] || [];
      throw err;
    }

    const headerRow = normalized[headerIndex];
    const dataRows = records.slice(headerIndex + 1);
    const columns = inferColumns(headerRow);
    const data: Record<string, OpenproviderParsedTld> = {};
    let emittedYear1 = 0;

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
        data[tld] = { maxYears: 0, regular: {}, member: {} };
      }
      if (nonMember !== null || member !== null) {
        data[tld].maxYears = Math.max(data[tld].maxYears, years);
      }
      if (years === 1) {
        if (nonMember !== null) data[tld].regular[op] = nonMember;
        if (member !== null) data[tld].member[op] = member;
        emittedYear1 += 1;
      }
    }

    return {
      csvUrl: raw.csvUrl,
      fetchedAt: new Date().toISOString(),
      headerIndex,
      rowsProcessed: dataRows.length,
      emittedYear1,
      headersOriginal: records[headerIndex] || [],
      data,
    };
  }

  protected async map(parsed: OpenproviderParsed): Promise<RegistrarPricelist> {
    const items: TldPricing[] = [];
    for (const tld of Object.keys(parsed.data).sort()) {
      const entry = parsed.data[tld];
      const bands = [] as TldPricing['bands'];
      if (Object.keys(entry.regular).length) {
        bands.push({ id: 'regular', label: 'Regular price', operations: entry.regular });
      }
      if (Object.keys(entry.member).length) {
        bands.push({ id: 'member', label: 'Member price', operations: entry.member });
      }
      if (!bands.length) continue;
      items.push({ tld, maxYears: entry.maxYears || undefined, bands });
    }
    return {
      registrarId: this.id,
      registrarName: this.label,
      currency: 'EUR',
      fetchedAt: parsed.fetchedAt,
      source: parsed.csvUrl,
      items,
      meta: {
        headerRowIndex: parsed.headerIndex,
        rowsProcessed: parsed.rowsProcessed,
        rowsEmittedYear1: parsed.emittedYear1,
        requiredHeaders: REQUIRED_HEADERS,
        headersOriginal: parsed.headersOriginal,
      },
    };
  }
}
