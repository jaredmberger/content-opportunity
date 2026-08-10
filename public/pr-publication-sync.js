(() => {
  'use strict';

  const CHECKED = new Set();
  const RECEIPT_MARKER = '--- Page Studio production receipt ---';
  const PUBLICATION_MARKER = '--- CuratorOS publication receipt ---';

  function parseReceipt(notes = '') {
    if (!String(notes).includes(RECEIPT_MARKER)) return null;
    const get = (label) => {
      const match = String(notes).match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'));
      return match ? match[1].trim() : '';
    };
    const repository = get('Repository');
    const prText = get('Pull request');
    const prNumber = Number(String(prText).replace(/^#/, ''));
    if (!repository || !Number.isInteger(prNumber) || prNumber <= 0) return null;
    return {
      repository,
      prNumber,
      prUrl: get('Pull request URL'),
      branch: get('Branch'),
      filePath: get('File path'),
      canonicalUrl: get('Canonical target')
    };
  }

  async function githubPr(receipt) {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(receipt.repository.split('/')[0])}/${encodeURIComponent(receipt.repository.split('/')[1])}/pulls/${receipt.prNumber}`, {
      headers: { accept: 'application/vnd.github+json' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    return response.json();
  }

  function publicationNotes(item, receipt, pr) {
    const previous = String(item.notes || '').replace(new RegExp(`\\n?${PUBLICATION_MARKER}[\\s\\S]*$`, 'm'), '').trim();
    const lines = [
      previous,
      previous ? '' : '',
      PUBLICATION_MARKER,
      'Status: Published',
      `Opportunity: ${item.id}`,
      receipt.canonicalUrl ? `Canonical URL: ${receipt.canonicalUrl}` : '',
      `Repository: ${receipt.repository}`,
      receipt.filePath ? `File path: ${receipt.filePath}` : '',
      receipt.branch ? `Branch: ${receipt.branch}` : '',
      `Pull request: #${receipt.prNumber}`,
      `Pull request URL: ${pr.html_url || receipt.prUrl || ''}`,
      pr.merge_commit_sha ? `Merge commit: ${pr.merge_commit_sha}` : '',
      pr.merged_at ? `Merged: ${pr.merged_at}` : '',
      `Verified by CuratorOS: ${new Date().toISOString()}`
    ];
    return lines.filter(Boolean).join('\n').slice(0, 5000);
  }

  async function markPublished(item, receipt, pr) {
    const response = await fetch(`/api/workflow/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        workflowStatus: 'completed',
        notes: publicationNotes(item, receipt, pr)
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Workflow returned HTTP ${response.status}`);
    return payload;
  }

  function addPublicationBadge(card, text, href = '') {
    if (!card || card.querySelector('[data-publication-sync]')) return;
    const host = card.querySelector('.opportunity-main > div') || card.querySelector('.opportunity-main');
    if (!host) return;
    const badge = href ? document.createElement('a') : document.createElement('span');
    badge.dataset.publicationSync = 'true';
    badge.className = 'badge';
    badge.textContent = text;
    if (href) {
      badge.href = href;
      badge.target = '_blank';
      badge.rel = 'noopener';
    }
    host.appendChild(badge);
  }

  async function checkItem(item, card) {
    const receipt = parseReceipt(item.notes);
    if (!receipt) return;
    const key = `${receipt.repository}#${receipt.prNumber}`;
    if (CHECKED.has(key)) return;
    CHECKED.add(key);

    try {
      const pr = await githubPr(receipt);
      if (pr.merged_at) {
        if ((item.workflowStatus || '') !== 'completed' || !String(item.notes || '').includes(PUBLICATION_MARKER)) {
          await markPublished(item, receipt, pr);
          item.workflowStatus = 'completed';
          item.notes = publicationNotes(item, receipt, pr);
        }
        addPublicationBadge(card, 'published · merged', pr.html_url || receipt.prUrl);
        window.dispatchEvent(new CustomEvent('content-opportunity:published', { detail: { opportunityId: item.id, receipt, pullRequest: pr } }));
        return;
      }
      if (pr.state === 'closed') {
        addPublicationBadge(card, 'PR closed · not merged', pr.html_url || receipt.prUrl);
        return;
      }
      addPublicationBadge(card, 'PR open · awaiting merge', pr.html_url || receipt.prUrl);
    } catch (error) {
      console.warn('[Content Opportunity] PR publication verification unavailable', error);
      CHECKED.delete(key);
    }
  }

  function inspect() {
    const items = window.__CONTENT_OPPORTUNITY_ITEMS__ || [];
    document.querySelectorAll('.opportunity[data-id]').forEach((card) => {
      const item = items.find(x => String(x.id) === String(card.dataset.id));
      if (!item || !['in-progress', 'completed'].includes(item.workflowStatus || '')) return;
      if (!String(item.notes || '').includes(RECEIPT_MARKER)) return;
      checkItem(item, card);
    });
  }

  window.addEventListener('content-opportunity:render', inspect);
  window.addEventListener('load', () => setTimeout(inspect, 1500));
})();
