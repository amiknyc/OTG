# Copilot / AI Agent Instructions — OpenSea Sales Overlay

This file gives focused, actionable guidance for AI-based contributors working on the `overlays/opensea-sales-overlay` project.

Architecture & data flow
- Single-page static overlay served by `index.html` + `public/` assets. Observed files: `index.html`, `public/script.js`, `public/style.css`.
- Backend “proxy” serverless functions live in `api/*.js` and run on Vercel (`vercel.json` defines `@vercel/node` builds). These proxy upstream APIs so secret keys (OpenSea) remain server-side.
- Frontend fetches two endpoints:
  - `/api/opensea-sales.js?collection=<slug>&limit=<n>` — returns OpenSea events list (v2 style) proxied from OpenSea API
  - `/api/coingecko-gun-metrics.js` — returns normalized CoinGecko data for the GUN token
- The frontend expects a JSON shape akin to `data.asset_events|data.events` for OpenSea and a normalized object for GUN metrics with keys: `priceUsd`, `marketCapUsd`, `vol1dUsd`, `change4hPct` and `sparkline7d`.

Key files to read first
- `index.html` — main entry for the overlay (static); it expects `public/script.js` and `public/style.css` alongside.
- `public/script.js` — the primary front-end program; follows these important constants and patterns:
  - `COLLECTION_SLUG` controls which OpenSea collection to show
  - `API_PATH` and `GUN_METRICS_URL` point at serverless functions
  - `ALL_TIME_HIGH` currently hard-coded in `script.js`. There is also `public/otg-all-time-high.json` (duplicate) — prefer using the JSON file for config to avoid duplication.
- `api/opensea-sales.js` — the OpenSea proxy; requires `OPENSEA_API_KEY` in env; CORS headers set for client access. It validates `collection` query param and enforces a `limit` with a safe upper bound (50).
- `api/coingecko-gun-metrics.js` — normalizes CoinGecko `/coins` output to a compact object used by the UI.
- `public/otg-all-time-high.json` — small JSON for all-time-high metadata (exists but currently unused by `script.js`).
- `vercel.json` and `package.json` — reveal deployment: `vercel dev` is the dev script; static files are in `public/` and API functions in `api/`.

Dev workflow & commands
- Local dev uses Vercel: `npm run dev` → launches `vercel dev`. Set environment variables (key for testing):
  - OPENSEA_API_KEY — required for `api/opensea-sales.js` to proxy OpenSea.
- On PowerShell (Windows) temporarily set an env var for local dev:
  - $env:OPENSEA_API_KEY = 'sk_...'
  - npm run dev
- Test endpoints with cURL while dev server is running:
  - OpenSea proxy: curl "http://localhost:3000/api/opensea-sales.js?collection=off-the-grid&limit=5" -H "Accept: application/json"
  - GUN metrics: curl "http://localhost:3000/api/coingecko-gun-metrics.js"
- Debugging:
  - Server logs: `vercel dev` prints serverless function console logs (errors are console.error’d before returning JSON errors).
  - Frontend: use browser console and network inspector (the overlay is static HTML, so watch `/api/*` requests).

Project-specific patterns & conventions
- Serverless functions use CommonJS `module.exports = async (req,res) => {}` (no frameworks). Keep them small and fast.
- The OpenSea proxy sets simple CORS headers to enable browser/OBS fetches — always ensure `Access-Control-Allow-Origin: *` remains for client use.
- Validation in `api/opensea-sales.js`: If `collection` is missing, return `400`; if `OPENSEA_API_KEY` missing, return `500`.
- UI uses `fetch` with basic Accept headers rather than adding an API key client-side.
- Metadata/rates caching is minimal: front-end `rarityCache` caches token metadata by `metadata_url` keys.
- Avoid embedding secret keys or tokens in `public/**` files; they must remain in server environment variables.

When modifying or adding endpoints
- Follow the API shape conventions:
  - Frontend expects an array of sale events under `data.asset_events` or `data.events` (both supported). If you change the proxy or add a wrapper, keep that shape.
  - For token metrics, return `priceUsd`, `marketCapUsd`, `vol1dUsd`, `change4hPct`, `sparkline7d` (array of numbers). This keeps the frontend rendering code unchanged.
- Add unit tests manually or integration checks via local `curl`/browser dev.
- If you need to add or rename functions in `api/`, ensure `vercel.json` still includes them, or rely on Vercel pattern – `api/**/*.js` is covered already in the existing config.

Safety, error handling & UX notes
- If a backend request fails (OpenSea/Coingecko) the UI shows a simple error message; serverless functions log upstream error details with `console.error()` and return JSON with `error` and `detail` where applicable.
- If the API key is not provided, the server returns `500` with `Server misconfigured: no API key` — remember to set or instruct the deploy environment to include `OPENSEA_API_KEY`.
- When adding new data fields consumed by the UI, always support falling back gracefully in `public/script.js` (use `??` or default nulled values).

Examples to copy in PRs/changes
- Adding a new endpoint that returns simple JSON:
  - File: `api/example.js`
  - Pattern: `module.exports = async (req,res) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.json({ok: true}); }`.
- Change collection slug: set `COLLECTION_SLUG` in `public/script.js` or add UI control to pick different slugs.
- Load `ALL_TIME_HIGH` from `public/otg-all-time-high.json` instead of hardcoding it in `public/script.js` if you add features around the historical high.

What not to do (repo-specific)
- Do not add secret keys to `public/` files, `index.html`, or commit them into `api/` code. Use env vars.
- Do not change the network or data shape (keys like `asset_events`, `events`, `payment` object) without updating `public/script.js` rendering / helper functions.

If you’re unsure
- Open `public/script.js` first — it’s the best source of truth for what the backend needs to return.
- Look at `api/*.js` for the expected request/response behavior.

If anything in the above guidance is unclear or you want deeper/higher-level suggestions (e.g. add CI for Vercel preview, convert ALL_TIME_HIGH into dynamic storage), tell me which area and I’ll expand or propose a concrete change plan.
