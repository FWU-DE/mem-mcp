# MEM Ontologie MCP Server

## Project Overview

MCP server that queries the MEM (Metadata for Education Media) ontology via a SPARQL endpoint. The ontology models German school curricula across federal states (Bundesländer).

## Architecture

- **Transport:** stdio (default) or Streamable HTTP (`--http` flag)
- **SDK:** `@modelcontextprotocol/sdk` — use `McpServer` from `server/mcp.js` with `registerTool()` and `zod` schemas
- **Data source:** SPARQL endpoint at `http://sparql.mem.edufeed.org/sparql/`
- **Runtime:** Node.js, TypeScript, ES modules

## SPARQL Endpoint

Endpoint: `http://sparql.mem.edufeed.org/sparql/`

### Named Graphs

Configured via environment variables (see Configuration section). Infrastructure graphs are always included; state graphs are included per-state query. Current defaults in `.env.example`:

- `GRAPH_ONTOLOGY` — Ontologie (always include)
- `GRAPH_SCHULART` — Schulart (always include)
- `GRAPH_SCHULFACH` — Schulfach (always include)
- `GRAPH_STATE_SN` — Sachsen
- `GRAPH_STATE_BY` — Bayern
- `GRAPH_STATE_RP` — Rheinland-Pfalz

### Ontology Prefixes

```
PREFIX lp:  <https://w3id.org/lehrplan/ontology/>
PREFIX obo: <http://purl.obolibrary.org/obo/>
```

### Key Properties

- `obo:BFO_0000051` — **has part** — the property the state data graphs (`by/data`, `sn/data`, `rp/data`, `bb/data`) actually use for parent → child relationships. Use this for tree traversal.
- `obo:BFO_0000050` — part of (inverse of `BFO_0000051`)
- `lp:LP_0000008` — hat Teil; declared as `rdfs:subPropertyOf obo:BFO_0000051`. **State data graphs contain ZERO `lp:LP_0000008` triples** — Virtuoso does no automatic RDFS reasoning, so queries traversing the hierarchy MUST use `obo:BFO_0000051` (or include the `*/inferences` graphs, which are not configured by default).
- `lp:LP_0000026` — hat Jahrgangsstufe (grade level)
- `lp:LP_0000029` — von Bundesland (state)
- `lp:LP_0000537` — hat Schulfach (subject)
- `lp:LP_0000812` — für Schulart (school type)
- `lp:LP_0030051` — hat Beschreibung (description)

### Key Per-State Content Classes

State-specific class names carry a `(BY)`, `(SN)`, … suffix. Examples for Bayern:

- `lp:LP_0002046` — Lernbereich (BY)
- `lp:LP_0002049` — Kompetenzerwartung (BY) — the actual "Kompetenz" the user is usually asking about
- `lp:LP_0002050` — Inhalt zu den Kompetenzen (BY)

Equivalent classes exist for other states. The `get_kompetenzen` tool returns these class labels alongside each node so the LLM does not need to memorise the LP_* codes.

### Key Classes

- `lp:LP_0000438` — Lehrplan (abstract, use subClassOf* for reasoning)
- `lp:LP_0000819` — Lehrplan (BY)
- `lp:LP_0000818` — Lehrplan (SN)
- `lp:LP_0000433` — Lehrplan (RP)
- `lp:LP_0000028` — Bildungsgangniveau (parent class)
- `lp:LP_0000111` — Schulart

### Bundesland URIs

- `lp:LP_3000049` — Baden-Württemberg
- `lp:LP_3000051` — Bayern
- `lp:LP_3000048` — Berlin
- `lp:LP_3000057` — Brandenburg
- `lp:LP_3000056` — Bremen
- `lp:LP_3000045` — Hamburg
- `lp:LP_3000050` — Hessen
- `lp:LP_3000052` — Mecklenburg-Vorpommern
- `lp:LP_3000043` — Niedersachsen
- `lp:LP_3000044` — Nordrhein-Westfalen
- `lp:LP_3000046` — Rheinland-Pfalz
- `lp:LP_3000055` — Saarland
- `lp:LP_3000047` — Sachsen
- `lp:LP_3000053` — Sachsen-Anhalt
- `lp:LP_3000054` — Schleswig-Holstein
- `lp:LP_3000031` — Thüringen

