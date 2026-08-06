const els = {
  dataset: document.querySelector('#dataset'),
  loadSample: document.querySelector('#loadSample'),
  analyze: document.querySelector('#analyze'),
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

const esc = value => String(value ?? '').replace(/[&<>'\"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;'
}[char]));

function readLocalWorkflow() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
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
        </div>
        <h3>${esc(item.title)}</h3>
        <p class="recommendation">${esc(item.recommendation)}</p>
        ${item.canonicalUrl ? `<p class="url-line"><a href="${esc(item.canonicalUrl)}" target="_blank" rel="noopener">Open existing page ↗</a></p>` : ''}
        ${item.unresolvedQuestions?.length ? `<p><strong>Open questions:</strong> ${item.unresolvedQuestions.map(esc).join(' · ')}</p>` : ''}
        <div class="evidence">${(item.evidence || []).slice(0, 5).map(e => `<div class="evidence-item"><strong>${esc(e.label)}</strong>+${esc(e.contribution)} points</div>`).join('')}</div>
      </div>
      <div class="score"><strong>${esc(item.score)}</strong><span>Opportunity score</span></div>
    </div>
    <div class="workflow-editor">
      <div>
        <label>Workflow status</label>
        <select class="workflow-status">${workflowOptions(item.workflowStatus || 'new')}</select>
      </div>
      <div class="notes-wrap">
        <label>Editorial notes</label>
        <textarea class="workflow-notes" rows="2" placeholder="Why accept, defer, research further, or what to do next…">${esc(item.notes || '')}</textarea>
      </div>
      <button class="save-workflow secondary">Save</button>
    </div>
  </article>`).join('');

  els.results.querySelectorAll('.save-workflow').forEach(button => button.addEventListener('click', saveWorkflow));
}

function renderAll() {
  renderSummary();
  renderResults();
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
    const response = await fetch(`/api/workflow/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Save failed');

    if (data.persistence === 'kv') {
      serverPersistence = 'kv';
    } else {
      const workflow = readLocalWorkflow();
      workflow[id] = record;
      writeLocalWorkflow(workflow);
    }

    const index = all.findIndex(item => item.id === id);
    if (index >= 0) all[index] = { ...all[index], ...(data.record || record) };

    els.persistence.textContent = serverPersistence === 'kv' ? 'Workflow storage · Cloudflare KV' : 'Workflow storage · this browser';
    button.textContent = data.persistence === 'kv' ? 'Saved to KV' : 'Saved locally';
    setTimeout(() => { button.textContent = 'Save'; }, 1000);
    renderAll();
  } catch {
    const workflow = readLocalWorkflow();
    workflow[id] = record;
    writeLocalWorkflow(workflow);
    const index = all.findIndex(item => item.id === id);
    if (index >= 0) all[index] = { ...all[index], ...record };
    button.textContent = 'Saved locally';
    setTimeout(() => { button.textContent = 'Save'; }, 1200);
    renderAll();
  } finally {
    button.disabled = false;
  }
}

async function analyze() {
  els.analyze.disabled = true;
  els.analyze.textContent = 'Analyzing…';
  try {
    const payload = JSON.parse(els.dataset.value || '{}');
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || 'Analysis failed');
    all = applyLocalWorkflow(data.opportunities || []);
    activeType = 'all';
    renderFilters();
    renderAll();
  } catch (error) {
    els.results.innerHTML = `<div class="empty panel">${esc(error.message)}</div>`;
  } finally {
    els.analyze.disabled = false;
    els.analyze.textContent = 'Analyze opportunities';
  }
}

els.loadSample.addEventListener('click', loadSample);
els.analyze.addEventListener('click', analyze);
els.searchQueue.addEventListener('input', renderAll);
els.workflowFilter.addEventListener('change', renderAll);
health();
loadSample();
