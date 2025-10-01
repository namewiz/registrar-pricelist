import { createRegistrarPriceGenerator } from '../core/registrar-generator.js';
import { fetchWithRetry } from '../core/http.js';

const REQUIRED_CREDENTIALS = [
  'NAMECHEAP_API_USER',
  'NAMECHEAP_API_KEY',
  'NAMECHEAP_USERNAME',
  'NAMECHEAP_CLIENT_IP',
];

const ACTIONS = ['REGISTER', 'RENEW', 'TRANSFER', 'REACTIVATE'];

function mask(value, keepStart = 2, keepEnd = 2) {
  if (!value) return '';
  const str = String(value);
  if (str.length <= keepStart + keepEnd) return '*'.repeat(str.length);
  return `${str.slice(0, keepStart)}***${str.slice(-keepEnd)}`;
}

function sanitizeUrl(url) {
  try {
    const parsed = new URL(url);
    const p = parsed.searchParams;
    if (p.has('ApiKey')) p.set('ApiKey', mask(p.get('ApiKey'), 3, 2));
    if (p.has('ApiUser')) p.set('ApiUser', mask(p.get('ApiUser'), 1, 0));
    if (p.has('UserName')) p.set('UserName', mask(p.get('UserName'), 1, 0));
    if (p.has('ClientIp')) p.set('ClientIp', 'x.x.x.x');
    return parsed.toString();
  } catch (_) {
    return url;
  }
}

function valBool(value) {
  if (value === undefined || value === null) return false;
  const str = String(value).trim().toLowerCase();
  return str === 'true' || str === 'yes' || str === '1';
}

function getCredentials(context) {
  const credentials = { ...(context.options?.credentials || {}) };
  for (const key of REQUIRED_CREDENTIALS) {
    if (!credentials[key] && context.env && context.env[key]) {
      credentials[key] = context.env[key];
    }
    if (!credentials[key]) {
      const err = new Error(`Missing required credential: ${key}`);
      err.code = 'EENV';
      throw err;
    }
  }
  return credentials;
}

function getBaseUrl(context) {
  if (context.options?.baseUrl) return context.options.baseUrl.replace(/\/$/, '');
  const sandbox = context.options?.sandbox ?? (context.env?.NAMECHEAP_SANDBOX === '1' || /true/i.test(context.env?.NAMECHEAP_SANDBOX || ''));
  const override = context.env?.NAMECHEAP_BASE_URL;
  if (override) return override.replace(/\/$/, '');
  return sandbox ? 'https://api.sandbox.namecheap.com' : 'https://api.namecheap.com';
}

function buildUrl(context, command, extraParams = {}) {
  const creds = getCredentials(context);
  const base = getBaseUrl(context);
  const url = new URL(base + '/xml.response');
  const params = {
    ApiUser: creds.NAMECHEAP_API_USER,
    ApiKey: creds.NAMECHEAP_API_KEY,
    UserName: creds.NAMECHEAP_USERNAME,
    ClientIp: creds.NAMECHEAP_CLIENT_IP,
    Command: command,
    ...extraParams,
  };
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchXml(context, command, params = {}) {
  const url = buildUrl(context, command, params);
  const logger = context.logger || (() => {});
  logger({ level: 'info', message: `[namecheap] GET ${sanitizeUrl(url)}` });
  const res = await fetchWithRetry(url, { retries: 4, backoffMs: 700, signal: context.signal, logger });
  return res.text();
}

function parseAttributes(str) {
  return Object.fromEntries(Array.from(str.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)).map((match) => [match[1], match[2]]));
}

