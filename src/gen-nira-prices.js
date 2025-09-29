#!/usr/bin/env node
import 'dotenv/config';
// gen-nira-prices.js (ESM)
// -------------------------------------------------------------
// Generates a simple price list for NIRA namespaces with prices
// expressed in USD, derived from fixed NGN list prices and the
// latest USD->NGN FX rate fetched at runtime.
//
// Usage:
//   node src/gen-nira-prices.js [outPath]
//   # example:
//   node src/gen-nira-prices.js data/nira-prices.json
// -------------------------------------------------------------

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const OUT_DEFAULT = path.join('data', 'nira-prices.json');
const FX_URL_DEFAULT = 'https://www.floatrates.com/daily/usd.json';

// Static NGN list prices (registration)
const NGN_PRICES = {
  'ng': 15000,
  'com.ng': 7000,
  'org.ng': 7000,
  'name.ng': 400,
};

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

function formatNaira(n) {
  // Use plain N prefix with comma grouping (no currency symbol required)
  return `N${Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function main() {
  const [, , outPathArg] = process.argv;
  const outPathEnv = process.env.NIRA_OUT_PATH || process.env.OUT_PATH;
  const fxEnv = process.env.NIRA_FX_URL;
  const outPath = outPathArg || outPathEnv || OUT_DEFAULT;
  const fxUrl = fxEnv || FX_URL_DEFAULT;

  const fxRes = await fetchWithRetry(fxUrl, { retries: 4, backoffMs: 700 });
  const fxJson = await fxRes.json();
  const ngnEntry = fxJson?.ngn || fxJson?.NGN || fxJson?.['ngn'] || fxJson?.['NGN'];
  const ngnPerUsd = ngnEntry?.rate;
  if (!ngnPerUsd || !Number.isFinite(ngnPerUsd)) {
    throw new Error('Could not determine NGN per USD from FloatRates response.');
  }

  const data = {};
  for (const [tld, ngn] of Object.entries(NGN_PRICES)) {
    const usd = round2(ngn / ngnPerUsd);
    data[tld] = { create: usd, renew: usd };
  }

  const result = {
    meta: {
      source: 'manual-nira-pricelist',
      generated_at: new Date().toISOString(),
      fx_source: fxUrl,
      exchange: `1 USD => ${formatNaira(ngnPerUsd)}`,
      notes: 'USD prices for 1-year create/renew derived from NGN list via FX.',
    },
    data,
  };

  const json = JSON.stringify(result, null, 2);
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, json, 'utf8');
  console.log(`Saved NIRA USD prices to: ${outPath}`);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
