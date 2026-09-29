import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProjectRecords, projectRecordsRequestHeaders } from '../src/project-records.js';

test('Project Records Access headers are only sent when both service-token values exist', () => {
  const none = projectRecordsRequestHeaders();
  assert.equal(none['CF-Access-Client-Id'], undefined);
  assert.equal(none['CF-Access-Client-Secret'], undefined);

  const partial = projectRecordsRequestHeaders({ accessClientId: 'client-id' });
  assert.equal(partial['CF-Access-Client-Id'], undefined);
  assert.equal(partial['CF-Access-Client-Secret'], undefined);

  const complete = projectRecordsRequestHeaders({
    accessClientId: 'client-id',
    accessClientSecret: 'client-secret'
  });
  assert.equal(complete['CF-Access-Client-Id'], 'client-id');
  assert.equal(complete['CF-Access-Client-Secret'], 'client-secret');
});

test('fetchProjectRecords performs an authenticated no-store live read', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (endpoint, init) => {
    captured = { endpoint, init };
    return { ok: true, json: async () => ({ version: 24, records: [] }) };
  };

  try {
    const payload = await fetchProjectRecords('https://curator.example/api/project-records', {
      accessClientId: 'id',
      accessClientSecret: 'secret'
    });
    assert.equal(payload.version, 24);
    assert.equal(captured.endpoint, 'https://curator.example/api/project-records');
    assert.equal(captured.init.headers['CF-Access-Client-Id'], 'id');
    assert.equal(captured.init.headers['CF-Access-Client-Secret'], 'secret');
    assert.equal(captured.init.cache, 'no-store');
    assert.equal(captured.init.cf.cacheTtl, 0);
    assert.equal(captured.init.cf.cacheEverything, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
