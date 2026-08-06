import scoringConfig from './config/scoring.json' with { type: 'json' };
import { discoverOpportunities, summarizeOpportunities } from './src/discovery.js';
import { fetchSiteInventory } from './src/site-inventory.js';
import { enrichWithSiteKnowledge } from './src/site-enrichment.js';
import { fetchLinkGraph, generateLinkOpportunities, DEFAULT_GRAPH_URL } from './src/link-graph.js';
import { normalizeSearchIntelligence, enrichItemsWithSearchIntelligence } from './src/search-intelligence.js';

const json = (data, init = {}) => new Response(JSON.stringify(data, null, 2), {
  ...init,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(init.headers || {})
  }
});

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  'access-control-allow-headers': 'Content-Type'
};

const WORKFLOW_STATUSES = new Set(['new', 'reviewed', 'accepted', 'in-progress', 'completed', 'deferred', 'dismissed']);
const workflowKey = id => `content-opportunity:workflow:${id}`;
const SEARCH_INTELLIGENCE_KEY = 'content-opportunity:search-intelligence:v1';

async function readWorkflow(env, id) {
  if (!env.OPPORTUNITY_STATE) return null;
  return env.OPPORTUNITY_STATE.get(workflowKey(id), { type: 'json' });
}

async function writeWorkflow(env, id, value) {
  if (!env.OPPORTUNITY_STATE) return false;
  await env.OPPORTUNITY_STATE.put(workflowKey(id), JSON.stringify(value));
  return true;
}

async function readSearchIntelligence(env) {
  if (!env.OPPORTUNITY_STATE) return null;
  return env.OPPORTUNITY_STATE.get(SEARCH_INTELLIGENCE_KEY, { type: 'json' });
}

async function writeSearchIntelligence(env, snapshot) {
  if (!env.OPPORTUNITY_STATE) return false;
  await env.OPPORTUNITY_STATE.put(SEARCH_INTELLIGENCE_KEY, JSON.stringify(snapshot));
  return true;
}

