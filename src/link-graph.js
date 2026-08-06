const DEFAULT_GRAPH_URL = 'https://link-map.oceanliners.net/api/graph';

function pageType(url) {
  const path = new URL(url).pathname.toLowerCase();
  if (path.startsWith('/ships/') && path !== '/ships/ships') return 'ship';
  if (path.includes('hub') || path === '/ships/ships' || path === '/explore' || path === '/site-map' || path === '/sitemap') return 'hub';
  if (/why-|what-|how-|did-|could-|ocean-liner/.test(path.split('/').filter(Boolean).pop() || '')) return 'article';
  if (['/', '/about', '/sources', '/provenance', '/attribution', '/contact', '/project-scope'].includes(path.replace(/\/$/, '') || '/')) return 'core';
  return 'other';
}

function labelFor(page) {
  if (page?.title) return page.title;
  try {
    const part = new URL(page.url).pathname.split('/').filter(Boolean).pop() || 'Ocean Liner Curator';
    return decodeURIComponent(part).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch { return page?.url || 'Untitled page'; }
}

function slugify(value = '') {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeGraphPayload(payload, source) {
  const graph = payload?.graph || payload?.data || payload;
  if (!Array.isArray(graph?.pages) || !Array.isArray(graph?.edges)) return null;
  return {
    ...graph,
    source: graph.source || source,
    pages: graph.pages.filter(page => page?.url),
    edges: graph.edges.filter(edge => edge?.source && edge?.target)
  };
}

export async function fetchLinkGraph(graphUrl = DEFAULT_GRAPH_URL) {
  const endpoint = graphUrl || DEFAULT_GRAPH_URL;
  const response = await fetch(endpoint, {
    headers: {
      accept: 'application/json',
      'user-agent': 'CuratorOS-Content-Opportunity/0.8.4 (+https://content.oceanliners.net)'
    },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; }
  catch { throw new Error(`Link Map graph returned non-JSON: ${text.slice(0, 80)}`); }
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Link Map graph returned HTTP ${response.status}`);
  }
  const graph = normalizeGraphPayload(payload, endpoint);
  if (!graph) throw new Error('Link Map graph is missing pages or edges.');
  return graph;
}

export function generateLinkOpportunities(graph, options = {}) {
  const minSharedNeighbors = Number(options.minSharedNeighbors ?? 1);
  const maxSuggestionsPerPage = Number(options.maxSuggestionsPerPage ?? 5);
  const maxOpportunities = Number(options.maxOpportunities ?? 80);
  const pages = Array.isArray(graph?.pages) ? graph.pages : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const byUrl = new Map(pages.map(page => [page.url, { ...page, type: pageType(page.url) }]));
  const incoming = new Map(pages.map(page => [page.url, new Set()]));
  const outgoing = new Map(pages.map(page => [page.url, new Set()]));

  for (const edge of edges) {
    if (!byUrl.has(edge.source) || !byUrl.has(edge.target)) continue;
    outgoing.get(edge.source).add(edge.target);
    incoming.get(edge.target).add(edge.source);
  }

  const neighborsFor = url => new Set([...(incoming.get(url) || []), ...(outgoing.get(url) || [])]);
  const candidates = [];

  for (const page of byUrl.values()) {
    const neighbors = neighborsFor(page.url);
    const direct = new Set([...neighbors, page.url]);
    const possible = [];
    for (const other of byUrl.values()) {
      if (other.url === page.url || other.type !== page.type || direct.has(other.url)) continue;
      const otherNeighbors = neighborsFor(other.url);
      let shared = 0;
      for (const neighbor of otherNeighbors) if (neighbors.has(neighbor)) shared += 1;
      if (shared < minSharedNeighbors) continue;
      possible.push({ url: other.url, title: labelFor(other), sharedNeighbors: shared, totalLinks: otherNeighbors.size });
    }
    possible.sort((a, b) => b.sharedNeighbors - a.sharedNeighbors || b.totalLinks - a.totalLinks || a.title.localeCompare(b.title));
    const suggestions = possible.slice(0, maxSuggestionsPerPage);
    if (!suggestions.length) continue;
    const inbound = incoming.get(page.url)?.size || 0;
    const outbound = outgoing.get(page.url)?.size || 0;
    const total = neighbors.size;
    const editorialImportance = inbound === 0 ? 10 : inbound <= 2 ? 8 : inbound <= 5 ? 6 : 4;
    const sharedStrength = suggestions.reduce((sum, item) => sum + item.sharedNeighbors, 0);
    candidates.push({
      id: `link-map-${slugify(new URL(page.url).pathname || page.url)}`,
      title: labelFor(page), contentType: 'internal-link task', cluster: `Link Map · ${page.type}`,
      canonicalUrl: page.url, opportunityType: 'connect', entityMentions: 0,
      potentialLinks: suggestions.length, missingLinks: suggestions.length, clusterGap: false,
      clusterDepth: total, searchImpressions: 0, averagePosition: 0, editorialImportance,
      unresolvedQuestions: [], relatedUrls: suggestions.map(item => item.url), sources: ['curatoros-link-map'],
      graphEvidence: { incomingLinks: inbound, outgoingLinks: outbound, totalNeighbors: total, sharedNeighborStrength: sharedStrength, suggestions }
    });
  }

  return candidates.sort((a, b) =>
    a.graphEvidence.incomingLinks - b.graphEvidence.incomingLinks ||
    b.graphEvidence.sharedNeighborStrength - a.graphEvidence.sharedNeighborStrength ||
    b.missingLinks - a.missingLinks || a.title.localeCompare(b.title)
  ).slice(0, maxOpportunities);
}

export { DEFAULT_GRAPH_URL };
