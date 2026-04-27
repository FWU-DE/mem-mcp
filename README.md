# MEM Ontology MCP Server

An MCP (Model Context Protocol) server for querying the MEM (Metadata for Education Media) ontology, which models German school curricula across federal states (Bundesländer).

## Features

The server provides the following tools:

1. **`sparql_query`** — Execute arbitrary SPARQL SELECT queries against the MEM triple store
2. **`list_bundeslaender`** — List all German federal states available in the ontology
3. **`list_schulfaecher`** — List all school subjects for a given state
4. **`list_schularten`** — List all school types for a given state
5. **`find_lehrplaene`** — Find curricula by state, optionally filtered by subject, school type, or grade level
6. **`get_lehrplan_tree`** — Get the hierarchical structure of a Lehrplan (bounded by `depth`, default 2, max 10)
7. **`get_children`** — Get direct children of a specific node (for drilling down into a branch)
8. **`search`** — Full-text search across all Lehrplan nodes by keyword (uses Virtuoso `bif:contains`), with optional Bundesland filter

## Installation

```bash
npm install
npm run build
```

## Configuration

### Environment Variables

All configuration is via a `.env` file in the project root (loaded automatically at startup). Copy the example and edit as needed:

```bash
cp .env.example .env
```

The server will fail at startup if required variables are missing.

**Infrastructure graphs** (required):

| Variable | Description |
|----------|-------------|
| `SPARQL_ENDPOINT` | SPARQL endpoint URL |
| `GRAPH_ONTOLOGY` | Ontology graph URI |
| `GRAPH_SCHULART` | Schulart graph URI |
| `GRAPH_SCHULFACH` | Schulfach graph URI |

**State graphs** (optional, add one per state):

| Variable | Description |
|----------|-------------|
| `GRAPH_STATE_<CODE>` | Graph URI for a state, e.g. `GRAPH_STATE_SN`, `GRAPH_STATE_BY` |

State graphs are discovered dynamically — adding a new state requires only a new `GRAPH_STATE_<CODE>` entry in `.env`.

### For Claude Code

Add a `.mcp.json` file in the project root:

```json
{
  "mcpServers": {
    "mem-ontology": {
      "type": "stdio",
      "command": "node",
      "args": ["build/index.js"]
    }
  }
}
```

### For Claude Desktop

Add to your MCP settings configuration file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mem-ontology": {
      "command": "node",
      "args": ["/absolute/path/to/mem-ontologie-mcp/build/index.js"]
    }
  }
}
```

## Usage Examples

### Find biology curricula for Gymnasium in Sachsen
```
Tool: find_lehrplaene
Arguments: { "bundesland": "SN", "schulfach": "Biologie", "schulart": "Gymnasium" }
```

### Browse the curriculum tree (depth-limited)
```
Tool: get_lehrplan_tree
Arguments: { "lehrplanUri": "https://lp-sachsen.org/resource/522", "depth": 2 }
```

### Drill into a specific node
```
Tool: get_children
Arguments: { "nodeUri": "https://lp-sachsen.org/resource/7052" }
```

### Search for a topic across all states
```
Tool: search
Arguments: { "query": "Wirbeltiere" }
```

### Search within a specific state
```
Tool: search
Arguments: { "query": "Fische", "bundesland": "SN" }
```

## State Codes

- **BW** — Baden-Württemberg
- **BY** — Bayern
- **BE** — Berlin
- **BB** — Brandenburg
- **HB** — Bremen
- **HH** — Hamburg
- **HE** — Hessen
- **MV** — Mecklenburg-Vorpommern
- **NI** — Niedersachsen
- **NW** — Nordrhein-Westfalen
- **RP** — Rheinland-Pfalz
- **SL** — Saarland
- **SN** — Sachsen
- **ST** — Sachsen-Anhalt
- **SH** — Schleswig-Holstein
- **TH** — Thüringen

**Note:** Currently, curriculum data is available for **BY** (Bayern), **SN** (Sachsen), and **RP** (Rheinland-Pfalz).

## Architecture

- **Transport:** stdio (default) or Streamable HTTP (`--http` flag)
- **SDK:** `@modelcontextprotocol/sdk` with `McpServer` and `zod` schemas
- **Data source:** SPARQL endpoint (configurable via `SPARQL_ENDPOINT` env var)
- **Runtime:** Node.js, TypeScript, ES modules

Source files:
- `src/index.ts` — Main MCP server with all tool registrations
- `src/http.ts` — Streamable HTTP transport (Express server)
- `src/sparql.ts` — SPARQL query execution and result formatting

## Development

```bash
npm run build      # Compile TypeScript
npm start          # Run the server (stdio)
npm run start:http # Run the server (HTTP)
```

## HTTP Mode

Run with `--http` flag (or `npm run start:http`) to expose the MCP server as an HTTP service using Streamable HTTP transport.

**Configuration** (via `.env` or environment variables):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |
| `API_KEY` | *(unset)* | Bearer token for auth. If unset, auth is disabled. |

**Authentication:** When `API_KEY` is set, all `/mcp` requests must include `Authorization: Bearer <key>`. Without `API_KEY`, the server is open access.

**Client connection example:**

```bash
# Test with MCP Inspector
npx @modelcontextprotocol/inspector --url http://localhost:3000/mcp

