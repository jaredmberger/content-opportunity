import scoringConfig from './config/scoring.json' with { type: 'json' };
import { discoverOpportunities, summarizeOpportunities } from './src/discovery.js';

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
const workflowKey = id => `content-opportunity:workflow:${id}`;

async function readWorkflow(env, id) {
  if (!env.OPPORTUNITY_STATE) return null;
  return env.OPPORTUNITY_STATE.get(workflowKey(id), { type: 'json' });
}

async function writeWorkflow(env, id, value) {
  if (!env.OPPORTUNITY_STATE) return false;
  await env.OPPORTUNITY_STATE.put(workflowKey(id), JSON.stringify(value));
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        service: env.APP_NAME || 'CuratorOS Content Opportunity Finder',
        version: '0.2.0',
        siteOrigin: env.SITE_ORIGIN || 'https://www.oceanliners.net',
        scoringVersion: scoringConfig.version,
        workflowPersistence: env.OPPORTUNITY_STATE ? 'kv' : 'browser'
      }, { headers: corsHeaders });
    }

    if (url.pathname === '/api/config' && request.method === 'GET') {
      return json({
        ...scoringConfig,
        workflowStatuses: [...WORKFLOW_STATUSES]
      }, { headers: corsHeaders });
    }

    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      try {
        const dataset = await request.json();
        const opportunities = discoverOpportunities(dataset, scoringConfig);

        if (env.OPPORTUNITY_STATE) {
          await Promise.all(opportunities.map(async item => {
            const saved = await readWorkflow(env, item.id);
            if (saved) {
              item.workflowStatus = saved.workflowStatus || item.workflowStatus;
              item.notes = saved.notes || '';
              item.updatedAt = saved.updatedAt || null;
            }
          }));
        }

        return json({
          generatedAt: new Date().toISOString(),
          summary: summarizeOpportunities(opportunities),
          opportunities
        }, { headers: corsHeaders });
      } catch (error) {
        return json({ ok: false, error: 'Invalid analysis payload', detail: error?.message || String(error) }, {
          status: 400,
          headers: corsHeaders
        });
      }
    }

    const workflowMatch = url.pathname.match(/^\/api\/workflow\/([^/]+)$/);
    if (workflowMatch) {
      const id = decodeURIComponent(workflowMatch[1]);

      if (request.method === 'GET') {
        if (!env.OPPORTUNITY_STATE) {
          return json({ ok: true, persistence: 'browser', record: null }, { headers: corsHeaders });
        }
        return json({ ok: true, persistence: 'kv', record: await readWorkflow(env, id) }, { headers: corsHeaders });
      }

      if (request.method === 'PUT') {
        try {
          const body = await request.json();
          const workflowStatus = String(body.workflowStatus || 'new');
          if (!WORKFLOW_STATUSES.has(workflowStatus)) {
            return json({ ok: false, error: 'Invalid workflow status' }, { status: 400, headers: corsHeaders });
          }

          const record = {
            id,
            workflowStatus,
            notes: String(body.notes || '').slice(0, 5000),
            updatedAt: new Date().toISOString()
          };
          const persisted = await writeWorkflow(env, id, record);
          return json({ ok: true, persistence: persisted ? 'kv' : 'browser', record }, { headers: corsHeaders });
        } catch (error) {
          return json({ ok: false, error: 'Invalid workflow payload', detail: error?.message || String(error) }, {
            status: 400,
            headers: corsHeaders
          });
        }
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'Not found' }, { status: 404, headers: corsHeaders });
    }

    return env.ASSETS.fetch(request);
  }
};
