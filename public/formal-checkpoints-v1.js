(() => {
  'use strict';

  const CHECKPOINTS = [7, 14, 28];
  const PREFIX = '--- CuratorOS verification checkpoint D';
  const normalized = (value = '') => {
    try {
      const url = new URL(String(value), 'https://oceanliners.net');
      let path = url.pathname || '/';
      path = path.replace(/\/index\.html?$/i, '/').replace(/\.html?$/i, '');
      if (path.length > 1) path = path.replace(/\/$/, '');
      return path.toLowerCase();
    } catch { return String(value || '').trim().toLowerCase(); }
  };
  const field = (notes, label) => {
    const match = String(notes || '').match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'));
    return match ? match[1].trim() : '';
  };
  const productionStart = notes => field(notes, 'Production start') || field(notes, 'Merged');
  const ageDays = iso => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  const hasCheckpoint = (notes, day) => String(notes || '').includes(`${PREFIX}${day} ---`);

  async function searchObservation(path) {
    try {
      const response = await fetch('/api/search-intelligence?live=1', { cache: 'no-store' });
      const data = await response.json();
      const pages = data?.snapshot?.pages || data?.pages || [];
      const row = pages.find(x => normalized(x.path || x.page || x.url) === path);
      if (!row) return { available:false, reason:'No matching Search Intelligence page row' };
      return {
        available:true,
        clicks:Number(row.clicks || 0),
        impressions:Number(row.impressions || 0),
        ctr:Number(row.ctr || 0),
        position:Number(row.position || 0),
        snapshotDate:data?.snapshot?.importedAt || data?.snapshot?.generatedAt || data?.generatedAt || ''
      };
    } catch (error) { return { available:false, reason:error?.message || String(error) }; }
  }

  function analyticsObservation(path) {
    return new Promise(resolve => {
      const callback = `__curatorCheckpointAnalytics_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      const timer = setTimeout(() => finish({ available:false, reason:'Analytics checkpoint timed out' }), 12000);
      function finish(value) {
        clearTimeout(timer);
        try { delete window[callback]; } catch {}
        script.remove();
        resolve(value);
      }
      window[callback] = payload => {
        const row = (payload?.pageSignals || []).find(x => normalized(x.entity) === path);
        if (!row) return finish({ available:false, reason:'No matching Analytics page signal' });
        finish({ available:true, observedAt:row.observedAt || payload.generatedAt || '', periodDays:row.periodDays || 28, ...row.metrics });
      };
      script.onerror = () => finish({ available:false, reason:'Analytics checkpoint feed unavailable' });
      script.src = `https://analytics.oceanliners.net/api/curator-intelligence?callback=${encodeURIComponent(callback)}&v=${Date.now()}`;
      document.head.appendChild(script);
    });
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function checkpointText(day, start, path, observedAt, actualAge, search, analytics, fingerprint) {
    const lines = [
      `${PREFIX}${day} ---`,
      `Scheduled checkpoint: Day ${day}`,
      `Production start: ${start}`,
      `Observed: ${observedAt}`,
      `Actual age: ${actualAge} days`,
      `Canonical path: ${path}`,
      search.available ? `Search: clicks=${search.clicks}; impressions=${search.impressions}; ctr=${search.ctr}; position=${search.position}` : `Search: unavailable (${search.reason || 'no data'})`,
      analytics.available ? `Analytics: views=${analytics.views || 0}; users=${analytics.users || 0}; viewChangePct=${analytics.viewChangePct ?? 'n/a'}; avgEngagementSeconds=${analytics.avgEngagementSeconds ?? 'n/a'}; periodDays=${analytics.periodDays || 28}` : `Analytics: unavailable (${analytics.reason || 'no data'})`,
      `Fingerprint SHA-256: ${fingerprint}`
    ];
    return lines.join('\n');
  }

  async function save(item, day) {
    const start = productionStart(item.notes);
    if (!start) return;
    const path = normalized(field(item.notes, 'Canonical URL') || field(item.notes, 'Canonical target') || item.canonicalUrl);
    if (!path) return;
    const actualAge = ageDays(start);
    const observedAt = new Date().toISOString();
    const [search, analytics] = await Promise.all([searchObservation(path), analyticsObservation(path)]);
    const payload = JSON.stringify({ schemaVersion:1, checkpointDay:day, productionStart:start, observedAt, actualAge, canonicalPath:path, search, analytics });
    const fingerprint = await sha256(payload);
    const receipt = checkpointText(day, start, path, observedAt, actualAge, search, analytics, fingerprint);
    const notes = `${String(item.notes || '').trim()}\n\n${receipt}`.trim().slice(0, 5000);
    const response = await fetch(`/api/workflow/${encodeURIComponent(item.id)}`, {
      method:'PUT', headers:{ 'content-type':'application/json', accept:'application/json' },
      body:JSON.stringify({ workflowStatus:item.workflowStatus || 'completed', notes })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `Checkpoint save returned HTTP ${response.status}`);
    item.notes = notes;
    window.dispatchEvent(new CustomEvent('content-opportunity:checkpoint-saved', { detail:{ opportunityId:item.id, day, observedAt, fingerprint } }));
  }

  async function inspect() {
    const items = window.__CONTENT_OPPORTUNITY_ITEMS__ || [];
    for (const item of items) {
      if ((item.workflowStatus || '') !== 'completed') continue;
      const start = productionStart(item.notes);
      if (!start) continue;
      const age = ageDays(start);
      for (const day of CHECKPOINTS) {
        if (age < day || hasCheckpoint(item.notes, day)) continue;
        try { await save(item, day); }
        catch (error) { console.warn(`[Content Opportunity] Day ${day} checkpoint unavailable`, error); }
      }
    }
  }

  window.addEventListener('content-opportunity:published', () => setTimeout(inspect, 400));
  window.addEventListener('content-opportunity:render', () => setTimeout(inspect, 700));
  window.addEventListener('focus', () => setTimeout(inspect, 300));
  window.addEventListener('load', () => setTimeout(inspect, 1800));
})();
