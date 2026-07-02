import { createRegistrarPriceGenerator } from '../registrar-generator.js';
import { fetchWithRetry } from '../http.js';

const COUNTRY_API_URL_DEFAULT = 'https://api.restcountries.com/countries/v5';
const EXCHANGE_RATES_URL_DEFAULT = 'https://www.floatrates.com/daily/usd.json';

/**
 * Fetch all pages from REST Countries v5 API.
 */
async function fetchAllV5Countries(baseUrl, apiKey, { signal, logger } = {}) {
  let offset = 0;
  const limit = 100;
  const allObjects = [];
  const headers = {};
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  while (true) {
    const url = new URL(baseUrl);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('response_fields', 'codes.alpha_2,currencies');

    if (logger) {
      logger({ level: 'info', message: `Fetching v5 countries page: limit=${limit}, offset=${offset}` });
    }

    const res = await fetchWithRetry(url.toString(), {
      retries: 4,
      backoffMs: 700,
      headers,
      signal,
      logger,
    });
    const body = await res.json();
    const objects = body?.data?.objects;

    if (!Array.isArray(objects) || objects.length === 0) {
      break;
    }

    allObjects.push(...objects);
    if (objects.length < limit) {
      break;
    }
    offset += limit;
  }

  return { data: { objects: allObjects } };
}

/**
 * Normalize country metadata response to a uniform format.
 */
function parseCountryData(body) {
  if (body && typeof body === 'object' && body.data && Array.isArray(body.data.objects)) {
    const list = [];
    for (const country of body.data.objects) {
      const countryCode = country?.codes?.alpha_2;
      const currencies = country?.currencies;
      if (!countryCode || !Array.isArray(currencies)) continue;

      const mappedCurrencies = {};
      for (const cur of currencies) {
        if (cur && cur.code) {
          mappedCurrencies[cur.code] = {
            name: cur.name || '',
            symbol: cur.symbol || '',
          };
        }
      }
      list.push({
        cca2: countryCode,
        currencies: mappedCurrencies,
      });
    }
    return list;
  }

  if (Array.isArray(body)) {
    return body;
  }

  return [];
}

/**
 * Exchange rates generator
 *
 * Fetches country -> currency metadata and USD FX rates, then emits a flat list of
 * country/currency + rate records to exchange-rates.json.
 */
export const exchangeRatesGenerator = createRegistrarPriceGenerator({
  id: 'exchange-rates',
  label: 'Exchange Rates',
  defaultOutput: 'exchange-rates.json',
  async generate({ env = {}, options = {}, logger, signal } = {}) {
    const countryApiUrl = options.countryApiUrl || env.COUNTRY_API_URL || COUNTRY_API_URL_DEFAULT;
    const ratesUrl = options.exchangeRatesUrl || env.EXCHANGE_RATES_URL || EXCHANGE_RATES_URL_DEFAULT;

    logger({ level: 'info', message: `Fetching country metadata from ${countryApiUrl}` });
    logger({ level: 'info', message: `Fetching FX rates from ${ratesUrl}` });

    const isV5 = countryApiUrl.includes('/v5') || countryApiUrl.includes('api.restcountries.com');
    const apiKey = env.REST_COUNTRIES_API_KEY || env.RESTCOUNTRIES_API_KEY || options.restCountriesApiKey;

    let countriesPromise;
    if (isV5) {
      if (!apiKey) {
        if (logger) {
          logger({
            level: 'warn',
            message: 'No REST Countries API key found in environment (REST_COUNTRIES_API_KEY). ' +
                     'Falling back to keyless public clone of the country dataset.',
          });
        }
        const fallbackUrl = 'https://raw.githubusercontent.com/mledoze/countries/master/dist/countries.json';
        countriesPromise = fetchWithRetry(fallbackUrl, { retries: 4, backoffMs: 700, signal, logger })
          .then((res) => res.json());
      } else {
        countriesPromise = fetchAllV5Countries(countryApiUrl, apiKey, { signal, logger });
      }
    } else {
      countriesPromise = fetchWithRetry(countryApiUrl, { retries: 4, backoffMs: 700, signal, logger })
        .then((res) => res.json());
    }

    const [countriesData, ratesRes] = await Promise.all([
      countriesPromise,
      fetchWithRetry(ratesUrl, { retries: 4, backoffMs: 700, signal, logger }),
    ]);

    const [countries, rates] = await Promise.all([
      parseCountryData(countriesData),
      ratesRes.json(),
    ]);

    const results = [];

    for (const country of countries) {
      const countryCode = country?.cca2;
      const currencies = country?.currencies;
      if (!countryCode || !currencies || typeof currencies !== 'object') continue;

      for (const [currencyCode, details] of Object.entries(currencies)) {
        if (!currencyCode || !details) continue;
        const rateInfo = rates[currencyCode.toLowerCase()];
        if (!rateInfo) {
          if (logger) logger({ level: 'warn', message: `No rate found for ${currencyCode}` });
          continue;
        }
        results.push({
          countryCode,
          currencyName: details.name,
          currencySymbol: details.symbol,
          currencyCode,
          exchangeRate: Number(rateInfo.rate),
          inverseRate: Number(rateInfo.inverseRate),
        });
      }
    }

    // Ensure stable ordering for cleaner diffs: sort by country code, then currency code
    results.sort((a, b) => {
      const cc = String(a.countryCode).localeCompare(String(b.countryCode));
      if (cc !== 0) return cc;
      return String(a.currencyCode).localeCompare(String(b.currencyCode));
    });

    return results;
  },
});

export default exchangeRatesGenerator;

