import scoringConfig from './config/scoring.json' with { type: 'json' };
import { discoverOpportunities, summarizeOpportunities } from './src/discovery.js';
import { fetchSiteInventory } from './src/site-inventory.js';
import { enrichWithSiteKnowledge } from './src/site-enrichment.js';
import { fetchLinkGraph, generateLinkOpportunities, DEFAULT_GRAPH_URL } from './src/link-graph.js';
import { normalizeSearchIntelligence, enrichItemsWithSearchIntelligence } from './src/search-intelligence.js';
import { fetchProjectRecords, normalizeProjectRecords, generateEntityOpportunities, DEFAULT_PROJECT_RECORDS_URL } from './src/project-records.js';
import { makeDiscoverySnapshot, compareDiscovery, reconciliationSummary } from './src/reconciliation.js';

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
const ACTIVE_WORKFLOW_STATUSES = new Set(['new', 'reviewed', 'accepted', 'in-progress']);
const workflowKey = id => `content-opportunity:workflow:${id}`;
const SEARCH_INTELLIGENCE_KEY = 'content-opportunity:search-intelligence:v1';
const PROJECT_RECORDS_KEY = 'content-opportunity:project-records:v1';
const DISCOVERY_SNAPSHOT_KEY = 'content-opportunity:discovery-snapshot:v1';
const DEFAULT_SEARCH_INTELLIGENCE_URL = 'https://search-intelligence.oceanliners.net/api/search-intelligence';

async function readWorkflow(env, id) {
  if (!env.OPPORTUNITY_STATE) return null;
  return env.OPPORTUNITY_STATE.get(workflowKey(id), { type: 'json' });
}

async function writeWorkflow(env, id, value) {
  if (!env.OPPORTUNITY_STATE) return false;
  await env.OPPORTUNITY_STATE.put(workflowKey(id), JSON.stringify(value));
  return true;
}

async function readKvJson(env, key) {
  if (!env.OPPORTUNITY_STATE) return null;
  return env.OPPORTUNITY_STATE.get(key, { type: 'json' });
}

async function writeKvJson(env, key, value) {
  if (!env.OPPORTUNITY_STATE) return false;
  await env.OPPORTUNITY_STATE.put(key, JSON.stringify(value));
  return true;
}

const readSearchIntelligence = env => readKvJson(env, SEARCH_INTELLIGENCE_KEY);
const writeSearchIntelligence = (env, snapshot) => writeKvJson(env, SEARCH_INTELLIGENCE_KEY, snapshot);
const readProjectRecords = env => readKvJson(env, PROJECT_RECORDS_KEY);
const writeProjectRecords = (env, snapshot) => writeKvJson(env, PROJECT_RECORDS_KEY, snapshot);
const readDiscoverySnapshot = env => readKvJson(env, DISCOVERY_SNAPSHOT_KEY);
const writeDiscoverySnapshot = (env, snapshot) => writeKvJson(env, DISCOVERY_SNAPSHOT_KEY, snapshot);

function asSearchSnapshot(payload, source) {
  const candidate = payload?.snapshot || payload;
  if (Array.isArray(candidate?.pages) && candidate.pages.length) {
    return {
      format: candidate.format || 'curatoros-search-intelligence',
      formatVersion: candidate.formatVersion || 1,
      importedAt: candidate.importedAt || candidate.generatedAt || new Date().toISOString(),
      source: candidate.source || source,
      rowCount: Number(candidate.rowCount || candidate.rows || candidate.pages.length),
      pageCount: Number(candidate.pageCount || candidate.pages.length),
      pages: candidate.pages
    };
  }
  const normalized = normalizeSearchIntelligence(candidate);
  return normalized.pageCount ? { ...normalized, source: normalized.source === 'search-console-import' ? source : normalized.source } : null;
}