# With authentication
npx @modelcontextprotocol/inspector --url http://localhost:3000/mcp --header "Authorization: Bearer your-secret-key-here"
```

## Deployment (Docker)

A `Dockerfile` and `docker-compose.yml` are included for self-hosted deployment. The container runs the server in HTTP mode behind your own reverse proxy (TLS is expected to be terminated upstream).

Container images are built by Forgejo Actions on every push to `main` and every `vX.Y.Z` tag, then published to the Forgejo registry at `git.edufeed.org/laoc/mem-mcp`. Available tags: `:latest`, `:main`, `:sha-<short>`, `:vX.Y.Z`.

```bash
# One-time on the deploy host: authenticate to the Forgejo registry.
# Skip this step if the package is set to public in Forgejo.
docker login git.edufeed.org

# First-time setup: configure environment.
cp .env.example .env
# Set API_KEY to a random secret for production.

# Deploy / update.
docker compose pull
docker compose up -d

# Logs
docker compose logs -f
```

By default the container binds to `127.0.0.1:3000` on the host, so it's only reachable via a reverse proxy on the same machine. Adjust the `ports:` entry in `docker-compose.yml` if you need LAN exposure.

### Production checklist

Before exposing the service publicly:

- **Pick a hostname.** Replace `mcp.example.org` in the reverse-proxy snippets below with your real FQDN and create the DNS record.
- **Set `API_KEY`.** When unset, the server is open access — fine for stdio or LAN, not for the public internet. Generate one with `openssl rand -hex 32` and put it in `.env`. Clients then send `Authorization: Bearer <key>`.
- **Pin the image tag.** `:latest` makes updates implicit. For deliberate rollouts, change `image:` in `docker-compose.yml` to a release tag (`:vX.Y.Z`) or commit pin (`:sha-<short>`) and bump it on purpose.
- **Confirm registry access.** `git.edufeed.org/laoc/mem-mcp` may be private. If `docker compose pull` fails with `unauthorized`, run `docker login git.edufeed.org` once on the host (or set the package to public in Forgejo).
- **Allow egress to the SPARQL endpoint.** The container must reach `https://sparql.mem.edufeed.org/sparql/` (or whatever `SPARQL_ENDPOINT` points at). If outbound traffic is firewalled, allow-list that host.

### Building locally (development only)

```bash
docker build -t mem-ontology-mcp:dev .
docker run --rm -p 127.0.0.1:3000:3000 --env-file .env mem-ontology-mcp:dev
```

### Reverse proxy example (Caddy)

```caddyfile
mcp.example.org {
    reverse_proxy 127.0.0.1:3000
}
```

### Reverse proxy example (nginx)

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:3000/mcp;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Streamable HTTP uses SSE for server->client messages.
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

Clients then connect to `https://mcp.example.org/mcp` with `Authorization: Bearer <API_KEY>`.

## License

Unlicense
