import {
  Logger,
  RegistrarParams,
  RegistrarPricelist,
  TldPricing,
  XRegistrar,
} from './registrars/base.js';
import { NamecheapRegistrar, type NamecheapParams } from './registrars/namecheap.js';
import { OpenproviderRegistrar, type OpenproviderParams } from './registrars/openprovider.js';
import { NiraRegistrar, type NiraParams } from './registrars/nira.js';
import { RegistrarConfig, type RegistrarId } from './config.js';
import {
  datasets,
  dataFiles,
  buildPriceIndex,
  getCreatePrice,
  type PriceIndex,
  type PriceIndexEntry,
} from './pricing.js';

interface RegistrarDefinition<P extends RegistrarParams> {
  id: RegistrarId;
  label: string;
  isAvailable: (config: RegistrarConfig) => boolean;
  create: (config: RegistrarConfig, options: RegistrarFactoryOptions) => XRegistrar<P, any, any>;
}

export interface RegistrarFactoryOptions {
  cacheDir?: string;
  logger?: Logger;
}

export interface GeneratePricelistsOptions {
  registrars?: RegistrarId[];
  ttl?: number;
  cacheDir?: string;
  logger?: Logger;
  config?: RegistrarConfig;
}

export type GenerateResult = Record<RegistrarId, RegistrarPricelist>;

const registrarDefinitions: Record<RegistrarId, RegistrarDefinition<RegistrarParams>> = {
  namecheap: {
    id: 'namecheap',
    label: 'Namecheap',
    isAvailable: (config) => config.isRegistrarEnabled('namecheap'),
    create: (config, { cacheDir, logger }) => {
      const params = config.getNamecheapParams({ cacheDir, logger });
      return new NamecheapRegistrar(params, { cacheDir, logger });
    },
  },
  openprovider: {
    id: 'openprovider',
    label: 'OpenProvider',
    isAvailable: (config) => config.isRegistrarEnabled('openprovider'),
    create: (config, { cacheDir, logger }) => {
      const params = config.getOpenproviderParams({ cacheDir, logger });
      return new OpenproviderRegistrar(params, { cacheDir, logger });
    },
  },
  nira: {
    id: 'nira',
    label: 'NIRA',
    isAvailable: (config) => config.isRegistrarEnabled('nira'),
    create: (config, { cacheDir, logger }) => {
      const params = config.getNiraParams({ cacheDir, logger });
      return new NiraRegistrar(params, { cacheDir, logger });
    },
  },
};

export interface RegistrarInfo {
  id: RegistrarId;
  label: string;
  available: boolean;
}

export function listRegistrars(config: RegistrarConfig = RegistrarConfig.fromEnv(process.env)): RegistrarInfo[] {
  return Object.values(registrarDefinitions).map((definition) => ({
    id: definition.id,
    label: definition.label,
    available: definition.isAvailable(config),
  }));
}

export async function generatePricelists({
  registrars,
  ttl = Infinity,
  cacheDir,
  logger,
  config,
}: GeneratePricelistsOptions = {}): Promise<GenerateResult> {
  const resolvedConfig = config ?? RegistrarConfig.fromEnv(process.env, { cacheDir, logger });
  const availableDefinitions = Object.values(registrarDefinitions).filter((definition) => definition.isAvailable(resolvedConfig));
  const ids = (registrars && registrars.length)
    ? registrars
    : availableDefinitions.map((definition) => definition.id);

  const tasks = ids.map(async (id) => {
    const definition = registrarDefinitions[id];
    if (!definition) {
      throw new Error(`Unknown registrar: ${id}`);
    }
    if (!definition.isAvailable(resolvedConfig)) {
      throw new Error(`Registrar "${id}" is not configured for this environment.`);
    }
    const registrar = definition.create(resolvedConfig, {
      cacheDir,
      logger,
    });
    const result = await registrar.getPricelist(ttl);
    return [id, result] as const;
  });

  const entries = await Promise.all(tasks);
  return Object.fromEntries(entries) as GenerateResult;
}

export { datasets, dataFiles, buildPriceIndex, getCreatePrice, type PriceIndex, type PriceIndexEntry };

export async function writePricelistsToDirectory(
  results: Record<string, RegistrarPricelist>,
  outDir: string,
): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(outDir, { recursive: true });
  await Promise.all(
    Object.values(results).map(async (result) => {
      const filePath = path.join(outDir, `${result.registrarId}-prices.json`);
      await fs.writeFile(filePath, JSON.stringify(result, null, 2));
    }),
  );
}

export {
  NamecheapRegistrar,
  type NamecheapParams,
  OpenproviderRegistrar,
  type OpenproviderParams,
  NiraRegistrar,
  type NiraParams,
  RegistrarConfig,
  type RegistrarId,
  XRegistrar,
  type RegistrarParams,
  type RegistrarPricelist,
  type TldPricing,
};
