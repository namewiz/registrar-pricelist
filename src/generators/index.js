import namecheapGenerator from './namecheap.js';
import namesiloGenerator from './namesilo.js';
import niraGenerator from './nira.js';
import openproviderGenerator from './openprovider.js';
export { generateUnifiedList, generateCheapestOpRows, rowsToCsv, generateCatalogRows, catalogRowsToCsv } from './unified.js';

export const registrarGenerators = [namecheapGenerator, namesiloGenerator, niraGenerator, openproviderGenerator];

export const registrarGeneratorMap = Object.fromEntries(
  registrarGenerators.map((generator) => [generator.id, generator]),
);

export function listRegistrarIds() {
  return registrarGenerators.map((generator) => generator.id);
}

export function getRegistrarGenerator(id) {
  return registrarGeneratorMap[id] || null;
}

export default registrarGenerators;
