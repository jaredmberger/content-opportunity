# Content Opportunity Recovery Export

Content Opportunity Finder provides a complete, read-only export of its dedicated `OPPORTUNITY_STATE` Cloudflare KV namespace at:

`GET /api/recovery-export`

## Security

The export may contain editorial notes, workflow decisions, feedback history, cached intelligence, and reconciliation state. It therefore requires a dedicated Cloudflare Worker secret:

`RECOVERY_EXPORT_TOKEN`

Send the token in:

`X-Curator-Recovery-Key: <RECOVERY_EXPORT_TOKEN>`

If the secret is not configured, the recovery endpoint returns 503 and remains disabled.

The endpoint performs no KV writes.

## What is exported

The exporter paginates the entire `OPPORTUNITY_STATE` namespace and preserves every key and its raw JSON string value.

Known key families include:

- `content-opportunity:workflow:<id>`
- `content-opportunity:feedback:<id>`
- `content-opportunity:search-intelligence:v1`
- `content-opportunity:project-records:v1`
- `content-opportunity:discovery-snapshot:v1`
- `content-opportunity:intelligence-candidates:v1`

Unknown future keys are also retained so the backup does not silently become incomplete when the application evolves.

Each backup includes:

- export timestamp
- total KV key count
- counts by known key family
- source binding and namespace ID
- SHA-256 integrity metadata
- exact key/value payloads

The response downloads as:

`content-opportunity-recovery-<timestamp>.json`

## Validation

From a clean checkout:

```bash
npm run recovery:validate -- /path/to/content-opportunity-recovery-....json
```

Validation checks:

- backup format and schema version
- duplicate/malformed keys
- JSON validity of every stored value
- key-count agreement
- SHA-256 integrity

## iPad / iPhone backup

Use Shortcuts or another HTTP client capable of supplying a custom header:

1. Get Contents of URL
2. URL: `https://content.oceanliners.net/api/recovery-export`
3. Method: GET
4. Header: `X-Curator-Recovery-Key` = the configured recovery token
5. Save File

Keep the resulting JSON outside GitHub and outside Cloudflare.

## Restore policy

There is intentionally no production restore endpoint.

Restoration should first target an explicitly named disposable KV namespace and verify every key after writing. Production restoration should only follow a documented data-loss incident and independent target verification.
