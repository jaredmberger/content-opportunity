import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEntityOpportunities } from '../src/project-records.js';

function snapshot(records) {
  return { version: 23, updatedAt: '2026-09-29T21:00:00.000Z', records };
}

test('ordinary unreferenced ship records remain below the automatic discovery threshold', () => {
  const result = generateEntityOpportunities(snapshot([
    { id: 'ship:example', title: 'SS Example', type: 'ship', data: {}, sources: [] }
  ]), { pages: [] });

  assert.equal(result.length, 0);
});

test('explicit discovery candidates surface before a public guide exists', () => {
  const result = generateEntityOpportunities(snapshot([
    {
      id: 'ship:candidate',
      title: 'SS Candidate',
      type: 'ship',
      status: 'draft',
      data: {},
      sources: [],
      metadata: { discoveryCandidate: true }
    }
  ]), { pages: [] });

  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'SS Candidate');
  assert.equal(result[0].contentType, 'ship guide');
  assert.equal(result[0].opportunityType, 'research');
  assert.equal(result[0].projectRecordEvidence.discoveryCandidate, true);
  assert.ok(result[0].sources.includes('curator-nomination'));
});

test('sourced discovery candidates can move directly into create work', () => {
  const result = generateEntityOpportunities(snapshot([
    {
      id: 'ship:sourced-candidate',
      title: 'SS Sourced Candidate',
      type: 'ship',
      status: 'review',
      data: {},
      sources: [{ id: 'source.one', title: 'Source one' }],
      metadata: { discoveryCandidate: true, confidence: 'probable' }
    }
  ]), { pages: [] });

  assert.equal(result.length, 1);
  assert.equal(result[0].opportunityType, 'create');
  assert.ok(result[0].editorialImportance >= 7);
});

test('discovery candidates disappear once the canonical page exists', () => {
  const result = generateEntityOpportunities(snapshot([
    {
      id: 'ship:published-candidate',
      title: 'SS Published Candidate',
      type: 'ship',
      data: { pageUrl: 'https://oceanliners.net/ships/ss-published-candidate' },
      sources: [{ id: 'source.one' }],
      metadata: { discoveryCandidate: true }
    }
  ]), {
    pages: [{ title: 'SS Published Candidate', url: 'https://oceanliners.net/ships/ss-published-candidate' }]
  });

  assert.equal(result.length, 0);
});
