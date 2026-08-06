# CuratorOS Content Opportunity Finder

Content Opportunity Finder is the editorial-planning engine for Ocean Liner Curator. It identifies where `oceanliners.net` should **Create**, **Expand**, **Connect**, or **Research** content and keeps the evidence behind every recommendation visible.

## What exists in v0.1

- Cloudflare Worker runtime
- Static CuratorOS-style dashboard
- `POST /api/analyze` analysis endpoint
- Explainable weighted scoring model
- Four editorial action classes: Create, Expand, Connect, Research
- Priority bands: High, Medium, Low
- Evidence contributions shown per opportunity
- Demonstration dataset for immediate testing
- Mobile/iPad-friendly interface

## Run locally

```bash
npm install
npm run dev
```

Then open the local Wrangler URL, load the sample dataset, and choose **Analyze opportunities**.

## Deploy

```bash
npm run deploy
```

The Worker is configured in `wrangler.toml`. You can attach a CuratorOS custom domain or route in Cloudflare after deployment.

## API

### `GET /api/health`

Returns service/version status.

### `GET /api/config`

Returns the current scoring configuration.

### `POST /api/analyze`

Accepts:

```json
{
  "items": [
    {
      "title": "RMS Carmania",
      "contentType": "ship guide",
      "cluster": "Cunard · Edwardian Liners",
      "canonicalUrl": null,
      "entityMentions": 11,
      "potentialLinks": 7,
      "missingLinks": 7,
      "clusterGap": true,
      "clusterDepth": 10,
      "searchImpressions": 620,
      "averagePosition": 12.4,
      "editorialImportance": 9,
      "unresolvedQuestions": [],
      "sources": ["site-index", "link-graph", "search-intelligence"]
    }
  ]
}
```

Returns ranked opportunities with score, priority, editorial action, recommendation, and factor-level evidence.

## Scoring philosophy

The score is deliberately explainable. Each input contributes a visible number of points. The current model balances repeated entity mentions, internal-link potential, cluster gaps, existing cluster depth, search demand, striking-distance search rankings, and editorial importance.

The weights live in `config/scoring.json`, so the editorial model can evolve without rewriting the discovery engine. Search demand is only one signal; the system is intended to serve Ocean Liner Curator's editorial mission rather than turn CuratorOS into a generic keyword-volume machine.

## Architecture

```text
Search Intelligence ───────┐
Site Index ────────────────┤
Internal Link Graph ───────┤
Entity / Knowledge Registry├──> Discovery Engine ──> Scoring ──> Opportunity Queue
Research Records ──────────┤                              │
Editorial priorities ──────┘                              └──> Evidence / explanation
```

## Next integrations

The next useful step is replacing manually supplied metrics with live CuratorOS inputs: Site inventory / canonical-page registry, Internal Link Graph output, Search Intelligence / Search Console-derived metrics, Entity Registry and research records, and saved opportunity states such as reviewed, accepted, deferred, completed, and dismissed.
