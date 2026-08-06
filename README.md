# CuratorOS Content Opportunity Finder

Content Opportunity Finder is the editorial-planning engine for Ocean Liner Curator. It identifies where `oceanliners.net` should **Create**, **Expand**, **Connect**, or **Research** content and keeps the evidence behind every recommendation visible.

## What exists in v0.2

- Cloudflare Worker runtime
- CuratorOS-style responsive dashboard
- `POST /api/analyze` analysis endpoint
- Explainable weighted scoring model
- Four editorial action classes: Create, Expand, Connect, Research
- Priority bands: High, Medium, Low
- Evidence contributions shown per opportunity
- Search and workflow filtering
- Editorial notes on each opportunity
- Workflow states: New, Reviewed, Accepted, In Progress, Completed, Deferred, Dismissed
- Cloudflare KV-backed workflow persistence
- Browser-local fallback if KV is unavailable
- Demonstration dataset for immediate testing
- Mobile/iPad-friendly interface

## Cloudflare KV

The Worker expects this KV binding:

```toml
[[kv_namespaces]]
binding = "OPPORTUNITY_STATE"
id = "afce711ea6844278b0d7fe059c739be2"
```

Workflow records are stored under keys shaped like:

```text
content-opportunity:workflow:<opportunity-id>
```

When the binding is present, KV is authoritative. Browser storage is only used as a fallback when server persistence is unavailable.

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

The production custom domain is:

```text
https://content.oceanliners.net
```

## API

### `GET /api/health`

Returns service/version status and reports whether workflow persistence is using Cloudflare KV or browser fallback.

### `GET /api/config`

Returns the current scoring configuration and supported workflow states.

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

Returns ranked opportunities with score, priority, editorial action, recommendation, factor-level evidence, and any saved workflow state.

### `GET /api/workflow/:id`

Returns the saved workflow record for one opportunity.

### `PUT /api/workflow/:id`

Saves an opportunity workflow state and editorial notes.

Example:

```json
{
  "workflowStatus": "accepted",
  "notes": "Good Cunard cluster gap. Build after Carmania source review."
}
```

Supported statuses:

```text
new
reviewed
accepted
in-progress
completed
deferred
dismissed
```

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
Editorial priorities ──────┘                              ├──> Evidence / explanation
                                                         └──> KV workflow state
```

## Next integrations

The next phase is replacing manually supplied metrics with live CuratorOS inputs. Highest-value targets are:

1. Site inventory / canonical-page registry
2. Internal Link Graph output
3. Search Intelligence / Search Console-derived metrics
4. Entity Registry and research records
5. Automatic opportunity refresh and stale/completed-opportunity reconciliation
