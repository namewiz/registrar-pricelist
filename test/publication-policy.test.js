import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateUnifiedList, generateCheapestOpRows, generateCatalogRows, catalogRowsFromOperationRows } from '../src/generators/unified.js';

function result(create, renew = create, currency = 'USD') {
  return {
    meta: { currency },
    data: { com: { 'regular-price': { create, renew, transfer: create } } },
  };
}

function publish(results, previous = {}, minPriceChangePercent = 1, providers) {
  const unified = generateUnifiedList(results, { providers, previous: previous.unified, minPriceChangePercent });
  const operationRows = Object.fromEntries(['create', 'renew', 'transfer'].map((op) => [
    op, generateCheapestOpRows(results, op, providers, { previous: previous.operationRows?.[op], minPriceChangePercent }),
  ]));
  return { unified, operationRows, catalogRows: catalogRowsFromOperationRows(operationRows) };
}

function checkPrice(publication, expected, provider = 'alpha') {
  assert.equal(publication.unified[0]['regular-price'].create, expected);
  assert.equal(publication.unified[0].provider, provider);
  assert.equal(publication.operationRows.create[0].amount, expected);
  assert.equal(publication.operationRows.create[0].provider, provider);
  assert.equal(publication.catalogRows.find((row) => row.product_variant === 'create').price_amount, expected);
}

for (const [current, expected] of [[10.09, 10], [9.91, 10], [10.1, 10.1], [9.9, 9.9], [10.11, 10.11], [9.89, 9.89]]) {
  test(`1% boundary: 10 → ${current} publishes ${expected}`, () => {
    const previous = publish({ alpha: result(10) });
    checkPrice(publish({ alpha: result(current) }, previous), expected);
  });
}

test('small changes accumulate against the last published price without mutating inputs', () => {
  let previous = publish({ alpha: result(10) });
  for (const price of [10.03, 10.06, 10.09, 10.12]) {
    const fetched = { alpha: result(price) };
    const before = structuredClone({ fetched, previous });
    const next = publish(fetched, previous);
    assert.deepEqual({ fetched, previous }, before);
    checkPrice(next, price === 10.12 ? 10.12 : 10);
    previous = next;
  }
  checkPrice(publish({ alpha: result(10.15) }, previous), 10.12);
});

test('custom percentages and zero bypass both price filtering and provider retention', () => {
  const previous = publish({ beta: result(10) });
  checkPrice(publish({ beta: result(10.15) }, previous, 2), 10, 'beta');
  checkPrice(publish({ beta: result(10.2) }, previous, 2), 10.2, 'beta');
  const results = { alpha: result(9.99), beta: result(10) };
  const next = publish(results, previous, 0);
  assert.deepEqual(next.unified, generateUnifiedList(results));
  for (const op of ['create', 'renew', 'transfer']) {
    assert.deepEqual(next.operationRows[op], generateCheapestOpRows(results, op));
  }
  assert.deepEqual(next.catalogRows, generateCatalogRows(results));
  checkPrice(publish({ alpha: result(10.01) }, publish({ alpha: result(10) }), 0), 10.01);
});

test('keeps incumbent for small savings or ties and switches at the savings boundary', () => {
  const previous = publish({ beta: result(10) });
  for (const amount of [10, 9.99, 9.91]) {
    checkPrice(publish({ alpha: result(amount), beta: result(10) }, previous), 10, 'beta');
  }
  const next = publish({ alpha: result(9.9), beta: result(10) }, previous);
  checkPrice(next, 9.9);
});

test('compares competitors to current incumbent prices, not its published price', () => {
  const previous = publish({ alpha: result(10) });
  checkPrice(publish({ alpha: result(12), beta: result(10.01) }, previous), 10.01, 'beta');
  // Incumbent itself can update while a slightly cheaper competitor is retained out.
  checkPrice(publish({ alpha: result(12), beta: result(11.99) }, previous), 12);
});

test('provider switches publish all new provider prices without retaining old amounts', () => {
  const previous = publish({ alpha: result(10, 20) });
  const next = publish({ alpha: result(12, 25), beta: result(10.01, 20.01) }, previous);
  assert.equal(next.unified[0]['regular-price'].renew, 20.01);
  assert.equal(next.operationRows.renew[0].amount, 20.01);
});

test('provider or operation removal immediately selects an eligible provider', () => {
  const previous = publish({ alpha: result(10) });
  checkPrice(publish({ beta: result(10.01) }, previous), 10.01, 'beta');
  const results = { alpha: result(10), beta: result(10.01) };
  delete results.alpha.data.com['regular-price'].create;
  const removed = publish(results, previous);
  // JSON still permits this provider via its existing minimum-operation fallback.
  assert.equal(removed.unified[0]['regular-price'].create, undefined);
  assert.deepEqual(removed.operationRows.create[0], { tld: 'com', provider: 'beta', currency: 'USD', amount: 10.01 });
  const subset = publish({ alpha: result(10), beta: result(10.01) }, previous, 1, ['beta']);
  checkPrice(subset, 10.01, 'beta');
});

