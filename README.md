# CuratorOS Content Opportunity Finder

Content Opportunity Finder is the editorial-planning engine for Ocean Liner Curator. It identifies where `oceanliners.net` should **Create**, **Expand**, **Connect**, or **Research** content and keeps the evidence behind every recommendation visible.

## What exists in v0.8

- Cloudflare Worker runtime at `content.oceanliners.net`
- One-tap automatic discovery from the deployed CuratorOS Link Map
- Focused topic/page discovery
- Live Search Intelligence service integration with KV fallback
- Permanent Project Records integration with KV fallback
- Automatic missing-entity detection from explicit Project Record relationships
- Canonical-page checks against the live site inventory
- Explainable Create / Expand / Connect / Research scoring
- Persistent editorial workflow in Cloudflare KV
- **Lifecycle reconciliation across discovery runs**
- Automatic completion when an opportunity is no longer detected after its evidence lane is successfully reevaluated
- Automatic reopening when a CuratorOS-auto-completed problem later returns
- Manual completion, deferral, or dismissal is never automatically reopened
- Responsive iPad-friendly dashboard
- Node regression tests for reconciliation behavior

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
content-opportunity:discovery-snapshot:v1
```

## Automatic discovery

**Find Opportunities Automatically** combines four evidence layers:

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

After each successful automatic run, CuratorOS stores a compact discovery snapshot and compares it with the previous run.

## Lifecycle reconciliation

Reconciliation is lane-aware. A prior opportunity is only considered resolved if the same evidence lane was successfully reevaluated.

For example:

- Link Map opportunity disappears after a successful Link Map analysis → eligible for automatic completion.
- Project Records opportunity disappears while Project Records are unavailable → **not** automatically completed.

CuratorOS only auto-completes active workflow states:

```text
new
reviewed
accepted
in-progress
```

It does not override manually completed, deferred, or dismissed decisions.

If an opportunity that CuratorOS itself auto-completed later appears again, it is reopened as `new` with reconciliation metadata explaining when it disappeared and when it returned.

A manual workflow save clears the automatic-reconciliation marker, returning authority to the curator.

## API

### `GET /api/health`

Reports Worker version, persistence status, live-data capability, whether lifecycle reconciliation is enabled, and the most recent discovery timestamp.

### `GET /api/discover`

Runs combined automatic discovery from Link Map + Project Records + Site Inventory + Search Intelligence, performs lifecycle reconciliation, and returns a `reconciliation` summary including:

```text
resolved
autoCompleted
autoReopened
firstSeen
returned
evaluatedLanes
```

Reconciliation can be disabled for a specific POST run with:

```json
{
  "reconciliation": {
    "enabled": false
  }
}
```

### `GET /api/reconciliation`

Returns the currently saved discovery snapshot used as the comparison baseline.

### `GET /api/search-intelligence`

Live-first Search Intelligence resolver. Use `?live=0` to inspect only the saved KV snapshot.

### `POST /api/search-intelligence`

Normalizes and saves compatible Search Intelligence/Search Console data to KV.

### `GET /api/project-records`

Live-first Project Records resolver. Use `?live=0` to inspect only the saved KV snapshot.

### `POST /api/project-records`

Accepts a `{ "records": [...] }` Project Records export and saves it as the KV fallback.

### `POST /api/analyze`

Analyzes supplied opportunity datasets with Site Inventory and Search Intelligence enrichment. Manual analyses do not mutate the automatic discovery baseline.

### `GET /api/site-inventory`

Returns the normalized live Ocean Liner Curator site inventory.

### `GET /api/link-graph`

Returns metadata for the deployed CuratorOS Link Map dataset.

### `GET /api/workflow/:id`

Returns one saved workflow record.

### `PUT /api/workflow/:id`

Saves workflow state and editorial notes. A manual save clears any automatic reconciliation marker.

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
                                                                    ├──> Discovery + Scoring ──> Opportunity Queue
Site Inventory ──> Canonical checks ────────────────────────────────┤                              │
                                                                    │                              ├──> KV Workflow
Search Intelligence live API ──┐                                   │                              │
                               ├──> Search metrics ─────────────────┘                              └──> Discovery Snapshot
KV Search snapshot fallback ───┘                                                                    │
                                                                                                     └──> Reconciliation
```

## Next integrations

1. Scheduled automatic refresh so reconciliation can run without a manual button press
2. Stronger entity-cluster inference for shipping lines, builders, classes, and historical subjects
3. Page Studio handoff for accepted Create/Expand opportunities
4. Completion verification details surfaced directly in the dashboard
