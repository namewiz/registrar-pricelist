export { RegistrarPriceGenerator, createRegistrarPriceGenerator } from './core/registrar-generator.js';
export { fetchWithRetry } from './core/http.js';
export { registrarGenerators, registrarGeneratorMap, listRegistrarIds, getRegistrarGenerator } from './generators/index.js';

import namecheapPrices from '../data/namecheap-prices.json' assert { type: 'json' };
import niraPrices from '../data/nira-prices.json' assert { type: 'json' };
import openproviderPrices from '../data/openprovider-prices.json' assert { type: 'json' };

export const dataFiles = {
  namecheap: namecheapPrices,
  nira: niraPrices,
  openprovider: openproviderPrices,
};

export { namecheapPrices, niraPrices, openproviderPrices };
