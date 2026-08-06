const DEFAULT_PROJECT_RECORDS_URL = 'https://curator.oceanliners.net/api/project-records';

const normalizeText = value => String(value || '')
  .toLowerCase()
  .replace(/\b(rms|ss|mv|hmhs|hmt|hms)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const normalizeUrl = value => {
  try {
    const url = new URL(String(value || '').trim(), 'https://oceanliners.net');
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

function publicUrl(record) {
  return normalizeUrl(record?.data?.pageUrl || record?.url || record?.path || record?.canonical || record?.href || '');
}

function recordTitle(record) {
  return String(record?.title || record?.name || record?.label || record?.id || '').trim();
}

function recordType(record) {
  return String(record?.type || record?.kind || record?.recordType || 'record').toLowerCase();
}

function confidenceFor(record) {
  const raw = String(record?.metadata?.confidence || record?.confidence || '').toLowerCase();
  if (['verified', 'high', 'certain'].includes(raw)) return 1;
  if (['medium', 'probable', 'likely'].includes(raw)) return 0.7;
  if (['low', 'uncertain', 'tentative'].includes(raw)) return 0.4;
  return 0.65;
}

function sourceCount(record) {
  return Array.isArray(record?.sources) ? record.sources.length : 0;
}

function relationshipTargets(record) {
  if (!Array.isArray(record?.relationships)) return [];
  return record.relationships
    .map(rel => String(rel?.target || rel?.recordId || rel?.id || '').trim())
    .filter(Boolean);
}

function inventoryIndex(inventory) {
  const pages = Array.isArray(inventory?.pages) ? inventory.pages : Array.isArray(inventory) ? inventory : [];
  const byUrl = new Set();
  const byTitle = new Set();
  for (const page of pages) {
    const url = normalizeUrl(page?.url || page?.href || page?.canonical || page?.path || '');
    if (url) byUrl.add(url);
    const title = normalizeText(page?.title || page?.name || page?.label || '');
    if (title) byTitle.add(title);
  }
  return { byUrl, byTitle };
}

export async function fetchProjectRecords(endpoint = DEFAULT_PROJECT_RECORDS_URL) {
  const response = await fetch(endpoint, {
    headers: {
      accept: 'application/json',
      'user-agent': 'CuratorOS-Content-Opportunity/0.7 (+https://content.oceanliners.net)'
    },
    cf: { cacheTtl: 120, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`Project Records returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.records)) throw new Error('Project Records response is missing records[].');
  return payload;
}

export function normalizeProjectRecords(payload, source = 'project-records') {
  const records = Array.isArray(payload) ? payload : Array.isArray(payload?.records) ? payload.records : [];
  return {
    format: 'curatoros-project-records-snapshot',
    formatVersion: 1,
    importedAt: new Date().toISOString(),
    source,
    version: Number(payload?.version || 0),
    updatedAt: payload?.updatedAt || null,
    recordCount: records.length,
    records
  };
}

export function generateEntityOpportunities(snapshot, inventory, options = {}) {
  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  const minReferences = Number(options.minReferences ?? 2);
  const maxOpportunities = Number(options.maxOpportunities ?? 80);
  const allowedTypes = new Set((options.allowedTypes || ['ship', 'company', 'builder', 'shipping-line', 'shipping_line', 'line']).map(v => String(v).toLowerCase()));
  const { byUrl, byTitle } = inventoryIndex(inventory);
  const byId = new Map(records.filter(r => r?.id).map(record => [String(record.id), record]));
  const inbound = new Map(records.filter(r => r?.id).map(record => [String(record.id), []]));

  for (const source of records) {
    for (const target of relationshipTargets(source)) {
      if (!byId.has(target)) continue;
      const list = inbound.get(target) || [];
      list.push(String(source.id || recordTitle(source)));
      inbound.set(target, list);
    }
  }

  const candidates = [];
  for (const record of records) {
    const id = String(record?.id || '').trim();
    const title = recordTitle(record);
    const type = recordType(record);
    if (!id || !title || !allowedTypes.has(type)) continue;

    const url = publicUrl(record);
    const hasCanonical = Boolean(url && byUrl.has(url)) || byTitle.has(normalizeText(title));
    if (hasCanonical) continue;

    const references = [...new Set(inbound.get(id) || [])];
    if (references.length < minReferences) continue;

    const sources = sourceCount(record);
    const confidence = confidenceFor(record);
    const unresolved = [];
    if (sources === 0) unresolved.push('No sources are attached to this Project Record.');
    if (confidence < 0.65) unresolved.push('Project Record confidence is low and should be reviewed before publication.');

    const researchFirst = unresolved.length > 0;
    const importance = Math.min(10, 4 + references.length + Math.min(sources, 3));
    const cluster = type === 'ship' ? 'Project Records · Ships' : 'Project Records · Entities';

    candidates.push({
      id: `project-records-${id.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase()}`,
      title,
      contentType: type === 'ship' ? 'ship guide' : 'entity page',
      cluster,
      canonicalUrl: null,
      opportunityType: researchFirst ? 'research' : 'create',
      entityMentions: references.length,
      potentialLinks: references.length,
      missingLinks: references.length,
      clusterGap: true,
      clusterDepth: references.length,
      searchImpressions: 0,
      averagePosition: 0,
      editorialImportance: importance,
      unresolvedQuestions: unresolved,
      sources: ['project-records'],
      projectRecordEvidence: {
        recordId: id,
        recordType: type,
        inboundRelationships: references.length,
        referringRecordIds: references.slice(0, 20),
        attachedSources: sources,
        confidence,
        publicUrl: url,
        canonicalPageFound: false,
        corpusVersion: snapshot?.version || 0,
        corpusUpdatedAt: snapshot?.updatedAt || null
      },
      generatedAutomatically: true
    });
  }

  return candidates
    .sort((a, b) => b.entityMentions - a.entityMentions || b.editorialImportance - a.editorialImportance || a.title.localeCompare(b.title))
    .slice(0, maxOpportunities);
}

export { DEFAULT_PROJECT_RECORDS_URL };
