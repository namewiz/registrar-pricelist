import { createRegistrarPriceGenerator } from '../registrar-generator.js';
import { fetchWithRetry } from '../http.js';

const COUNTRY_API_URL_DEFAULT = 'https://restcountries.com/v3.1/all?fields=cca2,currencies';
const EXCHANGE_RATES_URL_DEFAULT = 'https://www.floatrates.com/daily/usd.json';

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

    const [countriesRes, ratesRes] = await Promise.all([
      fetchWithRetry(countryApiUrl, { retries: 4, backoffMs: 700, signal, logger }),
      fetchWithRetry(ratesUrl, { retries: 4, backoffMs: 700, signal, logger }),
    ]);

    const [countries, rates] = await Promise.all([countriesRes.json(), ratesRes.json()]);

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
          exchangeRate: rateInfo.rate,
          inverseRate: rateInfo.inverseRate,
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
