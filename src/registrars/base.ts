import { PersistentCache } from '../utils/cache.js';

export interface LogEntry {
  level?: 'info' | 'warn' | 'error' | string;
  message: string;
}

export type Logger = (entry: LogEntry) => void;

export interface OperationPrices {
  create?: number;
  renew?: number;
  transfer?: number;
  restore?: number;
}

export interface PriceBand {
  id: string;
  label: string;
  operations: OperationPrices;
}

export interface TldPricing {
  tld: string;
  maxYears?: number;
  bands: PriceBand[];
  extras?: Record<string, unknown>;
}

export interface RegistrarPricelist {
  registrarId: string;
  registrarName: string;
  currency: string;
  fetchedAt: string;
  source: string;
  items: TldPricing[];
  meta?: Record<string, unknown>;
}

export interface RegistrarParams {
  cacheDir?: string;
  logger?: Logger;
}

export interface RegistrarOptions {
  cacheDir?: string;
  logger?: Logger;
}

export abstract class XRegistrar<P extends RegistrarParams, TRaw, TParsed> {
  protected readonly cache: PersistentCache<RegistrarPricelist>;
  protected readonly logger: Logger;

  constructor(protected readonly params: P, options: RegistrarOptions = {}) {
    const cacheDir = options.cacheDir ?? params.cacheDir;
    this.cache = new PersistentCache<RegistrarPricelist>(this.getCacheKey(), { cacheDir });
    this.logger = options.logger || params.logger || (() => {});
  }

  protected log(message: string, level: LogEntry['level'] = 'info'): void {
    this.logger({ level, message });
  }

  protected abstract getCacheKey(): string;
  abstract readonly id: string;
  abstract readonly label: string;

  protected abstract fetch(): Promise<TRaw>;
  protected abstract parse(raw: TRaw): Promise<TParsed>;
  protected abstract map(parsed: TParsed): Promise<RegistrarPricelist>;

  protected touch(pricelist: RegistrarPricelist): RegistrarPricelist {
    return { ...pricelist, fetchedAt: new Date().toISOString() };
  }

  async getPricelist(ttl = Infinity): Promise<RegistrarPricelist> {
    const cached = await this.cache.read();

    if (ttl === Infinity) {
      if (cached) {
        return cached.payload;
      }
    } else if (ttl > 0 && Number.isFinite(ttl)) {
      if (cached) {
        const age = Date.now() - Date.parse(cached.cachedAt);
        if (age <= ttl) {
          return cached.payload;
        }
      }
    } else if (ttl !== 0 && cached) {
      return cached.payload;
    }

    const raw = await this.fetch();
    const parsed = await this.parse(raw);
    const mapped = this.touch(await this.map(parsed));
    await this.cache.write({ cachedAt: mapped.fetchedAt, payload: mapped });
    return mapped;
  }
}
