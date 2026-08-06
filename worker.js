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
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(init.headers || {}) }
});
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  'access-control-allow-headers': 'Content-Type'
};
const WORKFLOW_STATUSES = new Set(['new','reviewed','accepted','in-progress','completed','deferred','dismissed']);
const ACTIVE_WORKFLOW_STATUSES = new Set(['new','reviewed','accepted','in-progress']);
const workflowKey = id => `content-opportunity:workflow:${id}`;
const SEARCH_INTELLIGENCE_KEY = 'content-opportunity:search-intelligence:v1';
const PROJECT_RECORDS_KEY = 'content-opportunity:project-records:v1';
const DISCOVERY_SNAPSHOT_KEY = 'content-opportunity:discovery-snapshot:v1';
const DEFAULT_SEARCH_INTELLIGENCE_URL = 'https://search-intelligence.oceanliners.net/api/search-intelligence';

async function readKvJson(env, key) {
  if (!env.OPPORTUNITY_STATE) return null;
  return env.OPPORTUNITY_STATE.get(key, { type: 'json' });
}
async function writeKvJson(env, key, value) {
  if (!env.OPPORTUNITY_STATE) return false;
  await env.OPPORTUNITY_STATE.put(key, JSON.stringify(value));
  return true;
}
const readWorkflow = (env,id) => readKvJson(env, workflowKey(id));
const writeWorkflow = (env,id,value) => writeKvJson(env, workflowKey(id), value);
const readSearchIntelligence = env => readKvJson(env, SEARCH_INTELLIGENCE_KEY);
const writeSearchIntelligence = (env,v) => writeKvJson(env, SEARCH_INTELLIGENCE_KEY, v);
const readProjectRecords = env => readKvJson(env, PROJECT_RECORDS_KEY);
const writeProjectRecords = (env,v) => writeKvJson(env, PROJECT_RECORDS_KEY, v);
const readDiscoverySnapshot = env => readKvJson(env, DISCOVERY_SNAPSHOT_KEY);
const writeDiscoverySnapshot = (env,v) => writeKvJson(env, DISCOVERY_SNAPSHOT_KEY, v);

function asSearchSnapshot(payload, source) {
  const candidate = payload?.snapshot || payload;
  if (Array.isArray(candidate?.pages) && candidate.pages.length) {
    return {
      format: candidate.format || 'curatoros-search-intelligence', formatVersion: candidate.formatVersion || 1,
      importedAt: candidate.importedAt || candidate.generatedAt || new Date().toISOString(),
      source: candidate.source || source,
      rowCount: Number(candidate.rowCount || candidate.rows || candidate.pages.length),
      pageCount: Number(candidate.pageCount || candidate.pages.length), pages: candidate.pages
    };
  }
  const normalized = normalizeSearchIntelligence(candidate);
  return normalized.pageCount ? { ...normalized, source: normalized.source === 'search-console-import' ? source : normalized.source } : null;
}

