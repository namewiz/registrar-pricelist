import { fetchWithRetry } from '../utils/http.js';
import { RegistrarParams, RegistrarPricelist, TldPricing, XRegistrar } from './base.js';

export interface NamecheapParams extends RegistrarParams {
  apiUser: string;
  apiKey: string;
  username: string;
  clientIp: string;
  sandbox?: boolean;
  baseUrl?: string;
}

interface NamecheapRaw {
  metadataXml: string;
  pricingXml: Record<string, string>;
}

interface NamecheapParsedTldMeta {
  NonRealTime: boolean;
  MinRegisterYears: number;
  MaxRegisterYears: number;
  MinRenewYears: number;
  MaxRenewYears: number;
  MinTransferYears: number;
  MaxTransferYears: number;
  IsApiRegisterable: boolean;
  IsApiRenewable: boolean;
  IsApiTransferable: boolean;
  IsEppRequired: boolean;
  IsSupportsIDN: boolean;
  Type: string | null;
  Category: string | null;
}

interface NamecheapParsedPricing {
  regular: Record<string, Record<string, number>>;
  sale: Record<string, Record<string, number>>;
  currency: string;
}

interface NamecheapParsed {
  fetchedAt: string;
  tldMetadata: Record<string, NamecheapParsedTldMeta>;
  pricing: NamecheapParsedPricing;
}

function mask(value: string | number | undefined, keepStart = 2, keepEnd = 2): string {
  if (!value) return '';
  const str = String(value);
  if (str.length <= keepStart + keepEnd) return '*'.repeat(str.length);
  return `${str.slice(0, keepStart)}***${str.slice(-keepEnd)}`;
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const p = parsed.searchParams;
    if (p.has('ApiKey')) p.set('ApiKey', mask(p.get('ApiKey') ?? '', 3, 2));
    if (p.has('ApiUser')) p.set('ApiUser', mask(p.get('ApiUser') ?? '', 1, 0));
    if (p.has('UserName')) p.set('UserName', mask(p.get('UserName') ?? '', 1, 0));
    if (p.has('ClientIp')) p.set('ClientIp', 'x.x.x.x');
    return parsed.toString();
  } catch {
    return url;
  }
}

function parseAttributes(str: string): Record<string, string> {
  return Object.fromEntries(Array.from(str.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)).map((match) => [match[1], match[2]]));
}

function valBool(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return false;
  const str = String(value).trim().toLowerCase();
  return str === 'true' || str === 'yes' || str === '1';
}

function actionToKey(action: string): 'create' | 'renew' | 'transfer' | 'restore' | null {
  const a = action.toUpperCase();
  if (a === 'REGISTER') return 'create';
  if (a === 'RENEW') return 'renew';
  if (a === 'TRANSFER') return 'transfer';
  if (a === 'REACTIVATE' || a === 'RESTORE') return 'restore';
  return null;
}

function categoryToKey(name: string): 'create' | 'renew' | 'transfer' | 'restore' | null {
  const a = name.toUpperCase();
  if (a === 'REGISTER') return 'create';
  if (a === 'RENEW') return 'renew';
  if (a === 'TRANSFER') return 'transfer';
  if (a === 'REACTIVATE') return 'restore';
  return null;
}

const ACTIONS = ['REGISTER', 'RENEW', 'TRANSFER', 'REACTIVATE'] as const;

export class NamecheapRegistrar extends XRegistrar<NamecheapParams, NamecheapRaw, NamecheapParsed> {
  readonly id = 'namecheap';
  readonly label = 'Namecheap';

  protected getCacheKey(): string {
    return 'namecheap-prices';
  }

  private getBaseUrl(): string {
    if (this.params.baseUrl) {
      return this.params.baseUrl.replace(/\/$/, '');
    }
    return this.params.sandbox ? 'https://api.sandbox.namecheap.com' : 'https://api.namecheap.com';
  }

