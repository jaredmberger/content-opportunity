import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateAndPrioritize } from '../src/prioritization.js';

function item(overrides = {}) {
  return {
    id: 'base',
    title: 'RMS Example',
    type: 'connect',
    score: 50,
    priority: 'medium',
    canonicalUrl: 'https://oceanliners.net/ships/rms-example',
    sources: [],
    relatedUrls: [],
    unresolvedQuestions: [],
    evidence: [],
    ...overrides
  };
}

test('multi-signal opportunities outrank equal-base single-signal opportunities', () => {
  const ranked = consolidateAndPrioritize([
    item({ id: 'single', title: 'Single', canonicalUrl: 'https://oceanliners.net/ships/single', graphEvidence: { incomingLinks: 1 } }),
    item({ id: 'multi', title: 'Multi', canonicalUrl: 'https://oceanliners.net/ships/multi', graphEvidence: { incomingLinks: 1 }, searchIntelligenceMatch: true })
  ]);
  assert.equal(ranked[0].id, 'multi');
  assert.equal(ranked[0].prioritization.independentSignals, 2);
  assert.ok(ranked[0].decisionScore > ranked[1].decisionScore);
});

test('duplicate canonical opportunities consolidate into one ranked item', () => {
  const ranked = consolidateAndPrioritize([
    item({ id: 'graph', graphEvidence: { incomingLinks: 1 }, sources: ['curatoros-link-map'] }),
    item({ id: 'search', type: 'expand', searchIntelligenceMatch: true, sources: ['search-intelligence'], score: 55 })
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].duplicateCount, 2);
  assert.deepEqual(new Set(ranked[0].sources), new Set(['curatoros-link-map', 'search-intelligence']));
  assert.ok(ranked[0].actionTypes.includes('connect'));
  assert.ok(ranked[0].actionTypes.includes('expand'));
});

test('work-next rank is assigned after decision-score ordering', () => {
  const ranked = consolidateAndPrioritize([
    item({ id: 'low', title: 'Low', canonicalUrl: 'https://oceanliners.net/ships/low', score: 30, graphEvidence: { incomingLinks: 1 } }),
    item({ id: 'high', title: 'High', canonicalUrl: 'https://oceanliners.net/ships/high', score: 70, graphEvidence: { incomingLinks: 1 } })
  ]);
  assert.equal(ranked[0].id, 'high');
  assert.equal(ranked[0].workNextRank, 1);
  assert.equal(ranked[1].workNextRank, 2);
});
