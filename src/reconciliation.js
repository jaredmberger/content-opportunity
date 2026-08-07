const laneFor = item => {
  if (item?.projectRecordEvidence) return 'project-records';
  if (item?.graphEvidence) return 'link-map';
  return 'other';
};

export function makeDiscoverySnapshot(opportunities = []) {
  return {
    format: 'curatoros-content-opportunity-discovery',
    formatVersion: 2,
    generatedAt: new Date().toISOString(),
    items: opportunities.map(item => ({
      id: item.id,
      title: item.title,
      type: item.type,
      lane: laneFor(item),
      score: Number(item.score || 0),
      decisionScore: Number(item.decisionScore ?? item.score ?? 0),
      workNextRank: Number(item.workNextRank || 0),
      feedbackAdjustment: Number(item.feedbackAdjustment || 0),
      signalLanes: Array.isArray(item.prioritization?.signalLanes) ? item.prioritization.signalLanes : [],
      independentSignals: Number(item.prioritization?.independentSignals || 0),
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
