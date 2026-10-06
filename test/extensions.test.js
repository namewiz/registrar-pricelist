import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeExtension,
  EXCLUDED_TLDS,
  filterResultsByTld,
  generateExtensionList,
  isAbridgedTld,
  isExcludedTld,
  TOP_GLOBAL_TLDS,
} from '../src/extensions.js';

test('TOP_GLOBAL_TLDS holds exactly 100 unique non-.ng extensions', () => {
  assert.equal(TOP_GLOBAL_TLDS.length, 100);
  assert.equal(new Set(TOP_GLOBAL_TLDS).size, 100);
  assert.ok(TOP_GLOBAL_TLDS.every((tld) => tld !== 'ng' && !tld.endsWith('.ng')));
});

test('gov.ng, biz.ng and mobi.ng are excluded', () => {
  for (const tld of ['gov.ng', 'biz.ng', 'mobi.ng']) assert.ok(isExcludedTld(tld), tld);
  assert.equal(EXCLUDED_TLDS.size, 3);
  assert.ok(!isExcludedTld('com.ng'));
});

test('abridged list covers every .ng extension plus the top global ones', () => {
  assert.ok(isAbridgedTld('ng'));
  assert.ok(isAbridgedTld('com.ng'));
  assert.ok(isAbridgedTld('com'));
  assert.ok(isAbridgedTld('co.uk'));
  assert.ok(!isAbridgedTld('5g.in'));
});

test('filterResultsByTld filters data and per-currency maps, leaving meta intact', () => {
  const results = {
    nira: {
      meta: { currency: 'USD' },
      data: { 'ng': { 'regular-price': { create: 1 } }, 'mobi.ng': { 'regular-price': { create: 1 } } },
      NGN: { 'ng': { 'regular-price': { create: 100 } }, 'mobi.ng': { 'regular-price': { create: 100 } } },
    },
  };
  const filtered = filterResultsByTld(results, (tld) => !isExcludedTld(tld));
  assert.deepEqual(Object.keys(filtered.nira.data), ['ng']);
  assert.deepEqual(Object.keys(filtered.nira.NGN), ['ng']);
  assert.deepEqual(filtered.nira.meta, { currency: 'USD' });
  assert.ok('mobi.ng' in results.nira.data, 'input is not mutated');
});

test('describeExtension classifies generic, country-code, second-level and IDN extensions', () => {
  assert.deepEqual(describeExtension('com'), {
    tld: 'com',
    type: 'generic',
    description: 'The most popular domain worldwide, for any commercial or personal site.',
  });
  assert.equal(describeExtension('ng').type, 'country-code');
  assert.equal(describeExtension('ng').country, 'NG');
  assert.equal(describeExtension('uk').country, 'GB');
  assert.deepEqual(describeExtension('5g.in'), {
    tld: '5g.in',
    type: 'second-level',
    country: 'IN',
    description: 'Second-level domain under .in (India).',
  });
  assert.equal(describeExtension('us.com').country, undefined);
  assert.equal(describeExtension('xn--p1ai').unicode, 'рф');
});

test('generateExtensionList skips synthetic SKUs and carries no prices', () => {
  const list = generateExtensionList([
    { tld: 'ng', 'regular-price': { create: 1 } },
    { tld: 'premium.ng', 'regular-price': { create: 1 } },
    { tld: 'com', 'regular-price': { create: 1 } },
  ]);
  assert.deepEqual(list.map((e) => e.tld), ['com', 'ng']);
  assert.ok(list.every((e) => !('regular-price' in e)));
});
