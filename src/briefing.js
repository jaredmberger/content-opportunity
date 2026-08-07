const byId = items => new Map((Array.isArray(items) ? items : []).filter(x => x?.id).map(x => [String(x.id), x]));
const clampList = (items, limit = 12) => items.slice(0, limit);

function activeAdjustments(profile = {}) {
  const out = [];
  for (const [name, entry] of Object.entries(profile.byType || {})) {
    if (Number(entry?.adjustment || 0)) out.push({ kind: 'type', name, adjustment: Number(entry.adjustment), decisions: Number(entry.decisions || 0) });
  }
  for (const [name, entry] of Object.entries(profile.byLane || {})) {
    if (Number(entry?.adjustment || 0)) out.push({ kind: 'lane', name, adjustment: Number(entry.adjustment), decisions: Number(entry.decisions || 0) });
  }
  return out.sort((a, b) => Math.abs(b.adjustment) - Math.abs(a.adjustment) || a.name.localeCompare(b.name));
}

function verificationState(records = []) {
  const out = [];
  for (const record of records) {
    if (record?.status !== 'implemented' || !record?.id) continue;
    const v = record.verification || {};
    out.push({
      id: String(record.id),
      page: record.page || record.query || '',
      recommendation: record.recommendation || '',
      state: v.state || 'insufficient',
      label: v.label || v.state || 'insufficient',
      checkpoint: v.checkpoint || null,
      ready: Boolean(v.ready),
      ageDays: Number(v.ageDays || 0)
    });
  }
  return out;
}

export function makeBriefingState({ discoverySnapshot, feedbackProfile, verificationRecords } = {}) {
  return {
    format: 'curatoros-content-opportunity-briefing-state',
    formatVersion: 1,
    capturedAt: new Date().toISOString(),
    discoveryGeneratedAt: discoverySnapshot?.generatedAt || null,
    opportunities: Array.isArray(discoverySnapshot?.items) ? discoverySnapshot.items : [],
    feedback: activeAdjustments(feedbackProfile),
    verification: verificationState(verificationRecords)
  };
}

export function compareBriefing(previous, current) {
  const oldOpp = byId(previous?.opportunities);
  const newOpp = byId(current?.opportunities);
  const added = [];
  const removed = [];
  const rankMovers = [];
  const scoreMovers = [];

  for (const item of newOpp.values()) {
    const before = oldOpp.get(String(item.id));
    if (!before) {
      added.push(item);
      continue;
    }
    const oldRank = Number(before.workNextRank || 0);
    const newRank = Number(item.workNextRank || 0);
    if (oldRank && newRank && oldRank !== newRank) {
      rankMovers.push({
        id: item.id,
        title: item.title,
        type: item.type,
        from: oldRank,
        to: newRank,
        change: oldRank - newRank,
        decisionScore: Number(item.decisionScore || 0)
      });
    }
    const oldScore = Number(before.decisionScore ?? before.score ?? 0);
    const newScore = Number(item.decisionScore ?? item.score ?? 0);
    if (Math.abs(newScore - oldScore) >= 2) {
      scoreMovers.push({ id: item.id, title: item.title, from: oldScore, to: newScore, change: newScore - oldScore });
    }
  }
  for (const item of oldOpp.values()) if (!newOpp.has(String(item.id))) removed.push(item);

  rankMovers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.to - b.to);
  scoreMovers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  added.sort((a, b) => Number(a.workNextRank || 9999) - Number(b.workNextRank || 9999));

  const oldVerification = byId(previous?.verification);
  const verificationChanges = [];
  for (const item of current?.verification || []) {
    const before = oldVerification.get(String(item.id));
    if (!before) {
      if (item.ready) verificationChanges.push({ ...item, change: 'became-trackable' });
      continue;
    }
    if (before.state !== item.state || before.checkpoint !== item.checkpoint || Boolean(before.ready) !== Boolean(item.ready)) {
      verificationChanges.push({ ...item, previousState: before.state, previousCheckpoint: before.checkpoint, change: 'verification-updated' });
    }
  }

  const oldFeedback = new Map((previous?.feedback || []).map(x => [`${x.kind}:${x.name}`, x]));
  const feedbackChanges = [];
  for (const item of current?.feedback || []) {
    const key = `${item.kind}:${item.name}`;
    const before = oldFeedback.get(key);
    if (!before || Number(before.adjustment || 0) !== Number(item.adjustment || 0)) {
      feedbackChanges.push({ ...item, previousAdjustment: Number(before?.adjustment || 0) });
    }
    oldFeedback.delete(key);
  }
  for (const item of oldFeedback.values()) feedbackChanges.push({ ...item, previousAdjustment: Number(item.adjustment || 0), adjustment: 0 });

  return {
    baselineAvailable: Boolean(previous),
    since: previous?.capturedAt || null,
    summary: {
      newOpportunities: added.length,
      removedOpportunities: removed.length,
      rankMovers: rankMovers.length,
      scoreMovers: scoreMovers.length,
      verificationChanges: verificationChanges.length,
      feedbackChanges: feedbackChanges.length
    },
    newOpportunities: clampList(added),
    removedOpportunities: clampList(removed),
    rankMovers: clampList(rankMovers),
    scoreMovers: clampList(scoreMovers),
    verificationChanges: clampList(verificationChanges),
    feedbackChanges: clampList(feedbackChanges)
  };
}