  private buildUrl(command: string, extra: Record<string, string | number> = {}): string {
    const base = this.getBaseUrl();
    const url = new URL(base + '/xml.response');
    const params: Record<string, string | number> = {
      ApiUser: this.params.apiUser,
      ApiKey: this.params.apiKey,
      UserName: this.params.username,
      ClientIp: this.params.clientIp,
      Command: command,
      ...extra,
    };
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async fetchXml(command: string, params: Record<string, string | number> = {}): Promise<string> {
    const url = this.buildUrl(command, params);
    this.log(`[namecheap] GET ${sanitizeUrl(url)}`);
    const res = await fetchWithRetry(url, { retries: 4, backoffMs: 700, logger: this.logger });
    return await res.text();
  }

  protected async fetch(): Promise<NamecheapRaw> {
    const metadataXml = await this.fetchXml('namecheap.domains.getTldList');
    const pricingXml: Record<string, string> = {};
    for (const action of ACTIONS) {
      pricingXml[action] = await this.fetchXml('namecheap.users.getPricing', {
        ProductType: 'DOMAIN',
        ActionName: action,
      });
    }
    return { metadataXml, pricingXml };
  }

  protected async parse(raw: NamecheapRaw): Promise<NamecheapParsed> {
    const tldMetadata = this.parseTldMetadata(raw.metadataXml);
    const pricing = this.parsePricing(raw.pricingXml);
    return {
      fetchedAt: new Date().toISOString(),
      tldMetadata,
      pricing,
    };
  }

  protected async map(parsed: NamecheapParsed): Promise<RegistrarPricelist> {
    const items: TldPricing[] = [];
    const { regular, sale } = parsed.pricing;
    const knownTlds = new Set([
      ...Object.keys(parsed.tldMetadata),
      ...Object.keys(regular),
      ...Object.keys(sale),
    ]);

    for (const tld of Array.from(knownTlds).sort()) {
      const meta = parsed.tldMetadata[tld];
      const maxYears = meta?.MaxRegisterYears || meta?.MaxRenewYears || undefined;
      const bands = [];
      if (regular[tld]) {
        bands.push({ id: 'regular', label: 'Regular price', operations: regular[tld] });
      }
      if (sale[tld]) {
        bands.push({ id: 'sale', label: 'Sale price', operations: sale[tld] });
      }
      if (!bands.length) continue;
      items.push({
        tld,
        maxYears,
        bands,
        extras: meta ? { ...meta } : undefined,
      });
    }

    return {
      registrarId: this.id,
      registrarName: this.label,
      currency: parsed.pricing.currency,
      fetchedAt: parsed.fetchedAt,
      source: this.getBaseUrl(),
      items,
      meta: {
        actions: ACTIONS,
      },
    };
  }

  private parseTldMetadata(xml: string): Record<string, NamecheapParsedTldMeta> {
    const status = (xml.match(/<ApiResponse[^>]*Status="([^"]+)"/i) || [])[1];
    if (status !== 'OK') {
      const msg = ((xml.match(/<Errors>[\s\S]*?<Error[^>]*>([\s\S]*?)<\/Error>/i) || [])[1] || 'Unknown error').trim();
      throw new Error(`namecheap.domains.getTldList failed: ${msg}`);
    }
    const tldSection = (xml.match(/<Tlds>([\s\S]*?)<\/Tlds>/i) || [])[1] || '';
    const tldRe = /<Tld\b([^>]*)>([\s\S]*?)<\/Tld>/gi;
    const result: Record<string, NamecheapParsedTldMeta> = {};
    let match: RegExpExecArray | null;
    while ((match = tldRe.exec(tldSection)) !== null) {
      const attrStr = match[1] || '';
      const parsed = parseAttributes(attrStr);
      const name = parsed.Name;
      if (!name) continue;
      result[name] = {
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
    return result;
  }

  private parsePricing(pricingXml: Record<string, string>): NamecheapParsedPricing {
    const regular: Record<string, Record<string, number>> = {};
    const sale: Record<string, Record<string, number>> = {};
    let currency = 'USD';

    for (const action of ACTIONS) {
      const xml = pricingXml[action];
      const status = (xml.match(/<ApiResponse[^>]*Status="([^"]+)"/i) || [])[1];
      if (status !== 'OK') {
        const errMsg = ((xml.match(/<Errors>[\s\S]*?<Error[^>]*>([\s\S]*?)<\/Error>/i) || [])[1] || 'Unknown error').trim();
        throw new Error(`namecheap.users.getPricing(${action}) failed: ${errMsg}`);
      }
      const productTypeRe = /<ProductType\b([^>]*)>([\s\S]*?)<\/ProductType>/gi;
      let ptMatch: RegExpExecArray | null;
      while ((ptMatch = productTypeRe.exec(xml)) !== null) {
        const attrsStr = ptMatch[1] || '';
        const body = ptMatch[2] || '';
        const attrs = parseAttributes(attrsStr);
        const ptName = String(attrs.Name || '').toUpperCase();
        if (ptName !== 'DOMAIN' && ptName !== 'DOMAINS') continue;
        const categoryRe = /<ProductCategory\b([^>]*)>([\s\S]*?)<\/ProductCategory>/gi;
        let catMatch: RegExpExecArray | null;
        while ((catMatch = categoryRe.exec(body)) !== null) {
          const catAttrs = parseAttributes(catMatch[1] || '');
          const catBody = catMatch[2] || '';
          const opKey = categoryToKey(catAttrs.Name || '') || actionToKey(action);
          if (!opKey) continue;
          const productRe = /<Product\b([^>]*)>([\s\S]*?)<\/Product>/gi;
          let prodMatch: RegExpExecArray | null;
          while ((prodMatch = productRe.exec(catBody)) !== null) {
            const prodAttrs = parseAttributes(prodMatch[1] || '');
            const tld = prodAttrs.Name;
            if (!tld) continue;
            const priceRe = /<Price\b([^>]*)\/>/gi;
            let priceMatch: RegExpExecArray | null;
            while ((priceMatch = priceRe.exec(prodMatch[2] || '')) !== null) {
              const priceAttrs = parseAttributes(priceMatch[1] || '');
              const duration = Number(priceAttrs.Duration ?? priceAttrs.DurationRangeStart ?? 0);
              if (duration && duration !== 1) continue;
              const amount = Number(priceAttrs.Price ?? priceAttrs.RegularPrice ?? priceAttrs.RetailPrice ?? 0);
              if (!Number.isFinite(amount) || amount <= 0) continue;
              currency = priceAttrs.Currency || currency;
              const priceType = String(priceAttrs.PriceType || '').toLowerCase();
              const target = priceType === 'sale' ? sale : regular;
              if (!target[tld]) target[tld] = {};
              target[tld][opKey] = amount;
            }
          }
        }
      }
    }

    return { regular, sale, currency };
  }
}
