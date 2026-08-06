# CuratorOS Content Opportunity Finder

Content Opportunity Finder is the editorial-planning engine for Ocean Liner Curator. It identifies where `oceanliners.net` should **Create**, **Expand**, **Connect**, or **Research** content and keeps the evidence behind every recommendation visible.

## What exists in v0.7

- Cloudflare Worker runtime at `content.oceanliners.net`
- One-tap automatic discovery from the deployed CuratorOS Link Map
- Focused topic/page discovery
- Live Search Intelligence service integration with KV fallback
- Permanent Project Records integration with KV fallback
- Automatic missing-entity detection from explicit Project Record relationships
- Canonical-page checks against the live site inventory
- Create opportunities for well-supported entities with no public page
- Research opportunities when the entity is important but source/confidence readiness is insufficient
- Search metrics merged into matching opportunities
- Explainable Create / Expand / Connect / Research scoring
- Persistent editorial workflow in Cloudflare KV
- Responsive iPad-friendly dashboard

## Live data sources

Search Intelligence:

```text
https://search-intelligence.oceanliners.net/api/search-intelligence
```

Project Records:

```text
https://curator.oceanliners.net/api/project-records
```

Content Opportunity Finder prefers each live source and refreshes a KV fallback snapshot after successful reads.

Resolution order for both sources:

```text
Live endpoint
   ↓ success
Use live data + refresh KV fallback
   ↓ failure
Use most recent KV snapshot
   ↓ unavailable
Continue with remaining discovery sources
```

Optional Worker environment overrides:

```text
SEARCH_INTELLIGENCE_URL
PROJECT_RECORDS_URL
```

## Cloudflare KV

The Worker uses:

```toml
[[kv_namespaces]]
binding = "OPPORTUNITY_STATE"
id = "afce711ea6844278b0d7fe059c739be2"
```

Keys include:

```text
content-opportunity:workflow:<opportunity-id>
content-opportunity:search-intelligence:v1
content-opportunity:project-records:v1
```

## Automatic discovery

**Find Opportunities Automatically** now combines four evidence layers:

```text
CuratorOS Link Map
        ↓
Internal-link / Connect opportunities

Permanent Project Records
        ↓
Relationship frequency + evidence readiness
        ↓
Missing canonical entity pages
        ↓
Create or Research opportunities

Search Intelligence
        ↓
Search demand / striking distance

Ocean Liner Curator Site Inventory
        ↓
Canonical coverage verification
```

### Project Records entity rules

The first entity generator is deliberately conservative. It does not mine arbitrary words from prose. It uses actual Project Record identities and explicit `relationships[].target` references.

By default an entity becomes a candidate when:

- its record type is a ship/company/builder/shipping-line style entity,
- at least two other Project Records explicitly point to it,
- no matching canonical public page is found in the site inventory.

If the entity has attached evidence and adequate confidence, the recommendation is **Create**. If it has no sources or low confidence, the recommendation becomes **Research** first.

Each opportunity preserves:

- Project Record ID and type
- inbound relationship count
- referring record IDs
- attached source count
- confidence
- corpus version/update time
- canonical coverage result

## API

### `GET /api/health`

Reports Worker version, persistence status, Link Map/Site Inventory capability, Search Intelligence endpoint/fallback state, and Project Records endpoint/fallback state.

### `GET /api/search-intelligence`

Live-first Search Intelligence resolver. Use `?live=0` to inspect only the saved KV snapshot.

### `POST /api/search-intelligence`

Normalizes and saves compatible Search Intelligence/Search Console data to KV.

### `GET /api/project-records`

Live-first Project Records resolver. Use:

```text
/api/project-records?live=0
```

to inspect only the saved KV snapshot.

### `POST /api/project-records`

Accepts a `{ "records": [...] }` Project Records export and saves it as the KV fallback. This provides a manual seed path if the live CuratorOS endpoint is unavailable.

### `GET /api/discover`

Runs combined automatic discovery from Link Map + Project Records + Site Inventory + Search Intelligence.

The response reports the live/fallback mode for Search Intelligence and Project Records and how many corpus-generated opportunities were produced.

### `POST /api/discover`

Same pathway with optional settings. Example:

```json
{
  "projectRecords": {
    "preferLive": false,
    "minReferences": 3,
    "maxOpportunities": 50
  },
  "searchIntelligence": {
    "preferLive": true
  }
}
```

### `POST /api/analyze`

Analyzes supplied opportunity datasets with Site Inventory and Search Intelligence enrichment.

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

The score is deliberately explainable. The model balances relationship/entity frequency, internal-link opportunity, cluster structure, search demand, striking-distance rankings, and editorial importance. Evidence readiness influences whether a gap is treated as a publication opportunity or a research task.

## Current architecture

```text
CuratorOS Link Map ────────────────┐
                                   ├──> Connect opportunities ───────┐
Project Records ──> Entity graph ──┤                                │
             │                     └──> Create / Research ──────────┤
             └──> KV fallback                                       │
                                                                    ├──> Discovery + Scoring ──> Opportunity Queue ──> KV Workflow
Site Inventory ──> Canonical checks ────────────────────────────────┤
                                                                    │
Search Intelligence live API ──┐                                   │
                               ├──> Search metrics ─────────────────┘
KV Search snapshot fallback ───┘
```

## Next integrations

1. Opportunity reconciliation when pages and links change
2. Completed-opportunity verification and automatic reopening when a problem returns
3. Stronger entity-cluster inference for shipping lines, builders, classes, and historical subjects
4. Page Studio handoff for accepted Create/Expand opportunities
