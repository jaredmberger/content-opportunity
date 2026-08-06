# CuratorOS Content Opportunity Finder

Content Opportunity Finder is the editorial-planning engine for Ocean Liner Curator. It identifies where `oceanliners.net` should **Create**, **Expand**, **Connect**, or **Research** content and keeps the evidence behind every recommendation visible.

## What exists in v0.6

- Cloudflare Worker runtime at `content.oceanliners.net`
- One-tap automatic discovery from the deployed CuratorOS Link Map
- Focused topic/page discovery
- Live Search Intelligence service integration
- Automatic fallback to the most recent Search Intelligence KV snapshot
- Successful live Search Intelligence reads refresh the fallback snapshot automatically
- Google Search Console CSV/JSON import remains available as a manual fallback/input path
- Search metrics merged into graph opportunities: impressions, clicks, CTR, average position, query count, top queries
- Search-demand and striking-distance scoring
- Live Site Inventory enrichment and canonical resolution
- Explainable Create / Expand / Connect / Research scoring
- Persistent editorial workflow in Cloudflare KV
- Responsive iPad-friendly dashboard

## Live Search Intelligence

Primary endpoint:

```text
https://search-intelligence.oceanliners.net/api/search-intelligence
```

Content Opportunity Finder now prefers that endpoint during automatic discovery and normal analyses.

Resolution order:

```text
Live Search Intelligence endpoint
        ↓ success
Use live metrics + refresh KV fallback

        ↓ failure
Most recent KV Search Intelligence snapshot

        ↓ unavailable
Continue with Link Map / Site Inventory without search metrics
```

The endpoint can be overridden with the Worker environment variable:

```text
SEARCH_INTELLIGENCE_URL
```

The default is the production endpoint above.

## Cloudflare KV

The Worker uses:

```toml
[[kv_namespaces]]
binding = "OPPORTUNITY_STATE"
id = "afce711ea6844278b0d7fe059c739be2"
```

Workflow records:

```text
content-opportunity:workflow:<opportunity-id>
```

Search Intelligence fallback snapshot:

```text
content-opportunity:search-intelligence:v1
```

## Main user workflows

### Automatic discovery

Choose **Find Opportunities Automatically**. The Worker reads the current CuratorOS Link Map and the live Search Intelligence endpoint in parallel, generates high-confidence relationship gaps, merges matching search metrics, scores the resulting opportunities, and restores saved workflow state.

If the live Search Intelligence request fails, the latest KV snapshot is used automatically.

### Search Intelligence import

Choose **Import Search Console data** to manually seed or replace the KV fallback with a Google Search Console `.csv` or compatible `.json` export.

Recognized metrics include:

```text
Page / Top pages / URL
Clicks
Impressions
CTR / Average CTR
Position / Average position
```

### Topic or page discovery

Enter a ship, subject, page title, or URL fragment such as:

```text
RMS Olympic
Titanic
Cunard
/ships/rms-olympic
```

### Specialized/manual analysis

JSON upload and the Advanced manual-data interface remain available for testing and CuratorOS interchange.

## API

### `GET /api/health`

Returns service/version status, persistence mode, Link Map and Site Inventory capabilities, the configured live Search Intelligence endpoint, and KV fallback status.

### `GET /api/search-intelligence`

By default, resolves Search Intelligence using the same live-first/fallback behavior as automatic discovery.

Use:

```text
/api/search-intelligence?live=0
```

to inspect only the saved KV snapshot.

The response reports `mode` as one of:

```text
live
kv-fallback
kv
unavailable
```

### `POST /api/search-intelligence`

Normalizes and saves Search Console/Search Intelligence data to KV. This remains the stable publishing/import contract for compatible tools.

### `GET /api/discover`

Runs automatic Link Map discovery and prefers live Search Intelligence. The response reports whether search evidence came from `live`, `kv-fallback`, or was unavailable.

### `POST /api/discover`

Same pathway with optional discovery settings. Live Search Intelligence can be disabled for a request with:

```json
{
  "searchIntelligence": {
    "preferLive": false
  }
}
```

### `POST /api/analyze`

Enriches supplied opportunities with Site Inventory and, by default, live-first Search Intelligence before scoring.

### `GET /api/site-inventory`

Returns the normalized live Ocean Liner Curator site inventory.

### `GET /api/link-graph`

Returns metadata for the deployed CuratorOS Link Map dataset.

### `GET /api/workflow/:id`

Returns one saved workflow record.

### `PUT /api/workflow/:id`

Saves workflow state and editorial notes.

Supported states:

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

The score is deliberately explainable. The model balances internal-link opportunity, cluster structure, search demand, striking-distance rankings, entity evidence, and editorial importance. Search demand remains one signal rather than the editorial mission itself.

## Current architecture

```text
CuratorOS Link Map ─────────────────────────────┐
                                                │
Ocean Liner Curator Site Inventory ─────────────┼──> Discovery + Scoring ──> Opportunity Queue ──> KV Workflow
                                                │
Search Intelligence live API ──┐                │
                               ├──> Search metrics
KV Search snapshot fallback ───┘                │
                                                │
Imported / supplied data ───────────────────────┘
```

## Next integrations

1. Permanent CuratorOS Project Records / Entity Registry
2. Automatic missing-topic generation from recurring entities without canonical pages
3. Opportunity reconciliation when pages and links change
4. Completed-opportunity verification and automatic reopening when a problem returns
