# CuratorOS Content Opportunity Finder

Content Opportunity Finder is the editorial-planning engine for Ocean Liner Curator. It identifies where `oceanliners.net` should **Create**, **Expand**, **Connect**, or **Research** content and keeps the evidence behind every recommendation visible.

## What exists in v0.5

- Cloudflare Worker runtime at `content.oceanliners.net`
- CuratorOS-style responsive, iPad-friendly dashboard
- One-tap **Find Opportunities Automatically** workflow
- Direct integration with the deployed CuratorOS Link Map dataset
- High-confidence graph-derived internal-link opportunity generation
- Focused topic/page discovery using page titles, URLs, clusters, and suggested graph connections
- Search Intelligence snapshot persistence in Cloudflare KV
- Direct Google Search Console page-export import from CSV or compatible JSON
- Automatic merging of impressions, clicks, CTR, average position, and query counts into graph opportunities
- Search-demand and striking-distance scoring during automatic discovery
- Stable Search Intelligence API contract for a future standalone Search Intelligence service
- JSON file upload and immediate analysis
- Advanced/manual pasted JSON input for testing and specialized datasets
- Live Site Inventory enrichment for supplied opportunities
- Existing-page/canonical resolution
- Live missing-link inspection for explicitly related pages
- Explainable weighted scoring
- Four editorial action classes: Create, Expand, Connect, Research
- Priority bands: High, Medium, Low
- Search and workflow filtering
- Editorial notes on each opportunity
- Workflow states: New, Reviewed, Accepted, In Progress, Completed, Deferred, Dismissed
- Cloudflare KV-backed persistence
- Browser-local workflow fallback if KV is unavailable

## Cloudflare KV

The Worker uses:

```toml
[[kv_namespaces]]
binding = "OPPORTUNITY_STATE"
id = "afce711ea6844278b0d7fe059c739be2"
```

Workflow records are stored under:

```text
content-opportunity:workflow:<opportunity-id>
```

The saved Search Intelligence snapshot is stored under:

```text
content-opportunity:search-intelligence:v1
```

When the binding is present, KV is authoritative.

## Main user workflows

### Automatic discovery

Choose **Find Opportunities Automatically**. The Worker reads the current CuratorOS Link Map, generates high-confidence relationship gaps, merges any saved Search Intelligence metrics onto matching canonical pages, scores the resulting opportunities, and restores saved workflow state.

### Search Intelligence import

Choose **Import Search Console data** and select either:

- a Google Search Console page export in `.csv` format, or
- compatible `.json` containing page-level search rows.

Recognized metrics include:

```text
Page / Top pages / URL
Clicks
Impressions
CTR / Average CTR
Position / Average position
```

The importer normalizes `www` and canonical URL forms, aggregates rows by page, calculates weighted average position, and saves the resulting page snapshot to KV. Automatic discovery is rerun after a successful import.

### Topic or page discovery

Enter a ship, subject, page title, or URL fragment such as:

```text
RMS Olympic
Titanic
Cunard
/ships/rms-olympic
```

The dashboard focuses the automatically generated opportunities around matching page titles, URLs, clusters, and suggested connections.

### Specialized JSON analysis

Choose a `.json` file from another CuratorOS tool or compatible source. The dashboard loads it into the manual analysis pathway and runs it immediately.

### Advanced/manual analysis

The pasted-JSON interface remains available under **Advanced / manual dataset** for testing, unusual data sources, or direct CuratorOS interchange.

## API

### `GET /api/health`

Returns service/version status, persistence mode, Site Inventory capability, Link Map discovery capability, and Search Intelligence snapshot status.

### `GET /api/config`

Returns scoring configuration and supported workflow states.

### `GET /api/site-inventory`

Reads the public Ocean Liner Curator site index and returns a normalized inventory of existing pages.

### `GET /api/link-graph`

Checks the current CuratorOS Link Map dataset and returns graph metadata.

### `GET /api/search-intelligence`

Returns the currently saved Search Intelligence snapshot and page metrics.

### `POST /api/search-intelligence`

Normalizes and saves Search Console/Search Intelligence rows to KV. This is also the stable publishing contract for a future standalone Search Intelligence service.

Example:

```json
{
  "source": "search-intelligence",
  "rows": [
    {
      "page": "https://oceanliners.net/ships/rms-olympic",
      "clicks": 42,
      "impressions": 1350,
      "ctr": 0.031,
      "position": 11.8
    }
  ]
}
```

### `GET /api/discover`

Runs automatic Link Map opportunity discovery. If a Search Intelligence snapshot exists, page metrics are merged before scoring.

### `POST /api/discover`

Same automatic discovery pathway with optional graph-generation settings.

### `POST /api/analyze`

Accepts a supplied opportunity dataset, enriches it with live Site Inventory knowledge unless disabled, merges saved Search Intelligence unless disabled, scores it, and restores saved workflow state.

### `GET /api/workflow/:id`

Returns the saved workflow record for one opportunity.

### `PUT /api/workflow/:id`

Saves workflow state and editorial notes.

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

The score is deliberately explainable. Each input contributes visible points. The model balances repeated entity mentions, internal-link potential, cluster gaps, existing cluster depth, search demand, striking-distance rankings, and editorial importance.

Search demand is only one signal. Content Opportunity Finder is designed to serve Ocean Liner Curator's editorial mission rather than become a generic keyword-volume tool.

## Current architecture

```text
Ocean Liner Curator Site Index ──────────────┐
                                             ├──> Site Knowledge Enrichment ──┐
Supplied / Imported Datasets ────────────────┘                                │
                                                                              ├──> Discovery + Scoring ──> Opportunity Queue ──> KV Workflow
CuratorOS Link Map ──> Graph Opportunity Generator ───────────────────────────┤
                                                                              │
Search Console / Search Intelligence ──> KV Search Snapshot ──────────────────┘
```

## Next integrations

Highest-value next targets:

1. Permanent CuratorOS Project Records / Entity Registry
2. Automatic missing-topic generation from entities that recur in records but lack canonical pages
3. Opportunity reconciliation when links/pages change
4. Completed-opportunity verification and automatic re-opening when a problem returns
5. Direct Search Intelligence service-to-service publishing when that application is deployed
