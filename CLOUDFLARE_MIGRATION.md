# Cloudflare Pages Migration Notes

## Build

- `npm run build:cloudflare`
- Output directory: `cloudflare-dist`
- Functions directory: `functions`

## Runtime bindings

- `WMS_DB`: Cloudflare D1 binding

## D1 schema

Run `cloudflare-schema.sql` in the D1 console or via Wrangler.

## Current limitations

- The existing application still supports Netlify Blob storage.
- Cloudflare Pages uses a new D1-backed API entry in `functions/api.js`.
- GitHub repository creation and push are not yet wired in this environment because `git` is unavailable locally.

## Suggested rollout order

1. Create GitHub repository.
2. Push this workspace to GitHub.
3. Create Cloudflare Pages project.
4. Bind D1 database to `WMS_DB`.
5. Import current stock and master data into D1.
6. Verify login, stock, in/out/move/count, export, and logs.
