import { createRegistrarPriceGenerator } from '../registrar-generator.js';
import { fetchWithRetry } from '../http.js';

const DEFAULT_BASE_URL = 'https://www.namesilo.com/api';
const OPERATIONS = { registration: 'create', renew: 'renew', transfer: 'transfer' };

function toPrice(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}

/**
 * Maps a getPrices reply to the shared price-list shape. Every key of `reply` other than
 * `code` and `detail` is a TLD whose value holds `registration`, `renew` and `transfer` in USD.
 */
export function mapNamesiloPrices(reply) {
  const code = Number(reply?.code);
  if (code !== 300) {
    throw new Error(`NameSilo getPrices failed: ${reply?.code} ${reply?.detail ?? ''}`.trim());
  }
  const data = {};
  for (const [key, prices] of Object.entries(reply)) {
    if (key === 'code' || key === 'detail' || !prices || typeof prices !== 'object') continue;
    const regular = {};
    for (const [field, op] of Object.entries(OPERATIONS)) {
      const amount = toPrice(prices[field]);
      if (amount !== undefined) regular[op] = amount;
    }
    if (regular.create === undefined) continue;
    data[key.toLowerCase().replace(/^\./, '')] = { 'regular-price': regular };
  }
  return data;
}

export const namesiloGenerator = createRegistrarPriceGenerator({
  id: 'namesilo',
  label: 'NameSilo',
  defaultOutput: 'namesilo-prices.json',
  async generate(context = {}) {
    const logger = context.logger || (() => {});
    const key = context.options?.apiKey || context.env?.NAMESILO_API_KEY;
    if (!key) {
      const err = new Error('Missing required credential: NAMESILO_API_KEY');
      err.code = 'EENV';
      throw err;
    }
    const baseUrl = (context.options?.baseUrl || context.env?.NAMESILO_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const url = new URL(`${baseUrl}/getPrices`);
    url.searchParams.set('version', '1');
    url.searchParams.set('type', 'json');
    url.searchParams.set('key', key);

    logger({ level: 'info', message: `[namesilo] Fetching ${baseUrl}/getPrices` });
    const res = await fetchWithRetry(url, { signal: context.signal, logger });
    const body = await res.json();
    const data = mapNamesiloPrices(body?.reply);

    return {
      meta: {
        source: 'NameSilo API',
        endpoint: `${baseUrl}/getPrices`,
        generated_at: new Date().toISOString(),
        currency: 'USD',
        tlds_in_output: Object.keys(data).length,
        notes: "Year=1 prices at this account's price level.",
      },
      data,
    };
  },
});

export default namesiloGenerator;
