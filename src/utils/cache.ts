import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface CacheEntry<T> {
  cachedAt: string;
  payload: T;
}

export interface CacheOptions {
  cacheDir?: string;
}

export class PersistentCache<T> {
  private readonly filePath: string;

  constructor(private readonly key: string, private readonly options: CacheOptions = {}) {
    const dir = this.options.cacheDir ?? path.resolve(process.cwd(), 'data');
    this.filePath = path.join(dir, `${this.key}.json`);
  }

  async read(): Promise<CacheEntry<T> | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as CacheEntry<T>;
      if (!parsed.cachedAt) {
        return null;
      }
      return parsed;
    } catch (err: any) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        return null;
      }
      throw err;
    }
  }

  async write(entry: CacheEntry<T>): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(entry, null, 2));
  }

  getFilePath(): string {
    return this.filePath;
  }
}
