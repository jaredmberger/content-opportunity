const els = {
  dataset: document.querySelector('#dataset'),
  loadSample: document.querySelector('#loadSample'),
  analyze: document.querySelector('#analyze'),
  discover: document.querySelector('#discover'),
  topicInput: document.querySelector('#topicInput'),
  analyzeTopic: document.querySelector('#analyzeTopic'),
  topicMeta: document.querySelector('#topicMeta'),
  chooseFile: document.querySelector('#chooseFile'),
  fileInput: document.querySelector('#fileInput'),
  fileName: document.querySelector('#fileName'),
  discoveryMeta: document.querySelector('#discoveryMeta'),
  status: document.querySelector('#status'),
  persistence: document.querySelector('#persistence'),
  summary: document.querySelector('#summary'),
  results: document.querySelector('#results'),
  filters: document.querySelector('#filters'),
  searchQueue: document.querySelector('#searchQueue'),
  workflowFilter: document.querySelector('#workflowFilter')
};

const WORKFLOW_STATUSES = ['new', 'reviewed', 'accepted', 'in-progress', 'completed', 'deferred', 'dismissed'];
const ACTIVE_STATUSES = new Set(['new', 'reviewed', 'accepted', 'in-progress']);
const STORAGE_KEY = 'curatoros-content-opportunity-workflow-v1';
let all = [];
let activeType = 'all';
let serverPersistence = 'browser';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function readLocalWorkflow() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function writeLocalWorkflow(map) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function applyLocalWorkflow(items) {
  if (serverPersistence === 'kv') return items;
  const workflow = readLocalWorkflow();
  return items.map(item => workflow[item.id] ? { ...item, ...workflow[item.id] } : item);
}

async function health() {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error();
    const data = await response.json();
    serverPersistence = data.workflowPersistence || 'browser';
    els.status.textContent = `Engine online · v${data.version}`;
    els.persistence.textContent = serverPersistence === 'kv' ? 'Workflow storage · Cloudflare KV' : 'Workflow storage · this browser';
  } catch {
    els.status.textContent = 'Engine unavailable';
    els.persistence.textContent = 'Storage status unavailable';
  }
}

async function loadSample() {
  const response = await fetch('/sample-data.json');
  els.dataset.value = JSON.stringify(await response.json(), null, 2);
}

function renderSummary() {
  const visible = filteredRows(false);
  const cards = [
    ['Queue', visible.length],
    ['High priority', visible.filter(x => x.priority === 'high').length],
    ['Accepted', all.filter(x => x.workflowStatus === 'accepted').length],
    ['In progress', all.filter(x => x.workflowStatus === 'in-progress').length]
  ];
  els.summary.innerHTML = cards.map(([label, value]) => `<article class="summary-card panel"><strong>${esc(value)}</strong><span>${esc(label)}</span></article>`).join('');
}

function renderFilters() {
  const types = ['all', 'create', 'expand', 'connect', 'research'];
  els.filters.innerHTML = types.map(type => `<button class="filter ${activeType === type ? 'active' : ''}" data-filter="${type}">${type}</button>`).join('');
  els.filters.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    activeType = button.dataset.filter;
    renderFilters();
    renderAll();
  }));
}

