/**
 * Unified list generator: combines outputs of registrar generators into
 * a single JSON array of TLD entries. Each entry contains:
 * - provider: registrar id
 * - tld: TLD string
 * - regular-price: map of operations to numeric prices (year=1)
 *
 * Rules:
 * - If a TLD appears in multiple sources, pick the provider with the
 *   cheapest create price when available; otherwise choose the minimum
 *   price among available operations.
 * - Only regular-price maps are considered; member/sale/etc. are ignored.
 * - Output keys are deterministically sorted to avoid noisy diffs.
 */

function sortObjectKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  const out = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortObjectKeys(obj[key]);
  }
  return out;
}

function normalizeRegularPriceMap(map) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [op, v] of Object.entries(map)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[op] = n;
  }
  // Ensure deterministic op ordering
  return sortObjectKeys(out);
}

function deriveBaseCurrency(result) {
  const raw = result?.meta?.currency;
  if (typeof raw === 'string' && raw.trim()) return raw.trim().toUpperCase();
  return null;
}

function collectCurrencyRegularPriceMaps(result, tld) {
  const extras = {};
  if (!result || typeof result !== 'object') return extras;
  for (const [maybeCurrency, currencyMap] of Object.entries(result)) {
    if (!/^[A-Z]{3}$/.test(maybeCurrency)) continue;
    const entry = currencyMap && typeof currencyMap === 'object' ? currencyMap[tld] : null;
    if (!entry || typeof entry !== 'object') continue;
    const regular = normalizeRegularPriceMap(entry['regular-price']);
    if (regular && Object.keys(regular).length > 0) {
      extras[maybeCurrency] = { 'regular-price': regular };
    }
  }
  return extras;
}

function cheapestMetric(regularMap) {
  // Prefer create price when present; else use the minimum among values
  if (!regularMap || typeof regularMap !== 'object') return Number.POSITIVE_INFINITY;
  if (Number.isFinite(regularMap.create)) return Number(regularMap.create);
  let min = Number.POSITIVE_INFINITY;
  for (const v of Object.values(regularMap)) {
    const n = Number(v);
    if (Number.isFinite(n) && n < min) min = n;
  }
  return min;
}

/**
 * Build the unified list array from registrar results.
 *
 * @param {Object<string, { meta?: any, data?: Record<string, any> }>} resultsByRegistrar
 *   Map of registrar id -> generator result ({ meta, data }).
 * @param {Object} [options]
 * @param {string[]} [options.providers]
 *   Optional subset of registrar ids to include; defaults to all in results.
 * @returns {Array<{ provider: string, tld: string, 'regular-price': Record<string, number> }>} unified list
 */
export function generateUnifiedList(resultsByRegistrar, options = {}) {
  const include = (options.providers && options.providers.length)
    ? options.providers
    : Object.keys(resultsByRegistrar || {});

  /** @type {Record<string, { provider: string, tld: string, 'regular-price': Record<string, number> }[]>} */
  const candidatesByTld = {};

  for (const provider of include) {
    const result = resultsByRegistrar[provider];
    if (!result || !result.data || typeof result.data !== 'object') continue;
    const baseCurrency = deriveBaseCurrency(result) || undefined;
    for (const [tld, entry] of Object.entries(result.data)) {
      const regular = normalizeRegularPriceMap(entry?.['regular-price']);
      if (!regular || Object.keys(regular).length === 0) continue;
      if (!candidatesByTld[tld]) candidatesByTld[tld] = [];
      // Construct entry with predictable key order via sortObjectKeys later
      const candidate = { provider, tld, 'regular-price': regular };
      if (baseCurrency) candidate.currency = baseCurrency;
      const currencyExtras = collectCurrencyRegularPriceMaps(result, tld);
      if (currencyExtras && Object.keys(currencyExtras).length > 0) {
        candidate.currencies = currencyExtras;
      }
      candidatesByTld[tld].push(candidate);
    }
  }

  /** @type {Array<{ provider: string, tld: string, 'regular-price': Record<string, number> }>} */
  const selected = [];
  for (const tld of Object.keys(candidatesByTld)) {
    const options = candidatesByTld[tld];
    if (!options || options.length === 0) continue;
    let best = options[0];
    let bestMetric = cheapestMetric(best['regular-price']);
    for (let i = 1; i < options.length; i++) {
      const cand = options[i];
      const metric = cheapestMetric(cand['regular-price']);
      if (metric < bestMetric || (metric === bestMetric && String(cand.provider) < String(best.provider))) {
        best = cand;
        bestMetric = metric;
      }
    }
    // Sort keys for stable output
    selected.push(sortObjectKeys(best));
  }

  // Deterministic ordering of array items by tld (then provider as tie-breaker)
  selected.sort((a, b) => (a.tld === b.tld ? (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0) : (a.tld < b.tld ? -1 : 1)));

  return selected;
}

