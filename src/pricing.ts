import namecheapSnapshot from '../data/namecheap-prices.json' with { type: 'json' };
import openproviderSnapshot from '../data/openprovider-prices.json' with { type: 'json' };
import niraSnapshot from '../data/nira-prices.json' with { type: 'json' };
import type { RegistrarId } from './config.js';
import type { RegistrarPricelist, TldPricing } from './registrars/base.js';

interface LegacyPriceEntry {
  maxYears?: number;
  [band: string]: any;
}

interface LegacyDataset {
  meta?: Record<string, any>;
  data?: Record<string, LegacyPriceEntry>;
}

function convertLegacyDataset(
  id: RegistrarId,
  label: string,
  fallbackCurrency: string,
  fallbackSource: string,
  dataset: LegacyDataset,
): RegistrarPricelist {
  const data = dataset.data ?? {};
  const items: TldPricing[] = [];
  for (const [tld, entry] of Object.entries(data)) {
    const bands: TldPricing['bands'] = [];
    for (const [key, value] of Object.entries(entry)) {
      if (key.endsWith('-price') && value && typeof value === 'object') {
        bands.push({
          id: key.replace(/-price$/, ''),
          label: key.replace(/-price$/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          operations: value,
        });
      }
    }
    if (!bands.length) continue;
    items.push({
      tld,
      maxYears: entry.maxYears,
      bands,
    });
  }

  const meta = dataset.meta ?? {};
  const currency = typeof meta.currency === 'string' ? meta.currency : fallbackCurrency;
  const source = typeof meta.source === 'string' ? meta.source : fallbackSource;

  return {
    registrarId: id,
    registrarName: label,
    currency,
    fetchedAt: meta.generated_at ?? meta.fetched_at ?? new Date().toISOString(),
    source,
    items,
    meta,
  };
}

export const datasets: Record<RegistrarId, RegistrarPricelist> = {
  namecheap: convertLegacyDataset('namecheap', 'Namecheap', 'USD', 'Namecheap API', namecheapSnapshot as LegacyDataset),
  openprovider: convertLegacyDataset('openprovider', 'OpenProvider', 'EUR', 'OpenProvider Sheet', openproviderSnapshot as LegacyDataset),
  nira: convertLegacyDataset('nira', 'NIRA', 'USD', 'NIRA FX', niraSnapshot as LegacyDataset),
};

export const dataFiles = datasets;

export function getCreatePrice(entry: TldPricing | undefined): number | undefined {
  if (!entry) return undefined;
  for (const band of entry.bands) {
    if (typeof band.operations.create === 'number') {
      return band.operations.create;
    }
  }
  for (const band of entry.bands) {
    if (typeof band.operations.renew === 'number') {
      return band.operations.renew;
    }
  }
  return undefined;
}

export interface PriceIndexEntry {
  maxYears?: number;
  prices: Record<RegistrarId, number>;
}

export type PriceIndex = Record<string, PriceIndexEntry>;

export function buildPriceIndex(pricelists: Partial<Record<RegistrarId, RegistrarPricelist>>): PriceIndex {
  const index: PriceIndex = {};
  for (const [id, list] of Object.entries(pricelists) as [RegistrarId, RegistrarPricelist][]) {
    if (!list) continue;
    for (const item of list.items) {
      if (!index[item.tld]) {
        index[item.tld] = { maxYears: item.maxYears, prices: {} as Record<RegistrarId, number> };
      }
      const current = index[item.tld];
      if (typeof item.maxYears === 'number') {
        current.maxYears = Math.max(current.maxYears ?? 0, item.maxYears ?? 0) || item.maxYears;
      }
      const price = getCreatePrice(item);
      if (typeof price === 'number' && Number.isFinite(price)) {
        current.prices[id] = price;
      }
    }
  }
  return index;
}
