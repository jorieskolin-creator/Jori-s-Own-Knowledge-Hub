'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { approveTable, entryFromDoc, normalizeEdit } = require('../api/_master_table');
const { createService, metadata } = require('../api/_governed_unified');

test('Golden Standard paths stay outside ordinary discovery and exact-ID retrieval', async () => {
  const blob = { pathname: '05-random/golden-standard/aster.html', size: 100, uploadedAt: '2026-11-13T08:00:00Z' };
  const fixture = entryFromDoc(metadata(blob, 'private'));
  assert.equal(fixture.review_status, 'Golden Standard');
  assert.throws(() => normalizeEdit(fixture, { review_status: 'Approved' }), /assigned by the fixture folder/);

  const regularBlob = { ...blob, pathname: '05-random/other/normal.html' };
  const regular = entryFromDoc(metadata(regularBlob, 'private'));
  assert.throws(() => normalizeEdit(regular, { review_status: 'Golden Standard' }), /assigned by the fixture folder/);
  const table = approveTable({ records: [fixture, { ...regular, review_status: 'Approved' }] });
  // Simulate an older or incorrectly labeled published snapshot.
  table.published_records[0].review_status = 'Approved';
  let reads = 0;
  const service = createService({
    list: async ({ storeId }) => ({
      blobs: storeId === (process.env.PRIVATE_BLOB_STORE_ID || 'store_YAAwH6FewcrImhA1') ? [blob, regularBlob] : [],
      hasMore: false
    }),
    readMaster: async () => ({ table }),
    get: async () => { reads++; throw Error('Excluded fixture must never be opened'); }
  });
  assert.deepEqual((await service.catalog()).map(doc => doc.id), [regular.id]);
  assert.equal((await service.execute('discover_sources', { query: 'aster' })).candidates_found, 0);
  await assert.rejects(() => service.retrieve({ query: 'aster', ids: [fixture.id] }), /outside current authorized catalog/);
  assert.equal(reads, 0);
});
