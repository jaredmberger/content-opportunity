const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

function normalizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, 'https://oceanliners.net');
    if (!['oceanliners.net', 'www.oceanliners.net'].includes(url.hostname.toLowerCase())) return null;
    url.protocol = 'https:';
    url.hostname = 'oceanliners.net';
    url.hash = '';
    url.search = '';
    let path = url.pathname.replace(/\/index\.html?$/i, '/').replace(/\/{2,}/g, '/');
    if (path.length > 1) path = path.replace(/\/$/, '');
    url.pathname = path || '/';
    return url.href;
  } catch {
    return null;
  }
}

function normalizeTitle(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/\b(rms|ss|mv|hmhs|hms|hmt)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function identityFor(item) {
  const url = normalizeUrl(item.canonicalUrl);
  if (url) return `url:${url}`;
  const recordId = item.projectRecordEvidence?.recordId;
  if (recordId) return `record:${String(recordId).toLowerCase()}`;
  return `title:${normalizeTitle(item.title)}`;
}

function signalLanes(item) {
  const lanes = [];
  if (item.graphEvidence) lanes.push('link-map');
  if (item.searchIntelligenceMatch) lanes.push('search-intelligence');
  if (item.projectRecordEvidence) lanes.push('project-records');
  if (item.inventoryResolved || item.siteInventoryMatch) lanes.push('site-inventory');
  return [...new Set(lanes)];
}

function mergeUnique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function mergeEvidence(a = [], b = []) {
  const map = new Map();
  for (const item of [...a, ...b]) {
    const key = `${item.factor || item.label || ''}:${item.value ?? ''}:${item.contribution ?? ''}`;
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()].sort((x, y) => Number(y.contribution || 0) - Number(x.contribution || 0));
}

function mergeGroup(group) {
  const sorted = [...group].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const primary = { ...sorted[0] };
  const actionTypes = mergeUnique(sorted.map(item => item.type));

  for (const item of sorted.slice(1)) {
    primary.sources = mergeUnique([...(primary.sources || []), ...(item.sources || [])]);
    primary.relatedUrls = mergeUnique([...(primary.relatedUrls || []), ...(item.relatedUrls || [])]);
    primary.unresolvedQuestions = mergeUnique([...(primary.unresolvedQuestions || []), ...(item.unresolvedQuestions || [])]);
    primary.evidence = mergeEvidence(primary.evidence, item.evidence);
    primary.entityMentions = Math.max(Number(primary.entityMentions || 0), Number(item.entityMentions || 0));
    primary.potentialLinks = Math.max(Number(primary.potentialLinks || 0), Number(item.potentialLinks || 0));
    primary.missingLinks = Math.max(Number(primary.missingLinks || 0), Number(item.missingLinks || 0));
    primary.clusterDepth = Math.max(Number(primary.clusterDepth || 0), Number(item.clusterDepth || 0));
    primary.searchImpressions = Math.max(Number(primary.searchImpressions || 0), Number(item.searchImpressions || 0));
    primary.searchClicks = Math.max(Number(primary.searchClicks || 0), Number(item.searchClicks || 0));
    primary.searchCtr = Math.max(Number(primary.searchCtr || 0), Number(item.searchCtr || 0));
    if (!primary.averagePosition && item.averagePosition) primary.averagePosition = item.averagePosition;
    primary.editorialImportance = Math.max(Number(primary.editorialImportance || 0), Number(item.editorialImportance || 0));
    primary.graphEvidence ||= item.graphEvidence || null;
    primary.projectRecordEvidence ||= item.projectRecordEvidence || null;
    primary.siteInventoryMatch ||= item.siteInventoryMatch || null;
    primary.inventoryResolved ||= Boolean(item.inventoryResolved);
    primary.searchIntelligenceMatch ||= Boolean(item.searchIntelligenceMatch);
  }

  primary.actionTypes = actionTypes;
  primary.secondaryActions = actionTypes.filter(type => type !== primary.type);
  primary.duplicateCount = group.length;
  return primary;
}

function decisionScore(item) {
  const lanes = signalLanes(item);
  const independentSignals = lanes.length;
  const convergenceBonus = Math.max(0, independentSignals - 1) * 6;
  const graphSearchBonus = item.graphEvidence && item.searchIntelligenceMatch ? 5 : 0;
  const knowledgeCoverageBonus = item.projectRecordEvidence && item.inventoryResolved ? 4 : 0;
  const actionabilityBonus = item.canonicalUrl && item.graphEvidence ? 3 : 0;
  const evidencePenalty = item.type === 'research' && (item.unresolvedQuestions?.length || 0) > 1 ? -4 : 0;
  return {
    decisionScore: Math.round(clamp(Number(item.score || 0) + convergenceBonus + graphSearchBonus + knowledgeCoverageBonus + actionabilityBonus + evidencePenalty)),
    convergenceBonus,
    independentSignals,
    signalLanes: lanes,
    graphSearchBonus,
    knowledgeCoverageBonus,
    actionabilityBonus,
    evidencePenalty
  };
}

export function consolidateAndPrioritize(opportunities = []) {
  const groups = new Map();
  for (const item of opportunities) {
    const key = identityFor(item);
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }

  const consolidated = [...groups.values()].map(mergeGroup).map(item => ({
    ...item,
    prioritization: decisionScore(item)
  }));

  consolidated.sort((a, b) =>
    b.prioritization.decisionScore - a.prioritization.decisionScore ||
    b.prioritization.independentSignals - a.prioritization.independentSignals ||
    b.score - a.score ||
    a.title.localeCompare(b.title)
  );

  consolidated.forEach((item, index) => {
    item.workNextRank = index + 1;
    item.decisionScore = item.prioritization.decisionScore;
  });
  return consolidated;
}

export function summarizePrioritization(opportunities = []) {
  return {
    total: opportunities.length,
    multiSignal: opportunities.filter(item => Number(item.prioritization?.independentSignals || 0) >= 2).length,
    threePlusSignals: opportunities.filter(item => Number(item.prioritization?.independentSignals || 0) >= 3).length,
    topRecommendation: opportunities[0] ? {
      id: opportunities[0].id,
      title: opportunities[0].title,
      type: opportunities[0].type,
      decisionScore: opportunities[0].decisionScore,
      signalLanes: opportunities[0].prioritization?.signalLanes || []
    } : null
  };
}
