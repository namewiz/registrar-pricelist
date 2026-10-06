import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeExtension,
  EXCLUDED_TLDS,
  extensionsToCsv,
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
    description: "The world's most trusted domain. The first choice for any business, brand or idea.",
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

test('every abridged extension has a hand-written description', () => {
  const generated = /^(Generic top-level domain|Second-level domain under)|'s country-code domain\.$/;
  for (const tld of ['ng', 'com.ng', 'org.ng', 'net.ng', 'edu.ng', 'sch.ng', 'name.ng', 'i.ng', ...TOP_GLOBAL_TLDS]) {
    assert.doesNotMatch(describeExtension(tld).description, generated, tld);
  }
});

test('extensionsToCsv writes a header, leaves absent fields empty and quotes commas', () => {
  const csv = extensionsToCsv([
    { tld: 'com.ng', type: 'second-level', country: 'NG', description: 'Trusted, local.' },
    { tld: 'xn--p1ai', unicode: 'рф', type: 'generic', description: 'Say "hi"' },
  ]);
  assert.deepEqual(csv.split('\n'), [
    'tld,unicode,type,country,description',
    'com.ng,,second-level,NG,"Trusted, local."',
    'xn--p1ai,рф,generic,,"Say ""hi"""',
  ]);
});
