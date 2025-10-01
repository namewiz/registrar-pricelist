import { createRegistrarPriceGenerator } from '../core/registrar-generator.js';
import { fetchWithRetry } from '../core/http.js';

const FX_URL_DEFAULT = 'https://www.floatrates.com/daily/usd.json';

const NGN_PRICES = {
  'ng': 15000,
  'com.ng': 7000,
  'org.ng': 7000,
  'name.ng': 400,
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

function formatNaira(n) {
  return `N${Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

export const niraGenerator = createRegistrarPriceGenerator({
  id: 'nira',
  label: 'NIRA',
  defaultOutput: 'nira-prices.json',
  async generate({ env = {}, options = {}, logger, signal } = {}) {
    const fxUrl = options.fxUrl || env.NIRA_FX_URL || FX_URL_DEFAULT;
    logger({ level: 'info', message: `Fetching FX rate from ${fxUrl}` });
    const fxRes = await fetchWithRetry(fxUrl, { retries: 4, backoffMs: 700, signal, logger });
    const fxJson = await fxRes.json();
    const ngnEntry = fxJson?.ngn || fxJson?.NGN || fxJson?.['ngn'] || fxJson?.['NGN'];
    const ngnPerUsd = ngnEntry?.rate;
    if (!ngnPerUsd || !Number.isFinite(ngnPerUsd)) {
      throw new Error('Could not determine NGN per USD from FloatRates response.');
    }

    const data = {};
    for (const [tld, ngnPrice] of Object.entries(NGN_PRICES)) {
      const usd = round2(ngnPrice / ngnPerUsd);
      data[tld] = { 'regular-price': { create: usd, renew: usd } };
    }

    return {
      meta: {
        source: 'manual-nira-pricelist',
        generated_at: new Date().toISOString(),
        fx_source: fxUrl,
        exchange: `1 USD => ${formatNaira(ngnPerUsd)}`,
        notes: 'USD prices for 1-year create/renew derived from NGN list via FX.',
      },
      data,
    };
  },
});

export default niraGenerator;