function filteredRows(includeType = true) {
  const workflow = els.workflowFilter.value;
  const query = els.searchQueue.value.trim().toLowerCase();
  return all.filter(item => {
    if (includeType && activeType !== 'all' && item.type !== activeType) return false;
    if (workflow === 'active' && !ACTIVE_STATUSES.has(item.workflowStatus || 'new')) return false;
    if (workflow !== 'all' && workflow !== 'active' && (item.workflowStatus || 'new') !== workflow) return false;
    if (query) {
      const haystack = [item.title, item.cluster, item.type, item.recommendation, item.notes].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function workflowOptions(selected) {
  return WORKFLOW_STATUSES.map(status => `<option value="${status}" ${status === selected ? 'selected' : ''}>${status.replace('-', ' ')}</option>`).join('');
}

function graphEvidence(item) {
  if (!item.graphEvidence) return '';
  const g = item.graphEvidence;
  const rows = [];
  if (Number.isFinite(g.incomingLinks)) rows.push(`<div class="evidence-item"><strong>Current inbound links</strong>${esc(g.incomingLinks)}</div>`);
  if (Number.isFinite(g.sharedNeighborStrength)) rows.push(`<div class="evidence-item"><strong>Shared-neighbor strength</strong>${esc(g.sharedNeighborStrength)}</div>`);
  if (Array.isArray(g.suggestions) && g.suggestions.length) rows.push(`<div class="evidence-item"><strong>Graph suggestions</strong>${esc(g.suggestions.length)} strong candidate${g.suggestions.length === 1 ? '' : 's'}</div>`);
  return rows.join('');
}

function siteEvidence(item) {
  const rows = [];
  if (item.generatedAutomatically) rows.push('<div class="evidence-item"><strong>Automatic discovery</strong>Generated from the CuratorOS Link Map</div>');
  if (item.inventoryResolved) rows.push(`<div class="evidence-item"><strong>Site inventory</strong>${item.siteInventoryMatch ? 'Existing canonical verified' : 'No canonical match found'}</div>`);
  if (item.linkInspection?.checked) rows.push(`<div class="evidence-item"><strong>Live link inspection</strong>${esc(item.linkInspection.missingCount)} of ${esc(item.linkInspection.relatedCount)} related links missing</div>`);
  return rows.join('');
}

function graphSuggestionDetails(item) {
  const suggestions = item.graphEvidence?.suggestions;
  if (!Array.isArray(suggestions) || !suggestions.length) return '';
  return `<details><summary>Suggested connections (${esc(suggestions.length)})</summary><div class="missing-links">${suggestions.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} <span>· ${esc(s.sharedNeighbors)} shared neighbor${s.sharedNeighbors === 1 ? '' : 's'}</span></a>`).join('')}</div></details>`;
}

function renderResults() {
  const rows = filteredRows();
  if (!rows.length) {
    els.results.innerHTML = '<div class="empty panel">No opportunities match this queue view.</div>';
    return;
  }

  els.results.innerHTML = rows.map(item => `<article class="opportunity panel" data-id="${esc(item.id)}">
    <div class="opportunity-top">
      <div class="opportunity-main">
        <div>
          <span class="badge">${esc(item.type)}</span>
          <span class="badge">${esc(item.priority)} priority</span>
          <span class="badge">${esc(item.cluster)}</span>
          <span class="badge workflow-badge">${esc((item.workflowStatus || 'new').replace('-', ' '))}</span>
          ${item.generatedAutomatically ? '<span class="badge">auto discovered</span>' : ''}
          ${item.siteInventoryMatch ? '<span class="badge">inventory verified</span>' : ''}
        </div>
        <h3>${esc(item.title)}</h3>
        <p class="recommendation">${esc(item.recommendation)}</p>
        ${item.canonicalUrl ? `<p class="url-line"><a href="${esc(item.canonicalUrl)}" target="_blank" rel="noopener">Open existing page ↗</a></p>` : ''}
        ${item.unresolvedQuestions?.length ? `<p><strong>Open questions:</strong> ${item.unresolvedQuestions.map(esc).join(' · ')}</p>` : ''}
        <div class="evidence">${siteEvidence(item)}${graphEvidence(item)}${(item.evidence || []).slice(0, 5).map(e => `<div class="evidence-item"><strong>${esc(e.label)}</strong>+${esc(e.contribution)} points</div>`).join('')}</div>
        ${graphSuggestionDetails(item)}
        ${item.linkInspection?.missingUrls?.length ? `<details><summary>Missing link targets (${esc(item.linkInspection.missingUrls.length)})</summary><div class="missing-links">${item.linkInspection.missingUrls.map(url => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`).join('')}</div></details>` : ''}
      </div>
      <div class="score"><strong>${esc(item.score)}</strong><span>Opportunity score</span></div>
    </div>
    <div class="workflow-editor">
      <div><label>Workflow status</label><select class="workflow-status">${workflowOptions(item.workflowStatus || 'new')}</select></div>
      <div class="notes-wrap"><label>Editorial notes</label><textarea class="workflow-notes" rows="2" placeholder="Why accept, defer, research further, or what to do next…">${esc(item.notes || '')}</textarea></div>
      <button class="save-workflow secondary">Save</button>
    </div>
  </article>`).join('');

  els.results.querySelectorAll('.save-workflow').forEach(button => button.addEventListener('click', saveWorkflow));
}

function renderAll() { renderSummary(); renderResults(); }

function acceptResults(data) {
  all = applyLocalWorkflow(data.opportunities || []);
  activeType = 'all';
  els.searchQueue.value = '';
  renderFilters();
  renderAll();
}

function topicHaystack(item) {
  const suggestions = Array.isArray(item.graphEvidence?.suggestions)
    ? item.graphEvidence.suggestions.flatMap(s => [s.title, s.url])
    : [];
  return [item.title, item.canonicalUrl, item.cluster, item.type, ...suggestions].filter(Boolean).join(' ').toLowerCase();
}

