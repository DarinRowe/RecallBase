# Self-Hosting RecallBase Sync

RecallBase sync is a Cloudflare reference backend for the same Hybrid Private Mode used by the hosted service.

## Required Cloudflare Resources

- Worker for `/api/status`, `/api/sync/status`, `/api/sync/batches`, `/api/search`, `/api/conversations/:id`, `/auth/cli/*`, `/auth/google/*`, and `/auth/logout`.
- D1 or equivalent relational storage for users, Google identities, CLI login attempts, device tokens, Web sessions, source state, cursors, completed batches, and readable search documents.
- R2 or equivalent object storage for encrypted normalized conversation chunks. Hosted V1 does not store raw source evidence.

## Secrets And Environments

Keep OAuth client secrets and storage credentials in environment secrets. Do not commit secrets to source or deployment config. Use separate OAuth apps and storage resources for development, staging, and production.

Required hosted Google OAuth values:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `RECALLBASE_HOSTED_BASE_URL`, for example `https://recallbase.example.com`

Configure the Google OAuth console authorized redirect URI as:

```text
https://<host>/auth/google/callback
```

The CLI normal flow is `rb login`, `rb sync`, then Web search. `rb login --token` remains a development/self-hosted escape hatch when you intentionally use a manually issued token.

## Route Scope

Every route must derive user and device scope from the authenticated subject. Do not trust client-supplied user ids, device ids, object keys, cursor owners, conversation owners, or blob owners.

## Sync Boundary

Hosted mode rejects non-empty `encryptedRawBlobs` with a `privacy_violation` response. Mark the batch complete only after encrypted conversation chunk metadata/payloads and readable search rows succeed. Web search and open endpoints should ignore incomplete batches.

Self-hosting gives deployment control. It does not change hosted V1 privacy semantics by default: raw evidence stays local-only, normalized messages sync as encrypted chunks, and metadata/snippets/optional summaries remain readable to the server for Web search. Raw upload compatibility should only be enabled behind an explicit self-hosted configuration.

## Verification

Run the Cloudflare verification workflow before wiring a production backend:

```bash
bun run verify:cloudflare
```

This runs a Wrangler dry-run and an in-process CLI sync/search smoke, including the zero-raw-upload assertion. To deploy the temporary verification Worker and run the same sync over real HTTP:

```bash
RECALLBASE_CF_DEPLOY=1 RECALLBASE_CF_URL=https://<worker-url> bun run verify:cloudflare
```

The verification Worker uses an in-memory backend only for deployment smoke tests. Production sync must use persistent D1/R2/Durable Object adapters.

If `RECALLBASE_CF_URL` is omitted, the script parses the workers.dev URL from Wrangler deploy output. It deletes the temporary verification Worker after a successful or failed deployed smoke run.
