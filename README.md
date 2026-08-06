# CuratorOS Content Opportunity Finder

Content Opportunity Finder is the editorial-planning engine for Ocean Liner Curator. It identifies where `oceanliners.net` should **Create**, **Expand**, **Connect**, or **Research** content and keeps the evidence behind every recommendation visible.

## What exists in v0.4

- Cloudflare Worker runtime at `content.oceanliners.net`
- CuratorOS-style responsive, iPad-friendly dashboard
- One-tap **Find Opportunities Automatically** workflow
- Direct integration with the deployed CuratorOS Link Map dataset
- High-confidence graph-derived internal-link opportunity generation
- Focused topic/page discovery using page titles, URLs, clusters, and suggested graph connections
- JSON file upload and immediate analysis
- Advanced/manual pasted JSON input for testing and specialized datasets
- Live Site Inventory enrichment for supplied opportunities
- Existing-page/canonical resolution
- Live missing-link inspection for explicitly related pages
- Explainable weighted scoring
- Four editorial action classes: Create, Expand, Connect, Research
- Priority bands: High, Medium, Low
- Evidence contributions shown per opportunity
- Search and workflow filtering
- Editorial notes on each opportunity
- Workflow states: New, Reviewed, Accepted, In Progress, Completed, Deferred, Dismissed
- Cloudflare KV-backed workflow persistence
- Browser-local fallback if KV is unavailable

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

When the binding is present, KV is authoritative. Browser storage is only a fallback.

## Main user workflows

### Automatic discovery

Choose **Find Opportunities Automatically**. The Worker reads:

```text
https://curator.oceanliners.net/link-map/link-map-data.json
```

It builds incoming/outgoing neighborhoods, finds same-type pages with strong shared graph neighbors but no direct connection, generates Connect opportunities, scores them, and merges saved workflow state from KV.

### Topic or page discovery

Enter a ship, subject, page title, or URL fragment such as:

```text
RMS Olympic
Titanic
Cunard
/ships/rms-olympic
```

The dashboard focuses the automatically generated graph opportunities around matching page titles, URLs, clusters, and suggested connections.

### File analysis

Choose a `.json` file. The dashboard loads it into the manual analysis pathway and runs it immediately.

### Advanced/manual analysis

The pasted-JSON interface remains available under **Advanced / manual dataset** for testing, unusual data sources, or direct CuratorOS interchange.

## API

### `GET /api/health`

Returns service/version status, persistence mode, Site Inventory capability, and Link Map discovery capability.

### `GET /api/config`

Returns scoring configuration and supported workflow states.

### `GET /api/site-inventory`

Reads the public Ocean Liner Curator site index and returns a normalized inventory of existing pages.

### `GET /api/link-graph`

Checks the current CuratorOS Link Map dataset and returns graph metadata.

### `GET /api/discover`

Runs automatic Link Map opportunity discovery and returns scored opportunities with saved workflow state.

### `POST /api/discover`

Same automatic discovery pathway with optional graph-generation settings.

### `POST /api/analyze`

Accepts a supplied opportunity dataset, enriches it with live Site Inventory knowledge unless disabled, scores it, and merges saved workflow state.

Example item:

```json
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
```

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
Ocean Liner Curator Site Index ───────┐
                                      ├──> Site Knowledge Enrichment ──┐
Supplied / Imported Datasets ─────────┘                                │
                                                                       ├──> Discovery + Scoring ──> Opportunity Queue ──> KV Workflow
CuratorOS Link Map ──> Graph Opportunity Generator ────────────────────┘
```

## Next integrations

Highest-value next targets:

1. Search Intelligence / Search Console metrics as a live data feed
2. Permanent CuratorOS Project Records / Entity Registry
3. Automatic missing-topic generation from entities that recur in records but lack canonical pages
4. Opportunity reconciliation when links/pages change
5. Completed-opportunity verification and automatic re-opening when a problem returns
