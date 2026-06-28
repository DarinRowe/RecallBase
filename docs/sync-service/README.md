# Sync Service Docs

The sync service backs up searchable RecallBase data to Cloudflare while keeping raw local transcripts out of the readable cloud surface.

## Code Map

- Worker entry: `apps/cloudflare/src/worker/index.ts`
- Sync routes: `apps/cloudflare/src/sync/routes.ts`
- Batch protocol: `apps/cloudflare/src/sync/batch-protocol.ts`
- Privacy schema: `apps/cloudflare/src/sync/privacy-schema.ts`
- Auth: `apps/cloudflare/src/auth/*`
- Migrations: `apps/cloudflare/migrations/*`

## Related Docs

- Product privacy model: `../product/privacy.md`
- Self-hosting: `self-hosting.md`
- Release/deploy checks: `../release/platforms.md`