async function getTldMetadata(context) {
  const xml = await fetchXml(context, 'namecheap.domains.getTldList');
  const status = (xml.match(/<ApiResponse[^>]*Status="([^"]+)"/i) || [])[1];
  if (status !== 'OK') {
    const msg = ((xml.match(/<Errors>[\s\S]*?<Error[^>]*>([\s\S]*?)<\/Error>/i) || [])[1] || 'Unknown error').trim();
    const err = new Error(`namecheap.domains.getTldList failed: ${msg}`);
    err.response = { xmlSnippet: xml.slice(0, 800) };
    throw err;
  }
  const tlds = [];
  const attrs = {};
  const tldSection = (xml.match(/<Tlds>([\s\S]*?)<\/Tlds>/i) || [])[1] || '';
  const tldRe = /<Tld\b([^>]*)>([\s\S]*?)<\/Tld>/gi;
  let match;
  while ((match = tldRe.exec(tldSection)) !== null) {
    const attrStr = match[1] || '';
    const parsed = parseAttributes(attrStr);
    const name = parsed.Name;
    if (!name) continue;
    tlds.push(name);
    attrs[name] = {
      NonRealTime: valBool(parsed.NonRealTime),
      MinRegisterYears: Number(parsed.MinRegisterYears || 0) || 0,
      MaxRegisterYears: Number(parsed.MaxRegisterYears || 0) || 0,
      MinRenewYears: Number(parsed.MinRenewYears || 0) || 0,
      MaxRenewYears: Number(parsed.MaxRenewYears || 0) || 0,
      MinTransferYears: Number(parsed.MinTransferYears || 0) || 0,
      MaxTransferYears: Number(parsed.MaxTransferYears || 0) || 0,
      IsApiRegisterable: valBool(parsed.IsApiRegisterable),
      IsApiRenewable: valBool(parsed.IsApiRenewable),
      IsApiTransferable: valBool(parsed.IsApiTransferable),
      IsEppRequired: valBool(parsed.IsEppRequired),
      IsSupportsIDN: valBool(parsed.IsSupportsIDN),
      Type: parsed.Type || null,
      Category: parsed.Category || null,
    };
  }
  return { tlds, attrs, fetched_at: new Date().toISOString() };
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

function mergeMaps(target, source) {
  for (const [tld, map] of Object.entries(source)) {
    if (!target[tld]) target[tld] = {};
    for (const [k, v] of Object.entries(map)) {
      target[tld][k] = v;
    }
  }
}

async function getPricingForAction(context, action) {
  const xml = await fetchXml(context, 'namecheap.users.getPricing', {
    ProductType: 'DOMAIN',
    ActionName: action,
  });
  const status = (xml.match(/<ApiResponse[^>]*Status="([^"]+)"/i) || [])[1];
  if (status !== 'OK') {
    const errMsg = ((xml.match(/<Errors>[\s\S]*?<Error[^>]*>([\s\S]*?)<\/Error>/i) || [])[1] || 'Unknown error').trim();
    const err = new Error(`namecheap.users.getPricing(${action}) failed: ${errMsg}`);
    err.response = { xmlSnippet: xml.slice(0, 800) };
    throw err;
  }
  const sale = {};
  const regular = {};
  let currency = 'USD';
  const productTypeRe = /<ProductType\b([^>]*)>([\s\S]*?)<\/ProductType>/gi;
  let ptMatch;
  while ((ptMatch = productTypeRe.exec(xml)) !== null) {
    const attrsStr = ptMatch[1] || '';
    const body = ptMatch[2] || '';
    const attrs = parseAttributes(attrsStr);
    const ptName = String(attrs.Name || '').toUpperCase();
    if (ptName !== 'DOMAIN' && ptName !== 'DOMAINS') continue;
    const categoryRe = /<ProductCategory\b([^>]*)>([\s\S]*?)<\/ProductCategory>/gi;
    let catMatch;
    while ((catMatch = categoryRe.exec(body)) !== null) {
      const catAttrs = parseAttributes(catMatch[1] || '');
      const catBody = catMatch[2] || '';
      const opKey = categoryToKey(catAttrs.Name) || actionToKey(action);
      if (!opKey) continue;
      const productRe = /<Product\b([^>]*)>([\s\S]*?)<\/Product>/gi;
      let prodMatch;
      while ((prodMatch = productRe.exec(catBody)) !== null) {
        const prodAttrs = parseAttributes(prodMatch[1] || '');
        const tld = prodAttrs.Name;
        if (!tld) continue;
        const priceRe = /<Price\b([^>]*)\/>/gi;
        let priceMatch;
        while ((priceMatch = priceRe.exec(prodMatch[2] || '')) !== null) {
          const priceAttrs = parseAttributes(priceMatch[1] || '');
          const duration = Number(priceAttrs.Duration ?? priceAttrs.DurationRangeStart ?? 0);
          const durationType = String(priceAttrs.DurationType || '').toUpperCase();
          if (duration !== 1 || (durationType && durationType !== 'YEAR')) continue;
          const userPrice = Number(priceAttrs.YourPrice);
          const retail = Number(priceAttrs.RegularPrice ?? priceAttrs.RetailPrice ?? priceAttrs.Price);
          currency = priceAttrs.Currency || currency;
          if (!sale[tld]) sale[tld] = {};
          if (!regular[tld]) regular[tld] = {};
          if (Number.isFinite(userPrice)) sale[tld][opKey] = userPrice;
          if (Number.isFinite(retail)) regular[tld][opKey] = retail;
        }
      }
    }
  }
  return { sale, regular, currency };
}

export const namecheapGenerator = createRegistrarPriceGenerator({
  id: 'namecheap',
  label: 'Namecheap',
  defaultOutput: 'namecheap-prices.json',
  async generate(context = {}) {
    const logger = context.logger || (() => {});
    const credentials = getCredentials(context);
    logger({ level: 'info', message: `[namecheap] Using account ${mask(credentials.NAMECHEAP_USERNAME, 1, 0)}` });

    const { tlds, attrs, fetched_at } = await getTldMetadata(context);

    const combinedSale = {};
    const combinedRegular = {};
    let currency = 'USD';
    for (const action of ACTIONS) {
      const { sale, regular, currency: cur } = await getPricingForAction(context, action);
      currency = cur || currency;
      mergeMaps(combinedSale, sale);
      mergeMaps(combinedRegular, regular);
    }

    const allTlds = new Set([...Object.keys(combinedSale), ...Object.keys(combinedRegular)]);
    const data = {};
    for (const tld of allTlds) {
      const info = attrs[tld] || {};
      if (Object.prototype.hasOwnProperty.call(info, 'IsApiRegisterable') && !info.IsApiRegisterable) continue;
      const saleMap = combinedSale[tld] || {};
      const regularMap = combinedRegular[tld] || {};
      if (!Object.keys(saleMap).length && !Object.keys(regularMap).length) continue;
      const maxYears = Math.max(info.MaxRegisterYears || 0, info.MaxRenewYears || 0, info.MaxTransferYears || 0);
      data[tld] = {
        maxYears: maxYears || 0,
        'regular-price': regularMap,
        'sale-price': saleMap,
      };
    }

    return {
      meta: {
        source: 'Namecheap API',
        endpoint: `${getBaseUrl(context)}/xml.response`,
        generated_at: new Date().toISOString(),
        actions_fetched: ACTIONS,
        currency,
        tlds_total: tlds.length,
        tlds_in_output: Object.keys(data).length,
        tld_metadata_fetched_at: fetched_at,
        notes: 'Year=1 prices only. Output mirrors OpenProvider structure with regular-price and sale-price maps.',
      },
      data,
    };
  },
});

export default namecheapGenerator;
