import type { Logger } from './registrars/base.js';
import type { NamecheapParams } from './registrars/namecheap.js';
import type { OpenproviderParams } from './registrars/openprovider.js';
import { DEFAULT_OPENPROVIDER_SHEET_URL } from './registrars/openprovider.js';
import type { NiraParams } from './registrars/nira.js';
import { DEFAULT_NIRA_FX_URL } from './registrars/nira.js';

export type RegistrarId = 'namecheap' | 'openprovider' | 'nira';

export interface RegistrarConfigOverrides {
  cacheDir?: string;
  logger?: Logger;
  namecheap?: Partial<NamecheapParams> | false;
  openprovider?: Partial<OpenproviderParams> | false;
  nira?: Partial<NiraParams> | false;
}

interface RegistrarConfigInit {
  cacheDir?: string;
  logger?: Logger;
  namecheap?: NamecheapParams;
  openprovider?: OpenproviderParams;
  nira?: NiraParams;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  const str = String(value).trim().toLowerCase();
  return str === '1' || str === 'true' || str === 'yes' || str === 'on';
}

function mergeParams<P extends { cacheDir?: string; logger?: Logger }>(
  base: P,
  fallbackCacheDir?: string,
  fallbackLogger?: Logger,
  overrides: Partial<P> = {},
): P {
  return {
    ...base,
    ...overrides,
    cacheDir: overrides.cacheDir ?? base.cacheDir ?? fallbackCacheDir,
    logger: overrides.logger ?? base.logger ?? fallbackLogger,
  };
}

export class RegistrarConfig implements NamecheapParams, OpenproviderParams, NiraParams {
  cacheDir?: string;
  logger?: Logger;

  private readonly namecheap?: NamecheapParams;
  private readonly openprovider?: OpenproviderParams;
  private readonly nira?: NiraParams;

  constructor(init: RegistrarConfigInit = {}) {
    this.cacheDir = init.cacheDir;
    this.logger = init.logger;
    this.namecheap = init.namecheap ? { ...init.namecheap } : undefined;
    this.openprovider = init.openprovider ? { ...init.openprovider } : undefined;
    this.nira = init.nira ? { ...init.nira } : undefined;
  }

  static fromEnv(env: NodeJS.ProcessEnv, overrides: RegistrarConfigOverrides = {}): RegistrarConfig {
    const cacheDir = overrides.cacheDir;
    const logger = overrides.logger;

    const namecheapOverride = overrides.namecheap;
    let namecheap: NamecheapParams | undefined;
    if (namecheapOverride !== false) {
      const apiUser = namecheapOverride?.apiUser ?? env.NAMECHEAP_API_USER;
      const apiKey = namecheapOverride?.apiKey ?? env.NAMECHEAP_API_KEY;
      const username = namecheapOverride?.username ?? env.NAMECHEAP_USERNAME;
      const clientIp = namecheapOverride?.clientIp ?? env.NAMECHEAP_CLIENT_IP;
      if (apiUser && apiKey && username && clientIp) {
        namecheap = mergeParams<NamecheapParams>(
          {
            apiUser,
            apiKey,
            username,
            clientIp,
            sandbox: namecheapOverride?.sandbox ?? parseBoolean(env.NAMECHEAP_SANDBOX),
            baseUrl: namecheapOverride?.baseUrl ?? env.NAMECHEAP_BASE_URL,
          },
          cacheDir,
          logger,
          namecheapOverride ?? {},
        );
      }
    }

    const openproviderOverride = overrides.openprovider;
    let openprovider: OpenproviderParams | undefined;
    if (openproviderOverride !== false) {
      const sheetUrl = openproviderOverride?.sheetUrl ?? env.OPENPROVIDER_SHEET_URL ?? DEFAULT_OPENPROVIDER_SHEET_URL;
      if (sheetUrl) {
        openprovider = mergeParams<OpenproviderParams>(
          { sheetUrl },
          cacheDir,
          logger,
          openproviderOverride ?? {},
        );
      }
    }

    const niraOverride = overrides.nira;
    let nira: NiraParams | undefined;
    if (niraOverride !== false) {
      const fxUrl = niraOverride?.fxUrl ?? env.NIRA_FX_URL ?? DEFAULT_NIRA_FX_URL;
      if (fxUrl) {
        nira = mergeParams<NiraParams>({ fxUrl }, cacheDir, logger, niraOverride ?? {});
      }
    }

    return new RegistrarConfig({ cacheDir, logger, namecheap, openprovider, nira });
  }

  isRegistrarEnabled(id: RegistrarId): boolean {
    if (id === 'namecheap') return Boolean(this.namecheap);
    if (id === 'openprovider') return Boolean(this.openprovider);
    if (id === 'nira') return Boolean(this.nira);
    return false;
  }

  enabledRegistrars(): RegistrarId[] {
    const ids: RegistrarId[] = ['namecheap', 'openprovider', 'nira'];
    return ids.filter((id): id is RegistrarId => this.isRegistrarEnabled(id));
  }

  private ensureNamecheap(): NamecheapParams {
    if (!this.namecheap) {
      throw new Error('Namecheap registrar is not configured.');
    }
    return mergeParams<NamecheapParams>(this.namecheap, this.cacheDir, this.logger);
  }

  private ensureOpenprovider(): OpenproviderParams {
    if (!this.openprovider) {
      throw new Error('OpenProvider registrar is not configured.');
    }
    return mergeParams<OpenproviderParams>(this.openprovider, this.cacheDir, this.logger);
  }

  private ensureNira(): NiraParams {
    if (!this.nira) {
      throw new Error('NIRA registrar is not configured.');
    }
    return mergeParams<NiraParams>(this.nira, this.cacheDir, this.logger);
  }

  getNamecheapParams(overrides: Partial<NamecheapParams> = {}): NamecheapParams {
    const base = this.ensureNamecheap();
    return mergeParams<NamecheapParams>(base, undefined, undefined, overrides);
  }

  getOpenproviderParams(overrides: Partial<OpenproviderParams> = {}): OpenproviderParams {
    const base = this.ensureOpenprovider();
    return mergeParams<OpenproviderParams>(base, undefined, undefined, overrides);
  }

  getNiraParams(overrides: Partial<NiraParams> = {}): NiraParams {
    const base = this.ensureNira();
    return mergeParams<NiraParams>(base, undefined, undefined, overrides);
  }

  get apiUser(): string {
    return this.ensureNamecheap().apiUser;
  }

  get apiKey(): string {
    return this.ensureNamecheap().apiKey;
  }

  get username(): string {
    return this.ensureNamecheap().username;
  }

  get clientIp(): string {
    return this.ensureNamecheap().clientIp;
  }

  get sandbox(): boolean {
    return this.ensureNamecheap().sandbox ?? false;
  }

  get baseUrl(): string | undefined {
    return this.ensureNamecheap().baseUrl;
  }

  get sheetUrl(): string | undefined {
    return this.ensureOpenprovider().sheetUrl;
  }

  get fxUrl(): string | undefined {
    return this.ensureNira().fxUrl;
  }
}
