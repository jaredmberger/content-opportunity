const POSITIVE_STATUSES = new Set(['accepted','in-progress','completed']);
const NEGATIVE_STATUSES = new Set(['deferred','dismissed']);
const DECISION_STATUSES = new Set([...POSITIVE_STATUSES, ...NEGATIVE_STATUSES]);
const MIN_DECISIONS = 4;
const MAX_ADJUSTMENT = 5;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function bucket() {
  return { decisions: 0, positive: 0, negative: 0, adjustment: 0 };
}

function addDecision(target, status) {
  if (!DECISION_STATUSES.has(status)) return;
  target.decisions += 1;
  if (POSITIVE_STATUSES.has(status)) target.positive += 1;
  if (NEGATIVE_STATUSES.has(status)) target.negative += 1;
}

function finalizeBucket(value) {
  if (value.decisions < MIN_DECISIONS) return { ...value, adjustment: 0, active: false };
  const preference = (value.positive - value.negative) / value.decisions;
  const adjustment = Math.round(clamp(preference * MAX_ADJUSTMENT, -MAX_ADJUSTMENT, MAX_ADJUSTMENT));
  return {
    ...value,
    adjustment,
    active: adjustment !== 0,
    positiveRate: value.decisions ? value.positive / value.decisions : 0
  };
}

export function buildFeedbackProfile(records = []) {
  const byType = {};
  const byLane = {};
  const considered = records.filter(record => DECISION_STATUSES.has(String(record?.workflowStatus || '')));

  for (const record of considered) {
    const status = String(record.workflowStatus || '');
    const type = String(record.opportunityType || '').toLowerCase();
    if (type) {
      byType[type] ||= bucket();
      addDecision(byType[type], status);
    }
    const lanes = Array.isArray(record.signalLanes) ? [...new Set(record.signalLanes.map(String))] : [];
    for (const lane of lanes) {
      byLane[lane] ||= bucket();
      addDecision(byLane[lane], status);
    }
  }

  for (const key of Object.keys(byType)) byType[key] = finalizeBucket(byType[key]);
  for (const key of Object.keys(byLane)) byLane[key] = finalizeBucket(byLane[key]);

  return {
    enabled: true,
    mode: 'transparent-bounded-preference',
    generatedAt: new Date().toISOString(),
    minimumDecisions: MIN_DECISIONS,
    maximumAdjustment: MAX_ADJUSTMENT,
    decisions: considered.length,
    byType,
    byLane
  };
}

export function applyFeedbackAdjustments(opportunities = [], profile = null) {
  if (!profile?.enabled || !profile.decisions) return opportunities;

  const adjusted = opportunities.map(item => {
    const typeRule = profile.byType?.[item.type];
    const lanes = Array.isArray(item.prioritization?.signalLanes) ? item.prioritization.signalLanes : [];
    const laneRules = lanes.map(lane => ({ lane, rule: profile.byLane?.[lane] })).filter(entry => entry.rule?.active);
    const typeAdjustment = typeRule?.active ? Number(typeRule.adjustment || 0) : 0;
    const laneAdjustment = laneRules.length
      ? Math.round(laneRules.reduce((sum, entry) => sum + Number(entry.rule.adjustment || 0), 0) / laneRules.length)
      : 0;
    const combined = Math.round(clamp(typeAdjustment + laneAdjustment, -MAX_ADJUSTMENT, MAX_ADJUSTMENT));
    const previous = Number(item.decisionScore ?? item.prioritization?.decisionScore ?? item.score ?? 0);
    const decisionScore = Math.round(clamp(previous + combined, 0, 100));
    return {
      ...item,
      decisionScore,
      prioritization: {
        ...(item.prioritization || {}),
        decisionScore,
        feedbackAdjustment: combined,
        feedbackEvidence: {
          type: typeRule?.active ? { type: item.type, ...typeRule } : null,
          lanes: laneRules.map(entry => ({ lane: entry.lane, ...entry.rule }))
        }
      }
    };
  });

  adjusted.sort((a, b) =>
    Number(b.decisionScore || 0) - Number(a.decisionScore || 0) ||
    Number(b.prioritization?.independentSignals || 0) - Number(a.prioritization?.independentSignals || 0) ||
    Number(b.score || 0) - Number(a.score || 0) ||
    String(a.title || '').localeCompare(String(b.title || ''))
  );
  adjusted.forEach((item, index) => { item.workNextRank = index + 1; });
  return adjusted;
}

export const FEEDBACK_STATUSES = [...DECISION_STATUSES];