export default generateUnifiedList;

// --- Optimized CSV helpers ---

function collectCandidatesByTld(resultsByRegistrar, providers) {
  const include = (providers && providers.length) ? providers : Object.keys(resultsByRegistrar || {});
  const candidatesByTld = {};
  for (const provider of include) {
    const result = resultsByRegistrar[provider];
    if (!result || !result.data || typeof result.data !== 'object') continue;
    const baseCurrency = deriveBaseCurrency(result) || undefined;
    for (const [tld, entry] of Object.entries(result.data)) {
      const regular = normalizeRegularPriceMap(entry?.['regular-price']);
      if (!regular || Object.keys(regular).length === 0) continue;
      if (!candidatesByTld[tld]) candidatesByTld[tld] = [];
      const candidate = { provider, tld, 'regular-price': regular };
      if (baseCurrency) candidate.currency = baseCurrency;
      const currencyExtras = collectCurrencyRegularPriceMaps(result, tld);
      if (currencyExtras && Object.keys(currencyExtras).length > 0) {
        candidate.currencies = currencyExtras;
      }
      candidatesByTld[tld].push(candidate);
    }
  }
  return candidatesByTld;
}

/**
 * Build cheapest rows for a specific operation (e.g., 'create' or 'renew').
 * Rows are objects with tld, provider, currency, amount so additional
 * currencies can be appended without changing the shape.
 */
export function generateCheapestOpRows(resultsByRegistrar, op, providers) {
  const candidatesByTld = collectCandidatesByTld(resultsByRegistrar, providers);
  const rows = [];
  for (const tld of Object.keys(candidatesByTld)) {
    const list = candidatesByTld[tld];
    let best = null;
    let bestPrice = Number.POSITIVE_INFINITY;
    for (const cand of list) {
      const price = Number(cand['regular-price']?.[op]);
      if (!Number.isFinite(price)) continue;
      if (price < bestPrice || (price === bestPrice && String(cand.provider) < String(best?.provider || ''))) {
        best = cand;
        bestPrice = price;
      }
    }
    const baseCurrency = best?.currency || 'USD';
    if (best) {
      rows.push({
        tld,
        provider: best.provider,
        currency: baseCurrency,
        amount: bestPrice,
      });
    }
    const byCurrency = new Map();
    for (const cand of list) {
      const currencies = cand.currencies || {};
      for (const [code, entry] of Object.entries(currencies)) {
        const price = Number(entry?.['regular-price']?.[op]);
        if (!Number.isFinite(price)) continue;
        const existing = byCurrency.get(code);
        if (!existing || price < existing.price || (price === existing.price && String(cand.provider) < String(existing.candidate.provider))) {
          byCurrency.set(code, { candidate: cand, price });
        }
      }
    }
    const baseCodeUpper = typeof baseCurrency === 'string' ? baseCurrency.toUpperCase() : '';
    for (const code of Array.from(byCurrency.keys()).sort()) {
      if (code === baseCodeUpper) continue;
      const entry = byCurrency.get(code);
      if (!entry) continue;
      rows.push({
        tld,
        provider: entry.candidate.provider,
        currency: code,
        amount: entry.price,
      });
    }
  }
  rows.sort((a, b) => {
    if (a.tld !== b.tld) return a.tld < b.tld ? -1 : 1;
    if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1;
    if (a.provider !== b.provider) return a.provider < b.provider ? -1 : 1;
    return 0;
  });
  return rows;
}

export function rowsToCsv(rows) {
  const header = 'tld,provider,currency,amount';
  const body = rows.map((row) => `${row.tld},${row.provider},${row.currency},${row.amount}`);
  return [header, ...body].join('\n');
}
