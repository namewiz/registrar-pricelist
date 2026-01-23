import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRegistrarPriceGenerator } from '../registrar-generator.js';

const NGN_PRICES = {
  'ng': 13000,
  'com.ng': 6000,
  'org.ng': 6000,
  'net.ng': 6000,
  'mobi.ng': 6000,
  'i.ng': 6000,
  "sch.ng": 6000,
  "edu.ng": 6000,
  'name.ng': 400,
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

function formatNaira(n) {
  return `₦${Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

export const niraGenerator = createRegistrarPriceGenerator({
  id: 'nira',
  label: 'NIRA',
  defaultOutput: 'nira-prices.json',
  async generate({ env = {}, options = {}, logger, signal } = {}) {
    const ratesPath = options.exchangeRatesPath || env.EXCHANGE_RATES_PATH || 'data/exchange-rates.json';
    const resolvedRatesPath = path.resolve(process.cwd(), ratesPath);
    logger({ level: 'info', message: `Reading exchange rates from ${resolvedRatesPath}` });
    let ngnPerUsd;
    try {
      const raw = await fs.readFile(resolvedRatesPath, 'utf8');
      const entries = JSON.parse(raw);
      // entries is an array of { countryCode, currencyName, currencySymbol, currencyCode, exchangeRate, inverseRate }
      for (const entry of entries) {
        if ((entry.currencyCode || '').toUpperCase() === 'NGN') {
          ngnPerUsd = entry.exchangeRate;
          break;
        }
      }
    } catch (err) {
      const e = new Error(`Failed to read exchange rates at ${resolvedRatesPath}: ${err.message}`);
      e.cause = err;
      throw e;
    }
    if (!ngnPerUsd || !Number.isFinite(ngnPerUsd)) {
      throw new Error('Could not determine NGN per USD from exchange-rates.json.');
    }

    const exchangeRate = Number(Number(ngnPerUsd).toFixed(6));
    const data = {};
    const ngnData = {};
    for (const [tld, ngnPrice] of Object.entries(NGN_PRICES)) {
      const usd = round2(ngnPrice / ngnPerUsd);
      const regularUsd = { create: usd, renew: usd, transfer: usd };
      data[tld] = { 'regular-price': regularUsd };
      const naira = round2(ngnPrice);
      ngnData[tld] = { 'regular-price': { create: naira, renew: naira, transfer: naira } };
    }

    return {
      meta: {
        source: 'manual-nira-pricelist',
        generated_at: new Date().toISOString(),
        data_currency: 'USD',
        exchange_rate: exchangeRate,
        orig_currency: 'NGN',
      },
      data,
      NGN: ngnData,
    };
  },
});

export default niraGenerator;
