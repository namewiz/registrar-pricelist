// Lightweight browser-facing bundle that exposes registrar metadata,
// embedded datasets (JSON), and helpers to prepare a comparison index.

import namecheapData from '../../data/namecheap-prices.json' assert { type: 'json' };
import openproviderData from '../../data/openprovider-prices.json' assert { type: 'json' };
import niraData from '../../data/nira-prices.json' assert { type: 'json' };

export const registrars = [
  { key: 'namecheap', label: 'Namecheap' },
  { key: 'openprovider', label: 'OpenProvider' },
  { key: 'nira', label: 'NIRA' },
];

export const datasets = {
  namecheap: namecheapData,
  openprovider: openproviderData,
  nira: niraData,
};

export function getCreatePrice(entry) {
  if (!entry) return undefined;
  const rp = entry['regular-price'] || {};
  if (typeof rp.create === 'number') return rp.create;
  if (typeof rp.renew === 'number') return rp.renew;
  return undefined;
}

// Build unified index: { [tld]: { maxYears, prices: { [registrarKey]: number } } }
export function buildPriceIndex({ namecheap, openprovider, nira } = datasets) {
  const index = {};
  const addFrom = (key, data) => {
    if (!data || !data.data) return;
    for (const [tld, entry] of Object.entries(data.data)) {
      if (!index[tld]) index[tld] = { maxYears: undefined, prices: {} };
      const my = typeof entry.maxYears === 'number' ? entry.maxYears : undefined;
      if (Number.isFinite(my)) index[tld].maxYears = Math.max(index[tld].maxYears || 0, my);
      const p = getCreatePrice(entry);
      if (typeof p === 'number' && Number.isFinite(p)) index[tld].prices[key] = p;
    }
  };

  addFrom('namecheap', namecheap);
  addFrom('openprovider', openprovider);
  addFrom('nira', nira);

  return index;
}

export default { registrars, datasets, buildPriceIndex, getCreatePrice };

