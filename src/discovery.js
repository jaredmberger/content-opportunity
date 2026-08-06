import { scoreOpportunity, summarizeEvidence } from './scoring.js';
import { consolidateAndPrioritize } from './prioritization.js';

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function typeFor(item) {
  const explicit = String(item.opportunityType || '').toLowerCase();
  if (['create', 'expand', 'connect', 'research'].includes(explicit)) return explicit;
  if ((item.unresolvedQuestions?.length ?? 0) > 0 && !item.canonicalUrl) return 'research';
  if (!item.canonicalUrl) return 'create';
  if ((item.potentialLinks ?? 0) >= 1 && (item.missingLinks ?? 0) > 0) return 'connect';
  return 'expand';
}

function recommendationFor(type, item) {
  if (type === 'create') {
    const refs = Number(item.projectRecordEvidence?.inboundRelationships || 0);
    return refs > 0
      ? `Create a canonical ${item.contentType || 'page'} for ${item.title}; ${refs} Project Record relationship${refs === 1 ? '' : 's'} already point to this entity.`
      : `Create a canonical ${item.contentType || 'page'} for ${item.title}.`;
  }
  if (type === 'expand') return `Strengthen ${item.title} with supporting sections, evidence, and related coverage.`;
  if (type === 'connect') {
    const count = Number(item.missingLinks || item.potentialLinks || 0);
    return count > 0
      ? `Improve internal linking for ${item.title}; CuratorOS identified ${count} strong missing connection${count === 1 ? '' : 's'}.`
      : `Add or improve internal links between ${item.title} and its strongest related pages.`;
  }
  if (item.projectRecordEvidence) {
    return `Research ${item.title} before publication; the entity is structurally important in Project Records, but its evidence readiness needs review.`;
  }
  return `Research ${item.title} before publication and resolve the open evidence questions.`;
}

export function discoverOpportunities(dataset, config) {
  const items = Array.isArray(dataset?.items) ? dataset.items : [];

  const scored = items.map(item => {
    const type = typeFor(item);
    const base = {
      id: item.id || slugify(item.title),
      title: item.title || 'Untitled opportunity',
      type,
      contentType: item.contentType || 'page',
      cluster: item.cluster || 'Unclassified',
      canonicalUrl: item.canonicalUrl || null,
      entityMentions: Number(item.entityMentions || 0),
      potentialLinks: Number(item.potentialLinks || 0),
      missingLinks: Number(item.missingLinks || 0),
      clusterGap: Boolean(item.clusterGap),
      clusterDepth: Number(item.clusterDepth || 0),
      searchImpressions: Number(item.searchImpressions || 0),
      averagePosition: Number(item.averagePosition || 0),
      searchClicks: Number(item.searchClicks || 0),
      searchCtr: Number(item.searchCtr || 0),
      searchQueryCount: Number(item.searchQueryCount || 0),
      searchTopQueries: Array.isArray(item.searchTopQueries) ? item.searchTopQueries : [],
      searchIntelligenceMatch: Boolean(item.searchIntelligenceMatch),
      editorialImportance: Number(item.editorialImportance || 0),
      unresolvedQuestions: Array.isArray(item.unresolvedQuestions) ? item.unresolvedQuestions : [],
      sources: Array.isArray(item.sources) ? item.sources : [],
      workflowStatus: item.workflowStatus || 'new',
      notes: item.notes || '',
      siteInventoryMatch: item.siteInventoryMatch || null,
      inventoryResolved: Boolean(item.inventoryResolved),
      linkInspection: item.linkInspection || null,
      graphEvidence: item.graphEvidence || null,
      projectRecordEvidence: item.projectRecordEvidence || null,
      relatedUrls: Array.isArray(item.relatedUrls) ? item.relatedUrls : [],
      generatedAutomatically: Boolean(item.generatedAutomatically)
    };

    const result = scoreOpportunity(base, config);
    return {
      ...base,
      ...result,
      recommendation: recommendationFor(type, base),
      evidence: summarizeEvidence(result)
    };
  });

  return consolidateAndPrioritize(scored);
}

export function summarizeOpportunities(opportunities) {
  const summary = {
    total: opportunities.length,
    high: 0,
    medium: 0,
    low: 0,
    create: 0,
    expand: 0,
    connect: 0,
    research: 0,
    multiSignal: 0,
    threePlusSignals: 0
  };

  for (const item of opportunities) {
    summary[item.priority] = (summary[item.priority] || 0) + 1;
    summary[item.type] = (summary[item.type] || 0) + 1;
    const signalCount = Number(item.prioritization?.independentSignals || 0);
    if (signalCount >= 2) summary.multiSignal += 1;
    if (signalCount >= 3) summary.threePlusSignals += 1;
  }
  if (opportunities[0]) {
    summary.workNext = {
      id: opportunities[0].id,
      title: opportunities[0].title,
      type: opportunities[0].type,
      decisionScore: opportunities[0].decisionScore,
      signals: opportunities[0].prioritization?.signalLanes || []
    };
  }
  return summary;
}
