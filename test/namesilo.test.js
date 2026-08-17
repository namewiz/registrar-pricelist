import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapNamesiloPrices } from '../src/generators/namesilo.js';

// Hand-written in the shape NameSilo documents for getPrices; replace with a recorded reply once we have a key.
const reply = {
  code: 300,
  detail: 'success',
  com: { registration: '10.46', transfer: '10.46', renew: '10.46' },
  io: { registration: '34.99', transfer: '34.99', renew: '39.99' },
  xyz: { registration: '1.99', transfer: '11.29', renew: '11.29' },
  nocreate: { renew: '5.00' },
};

test('mapNamesiloPrices maps registration/renew/transfer to create/renew/transfer', () => {
  const data = mapNamesiloPrices(reply);
  assert.deepEqual(data.com, { 'regular-price': { create: 10.46, renew: 10.46, transfer: 10.46 } });
  assert.deepEqual(data.xyz, { 'regular-price': { create: 1.99, renew: 11.29, transfer: 11.29 } });
  assert.equal(data.code, undefined);
  assert.equal(data.detail, undefined);
});

test('mapNamesiloPrices skips TLDs without a registration price', () => {
  assert.equal(mapNamesiloPrices(reply).nocreate, undefined);
});

test('mapNamesiloPrices throws on a non-success reply', () => {
  assert.throws(() => mapNamesiloPrices({ code: 110, detail: 'Invalid API Key' }), /110 Invalid API Key/);
});
