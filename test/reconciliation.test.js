import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDiscoverySnapshot, compareDiscovery } from '../src/reconciliation.js';

test('only resolves disappeared opportunities from reevaluated lanes', () => {
  const previous = makeDiscoverySnapshot([
    { id: 'link-a', title: 'Link A', type: 'connect', graphEvidence: {} },
    { id: 'entity-a', title: 'Entity A', type: 'create', projectRecordEvidence: {} }
  ]);

  const changes = compareDiscovery(previous, [], ['link-map']);
  assert.deepEqual(changes.resolved.map(item => item.id), ['link-a']);
});

test('recognizes first-seen opportunities after a previous snapshot', () => {
  const previous = makeDiscoverySnapshot([
    { id: 'link-a', title: 'Link A', type: 'connect', graphEvidence: {} }
  ]);
  const current = [
    { id: 'link-a', title: 'Link A', type: 'connect', graphEvidence: {} },
    { id: 'link-b', title: 'Link B', type: 'connect', graphEvidence: {} }
  ];

  const changes = compareDiscovery(previous, current, ['link-map']);
  assert.deepEqual(changes.firstSeen.map(item => item.id), ['link-b']);
  assert.deepEqual(changes.resolved, []);
});