async function fetchLiveSearchIntelligence(env) {
  const endpoint = env.SEARCH_INTELLIGENCE_URL || DEFAULT_SEARCH_INTELLIGENCE_URL;
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json', 'user-agent': 'CuratorOS-Content-Opportunity/0.8 (+https://content.oceanliners.net)' },
    cf: { cacheTtl: 120, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`Search Intelligence returned HTTP ${response.status}`);
  const payload = await response.json();
  const snapshot = asSearchSnapshot(payload, endpoint);
  if (!snapshot?.pageCount) throw new Error('Search Intelligence returned no usable page metrics.');
  return { snapshot, endpoint };
}

async function resolveSearchIntelligence(env, { preferLive = true } = {}) {
  const endpoint = env.SEARCH_INTELLIGENCE_URL || DEFAULT_SEARCH_INTELLIGENCE_URL;
  if (preferLive) {
    try {
      const live = await fetchLiveSearchIntelligence(env);
      await writeSearchIntelligence(env, live.snapshot).catch(() => false);
      return { snapshot: live.snapshot, mode: 'live', endpoint: live.endpoint, fallback: false };
    } catch (error) {
      const saved = await readSearchIntelligence(env).catch(() => null);
      if (saved) return { snapshot: saved, mode: 'kv-fallback', endpoint, fallback: true, liveError: error?.message || String(error) };
      return { snapshot: null, mode: 'unavailable', endpoint, fallback: false, liveError: error?.message || String(error) };
    }
  }
  const saved = await readSearchIntelligence(env).catch(() => null);
  return { snapshot: saved, mode: saved ? 'kv' : 'unavailable', endpoint, fallback: false };
}

async function resolveProjectRecords(env, { preferLive = true } = {}) {
  const endpoint = env.PROJECT_RECORDS_URL || DEFAULT_PROJECT_RECORDS_URL;
  if (preferLive) {
    try {
      const payload = await fetchProjectRecords(endpoint);
      const snapshot = normalizeProjectRecords(payload, endpoint);
      await writeProjectRecords(env, snapshot).catch(() => false);
      return { snapshot, mode: 'live', endpoint, fallback: false };
    } catch (error) {
      const saved = await readProjectRecords(env).catch(() => null);
      if (saved) return { snapshot: saved, mode: 'kv-fallback', endpoint, fallback: true, liveError: error?.message || String(error) };
      return { snapshot: null, mode: 'unavailable', endpoint, fallback: false, liveError: error?.message || String(error) };
    }
  }
  const saved = await readProjectRecords(env).catch(() => null);
  return { snapshot: saved, mode: saved ? 'kv' : 'unavailable', endpoint, fallback: false };
}

async function attachWorkflow(env, opportunities) {
  if (!env.OPPORTUNITY_STATE) return opportunities;
  await Promise.all(opportunities.map(async item => {
    const saved = await readWorkflow(env, item.id);
    if (!saved) return;
    item.workflowStatus = saved.workflowStatus || item.workflowStatus;
    item.notes = saved.notes || '';
    item.updatedAt = saved.updatedAt || null;
    item.reconciliation = saved.reconciliation || null;
  }));
  return opportunities;
}

async function reconcileWorkflow(env, opportunities, evaluatedLanes) {
  if (!env.OPPORTUNITY_STATE) return { enabled: false, ...reconciliationSummary() };
  const previous = await readDiscoverySnapshot(env).catch(() => null);
  const changes = compareDiscovery(previous, opportunities, evaluatedLanes);
  const now = new Date().toISOString();
  let autoCompleted = 0;
  let autoReopened = 0;

  if (previous) {
    await Promise.all(changes.resolved.map(async item => {
      const saved = await readWorkflow(env, item.id).catch(() => null);
      const currentStatus = saved?.workflowStatus || 'new';
      if (!ACTIVE_WORKFLOW_STATUSES.has(currentStatus)) return;
      const record = {
        id: item.id,
        workflowStatus: 'completed',
        notes: saved?.notes || '',
        updatedAt: now,
        reconciliation: {
          autoCompleted: true,
          reason: 'Opportunity no longer detected after successful reevaluation.',
          lane: item.lane,
          resolvedAt: now
        }
      };
      if (await writeWorkflow(env, item.id, record)) autoCompleted += 1;
    }));
  }

  await Promise.all(opportunities.map(async item => {
    const saved = await readWorkflow(env, item.id).catch(() => null);
    if (!saved?.reconciliation?.autoCompleted) return;
    const record = {
      id: item.id,
      workflowStatus: 'new',
      notes: saved.notes || '',
      updatedAt: now,
      reconciliation: {
        autoCompleted: false,
        autoReopened: true,
        reason: 'Previously resolved opportunity is detected again.',
        lane: item.projectRecordEvidence ? 'project-records' : item.graphEvidence ? 'link-map' : 'other',
        reopenedAt: now,
        previousResolvedAt: saved.reconciliation.resolvedAt || null
      }
    };
    if (await writeWorkflow(env, item.id, record)) autoReopened += 1;
  }));

  await writeDiscoverySnapshot(env, makeDiscoverySnapshot(opportunities)).catch(() => false);
  return {
    enabled: true,
    ...reconciliationSummary(changes),
    autoCompleted,
    autoReopened,
    evaluatedLanes
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const siteOrigin = env.SITE_ORIGIN || 'https://www.oceanliners.net';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    if (url.pathname === '/api/health') {
      const [searchSnapshot, projectSnapshot, discoverySnapshot] = await Promise.all([
        readSearchIntelligence(env).catch(() => null),
        readProjectRecords(env).catch(() => null),
        readDiscoverySnapshot(env).catch(() => null)
      ]);
      return json({
        ok: true,
        service: env.APP_NAME || 'CuratorOS Content Opportunity Finder',
        version: '0.8.0',
        siteOrigin,
        scoringVersion: scoringConfig.version,
        workflowPersistence: env.OPPORTUNITY_STATE ? 'kv' : 'browser',
        siteInventory: 'live-index',
        automaticSiteEnrichment: true,
        linkGapInspection: true,
        automaticGraphDiscovery: true,
        automaticEntityDiscovery: true,
        lifecycleReconciliation: Boolean(env.OPPORTUNITY_STATE),
        lastDiscoveryAt: discoverySnapshot?.generatedAt || null,
        linkMapSource: DEFAULT_GRAPH_URL,
        searchIntelligenceEndpoint: env.SEARCH_INTELLIGENCE_URL || DEFAULT_SEARCH_INTELLIGENCE_URL,
        projectRecordsEndpoint: env.PROJECT_RECORDS_URL || DEFAULT_PROJECT_RECORDS_URL,
        searchIntelligenceFallback: searchSnapshot ? { available: true, importedAt: searchSnapshot.importedAt || null, pageCount: searchSnapshot.pageCount || 0 } : { available: false },
        projectRecordsFallback: projectSnapshot ? { available: true, importedAt: projectSnapshot.importedAt || null, recordCount: projectSnapshot.recordCount || 0, version: projectSnapshot.version || 0 } : { available: false }
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
        const resolved = await resolveSearchIntelligence(env, { preferLive: url.searchParams.get('live') !== '0' });
        return json({ ok: true, connected: Boolean(resolved.snapshot), ...resolved }, { headers: corsHeaders });
      }
      if (request.method === 'POST' || request.method === 'PUT') {
        try {
          const body = await request.json();
          const snapshot = asSearchSnapshot(body, 'manual-import');
          if (!snapshot?.pageCount) return json({ ok: false, error: 'No usable page-level Search Console rows were found.' }, { status: 400, headers: corsHeaders });
          const persisted = await writeSearchIntelligence(env, snapshot);
          if (!persisted) return json({ ok: false, error: 'OPPORTUNITY_STATE is required to save Search Intelligence.' }, { status: 503, headers: corsHeaders });
          return json({ ok: true, persistence: 'kv', snapshot: { importedAt: snapshot.importedAt, source: snapshot.source, rowCount: snapshot.rowCount, pageCount: snapshot.pageCount } }, { headers: corsHeaders });
        } catch (error) {
          return json({ ok: false, error: 'Invalid Search Intelligence payload', detail: error?.message || String(error) }, { status: 400, headers: corsHeaders });
        }
      }
    }

    if (url.pathname === '/api/project-records') {
      if (request.method === 'GET') {
        const resolved = await resolveProjectRecords(env, { preferLive: url.searchParams.get('live') !== '0' });
        return json({ ok: true, connected: Boolean(resolved.snapshot), ...resolved }, { headers: corsHeaders });
      }
      if (request.method === 'POST' || request.method === 'PUT') {
        try {
          const body = await request.json();
          const snapshot = normalizeProjectRecords(body, 'manual-import');
          if (!snapshot.recordCount) return json({ ok: false, error: 'No Project Records were found.' }, { status: 400, headers: corsHeaders });
          const persisted = await writeProjectRecords(env, snapshot);
          if (!persisted) return json({ ok: false, error: 'OPPORTUNITY_STATE is required to save Project Records.' }, { status: 503, headers: corsHeaders });
          return json({ ok: true, persistence: 'kv', snapshot: { importedAt: snapshot.importedAt, recordCount: snapshot.recordCount, version: snapshot.version } }, { headers: corsHeaders });
        } catch (error) {
          return json({ ok: false, error: 'Invalid Project Records payload', detail: error?.message || String(error) }, { status: 400, headers: corsHeaders });
        }
      }
    }

    if (url.pathname === '/api/reconciliation' && request.method === 'GET') {
      const snapshot = await readDiscoverySnapshot(env).catch(() => null);
      return json({ ok: true, enabled: Boolean(env.OPPORTUNITY_STATE), snapshot }, { headers: corsHeaders });
    }

    if (url.pathname === '/api/discover' && (request.method === 'GET' || request.method === 'POST')) {
      try {
        let options = {};
        if (request.method === 'POST') options = await request.json().catch(() => ({}));
        const [graph, searchResolved, projectResolved, inventory] = await Promise.all([
          fetchLinkGraph(),
          resolveSearchIntelligence(env, { preferLive: options?.searchIntelligence?.preferLive !== false }),
          resolveProjectRecords(env, { preferLive: options?.projectRecords?.preferLive !== false }),
          fetchSiteInventory(siteOrigin)
        ]);

        let generated = generateLinkOpportunities(graph, options?.graph || {}).map(item => ({ ...item, generatedAutomatically: true }));
        if (projectResolved.snapshot) {
          generated.push(...generateEntityOpportunities(projectResolved.snapshot, inventory, options?.projectRecords || {}));
        }
        if (searchResolved.snapshot) generated = enrichItemsWithSearchIntelligence(generated, searchResolved.snapshot);

        const opportunities = discoverOpportunities({ items: generated }, scoringConfig);
        const evaluatedLanes = ['link-map'];
        if (projectResolved.snapshot) evaluatedLanes.push('project-records');
        const reconciliation = options?.reconciliation?.enabled === false
          ? { enabled: false }
          : await reconcileWorkflow(env, opportunities, evaluatedLanes);
        await attachWorkflow(env, opportunities);

        return json({
          generatedAt: new Date().toISOString(),
          mode: projectResolved.snapshot ? 'automatic-full-intelligence' : searchResolved.snapshot ? 'automatic-link-map-search-intelligence' : 'automatic-link-map',
          graph: { source: DEFAULT_GRAPH_URL, generatedAt: graph.generatedAt || null, pages: graph.pages.length, edges: graph.edges.length },
          searchIntelligence: {
            used: Boolean(searchResolved.snapshot), mode: searchResolved.mode, endpoint: searchResolved.endpoint, fallback: searchResolved.fallback,
            liveError: searchResolved.liveError || null, pages: searchResolved.snapshot?.pageCount || 0,
            matchedOpportunities: opportunities.filter(item => item.searchIntelligenceMatch).length
          },
          projectRecords: {
            used: Boolean(projectResolved.snapshot), mode: projectResolved.mode, endpoint: projectResolved.endpoint, fallback: projectResolved.fallback,
            liveError: projectResolved.liveError || null, records: projectResolved.snapshot?.recordCount || 0, version: projectResolved.snapshot?.version || 0,
            generatedOpportunities: opportunities.filter(item => item.projectRecordEvidence).length
          },
          reconciliation,
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
        let searchMode = 'none';
        if (dataset?.searchIntelligence) {
          searchSnapshot = asSearchSnapshot(dataset.searchIntelligence, 'embedded-analysis');
          searchMode = searchSnapshot ? 'embedded' : 'none';
        } else if (dataset?.options?.useSearchIntelligence !== false) {
          const resolved = await resolveSearchIntelligence(env, { preferLive: dataset?.options?.preferLiveSearchIntelligence !== false });
          searchSnapshot = resolved.snapshot;
          searchMode = resolved.mode;
        }
        if (searchSnapshot) items = enrichItemsWithSearchIntelligence(items, searchSnapshot);
        const opportunities = discoverOpportunities({ ...enrichedDataset, items }, scoringConfig);
        await attachWorkflow(env, opportunities);
        return json({ generatedAt: new Date().toISOString(), mode: 'manual-analysis', summary: summarizeOpportunities(opportunities), siteKnowledge: enrichedDataset.siteKnowledge || null, inventoryUsed: Boolean(inventory), searchIntelligenceUsed: Boolean(searchSnapshot), searchIntelligenceMode: searchMode, opportunities }, { headers: corsHeaders });
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
          const record = { id, workflowStatus, notes: String(body.notes || '').slice(0, 5000), updatedAt: new Date().toISOString(), reconciliation: null };
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