async function fetchLiveSearchIntelligence(env) {
  const endpoint = env.SEARCH_INTELLIGENCE_URL || DEFAULT_SEARCH_INTELLIGENCE_URL;
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json', 'user-agent': 'CuratorOS-Content-Opportunity/0.8.2 (+https://content.oceanliners.net)' },
    cf: { cacheTtl: 120, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`Search Intelligence returned HTTP ${response.status}`);
  const snapshot = asSearchSnapshot(await response.json(), endpoint);
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
    const saved = await readWorkflow(env, item.id).catch(() => null);
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
  let autoCompleted = 0, autoReopened = 0;
  if (previous) await Promise.all(changes.resolved.map(async item => {
    const saved = await readWorkflow(env, item.id).catch(() => null);
    const currentStatus = saved?.workflowStatus || 'new';
    if (!ACTIVE_WORKFLOW_STATUSES.has(currentStatus)) return;
    const record = { id:item.id, workflowStatus:'completed', notes:saved?.notes || '', updatedAt:now,
      reconciliation:{ autoCompleted:true, reason:'Opportunity no longer detected after successful reevaluation.', lane:item.lane, resolvedAt:now } };
    if (await writeWorkflow(env,item.id,record)) autoCompleted += 1;
  }));
  await Promise.all(opportunities.map(async item => {
    const saved = await readWorkflow(env,item.id).catch(() => null);
    if (!saved?.reconciliation?.autoCompleted) return;
    const record = { id:item.id, workflowStatus:'new', notes:saved.notes || '', updatedAt:now,
      reconciliation:{ autoCompleted:false, autoReopened:true, reason:'Previously resolved opportunity is detected again.',
        lane:item.projectRecordEvidence?'project-records':item.graphEvidence?'link-map':'other', reopenedAt:now,
        previousResolvedAt:saved.reconciliation.resolvedAt || null } };
    if (await writeWorkflow(env,item.id,record)) autoReopened += 1;
  }));
  await writeDiscoverySnapshot(env, makeDiscoverySnapshot(opportunities)).catch(() => false);
  return { enabled:true, ...reconciliationSummary(changes), autoCompleted, autoReopened, evaluatedLanes };
}

async function safeSource(name, fn) {
  try { return { name, ok:true, value:await fn(), error:null }; }
  catch (error) { return { name, ok:false, value:null, error:error?.message || String(error) }; }
}

function sourceDiagnostics({ graphResult, inventoryResult, searchResolved, projectResolved }) {
  return {
    linkMap: { ok:graphResult.ok, mode:graphResult.ok?'static-dataset':'unavailable', source:DEFAULT_GRAPH_URL, error:graphResult.error },
    siteInventory: { ok:inventoryResult.ok, mode:inventoryResult.ok?'live-index':'unavailable', source:inventoryResult.value?.source || null, error:inventoryResult.error },
    searchIntelligence: { ok:Boolean(searchResolved.snapshot), mode:searchResolved.mode, source:searchResolved.endpoint, error:searchResolved.liveError || null },
    projectRecords: { ok:Boolean(projectResolved.snapshot), mode:projectResolved.mode, source:projectResolved.endpoint, error:projectResolved.liveError || null }
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const siteOrigin = env.SITE_ORIGIN || 'https://www.oceanliners.net';
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:corsHeaders});

    if (url.pathname === '/api/health') {
      const [searchSnapshot, projectSnapshot, discoverySnapshot] = await Promise.all([
        readSearchIntelligence(env).catch(()=>null), readProjectRecords(env).catch(()=>null), readDiscoverySnapshot(env).catch(()=>null)
      ]);
      return json({ ok:true, service:env.APP_NAME || 'CuratorOS Content Opportunity Finder', version:'0.8.2', siteOrigin,
        scoringVersion:scoringConfig.version, workflowPersistence:env.OPPORTUNITY_STATE?'kv':'browser',
        siteInventory:'live-index', automaticSiteEnrichment:true, linkGapInspection:true, automaticGraphDiscovery:true,
        automaticEntityDiscovery:true, lifecycleReconciliation:Boolean(env.OPPORTUNITY_STATE), lastDiscoveryAt:discoverySnapshot?.generatedAt || null,
        linkMapSource:DEFAULT_GRAPH_URL, searchIntelligenceEndpoint:env.SEARCH_INTELLIGENCE_URL || DEFAULT_SEARCH_INTELLIGENCE_URL,
        projectRecordsEndpoint:env.PROJECT_RECORDS_URL || DEFAULT_PROJECT_RECORDS_URL,
        searchIntelligenceFallback:searchSnapshot?{available:true,importedAt:searchSnapshot.importedAt||null,pageCount:searchSnapshot.pageCount||0}:{available:false},
        projectRecordsFallback:projectSnapshot?{available:true,importedAt:projectSnapshot.importedAt||null,recordCount:projectSnapshot.recordCount||0,version:projectSnapshot.version||0}:{available:false}
      },{headers:corsHeaders});
    }

    if (url.pathname === '/api/config' && request.method === 'GET') return json({...scoringConfig,workflowStatuses:[...WORKFLOW_STATUSES]},{headers:corsHeaders});

    if (url.pathname === '/api/site-inventory' && request.method === 'GET') {
      try { return json({ok:true,...await fetchSiteInventory(siteOrigin)},{headers:corsHeaders}); }
      catch(error){ return json({ok:false,error:'Unable to read site inventory',detail:error?.message||String(error)},{status:502,headers:corsHeaders}); }
    }

    if (url.pathname === '/api/link-graph' && request.method === 'GET') {
      try { const graph=await fetchLinkGraph(); return json({ok:true,source:graph.source||DEFAULT_GRAPH_URL,generatedAt:graph.generatedAt||null,pageCount:graph.pages.length,edgeCount:graph.edges.length},{headers:corsHeaders}); }
      catch(error){ return json({ok:false,error:'Unable to read CuratorOS Link Map',detail:error?.message||String(error)},{status:502,headers:corsHeaders}); }
    }

    if (url.pathname === '/api/search-intelligence') {
      if (request.method === 'GET') { const resolved=await resolveSearchIntelligence(env,{preferLive:url.searchParams.get('live')!=='0'}); return json({ok:true,connected:Boolean(resolved.snapshot),...resolved},{headers:corsHeaders}); }
      if (request.method === 'POST' || request.method === 'PUT') {
        try { const snapshot=asSearchSnapshot(await request.json(),'manual-import');
          if(!snapshot?.pageCount) return json({ok:false,error:'No usable page-level Search Console rows were found.'},{status:400,headers:corsHeaders});
          if(!await writeSearchIntelligence(env,snapshot)) return json({ok:false,error:'OPPORTUNITY_STATE is required to save Search Intelligence.'},{status:503,headers:corsHeaders});
          return json({ok:true,persistence:'kv',snapshot:{importedAt:snapshot.importedAt,source:snapshot.source,rowCount:snapshot.rowCount,pageCount:snapshot.pageCount}},{headers:corsHeaders});
        } catch(error){ return json({ok:false,error:'Invalid Search Intelligence payload',detail:error?.message||String(error)},{status:400,headers:corsHeaders}); }
      }
    }

    if (url.pathname === '/api/project-records') {
      if (request.method === 'GET') { const resolved=await resolveProjectRecords(env,{preferLive:url.searchParams.get('live')!=='0'}); return json({ok:true,connected:Boolean(resolved.snapshot),...resolved},{headers:corsHeaders}); }
      if (request.method === 'POST' || request.method === 'PUT') {
        try { const snapshot=normalizeProjectRecords(await request.json(),'manual-import');
          if(!snapshot.recordCount) return json({ok:false,error:'No Project Records were found.'},{status:400,headers:corsHeaders});
          if(!await writeProjectRecords(env,snapshot)) return json({ok:false,error:'OPPORTUNITY_STATE is required to save Project Records.'},{status:503,headers:corsHeaders});
          return json({ok:true,persistence:'kv',snapshot:{importedAt:snapshot.importedAt,recordCount:snapshot.recordCount,version:snapshot.version}},{headers:corsHeaders});
        } catch(error){ return json({ok:false,error:'Invalid Project Records payload',detail:error?.message||String(error)},{status:400,headers:corsHeaders}); }
      }
    }

    if (url.pathname === '/api/reconciliation' && request.method === 'GET') {
      return json({ok:true,enabled:Boolean(env.OPPORTUNITY_STATE),snapshot:await readDiscoverySnapshot(env).catch(()=>null)},{headers:corsHeaders});
    }

    if (url.pathname === '/api/discover' && (request.method === 'GET' || request.method === 'POST')) {
      let options={}; if(request.method==='POST') options=await request.json().catch(()=>({}));
      const [graphResult, inventoryResult, searchResolved, projectResolved] = await Promise.all([
        safeSource('link-map',()=>fetchLinkGraph()), safeSource('site-inventory',()=>fetchSiteInventory(siteOrigin)),
        resolveSearchIntelligence(env,{preferLive:options?.searchIntelligence?.preferLive!==false}),
        resolveProjectRecords(env,{preferLive:options?.projectRecords?.preferLive!==false})
      ]);
      const diagnostics=sourceDiagnostics({graphResult,inventoryResult,searchResolved,projectResolved});
      let generated=[];
      if(graphResult.ok) generated.push(...generateLinkOpportunities(graphResult.value,options?.graph||{}).map(item=>({...item,generatedAutomatically:true})));
      const projectLaneHealthy = Boolean(projectResolved.snapshot) && inventoryResult.ok && projectResolved.mode === 'live';
      if(projectResolved.snapshot && inventoryResult.ok) generated.push(...generateEntityOpportunities(projectResolved.snapshot,inventoryResult.value,options?.projectRecords||{}));
      if(searchResolved.snapshot) generated=enrichItemsWithSearchIntelligence(generated,searchResolved.snapshot);
      const opportunities=discoverOpportunities({items:generated},scoringConfig);
      const evaluatedLanes=[];
      if(graphResult.ok) evaluatedLanes.push('link-map');
      if(projectLaneHealthy) evaluatedLanes.push('project-records');
      const reconciliation=options?.reconciliation?.enabled===false?{enabled:false}:await reconcileWorkflow(env,opportunities,evaluatedLanes);
      await attachWorkflow(env,opportunities);
      const usableSources=Object.values(diagnostics).filter(x=>x.ok).length;
      return json({ ok:true, generatedAt:new Date().toISOString(), mode:'automatic-resilient', degraded:usableSources<4,
        diagnostics,
        graph:graphResult.ok?{source:graphResult.value.source||DEFAULT_GRAPH_URL,generatedAt:graphResult.value.generatedAt||null,pages:graphResult.value.pages.length,edges:graphResult.value.edges.length}:null,
        searchIntelligence:{used:Boolean(searchResolved.snapshot),mode:searchResolved.mode,endpoint:searchResolved.endpoint,fallback:searchResolved.fallback,liveError:searchResolved.liveError||null,pages:searchResolved.snapshot?.pageCount||0,matchedOpportunities:opportunities.filter(i=>i.searchIntelligenceMatch).length},
        projectRecords:{used:Boolean(projectResolved.snapshot)&&inventoryResult.ok,mode:projectResolved.mode,endpoint:projectResolved.endpoint,fallback:projectResolved.fallback,liveError:projectResolved.liveError||null,records:projectResolved.snapshot?.recordCount||0,version:projectResolved.snapshot?.version||0,generatedOpportunities:opportunities.filter(i=>i.projectRecordEvidence).length},
        reconciliation, summary:summarizeOpportunities(opportunities), opportunities
      },{headers:corsHeaders});
    }

    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      try {
        const dataset=await request.json(); let enrichedDataset=dataset, inventory=null;
        if(dataset?.options?.useSiteInventory!==false){ inventory=await fetchSiteInventory(siteOrigin); enrichedDataset=await enrichWithSiteKnowledge(dataset,inventory,siteOrigin); }
        let items=Array.isArray(enrichedDataset?.items)?enrichedDataset.items:[]; let searchSnapshot=null, searchMode='none';
        if(dataset?.searchIntelligence){ searchSnapshot=asSearchSnapshot(dataset.searchIntelligence,'embedded-analysis'); searchMode=searchSnapshot?'embedded':'none'; }
        else if(dataset?.options?.useSearchIntelligence!==false){ const resolved=await resolveSearchIntelligence(env,{preferLive:dataset?.options?.preferLiveSearchIntelligence!==false}); searchSnapshot=resolved.snapshot; searchMode=resolved.mode; }
        if(searchSnapshot) items=enrichItemsWithSearchIntelligence(items,searchSnapshot);
        const opportunities=discoverOpportunities({...enrichedDataset,items},scoringConfig); await attachWorkflow(env,opportunities);
        return json({generatedAt:new Date().toISOString(),mode:'manual-analysis',summary:summarizeOpportunities(opportunities),siteKnowledge:enrichedDataset.siteKnowledge||null,inventoryUsed:Boolean(inventory),searchIntelligenceUsed:Boolean(searchSnapshot),searchIntelligenceMode:searchMode,opportunities},{headers:corsHeaders});
      } catch(error){ return json({ok:false,error:'Invalid analysis payload',detail:error?.message||String(error)},{status:400,headers:corsHeaders}); }
    }

    const workflowMatch=url.pathname.match(/^\/api\/workflow\/([^/]+)$/);
    if(workflowMatch){ const id=decodeURIComponent(workflowMatch[1]);
      if(request.method==='GET'){ if(!env.OPPORTUNITY_STATE)return json({ok:true,persistence:'browser',record:null},{headers:corsHeaders}); return json({ok:true,persistence:'kv',record:await readWorkflow(env,id)},{headers:corsHeaders}); }
      if(request.method==='PUT'){
        try{ const body=await request.json(); const workflowStatus=String(body.workflowStatus||'new');
          if(!WORKFLOW_STATUSES.has(workflowStatus))return json({ok:false,error:'Invalid workflow status'},{status:400,headers:corsHeaders});
          const record={id,workflowStatus,notes:String(body.notes||'').slice(0,5000),updatedAt:new Date().toISOString(),reconciliation:null};
          const persisted=await writeWorkflow(env,id,record); return json({ok:true,persistence:persisted?'kv':'browser',record},{headers:corsHeaders});
        }catch(error){return json({ok:false,error:'Invalid workflow payload',detail:error?.message||String(error)},{status:400,headers:corsHeaders});}
      }
    }
    if(url.pathname.startsWith('/api/'))return json({ok:false,error:'Not found'},{status:404,headers:corsHeaders});
    return env.ASSETS.fetch(request);
  }
};
