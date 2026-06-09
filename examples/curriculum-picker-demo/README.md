# Curriculum Picker Demo

Minimal working demo that accompanies [`docs/curriculum-picker.md`](../../docs/curriculum-picker.md).
Implements the full Bundesland → Schulart → Schulfach → Lehrplan cascade
plus the lazy topic-node tree against the public MEM SPARQL endpoint.

## Run

```bash
node proxy.mjs
# then open http://localhost:5174
```

No `npm install`, no build step — uses Node's built-in `http` + `fetch`.

**Don't double-click `index.html`.** Opening it via `file://` skips the
proxy, and the cascade's `fetch('/api/curricula')` blows up with CORS
errors. The page detects this and shows you a hint, but it won't work
until you go via the proxy.

## What's here

- **`proxy.mjs`** — ~120 lines. Serves the static HTML and proxies
  `POST /api/curricula` to `https://sparql.mem.edufeed.org/sparql/`.
  The proxy exists for **CORS**, not security: the Virtuoso endpoint
  doesn't set `Access-Control-Allow-Origin`, so a browser on any other
  origin can't read its responses directly. If your endpoint allows CORS,
  you can call it from the browser with no server in the middle.
- **`index.html`** — ~330 lines. Vanilla JS, no framework, no build.
  The cascade is plain `change` listeners; the tree is recursive
  DOM construction with a per-node fetch cache.

## What it does NOT do (intentionally)

This is illustration, not production. It skips:

- **URI validation** before SPARQL substitution. The proxy trusts the
  browser's tool name and args. For a real app that exposes the proxy
  to untrusted users, validate URIs as the doc describes.
- **Tool-name allowlist**. The proxy maps `tool` → query template, so
  unknown tools 400, but there's no defensive check against typo'd
  args or oversized payloads.
- **Caching**. Every cascade change re-queries Virtuoso. Add an HTTP
  cache header or an in-memory layer in production.
- **Error UX**. Network errors throw and the empty dropdown stays empty.
  A real app would show a banner.
- **i18n, accessibility polish, mobile layout**. Just enough CSS to be
  readable.

## Mapping back to the doc

| Doc section | Demo location |
|---|---|
| The five query templates | `proxy.mjs` (the `QUERIES` table) |
| The server route | `proxy.mjs` (the `createServer` handler) |
| The cascade UI | `index.html` (`#bundesland` → `#lehrplan` listeners) |
| The lazy tree | `index.html` (`renderNode` + chevron click handler) |
| Selection → metadata serialization | `index.html` (`togglePick` + `renderAmb`) |
