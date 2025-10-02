import { fetchWithRetry } from '../utils/http.js';
import { RegistrarParams, RegistrarPricelist, TldPricing, XRegistrar } from './base.js';

export const DEFAULT_NIRA_FX_URL = 'https://www.floatrates.com/daily/usd.json';

const NGN_PRICES: Record<string, number> = {
  'ng': 15000,
  'com.ng': 7000,
  'org.ng': 7000,
  'name.ng': 400,
};

export interface NiraParams extends RegistrarParams {
  fxUrl?: string;
}

interface NiraRaw {
  fxUrl: string;
  fxData: Record<string, any>;
}

interface NiraParsed {
  fxUrl: string;
  ngnPerUsd: number;
  fetchedAt: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatNaira(n: number): string {
  return `N${Number(n).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

export class NiraRegistrar extends XRegistrar<NiraParams, NiraRaw, NiraParsed> {
  readonly id = 'nira';
  readonly label = 'NIRA';

  protected getCacheKey(): string {
    return 'nira-prices';
  }

  protected async fetch(): Promise<NiraRaw> {
    const fxUrl = this.params.fxUrl ?? DEFAULT_NIRA_FX_URL;
    this.log(`[nira] GET ${fxUrl}`);
    const fxRes = await fetchWithRetry(fxUrl, { retries: 4, backoffMs: 700, logger: this.logger });
    const fxData = await fxRes.json();
    return { fxUrl, fxData };
  }

  protected async parse(raw: NiraRaw): Promise<NiraParsed> {
    const entry = raw.fxData?.ngn || raw.fxData?.NGN || raw.fxData?.['ngn'] || raw.fxData?.['NGN'];
    const rate = Number(entry?.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('Could not determine NGN per USD from FX response.');
    }
    return {
      fxUrl: raw.fxUrl,
      ngnPerUsd: rate,
      fetchedAt: new Date().toISOString(),
    };
  }

  protected async map(parsed: NiraParsed): Promise<RegistrarPricelist> {
    const items: TldPricing[] = [];
    for (const [tld, ngnPrice] of Object.entries(NGN_PRICES)) {
      const usd = round2(ngnPrice / parsed.ngnPerUsd);
      items.push({
        tld,
        bands: [
          {
            id: 'regular',
            label: 'Regular price',
            operations: { create: usd, renew: usd },
          },
        ],
      });
    }
    return {
      registrarId: this.id,
      registrarName: this.label,
      currency: 'USD',
      fetchedAt: parsed.fetchedAt,
      source: parsed.fxUrl,
      items,
      meta: {
        exchange: `1 USD => ${formatNaira(parsed.ngnPerUsd)}`,
        notes: 'USD prices derived from NGN list using live FX rate.',
      },
    };
  }
}
