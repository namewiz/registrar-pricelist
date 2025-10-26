import namecheapGenerator from './namecheap.js';
import niraGenerator from './nira.js';
import openproviderGenerator from './openprovider.js';
export { generateUnifiedList, generateCheapestOpRows, rowsToCsv } from './unified.js';

export const registrarGenerators = [namecheapGenerator, niraGenerator, openproviderGenerator];

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
