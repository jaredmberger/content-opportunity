const laneFor = item => {
  if (item?.projectRecordEvidence) return 'project-records';
  if (item?.graphEvidence) return 'link-map';
  return 'other';
};

export function makeDiscoverySnapshot(opportunities = []) {
  return {
    format: 'curatoros-content-opportunity-discovery',
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    items: opportunities.map(item => ({
      id: item.id,
      title: item.title,
      type: item.type,
      lane: laneFor(item),
      score: item.score,
      canonicalUrl: item.canonicalUrl || null
    }))
  };
}

export function compareDiscovery(previous, opportunities = [], evaluatedLanes = []) {
  const currentById = new Map(opportunities.map(item => [item.id, item]));
  const previousItems = Array.isArray(previous?.items) ? previous.items : [];
  const lanes = new Set(evaluatedLanes);

  const resolved = previousItems.filter(item =>
    lanes.has(item.lane) && !currentById.has(item.id)
  );

  const previousById = new Map(previousItems.map(item => [item.id, item]));
  const returned = opportunities.filter(item => previousById.has(item.id));
  const firstSeen = opportunities.filter(item => !previousById.has(item.id));

  return { resolved, returned, firstSeen };
}

export function reconciliationSummary(changes = {}) {
  return {
    resolved: changes.resolved?.length || 0,
    returned: changes.returned?.length || 0,
    firstSeen: changes.firstSeen?.length || 0
  };
}