async function saveWorkflow(event) {
  const card = event.currentTarget.closest('.opportunity');
  const id = card.dataset.id;
  const workflowStatus = card.querySelector('.workflow-status').value;
  const notes = card.querySelector('.workflow-notes').value.trim();
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Saving…';
  const record = { workflowStatus, notes, updatedAt: new Date().toISOString() };

  try {
    const response = await fetch(`/api/workflow/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(record) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Save failed');
    if (data.persistence === 'kv') serverPersistence = 'kv';
    else { const workflow = readLocalWorkflow(); workflow[id] = record; writeLocalWorkflow(workflow); }
    const index = all.findIndex(item => item.id === id);
    if (index >= 0) all[index] = { ...all[index], ...(data.record || record) };
    els.persistence.textContent = serverPersistence === 'kv' ? 'Workflow storage · Cloudflare KV' : 'Workflow storage · this browser';
    button.textContent = data.persistence === 'kv' ? 'Saved to KV' : 'Saved locally';
    setTimeout(() => { button.textContent = 'Save'; }, 1000);
    renderAll();
  } catch {
    const workflow = readLocalWorkflow(); workflow[id] = record; writeLocalWorkflow(workflow);
    const index = all.findIndex(item => item.id === id);
    if (index >= 0) all[index] = { ...all[index], ...record };
    button.textContent = 'Saved locally';
    setTimeout(() => { button.textContent = 'Save'; }, 1200);
    renderAll();
  } finally { button.disabled = false; }
}

async function fetchAutomaticData() {
  const response = await fetch('/api/discover', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || data.error || 'Automatic discovery failed');
  return data;
}

async function discoverAutomatically() {
  els.discover.disabled = true;
  els.discover.textContent = 'Inspecting CuratorOS Link Map…';
  els.discoveryMeta.textContent = 'Reading the current graph and generating high-confidence relationship gaps…';
  try {
    const data = await fetchAutomaticData();
    acceptResults(data);
    const graph = data.graph || {};
    els.discoveryMeta.textContent = `Analyzed ${graph.pages ?? 0} pages and ${graph.edges ?? 0} internal links · ${data.opportunities?.length ?? 0} opportunities surfaced.`;
  } catch (error) {
    els.results.innerHTML = `<div class="empty panel">${esc(error.message)}</div>`;
    els.discoveryMeta.textContent = 'Automatic discovery could not complete.';
  } finally {
    els.discover.disabled = false;
    els.discover.textContent = 'Find Opportunities Automatically';
  }
}

async function analyzeTopic() {
  const query = els.topicInput.value.trim().toLowerCase();
  if (!query) {
    els.topicMeta.textContent = 'Enter a ship, topic, page title, or URL fragment first.';
    els.topicInput.focus();
    return;
  }
  els.analyzeTopic.disabled = true;
  els.analyzeTopic.textContent = 'Analyzing…';
  els.topicMeta.textContent = `Finding graph opportunities related to “${els.topicInput.value.trim()}”…`;
  try {
    const data = await fetchAutomaticData();
    const matches = (data.opportunities || []).filter(item => topicHaystack(item).includes(query));
    acceptResults({ ...data, opportunities: matches });
    els.topicMeta.textContent = matches.length
      ? `${matches.length} opportunity${matches.length === 1 ? '' : 'ies'} found around “${els.topicInput.value.trim()}”.`
      : `No high-confidence Link Map opportunities currently match “${els.topicInput.value.trim()}”.`;
  } catch (error) {
    els.results.innerHTML = `<div class="empty panel">${esc(error.message)}</div>`;
    els.topicMeta.textContent = 'Focused discovery could not complete.';
  } finally {
    els.analyzeTopic.disabled = false;
    els.analyzeTopic.textContent = 'Analyze';
  }
}

async function analyze() {
  els.analyze.disabled = true;
  els.analyze.textContent = 'Analyzing site + opportunities…';
  try {
    const payload = JSON.parse(els.dataset.value || '{}');
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || 'Analysis failed');
    acceptResults(data);
  } catch (error) {
    els.results.innerHTML = `<div class="empty panel">${esc(error.message)}</div>`;
  } finally {
    els.analyze.disabled = false;
    els.analyze.textContent = 'Analyze dataset';
  }
}

function chooseFile() { els.fileInput.click(); }

async function importFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  els.fileName.textContent = file.name;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    els.dataset.value = JSON.stringify(parsed, null, 2);
    document.querySelector('.advanced')?.setAttribute('open', '');
    await analyze();
  } catch (error) {
    els.results.innerHTML = `<div class="empty panel">Could not read ${esc(file.name)}: ${esc(error.message)}</div>`;
  }
}

els.discover.addEventListener('click', discoverAutomatically);
els.analyzeTopic.addEventListener('click', analyzeTopic);
els.topicInput.addEventListener('keydown', event => { if (event.key === 'Enter') analyzeTopic(); });
els.chooseFile.addEventListener('click', chooseFile);
els.fileInput.addEventListener('change', importFile);
els.loadSample.addEventListener('click', loadSample);
els.analyze.addEventListener('click', analyze);
els.searchQueue.addEventListener('input', renderAll);
els.workflowFilter.addEventListener('change', renderAll);
health();