### Jahrgangsstufe URIs

Pattern: `lp:LP_200000N` where N = grade level (1-13)
- `lp:LP_2000001` — Jahrgangsstufe 1
- ...through...
- `lp:LP_2000013` — Jahrgangsstufe 13

### Reasoning Pattern

The triple store doesn't support automatic reasoning. Two consequences:

1. **Class hierarchy** — use explicit `rdfs:subClassOf*` property paths:
   ```sparql
   ?lpsubclass rdfs:subClassOf* lp:LP_0000438 .
   ?s rdf:type ?lpsubclass .
   ```
2. **Property hierarchy** — the materialised triple always uses the most specific OR the most general property, never both. For part-of, the data uses `obo:BFO_0000051` only — querying the sub-property `lp:LP_0000008` returns nothing. Either query the super-property directly, or add the per-state `*/inferences` graph (which materialises the inferred triples).

## MCP Tools

- **`sparql_query`** — Execute arbitrary SPARQL SELECT queries
- **`list_bundeslaender`** — List all federal states
- **`list_schulfaecher`** — List school subjects for a state
- **`list_schularten`** — List school types for a state
- **`find_lehrplaene`** — Find curricula by state, subject, school type, grade
- **`get_lehrplan_tree`** — Get hierarchical structure of a Lehrplan (parent → child via `obo:BFO_0000051`). `depth` parameter (default 2, max 10) controls how many levels deep the tree goes. Use `get_children` to drill deeper into specific nodes.
- **`get_children`** — Get the direct children of a specific node in the Lehrplan hierarchy (via `obo:BFO_0000051`). Use this to drill down into a specific branch after using `get_lehrplan_tree`.
- **`get_kompetenzen`** — Flat catalogue of all descendant nodes (Kompetenzerwartungen, Lernbereiche, Inhalte, …) reachable from matching Lehrpläne via `obo:BFO_0000051+`, annotated with their class label. Takes the same filters as `find_lehrplaene`. This is the right tool for "Welche Kompetenzen werden in <Bundesland> im Fach <X> in <Schulart> der Jahrgangsstufe <N> entwickelt?"-style questions.
- **`search`** — Full-text search over Lehrplan node label text (Virtuoso `bif:contains`). Matches LABEL TEXT only, not concept type — terms like "Kompetenz" return nothing. Optional `bundesland` and `schulfach` filters.

## Ontology Documentation

- Class documentation: https://fwu-de.github.io/lehrplan-ontologie/
- SPARQL notebooks with examples: /home/laoc/coding/fwu/mem-sparql-notebooks/

## Configuration

All configuration is via a `.env` file in the project root (loaded automatically at startup). Copy `.env.example` to `.env` and edit as needed.

**Infrastructure graphs** (required):

| Variable | Description |
|----------|-------------|
| `SPARQL_ENDPOINT` | SPARQL endpoint URL |
| `GRAPH_ONTOLOGY` | Ontology graph URI |
| `GRAPH_SCHULART` | Schulart graph URI |
| `GRAPH_SCHULFACH` | Schulfach graph URI |

**State graphs** (dynamic, optional):

| Variable | Description |
|----------|-------------|
| `GRAPH_STATE_<CODE>` | Graph URI for a state, e.g. `GRAPH_STATE_SN`, `GRAPH_STATE_BY` |

Adding a new state requires only adding a `GRAPH_STATE_<CODE>` env var — no code changes.

## Build & Run

```bash
npm install
npm run build
npm start          # stdio mode (default)
npm run start:http # HTTP mode
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
