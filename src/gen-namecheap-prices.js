#!/usr/bin/env node
import 'dotenv/config';
// gen-namecheap-prices.js (ESM)
// -------------------------------------------------------------
// Generates a compact price list from Namecheap's API.
// - Caches namecheap.domains.getTldList response to reduce calls
// - Fetches prices via namecheap.users.getPricing (XML endpoint)
// - Emits year=1 prices for create/renew/transfer/restore when available
// - Output maps per TLD: regular-price (retail) and sale-price (your price)
//
// Usage:
//   node src/gen-namecheap-prices.js [outPath]
//   # example:
//   NAMECHEAP_API_USER=... NAMECHEAP_API_KEY=... \
//   NAMECHEAP_USERNAME=... NAMECHEAP_CLIENT_IP=... \
//   node src/gen-namecheap-prices.js data/namecheap-prices.json
//
// Environment variables:
//   NAMECHEAP_API_USER      (required)
//   NAMECHEAP_API_KEY       (required)
//   NAMECHEAP_USERNAME      (required)
//   NAMECHEAP_CLIENT_IP     (required – your whitelisted client IP)
//   NAMECHEAP_SANDBOX=1     (optional – use sandbox endpoint)
//   NAMECHEAP_BASE_URL      (optional – override base API URL)
//   NAMECHEAP_TLD_CACHE     (optional – cache path, default .cache/namecheap-tlds.json)
//   NAMECHEAP_TLD_CACHE_TTL_MINUTES (optional – default 1440 = 24h)
// -------------------------------------------------------------

import { promises as fsp } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

const DEFAULT_OUT = path.join('data', 'namecheap-prices.json');
const DEFAULT_CACHE_PATH = path.join('.cache', 'namecheap-tlds.json');
const DEFAULT_TTL_MIN = 24 * 60; // 24 hours

let VERBOSE = false;
function vlog(...args) { 
  //if (VERBOSE)
  console.log(...args); 
}

function parseArgs(argv) {
  const out = { verbose: false, outPath: null };
  const rest = [];
  for (const a of argv.slice(2)) {
    if (a === '-v' || a === '--verbose') out.verbose = true;
    else rest.push(a);
  }
  out.outPath = rest[0] || null;
  return out;
}

function getBaseUrl() {
  const override = process.env.NAMECHEAP_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, '');
  const sandbox = process.env.NAMECHEAP_SANDBOX === '1' || /true/i.test(process.env.NAMECHEAP_SANDBOX || '');
  return sandbox ? 'https://api.sandbox.namecheap.com' : 'https://api.namecheap.com';
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error(`Missing required env var: ${name}`);
    err.code = 'EENV';
    throw err;
  }
  return v;
}