test('JSON selects using its fallback metric while CSVs select per operation', () => {
  const results = { alpha: result(10, 20), beta: result(20, 10) };
  const previous = publish(results);
  assert.equal(previous.unified[0].provider, 'alpha');
  assert.equal(previous.operationRows.renew[0].provider, 'beta');
  delete results.alpha.data.com['regular-price'].create;
  delete results.beta.data.com['regular-price'].create;
  const fallback = publish(results);
  assert.equal(fallback.unified[0].provider, 'alpha'); // equal minimum, alphabetical tie
  results.beta.data.com['regular-price'].renew = 9.95;
  assert.equal(publish(results, fallback).unified[0].provider, 'alpha');
  results.beta.data.com['regular-price'].renew = 9.9;
  assert.equal(publish(results, fallback).unified[0].provider, 'beta');
});

test('zero prices, additions and removals do not require a percentage baseline', () => {
  const previous = publish({ alpha: result(0) });
  checkPrice(publish({ alpha: result(0) }, previous), 0);
  checkPrice(publish({ alpha: result(0.01) }, previous), 0.01);
  checkPrice(publish({ alpha: result(0) }, publish({ alpha: result(0.01) })), 0);
  const results = { alpha: result(10) };
  const before = publish(results);
  results.alpha.data.net = { 'regular-price': { create: 0.01 } };
  delete results.alpha.data.com['regular-price'].renew;
  const next = publish(results, before);
  assert.equal(next.unified.find((entry) => entry.tld === 'net')['regular-price'].create, 0.01);
  assert.equal(next.unified.find((entry) => entry.tld === 'com')['regular-price'].renew, undefined);
  assert.deepEqual(next.operationRows.renew, []);
  assert.deepEqual(publish({}, before).unified, []);
  assert.deepEqual(publish({}, before).operationRows.create, []);
});

test('currencies are filtered independently; base currency changes reset the baseline', () => {
  const results = { alpha: result(10) };
  results.alpha.NGN = { com: { 'regular-price': { create: 1000, renew: 1000 } } };
  const previous = publish(results);
  results.alpha.data.com['regular-price'].create = 10.09;
  results.alpha.NGN.com['regular-price'].create = 1010;
  results.alpha.NGN.com['regular-price'].renew = 1009;
  const next = publish(results, previous);
  assert.equal(next.unified[0]['regular-price'].create, 10);
  assert.deepEqual(next.unified[0].currencies.NGN['regular-price'], { create: 1010, renew: 1000 });
  assert.equal(next.operationRows.create.find((row) => row.currency === 'USD').amount, 10);
  assert.equal(next.operationRows.create.find((row) => row.currency === 'NGN').amount, 1010);
  checkPrice(publish({ alpha: result(10.01, 10.01, 'EUR') }, previous), 10.01);
});

test('legacy missing base currency is treated as USD, including NIRA data_currency metadata', () => {
  const results = { alpha: result(10) };
  results.alpha.meta = { data_currency: 'USD' };
  const previous = publish(results);
  results.alpha.data.com['regular-price'].create = 10.09;
  checkPrice(publish(results, previous), 10);
});

test('provider retention and removal operate independently for additional currencies', () => {
  const results = { alpha: result(10), beta: result(11) };
  results.beta.NGN = { com: { 'regular-price': { create: 1000 } } };
  const previous = publish(results);
  results.alpha.NGN = { com: { 'regular-price': { create: 995 } } };
  const retained = publish(results, previous);
  assert.equal(retained.operationRows.create.find((row) => row.currency === 'NGN').provider, 'beta');
  results.alpha.NGN.com['regular-price'].create = 990;
  const switched = publish(results, retained);
  assert.deepEqual(switched.operationRows.create.find((row) => row.currency === 'NGN'), {
    tld: 'com', provider: 'alpha', currency: 'NGN', amount: 990,
  });
  delete results.alpha.NGN;
  const removed = publish(results, switched);
  assert.equal(removed.operationRows.create.find((row) => row.currency === 'NGN').provider, 'beta');
  assert.equal(removed.unified[0].currencies, undefined);
});

test('stabilizes each operation independently and leaves unchanged publications intact', () => {
  const results = { alpha: result(10) };
  const previous = publish(results);
  assert.deepEqual(publish(results, previous), previous);
  results.alpha.data.com['regular-price'].create = 10.09;
  results.alpha.data.com['regular-price'].renew = 11;
  const next = publish(results, previous);
  assert.deepEqual(next.unified[0]['regular-price'], { create: 10, renew: 11, transfer: 10 });
  assert.equal(next.operationRows.create[0].amount, 10);
  assert.equal(next.operationRows.renew[0].amount, 11);
});
