(() => {
  'use strict';

  const CHECKED = new Set();
  const RECEIPT_MARKER = '--- Page Studio production receipt ---';
  const PUBLICATION_MARKER = '--- CuratorOS publication receipt ---';
  const BASELINE_MARKER = '--- CuratorOS production baseline ---';

  function parseReceipt(notes = '') {
    if (!String(notes).includes(RECEIPT_MARKER)) return null;
    const get = (label) => {
      const match = String(notes).match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'));
      return match ? match[1].trim() : '';
    };
    const repository = get('Repository');
    const prNumber = Number(String(get('Pull request')).replace(/^#/, ''));
    if (!repository || !Number.isInteger(prNumber) || prNumber <= 0) return null;
    return { repository, prNumber, prUrl:get('Pull request URL'), branch:get('Branch'), filePath:get('File path'), canonicalUrl:get('Canonical target') };
  }

  async function githubPr(receipt) {
    const [owner, repo] = receipt.repository.split('/');
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${receipt.prNumber}`, { headers:{accept:'application/vnd.github+json'}, cache:'no-store' });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    return response.json();
  }

  function finite(value) { const n=Number(value); return Number.isFinite(n) ? n : null; }

  function baselineFor(item, receipt, pr) {
    const evidence = item?.evidence && typeof item.evidence === 'object' ? item.evidence : {};
    const productionStartedAt = pr.merged_at || new Date().toISOString();
    const search = {
      clicks: finite(item.searchClicks ?? evidence.searchClicks),
      impressions: finite(item.searchImpressions ?? evidence.searchImpressions),
      ctr: finite(item.searchCtr ?? evidence.searchCtr),
      position: finite(item.averagePosition ?? evidence.averagePosition)
    };
    const analytics = {
      views: finite(evidence.views ?? item.analyticsViews),
      users: finite(evidence.users ?? item.analyticsUsers),
      avgEngagementSeconds: finite(evidence.avgEngagementSeconds ?? item.avgEngagementSeconds),
      viewChangePct: finite(evidence.viewChangePct)
    };
    const searchAvailable = Object.values(search).some(v => v !== null);
    const analyticsAvailable = Object.values(analytics).some(v => v !== null);
    return {
      productionStartedAt,
      canonicalUrl: receipt.canonicalUrl || item.canonicalUrl || '',
      search: searchAvailable ? search : null,
      analytics: analyticsAvailable ? analytics : null,
      evidenceState: searchAvailable && analyticsAvailable ? 'search+analytics' : searchAvailable ? 'search-only' : analyticsAvailable ? 'analytics-only' : 'timestamp-only'
    };
  }

  function publicationNotes(item, receipt, pr, baseline) {
    const previous = String(item.notes || '')
      .replace(new RegExp(`\\n?${PUBLICATION_MARKER}[\\s\\S]*$`, 'm'), '')
      .replace(new RegExp(`\\n?${BASELINE_MARKER}[\\s\\S]*$`, 'm'), '')
      .trim();
    const lines = [
      previous,
      PUBLICATION_MARKER,
      'Status: Published',
      `Opportunity: ${item.id}`,
      baseline.canonicalUrl ? `Canonical URL: ${baseline.canonicalUrl}` : '',
      `Repository: ${receipt.repository}`,
      receipt.filePath ? `File path: ${receipt.filePath}` : '',
      receipt.branch ? `Branch: ${receipt.branch}` : '',
      `Pull request: #${receipt.prNumber}`,
      `Pull request URL: ${pr.html_url || receipt.prUrl || ''}`,
      pr.merge_commit_sha ? `Merge commit: ${pr.merge_commit_sha}` : '',
      `Merged: ${baseline.productionStartedAt}`,
      `Verified by CuratorOS: ${new Date().toISOString()}`,
      '',
      BASELINE_MARKER,
      `Production start: ${baseline.productionStartedAt}`,
      `Baseline evidence: ${baseline.evidenceState}`,
      baseline.search?.clicks !== null && baseline.search?.clicks !== undefined ? `Search clicks: ${baseline.search.clicks}` : '',
      baseline.search?.impressions !== null && baseline.search?.impressions !== undefined ? `Search impressions: ${baseline.search.impressions}` : '',
      baseline.search?.ctr !== null && baseline.search?.ctr !== undefined ? `Search CTR: ${baseline.search.ctr}` : '',
      baseline.search?.position !== null && baseline.search?.position !== undefined ? `Search position: ${baseline.search.position}` : '',
      baseline.analytics?.views !== null && baseline.analytics?.views !== undefined ? `Analytics views: ${baseline.analytics.views}` : '',
      baseline.analytics?.users !== null && baseline.analytics?.users !== undefined ? `Analytics users: ${baseline.analytics.users}` : '',
      baseline.analytics?.avgEngagementSeconds !== null && baseline.analytics?.avgEngagementSeconds !== undefined ? `Analytics engagement seconds: ${baseline.analytics.avgEngagementSeconds}` : '',
      baseline.analytics?.viewChangePct !== null && baseline.analytics?.viewChangePct !== undefined ? `Analytics prior change: ${baseline.analytics.viewChangePct}` : '',
      baseline.evidenceState === 'timestamp-only' ? 'Baseline note: No page-level Search or Analytics values were attached at publication; verification must use production start as the temporal anchor.' : ''
    ];
    return lines.filter(Boolean).join('\n').slice(0, 5000);
  }

  async function markPublished(item, receipt, pr, baseline) {
    const response = await fetch(`/api/workflow/${encodeURIComponent(item.id)}`, {
      method:'PUT', headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({ workflowStatus:'completed', notes:publicationNotes(item, receipt, pr, baseline) })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Workflow returned HTTP ${response.status}`);
    return payload;
  }

  function addPublicationBadge(card, text, href='') {
    if (!card || card.querySelector('[data-publication-sync]')) return;
    const host=card.querySelector('.opportunity-main > div')||card.querySelector('.opportunity-main'); if(!host)return;
    const badge=href?document.createElement('a'):document.createElement('span');badge.dataset.publicationSync='true';badge.className='badge';badge.textContent=text;
    if(href){badge.href=href;badge.target='_blank';badge.rel='noopener'}host.appendChild(badge);
  }

  async function checkItem(item, card) {
    const receipt=parseReceipt(item.notes); if(!receipt)return;
    const key=`${receipt.repository}#${receipt.prNumber}`; if(CHECKED.has(key))return; CHECKED.add(key);
    try {
      const pr=await githubPr(receipt);
      if(pr.merged_at){
        const baseline=baselineFor(item, receipt, pr);
        if((item.workflowStatus||'')!=='completed'||!String(item.notes||'').includes(BASELINE_MARKER)){
          await markPublished(item, receipt, pr, baseline);item.workflowStatus='completed';item.notes=publicationNotes(item, receipt, pr, baseline);
        }
        addPublicationBadge(card,`published · baseline ${baseline.evidenceState}`,pr.html_url||receipt.prUrl);
        window.dispatchEvent(new CustomEvent('content-opportunity:published',{detail:{opportunityId:item.id,receipt,pullRequest:pr,baseline}}));
        return;
      }
      if(pr.state==='closed'){addPublicationBadge(card,'PR closed · not merged',pr.html_url||receipt.prUrl);return;}
      addPublicationBadge(card,'PR open · awaiting merge',pr.html_url||receipt.prUrl);
    } catch(error){console.warn('[Content Opportunity] PR publication verification unavailable',error);CHECKED.delete(key);}
  }

  function inspect(){const items=window.__CONTENT_OPPORTUNITY_ITEMS__||[];document.querySelectorAll('.opportunity[data-id]').forEach(card=>{const item=items.find(x=>String(x.id)===String(card.dataset.id));if(!item||!['in-progress','completed'].includes(item.workflowStatus||''))return;if(!String(item.notes||'').includes(RECEIPT_MARKER))return;checkItem(item,card);});}
  window.addEventListener('content-opportunity:render',inspect);window.addEventListener('load',()=>setTimeout(inspect,1500));
})();