function buildUrl(command, extraParams = {}) {
  const base = getBaseUrl();
  const url = new URL(base + '/xml.response');
  const params = {
    ApiUser: requireEnv('NAMECHEAP_API_USER'),
    ApiKey: requireEnv('NAMECHEAP_API_KEY'),
    UserName: requireEnv('NAMECHEAP_USERNAME'),
    ClientIp: requireEnv('NAMECHEAP_CLIENT_IP'),
    Command: command,
    ...extraParams,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

function maskMiddle(s, keepStart = 2, keepEnd = 2) {
  if (!s) return '';
  const str = String(s);
  if (str.length <= keepStart + keepEnd) return '*'.repeat(str.length);
  return str.slice(0, keepStart) + '***' + str.slice(-keepEnd);
}

function sanitizeUrlForLog(u) {
  try {
    const url = new URL(u);
    const p = url.searchParams;
    if (p.has('ApiKey')) p.set('ApiKey', maskMiddle(p.get('ApiKey'), 3, 2));
    if (p.has('ApiUser')) p.set('ApiUser', maskMiddle(p.get('ApiUser'), 1, 0));
    if (p.has('UserName')) p.set('UserName', maskMiddle(p.get('UserName'), 1, 0));
    if (p.has('ClientIp')) p.set('ClientIp', 'x.x.x.x');
    return url.toString();
  } catch (_) {
    return u;
  }
}

async function fetchWithRetry(url, { retries = 3, backoffMs = 500, label } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'prices-bot/1.1' } });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.url = sanitizeUrlForLog(url);
        err.body = body.slice(0, 800);
        vlog(`[http] ${label || ''} GET ${sanitizeUrlForLog(url)} -> ${res.status}`);
        throw err;
      }
      vlog(`[http] ${label || ''} GET ${sanitizeUrlForLog(url)} -> ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        vlog(`[retry] attempt ${i + 1} failed for ${label || sanitizeUrlForLog(url)}: ${err.message}`);
        await delay(backoffMs * Math.pow(2, i));
      }
    }
  }
  throw lastErr;
}

async function ensureDir(p) {
  const dir = path.dirname(p);
  try {
    await fsp.mkdir(dir, { recursive: true });
  } catch (_) {}
}

async function readCache(cachePath, ttlMinutes) {
  try {
    const stat = await fsp.stat(cachePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs <= ttlMinutes * 60 * 1000) {
      const raw = await fsp.readFile(cachePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (_) {}
  return null;
}

async function writeCache(cachePath, data) {
  await ensureDir(cachePath);
  await fsp.writeFile(cachePath, JSON.stringify(data, null, 2), 'utf8');
}

function valBool(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1';
}

// -------------------- API calls --------------------
async function getTldListCached() {
  const cachePath = process.env.NAMECHEAP_TLD_CACHE || DEFAULT_CACHE_PATH;
  const ttlMin = Number(process.env.NAMECHEAP_TLD_CACHE_TTL_MINUTES || DEFAULT_TTL_MIN);
  vlog(`[tlds] cache path: ${cachePath} (ttl=${ttlMin}m)`);
  const cached = await readCache(cachePath, ttlMin);
  if (cached) {
    vlog(`[tlds] cache HIT: ${cached.tlds?.length ?? 0} tlds (fetched_at=${cached.meta?.fetched_at})`);
    return { cached: true, cachePath, ...cached };
  }

  const url = buildUrl('namecheap.domains.getTldList');
  vlog('[tlds] cache MISS — fetching fresh list');
  const res = await fetchWithRetry(url, { retries: 4, backoffMs: 700, label: 'tldList' });
  const xml = await res.text();

  const status = (xml.match(/<ApiResponse[^>]*Status="([^"]+)"/i) || [])[1];
  if (status !== 'OK') {
    const errMsg = ((xml.match(/<Errors>[\s\S]*?<Error[^>]*>([\s\S]*?)<\/Error>/i) || [])[1] || 'Unknown error').trim();
    const err = new Error(`getTldList failed: ${errMsg}`);
    err.response = { xmlSnippet: xml.slice(0, 1000) };
    throw err;
  }

  const tldsSection = (xml.match(/<Tlds>([\s\S]*?)<\/Tlds>/i) || [])[1] || '';
  const tldRe = /<Tld\b([^>]*)>([\s\S]*?)<\/Tld>/gi;
  const tlds = [];
  const attrs = {};
  let m;
  while ((m = tldRe.exec(tldsSection)) !== null) {
    const attrStr = m[1] || '';
    const a = Object.fromEntries(Array.from(attrStr.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)).map(x => [x[1], x[2]]));
    const name = a.Name;
    if (!name) continue;
    tlds.push(name);
    attrs[name] = {
      NonRealTime: valBool(a.NonRealTime),
      MinRegisterYears: Number(a.MinRegisterYears || 0) || 0,
      MaxRegisterYears: Number(a.MaxRegisterYears || 0) || 0,
      MinRenewYears: Number(a.MinRenewYears || 0) || 0,
      MaxRenewYears: Number(a.MaxRenewYears || 0) || 0,
      MinTransferYears: Number(a.MinTransferYears || 0) || 0,
      MaxTransferYears: Number(a.MaxTransferYears || 0) || 0,
      IsApiRegisterable: valBool(a.IsApiRegisterable),
      IsApiRenewable: valBool(a.IsApiRenewable),
      IsApiTransferable: valBool(a.IsApiTransferable),
      IsEppRequired: valBool(a.IsEppRequired),
      IsSupportsIDN: valBool(a.IsSupportsIDN),
      Type: a.Type || null,
      Category: a.Category || null,
    };
  }
  const payload = { meta: { fetched_at: new Date().toISOString() }, tlds, attrs };
  vlog(`[tlds] fetched ${tlds.length} TLDs from API`);
  await writeCache(cachePath, payload);
  return { cached: false, cachePath, ...payload };
}

function priceFromAttrs(a) {
  if (!a) return null;
  const val = a.Price ?? a.YourPrice ?? a.RetailPrice ?? a.RegularPrice ?? a.CurrentPrice;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function actionToKey(action) {
  const a = String(action || '').toUpperCase();
  if (a === 'REGISTER') return 'create';
  if (a === 'RENEW') return 'renew';
  if (a === 'TRANSFER') return 'transfer';
  if (a === 'REACTIVATE' || a === 'RESTORE') return 'restore';
  return null;
}

function categoryToKey(name) {
  const a = String(name || '').toUpperCase();
  if (a === 'REGISTER') return 'create';
  if (a === 'RENEW') return 'renew';
  if (a === 'TRANSFER') return 'transfer';
  if (a === 'REACTIVATE') return 'restore';
  return null;
}

async function getPricingByAction(action /* REGISTER | RENEW | TRANSFER | REACTIVATE */) {
  const params = { ProductType: 'DOMAIN' };
  if (action) params.ActionName = action;
  const url = buildUrl('namecheap.users.getPricing', params);
  vlog(`[pricing] fetching ${action || 'ALL'} pricing`);
  const res = await fetchWithRetry(url, { retries: 4, backoffMs: 700, label: `pricing:${action || 'ALL'}` });
  const xml = await res.text();

  const status = (xml.match(/<ApiResponse[^>]*Status="([^"]+)"/i) || [])[1];
  if (status !== 'OK') {
    const errMsg = ((xml.match(/<Errors>[\s\S]*?<Error[^>]*>([\s\S]*?)<\/Error>/i) || [])[1] || 'Unknown error').trim();
    const err = new Error(`getPricing(${action || 'ALL'}) failed: ${errMsg}`);
    err.response = { xmlSnippet: xml.slice(0, 1000) };
    throw err;
  }
  const sale = {};     // YourPrice -> sale-price
  const regular = {};  // RegularPrice/RetailPrice/Price -> regular-price
  let currency = 'USD';

  // Extract only ProductType Name="DOMAIN" blocks
  const ptRe = /<ProductType\b([^>]*)>([\s\S]*?)<\/ProductType>/gi;
  let m;
  while ((m = ptRe.exec(xml)) !== null) {
    const attrsStr = m[1] || '';
    const body = m[2] || '';
    const a = Object.fromEntries(Array.from(attrsStr.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)).map(x => [x[1], x[2]]));
    const ptName = String(a.Name || '').toUpperCase();
    if (ptName !== 'DOMAIN' && ptName !== 'DOMAINS') continue;

    // Within ProductType, there are ProductCategory blocks (e.g., register, renew)
    const catRe = /<ProductCategory\b([^>]*)>([\s\S]*?)<\/ProductCategory>/gi;
    let cm;
    while ((cm = catRe.exec(body)) !== null) {
      const cAttrStr = cm[1] || '';
      const cBody = cm[2] || '';
      const ca = Object.fromEntries(Array.from(cAttrStr.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)).map(x => [x[1], x[2]]));
      const opKey = categoryToKey(ca.Name);
      // If category name isn't recognized, fallback to function arg (ActionName) if present
      const effectiveKey = opKey || actionToKey(action);
      if (!effectiveKey) continue;

      // Find products (TLDs) within the category
      const prodRe = /<Product\b([^>]*)>([\s\S]*?)<\/Product>/gi;
      let pm;
      while ((pm = prodRe.exec(cBody)) !== null) {
        const pAttrStr = pm[1] || '';
        const pBody = pm[2] || '';
        const pa = Object.fromEntries(Array.from(pAttrStr.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)).map(x => [x[1], x[2]]));
        const tld = pa.Name;
        if (!tld) continue;

        const priceRe = /<Price\b([^>]*)\/>/gi;
        let pr;
        while ((pr = priceRe.exec(pBody)) !== null) {
          const prAttrStr = pr[1] || '';
          const prA = Object.fromEntries(Array.from(prAttrStr.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)).map(x => [x[1], x[2]]));
          const duration = Number(prA.Duration ?? prA.DurationRangeStart ?? 0);
          const durationType = String(prA.DurationType || '').toUpperCase();
          if (duration !== 1 || (durationType && durationType !== 'YEAR')) continue;
          const userPrice = Number(prA.YourPrice);
          const retail = Number(prA.RegularPrice ?? prA.RetailPrice ?? prA.Price);
          currency = prA.Currency || currency;
          if (!sale[tld]) sale[tld] = {};
          if (!regular[tld]) regular[tld] = {};
          if (Number.isFinite(userPrice)) sale[tld][effectiveKey] = userPrice;
          if (Number.isFinite(retail)) regular[tld][effectiveKey] = retail;
        }
      }
    }
  }
  const tldCount = new Set([...Object.keys(sale), ...Object.keys(regular)]).size;
  vlog(`[pricing] ${action || 'ALL'}: found ${tldCount} TLD price entries`);
  return { sale, regular, currency };
}

function mergePriceMaps(into, from) {
  for (const [tld, map] of Object.entries(from)) {
    if (!into[tld]) into[tld] = {};
    for (const [k, v] of Object.entries(map)) into[tld][k] = v;
  }
  return into;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ------------------------------ main ------------------------------
async function main() {
  console.log('Generating Namecheap prices from API...');
  const args = parseArgs(process.argv);
  VERBOSE = !!args.verbose;
  const outPathEnv = process.env.NAMECHEAP_OUT_PATH || process.env.OUT_PATH;
  const outPath = args.outPath || outPathEnv || DEFAULT_OUT;

  // Validate env early to give actionable errors
  requireEnv('NAMECHEAP_API_USER');
  requireEnv('NAMECHEAP_API_KEY');
  requireEnv('NAMECHEAP_USERNAME');
  requireEnv('NAMECHEAP_CLIENT_IP');

  vlog(`[init] base URL: ${getBaseUrl()}`);
  vlog(`[init] verbose mode on`);
  vlog(`[init] output: ${outPath}`);
  console.log(`[init] output: ${outPath}`);

  const { cached: tldCached, cachePath: tldCachePath, tlds, attrs } = await getTldListCached();

  const actions = ['REGISTER', 'RENEW', 'TRANSFER', 'REACTIVATE'];
  const combinedSale = {};
  const combinedRegular = {};
  let currency = 'USD';
  for (const act of actions) {
    const { sale, regular, currency: cur } = await getPricingByAction(act);
    currency = cur || currency;
    mergePriceMaps(combinedSale, sale);
    mergePriceMaps(combinedRegular, regular);
  }

  // Reduce to API-registerable TLDs and build openprovider-like structure
  const allTlds = new Set([...Object.keys(combinedSale), ...Object.keys(combinedRegular)]);
  const data = {};
  for (const tld of allTlds) {
    const info = attrs[tld] || {};
    if (Object.prototype.hasOwnProperty.call(info, 'IsApiRegisterable') && !info.IsApiRegisterable) continue;
    const saleMap = combinedSale[tld] || {};
    const regularMap = combinedRegular[tld] || {};
    if (!Object.keys(saleMap).length && !Object.keys(regularMap).length) continue;

    const maxYears = Math.max(
      info.MaxRegisterYears || 0,
      info.MaxRenewYears || 0,
      info.MaxTransferYears || 0,
    );

    data[tld] = {
      maxYears: maxYears || 0,
      'regular-price': regularMap,
      'sale-price': saleMap,
    };
  }
  vlog(`[done] merged ${allTlds.size} TLDs -> output ${Object.keys(data).length} TLDs`);

  const result = {
    meta: {
      source: 'Namecheap API',
      endpoint: getBaseUrl() + '/xml.response',
      generated_at: new Date().toISOString(),
      actions_fetched: actions,
      currency,
      tlds_total: tlds.length,
      tlds_in_output: Object.keys(data).length,
      tld_cache_used: tldCached,
      tld_cache_path: tldCachePath,
      notes: 'Year=1 prices only. Output mirrors openprovider structure with regular-price and sale-price maps.',
    },
    data,
  };

  await ensureDir(outPath);
  await fsp.writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`Saved Namecheap prices to: ${outPath}`);
}

main().catch((err) => {
  console.error('Failed:', err?.message || err);
  if (VERBOSE && err?.url) console.error('[url]', err.url);
  if (VERBOSE && err?.status) console.error('[status]', err.status);
  if (VERBOSE && err?.body) console.error('[body]', err.body);
  if (err?.response) {
    try { console.error(JSON.stringify(err.response, null, 2)); } catch (_) {}
  }
  process.exit(1);
});
