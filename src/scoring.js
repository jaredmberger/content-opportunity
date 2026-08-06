const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

function normalize(value, max) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return 0;
  return clamp(value / max, 0, 1);
}

export function scoreOpportunity(opportunity, config) {
  const weights = config?.weights || {};

  const factors = {
    entityMentions: normalize(opportunity.entityMentions ?? 0, 12),
    internalLinkPotential: normalize(opportunity.potentialLinks ?? 0, 10),
    clusterGap: opportunity.clusterGap ? 1 : 0,
    clusterDepth: normalize(opportunity.clusterDepth ?? 0, 12),
    searchDemand: normalize(opportunity.searchImpressions ?? 0, 1000),
    strikingDistance: opportunity.averagePosition >= 4 && opportunity.averagePosition <= 20 ? 1 : 0,
    editorialImportance: clamp((opportunity.editorialImportance ?? 0) / 10, 0, 1)
  };

  const evidence = [];
  let score = 0;

  for (const [key, factor] of Object.entries(factors)) {
    const weight = Number(weights[key] ?? 0);
    const contribution = factor * weight;
    score += contribution;
    if (contribution > 0) {
      evidence.push({ factor: key, value: factor, weight, contribution: Number(contribution.toFixed(2)) });
    }
  }

  const rounded = Math.round(clamp(score));
  const thresholds = config?.thresholds || { high: 75, medium: 50, low: 0 };
  const priority = rounded >= thresholds.high ? "high" : rounded >= thresholds.medium ? "medium" : "low";

  return {
    score: rounded,
    priority,
    evidence: evidence.sort((a, b) => b.contribution - a.contribution)
  };
}

export function summarizeEvidence(scored) {
  const labels = {
    entityMentions: "Repeated entity mentions",
    internalLinkPotential: "Internal-link potential",
    clusterGap: "Cluster gap",
    clusterDepth: "Existing cluster depth",
    searchDemand: "Search demand",
    strikingDistance: "Striking-distance ranking",
    editorialImportance: "Editorial importance"
  };

  return scored.evidence.map(item => ({
    ...item,
    label: labels[item.factor] || item.factor
  }));
}
