import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import {
  describeExtension,
  EXCLUDED_TLDS,
  extensionsToCsv,
  filterResultsByTld,
  generateExtensionList,
  isAbridgedTld,
  isExcludedTld,
  POPULAR_GLOBAL_TLDS,
} from '../src/extensions.js';

test('POPULAR_GLOBAL_TLDS holds unique non-.ng extensions', () => {
  assert.ok(POPULAR_GLOBAL_TLDS.length > 0);
  assert.equal(new Set(POPULAR_GLOBAL_TLDS).size, POPULAR_GLOBAL_TLDS.length);
  assert.ok(POPULAR_GLOBAL_TLDS.every((tld) => tld !== 'ng' && !tld.endsWith('.ng')));
});

test('gov.ng, biz.ng and mobi.ng are excluded', () => {
  for (const tld of ['gov.ng', 'biz.ng', 'mobi.ng']) assert.ok(isExcludedTld(tld), tld);
  assert.equal(EXCLUDED_TLDS.size, 3);
  assert.ok(!isExcludedTld('com.ng'));
});

test('abridged list covers every .ng extension plus selected popular global ones', () => {
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
    description: "Businesses, brands, shops and personal websites",
    tags: ['business', 'popular', 'short'],
  });
  assert.equal(describeExtension('ng').type, 'country-code');
  assert.equal(describeExtension('ng').country, 'NG');
  assert.equal(describeExtension('uk').country, 'GB');
  assert.deepEqual(describeExtension('5g.in'), {
    tld: '5g.in',
    type: 'second-level',
    country: 'IN',
    description: 'Second-level domain under .in (India).',
    tags: ['geographic'],
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
  for (const tld of ['ng', 'com.ng', 'org.ng', 'net.ng', 'edu.ng', 'sch.ng', 'name.ng', 'i.ng', ...POPULAR_GLOBAL_TLDS]) {
    assert.doesNotMatch(describeExtension(tld).description, generated, tld);
  }
});

test('extensionsToCsv writes pipe-separated tags and quotes CSV fields', () => {
  const csv = extensionsToCsv([
    { tld: 'com.ng', type: 'second-level', country: 'NG', description: 'Trusted, local.', tags: ['business', 'geographic'] },
    { tld: 'xn--p1ai', unicode: 'рф', type: 'generic', description: 'Say "hi"' },
    { tld: 'art', type: 'generic', description: 'Art', tags: ['arts & media', 'short'] },
  ]);
  assert.deepEqual(csv.split('\n'), [
    'tld,type,country,description,tags',
    'com.ng,second-level,NG,"Trusted, local.",business|geographic',
    'xn--p1ai,generic,,"Say ""hi""",',
    'art,generic,,Art,arts & media|short',
  ]);
  const rows = parse(csv, { columns: true });
  assert.deepEqual(rows[0].tags.split('|'), ['business', 'geographic']);
  assert.equal(rows[1].tags, '');
  assert.equal(rows[2].tags.split('|')[0], 'arts & media');
});

test('tags support overlapping topics, geography and suffix properties', () => {
  for (const [tld, expected] of Object.entries({
    ai: ['geographic', 'short', 'technology'],
    'com.ng': ['business', 'geographic', 'popular'],
    'edu.ng': ['academic', 'geographic'],
    'co.uk': ['geographic'],
    africa: ['geographic'],
    lat: ['business', 'geographic'],
    berlin: ['arts & media', 'geographic'],
    church: ['social & lifestyle'],
    studio: ['arts & media', 'business'],
    finance: ['business', 'finance'],
    restaurant: ['social & lifestyle'],
    boats: ['business', 'social & lifestyle'],
    garden: ['business'],
    fitness: ['fun & sports', 'health'],
    social: ['social & lifestyle'],
    marketing: ['business'],
  })) {
    const tags = describeExtension(tld).tags;
    for (const tag of expected) assert.ok(tags.includes(tag), `${tld}: ${tag}`);
  }
  assert.ok(!describeExtension('com.ng').tags.includes('short'));
  assert.ok(!describeExtension('church').tags.includes('popular'));
  assert.ok(!describeExtension('com').tags.includes('geographic'));
});

test('cheap uses only finite nonnegative regular USD create prices, including the threshold', () => {
  const cases = [
    [{ 'regular-price': { create: 0 } }, true],
    [{ 'regular-price': { create: 10 } }, true],
    [{ currency: 'usd', 'regular-price': { create: 9 } }, true],
    [{ 'regular-price': { create: 10.01 } }, false],
    [{ currency: 'NGN', 'regular-price': { create: 5 } }, false],
    [{ 'regular-price': { create: -1 } }, false],
    [{ 'regular-price': { create: NaN } }, false],
    [{ 'regular-price': { create: Infinity } }, false],
    [{ 'regular-price': { create: '5' } }, false],
    [{ 'regular-price': { create: null } }, false],
    [{ 'regular-price': { renew: 5 }, 'sale-price': { create: 1 } }, false],
    [{}, false],
  ];
  for (const [priceEntry, expected] of cases) {
    const input = [{ tld: 'com', ...priceEntry }];
    const before = structuredClone(input);
    assert.equal(generateExtensionList(input)[0].tags.includes('cheap'), expected);
    assert.deepEqual(input, before);
  }
});

test('abridged tags are populated, sorted, unique and returned as independent arrays', () => {
  for (const tld of ['ng', 'com.ng', 'org.ng', 'net.ng', 'edu.ng', 'sch.ng', 'name.ng', 'i.ng', ...POPULAR_GLOBAL_TLDS]) {
    const tags = describeExtension(tld).tags;
    assert.ok(tags.length > 0, tld);
    assert.deepEqual(tags, [...new Set(tags)].sort(), tld);
    tags.push('test');
    assert.ok(!describeExtension(tld).tags.includes('test'), tld);
  }
});

test('published abridged extension CSV matches the generator and uses exactly 12 tags', async () => {
  const prices = JSON.parse(await readFile(new URL('../data/abridged-prices.json', import.meta.url), 'utf8'));
  const csv = await readFile(new URL('../data/abridged-extensions.csv', import.meta.url), 'utf8');
  assert.equal(csv.trimEnd(), extensionsToCsv(generateExtensionList(prices)));
  const rows = parse(csv, { columns: true });
  assert.ok(rows.every((row) => row.tags.length > 0));
  const tags = new Set(rows.flatMap((row) => row.tags.split('|')));
  assert.deepEqual([...tags].sort(), [
    'academic', 'arts & media', 'business', 'cheap', 'finance', 'fun & sports',
    'geographic', 'health', 'popular', 'short', 'social & lifestyle', 'technology',
  ]);
});
