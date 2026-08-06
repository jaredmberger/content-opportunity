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
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'Content-Type'
};

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
        version: '0.1.0',
        siteOrigin: env.SITE_ORIGIN || 'https://www.oceanliners.net',
        scoringVersion: scoringConfig.version
      }, { headers: corsHeaders });
    }

    if (url.pathname === '/api/config' && request.method === 'GET') {
      return json(scoringConfig, { headers: corsHeaders });
    }

    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      try {
        const dataset = await request.json();
        const opportunities = discoverOpportunities(dataset, scoringConfig);
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

    if (url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'Not found' }, { status: 404, headers: corsHeaders });
    }

    return env.ASSETS.fetch(request);
  }
};
