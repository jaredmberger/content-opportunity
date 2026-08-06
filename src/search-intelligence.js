const normalizeUrl = value => {
  try {
    const url = new URL(String(value || '').trim(), 'https://www.oceanliners.net');
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
};

const number = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/[%,$]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

function firstValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') return row[key];
  }
  return '';
}

function curatorIntelligenceRows(payload) {
  if (payload?.system?.id !== 'search-intelligence') return null;
  const verificationPages = Array.isArray(payload?.verificationContext?.pages) ? payload.verificationContext.pages : [];
  const querySignals = [...(Array.isArray(payload?.priorities) ? payload.priorities : []), ...(Array.isArray(payload?.opportunities) ? payload.opportunities : [])];
  const queriesByPage = new Map();
  for (const signal of querySignals) {
    const page = normalizeUrl(signal?.entity || signal?.page || '');
    const query = String(signal?.query || '').trim();
    if (!page || !query) continue;
    if (!queriesByPage.has(page)) queriesByPage.set(page, new Set());
    queriesByPage.get(page).add(query);
  }

  const rows = [];
  for (const page of verificationPages) {
    const canonical = normalizeUrl(page?.path || page?.page || '');
    const points = Array.isArray(page?.points) ? page.points.slice().sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || ''))) : [];
    const latest = points.at(-1);
    if (!canonical || !latest) continue;
    const queries = [...(queriesByPage.get(canonical) || [])];
    if (queries.length) {
      for (const query of queries) rows.push({ page: canonical, query, clicks: latest.clicks, impressions: latest.impressions, ctr: latest.ctr, position: latest.position });
    } else {
      rows.push({ page: canonical, clicks: latest.clicks, impressions: latest.impressions, ctr: latest.ctr, position: latest.position });
    }
  }

  return rows;
}

export function normalizeSearchIntelligence(payload) {
  const curatorRows = curatorIntelligenceRows(payload);
  const sourceRows = curatorRows || (Array.isArray(payload) ? payload
    : Array.isArray(payload?.rows) ? payload.rows
    : Array.isArray(payload?.items) ? payload.items
    : Array.isArray(payload?.data) ? payload.data
    : []);

  const rows = sourceRows.map(row => {
    const page = normalizeUrl(firstValue(row, [
      'page', 'url', 'Page', 'URL', 'Top pages', 'Landing page', 'landingPage', 'canonicalUrl'
    ]));
    if (!page) return null;
    const query = String(firstValue(row, ['query', 'Query', 'Top queries', 'keyword', 'searchTerm']) || '').trim();
    const clicks = number(firstValue(row, ['clicks', 'Clicks']));
    const impressions = number(firstValue(row, ['impressions', 'Impressions']));
    let ctr = number(firstValue(row, ['ctr', 'CTR', 'Average CTR']));
    if (ctr > 1) ctr /= 100;
    if (!ctr && impressions > 0) ctr = clicks / impressions;
    const position = number(firstValue(row, ['position', 'Position', 'Average position', 'averagePosition', 'avgPosition']));
    return { page, query, clicks, impressions, ctr, position };
  }).filter(Boolean);

  const byPage = new Map();
  for (const row of rows) {
    const current = byPage.get(row.page) || {
      page: row.page,
      clicks: 0,
      impressions: 0,
      weightedPosition: 0,
      positionWeight: 0,
      queries: new Map()
    };
    current.clicks += row.clicks;
    current.impressions += row.impressions;
    const weight = row.impressions > 0 ? row.impressions : 1;
    if (row.position > 0) {
      current.weightedPosition += row.position * weight;
      current.positionWeight += weight;
    }
    if (row.query) {
      const q = current.queries.get(row.query) || { query: row.query, clicks: 0, impressions: 0, weightedPosition: 0, positionWeight: 0 };
      q.clicks += row.clicks;
      q.impressions += row.impressions;
      if (row.position > 0) {
        q.weightedPosition += row.position * weight;
        q.positionWeight += weight;
      }
      current.queries.set(row.query, q);
    }
    byPage.set(row.page, current);
  }

  const pages = [...byPage.values()].map(item => ({
    page: item.page,
    clicks: Math.round(item.clicks * 100) / 100,
    impressions: Math.round(item.impressions * 100) / 100,
    ctr: item.impressions > 0 ? item.clicks / item.impressions : 0,
    averagePosition: item.positionWeight > 0 ? item.weightedPosition / item.positionWeight : 0,
    queryCount: item.queries.size,
    topQueries: [...item.queries.values()]
      .map(q => ({
        query: q.query,
        clicks: Math.round(q.clicks * 100) / 100,
        impressions: Math.round(q.impressions * 100) / 100,
        averagePosition: q.positionWeight > 0 ? q.weightedPosition / q.positionWeight : 0
      }))
      .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
      .slice(0, 8)
  })).sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);

  return {
    format: 'curatoros-search-intelligence',
    formatVersion: 1,
    importedAt: new Date().toISOString(),
    source: String(payload?.source || (curatorRows ? 'curator-intelligence' : 'search-console-import')),
    rowCount: rows.length,
    pageCount: pages.length,
    pages
  };
}

export function enrichItemsWithSearchIntelligence(items, snapshot) {
  if (!Array.isArray(items) || !Array.isArray(snapshot?.pages)) return items || [];
  const pageMetrics = new Map(snapshot.pages.map(page => [normalizeUrl(page.page), page]));

  return items.map(item => {
    const canonical = normalizeUrl(item.canonicalUrl);
    const metrics = canonical ? pageMetrics.get(canonical) : null;
    if (!metrics) return item;
    return {
      ...item,
      searchImpressions: Number(metrics.impressions || 0),
      averagePosition: Number(metrics.averagePosition || 0),
      searchClicks: Number(metrics.clicks || 0),
      searchCtr: Number(metrics.ctr || 0),
      searchQueryCount: Number(metrics.queryCount || 0),
      searchTopQueries: Array.isArray(metrics.topQueries) ? metrics.topQueries : [],
      searchIntelligenceMatch: true,
      sources: [...new Set([...(Array.isArray(item.sources) ? item.sources : []), 'search-intelligence'])]
    };
  });
}
