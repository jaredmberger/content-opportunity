import { scoreOpportunity, summarizeEvidence } from './scoring.js';

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
  if (type === 'create') return `Create a canonical ${item.contentType || 'page'} for ${item.title}.`;
  if (type === 'expand') return `Strengthen ${item.title} with supporting sections, evidence, and related coverage.`;
  if (type === 'connect') {
    const count = Number(item.missingLinks || item.potentialLinks || 0);
    return count > 0
      ? `Improve internal linking for ${item.title}; CuratorOS identified ${count} strong missing connection${count === 1 ? '' : 's'}.`
      : `Add or improve internal links between ${item.title} and its strongest related pages.`;
  }
  return `Research ${item.title} before publication and resolve the open evidence questions.`;
}

export function discoverOpportunities(dataset, config) {
  const items = Array.isArray(dataset?.items) ? dataset.items : [];

  return items
    .map(item => {
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
        editorialImportance: Number(item.editorialImportance || 0),
        unresolvedQuestions: Array.isArray(item.unresolvedQuestions) ? item.unresolvedQuestions : [],
        sources: Array.isArray(item.sources) ? item.sources : [],
        workflowStatus: item.workflowStatus || 'new',
        notes: item.notes || '',
        siteInventoryMatch: item.siteInventoryMatch || null,
        inventoryResolved: Boolean(item.inventoryResolved),
        linkInspection: item.linkInspection || null,
        graphEvidence: item.graphEvidence || null,
        relatedUrls: Array.isArray(item.relatedUrls) ? item.relatedUrls : [],
        generatedAutomatically: Boolean(item.generatedAutomatically)
      };

      const scored = scoreOpportunity(base, config);
      return {
        ...base,
        ...scored,
        recommendation: recommendationFor(type, base),
        evidence: summarizeEvidence(scored)
      };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
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
    research: 0
  };

  for (const item of opportunities) {
    summary[item.priority] = (summary[item.priority] || 0) + 1;
    summary[item.type] = (summary[item.type] || 0) + 1;
  }
  return summary;
}