async function attachWorkflow(env, opportunities) {
  if (!env.OPPORTUNITY_STATE) return opportunities;
  await Promise.all(opportunities.map(async item => {
    const saved = await readWorkflow(env, item.id);
    if (!saved) return;
    item.workflowStatus = saved.workflowStatus || item.workflowStatus;
    item.notes = saved.notes || '';
    item.updatedAt = saved.updatedAt || null;
  }));
  return opportunities;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const siteOrigin = env.SITE_ORIGIN || 'https://www.oceanliners.net';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    if (url.pathname === '/api/health') {
      const searchSnapshot = await readSearchIntelligence(env).catch(() => null);
      return json({
        ok: true,
        service: env.APP_NAME || 'CuratorOS Content Opportunity Finder',
        version: '0.5.0',
        siteOrigin,
        scoringVersion: scoringConfig.version,
        workflowPersistence: env.OPPORTUNITY_STATE ? 'kv' : 'browser',
        siteInventory: 'live-index',
        automaticSiteEnrichment: true,
        linkGapInspection: true,
        automaticGraphDiscovery: true,
        linkMapSource: DEFAULT_GRAPH_URL,
        searchIntelligence: searchSnapshot ? {
          connected: true,
          importedAt: searchSnapshot.importedAt || null,
          pageCount: searchSnapshot.pageCount || 0,
          rowCount: searchSnapshot.rowCount || 0,
          source: searchSnapshot.source || null
        } : { connected: false }
      }, { headers: corsHeaders });
    }

    if (url.pathname === '/api/config' && request.method === 'GET') {
      return json({ ...scoringConfig, workflowStatuses: [...WORKFLOW_STATUSES] }, { headers: corsHeaders });
    }

    if (url.pathname === '/api/site-inventory' && request.method === 'GET') {
      try {
        const inventory = await fetchSiteInventory(siteOrigin);
        return json({ ok: true, ...inventory }, { headers: corsHeaders });
      } catch (error) {
        return json({ ok: false, error: 'Unable to read site inventory', detail: error?.message || String(error) }, { status: 502, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/link-graph' && request.method === 'GET') {
      try {
        const graph = await fetchLinkGraph();
        return json({ ok: true, source: DEFAULT_GRAPH_URL, generatedAt: graph.generatedAt || null, pageCount: graph.pages.length, edgeCount: graph.edges.length }, { headers: corsHeaders });
      } catch (error) {
        return json({ ok: false, error: 'Unable to read CuratorOS Link Map', detail: error?.message || String(error) }, { status: 502, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/search-intelligence') {
      if (request.method === 'GET') {
        const snapshot = await readSearchIntelligence(env);
        return json({
          ok: true,
          connected: Boolean(snapshot),
          snapshot: snapshot ? {
            format: snapshot.format,
            formatVersion: snapshot.formatVersion,
            importedAt: snapshot.importedAt,
            source: snapshot.source,
            rowCount: snapshot.rowCount,
            pageCount: snapshot.pageCount,
            pages: snapshot.pages
          } : null
        }, { headers: corsHeaders });
      }

      if (request.method === 'POST' || request.method === 'PUT') {
        try {
          const body = await request.json();
          const snapshot = normalizeSearchIntelligence(body);
          if (!snapshot.rowCount || !snapshot.pageCount) {
            return json({ ok: false, error: 'No usable page-level Search Console rows were found.' }, { status: 400, headers: corsHeaders });
          }
          const persisted = await writeSearchIntelligence(env, snapshot);
          if (!persisted) return json({ ok: false, error: 'OPPORTUNITY_STATE is required to save Search Intelligence.' }, { status: 503, headers: corsHeaders });
          return json({ ok: true, persistence: 'kv', snapshot: { importedAt: snapshot.importedAt, source: snapshot.source, rowCount: snapshot.rowCount, pageCount: snapshot.pageCount } }, { headers: corsHeaders });
        } catch (error) {
          return json({ ok: false, error: 'Invalid Search Intelligence payload', detail: error?.message || String(error) }, { status: 400, headers: corsHeaders });
        }
      }
    }

    if (url.pathname === '/api/discover' && (request.method === 'GET' || request.method === 'POST')) {
      try {
        let options = {};
        if (request.method === 'POST') options = await request.json().catch(() => ({}));
        const [graph, searchSnapshot] = await Promise.all([
          fetchLinkGraph(),
          readSearchIntelligence(env).catch(() => null)
        ]);
        let generated = generateLinkOpportunities(graph, options?.graph || options || {}).map(item => ({ ...item, generatedAutomatically: true }));
        if (searchSnapshot) generated = enrichItemsWithSearchIntelligence(generated, searchSnapshot);
        const opportunities = discoverOpportunities({ items: generated }, scoringConfig);
        await attachWorkflow(env, opportunities);
        return json({
          generatedAt: new Date().toISOString(),
          mode: searchSnapshot ? 'automatic-link-map-search-intelligence' : 'automatic-link-map',
          graph: { source: DEFAULT_GRAPH_URL, generatedAt: graph.generatedAt || null, pages: graph.pages.length, edges: graph.edges.length },
          searchIntelligence: searchSnapshot ? {
            used: true,
            importedAt: searchSnapshot.importedAt,
            source: searchSnapshot.source,
            pages: searchSnapshot.pageCount,
            rows: searchSnapshot.rowCount,
            matchedOpportunities: opportunities.filter(item => item.searchIntelligenceMatch).length
          } : { used: false },
          summary: summarizeOpportunities(opportunities),
          opportunities
        }, { headers: corsHeaders });
      } catch (error) {
        return json({ ok: false, error: 'Automatic discovery failed', detail: error?.message || String(error) }, { status: 502, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      try {
        const dataset = await request.json();
        let enrichedDataset = dataset;
        let inventory = null;

        if (dataset?.options?.useSiteInventory !== false) {
          inventory = await fetchSiteInventory(siteOrigin);
          enrichedDataset = await enrichWithSiteKnowledge(dataset, inventory, siteOrigin);
        }

        let items = Array.isArray(enrichedDataset?.items) ? enrichedDataset.items : [];
        let searchSnapshot = null;
        if (dataset?.searchIntelligence) searchSnapshot = normalizeSearchIntelligence(dataset.searchIntelligence);
        else if (dataset?.options?.useSavedSearchIntelligence !== false) searchSnapshot = await readSearchIntelligence(env).catch(() => null);
        if (searchSnapshot) items = enrichItemsWithSearchIntelligence(items, searchSnapshot);

        const opportunities = discoverOpportunities({ ...enrichedDataset, items }, scoringConfig);
        await attachWorkflow(env, opportunities);

        return json({
          generatedAt: new Date().toISOString(),
          mode: 'manual-analysis',
          summary: summarizeOpportunities(opportunities),
          siteKnowledge: enrichedDataset.siteKnowledge || null,
          inventoryUsed: Boolean(inventory),
          searchIntelligenceUsed: Boolean(searchSnapshot),
          opportunities
        }, { headers: corsHeaders });
      } catch (error) {
        return json({ ok: false, error: 'Invalid analysis payload', detail: error?.message || String(error) }, { status: 400, headers: corsHeaders });
      }
    }

    const workflowMatch = url.pathname.match(/^\/api\/workflow\/([^/]+)$/);
    if (workflowMatch) {
      const id = decodeURIComponent(workflowMatch[1]);

      if (request.method === 'GET') {
        if (!env.OPPORTUNITY_STATE) return json({ ok: true, persistence: 'browser', record: null }, { headers: corsHeaders });
        return json({ ok: true, persistence: 'kv', record: await readWorkflow(env, id) }, { headers: corsHeaders });
      }

      if (request.method === 'PUT') {
        try {
          const body = await request.json();
          const workflowStatus = String(body.workflowStatus || 'new');
          if (!WORKFLOW_STATUSES.has(workflowStatus)) return json({ ok: false, error: 'Invalid workflow status' }, { status: 400, headers: corsHeaders });
          const record = { id, workflowStatus, notes: String(body.notes || '').slice(0, 5000), updatedAt: new Date().toISOString() };
          const persisted = await writeWorkflow(env, id, record);
          return json({ ok: true, persistence: persisted ? 'kv' : 'browser', record }, { headers: corsHeaders });
        } catch (error) {
          return json({ ok: false, error: 'Invalid workflow payload', detail: error?.message || String(error) }, { status: 400, headers: corsHeaders });
        }
      }
    }

    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Not found' }, { status: 404, headers: corsHeaders });
    return env.ASSETS.fetch(request);
  }
};
