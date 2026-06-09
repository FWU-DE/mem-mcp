# Building a Curriculum-Reference Picker

How to wire a metadata form to the MEM Lehrplan ontology so users can attach
curriculum references (Bundesland → Schulart → Schulfach → Lehrplan → topic
node) to a learning resource.

The reference implementation is `edufeed-app` (Svelte 5 + SvelteKit). This doc
extracts the load-bearing pieces so you can rebuild it in any stack.

## What you're building

A four-level cascade of selects plus a lazy-loaded tree of curriculum topic
nodes. When the user clicks a node, the form appends a SKOS-shaped concept to
one of three relation arrays — `teaches`, `assesses`, `competencyRequired` —
that get serialized into the resource's metadata.

```
[ Bundesland ▾ ]      ← all 16 states with curricula in the endpoint
[ Schulart   ▾ ]      ← school types valid in that state (+ "Alle Schularten")
[ Schulfach  ▾ ]      ← subjects taught in (state, schulart)
[ Lehrplan   ▾ ]      ← curricula matching (state, schulart, subject)

▾ Lehrplan tree (lazy-loaded on expand)
  ▸ Lernbereich 1 …    [+T] [+A] [+R]
  ▾ Lernbereich 2 …    [+T] [+A] [+R]
    • Kompetenzerwartung 2.1 …    [+T] [+A] [+R]
    • Kompetenzerwartung 2.2 …    [+T] [+A] [+R]
```

The `+T`/`+A`/`+R` buttons push the node into `teaches`/`assesses`/`competencyRequired`.

## Architecture

```
┌─ Browser ───────────────────────┐    ┌─ App server ──────────────┐    ┌─ SPARQL endpoint ──────┐
│ CurriculumPicker (cascade)      │    │ POST /api/curricula        │    │ sparql.mem.edufeed.org │
│ CurriculumTree   (lazy tree)    │───▶│  whitelist tool name       │───▶│ Virtuoso, all graphs   │
│  POST { tool, args }            │    │  validate URIs             │    │ loaded as default      │
│                                 │    │  build SPARQL from template │    │                        │
│                                 │◀───│  map bindings → {id,label}  │◀───│                        │
└─────────────────────────────────┘    └─────────────────────────────┘    └────────────────────────┘
```

Two decisions worth understanding before you copy this:

1. **The server proxies SPARQL — it doesn't expose it.** The browser POSTs
   `{tool: 'list_schulfaecher', args: {bundeslandUri: '…'}}`, not raw SPARQL.
   The server has a fixed whitelist of tool names and builds queries from
   templates. URI arguments are validated as `http(s)://` URLs free of
   `<` `>` `"` `\` and whitespace, so they cannot break out of the `<URI>`
   slots in the templates. Don't skip this — interpolating user input into
   SPARQL is the same injection problem as interpolating it into SQL.
2. **Why not call `mem-ontologie-mcp` from the browser?** The MCP server speaks
   stdio/Streamable-HTTP for LLM clients, not browsers. For a normal web form
   you want a thin SvelteKit/Express/Next route that talks SPARQL directly.
   Use the MCP server during development (Claude Code, MCP Inspector) to
   prototype the queries; ship the queries embedded in your app.

## The five query templates

All queries use these prefixes:

```sparql
PREFIX lp:   <https://w3id.org/lehrplan/ontology/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX obo:  <http://purl.obolibrary.org/obo/>
```

### 1. `list_bundeslaender` — top of the cascade

```sparql
SELECT DISTINCT ?uri ?label WHERE {
  ?uri a lp:LP_0000040 ;            # Bundesland class ("Bundesland Bezeichnung")
       rdfs:label ?label .
  FILTER(lang(?label) = "de")
} ORDER BY ?label
```

Query the Bundesland class (`LP_0000040`) directly — don't reverse-scan
`?s lp:LP_0000029 ?uri`. Every Lernbereich / Kompetenzerwartung / sub-node
in every state graph carries `LP_0000029`, so the reverse scan walks ~1.6M
triples to find 16 distinct objects (multi-second response). The class has
16 typed instances and is essentially free to query.

Returns all states that actually have curriculum data loaded. Don't hardcode
the list — new states get added as their data is imported.

### 2. `list_schularten` — school types in that state

```sparql
SELECT DISTINCT ?uri (SAMPLE(?l) AS ?label) WHERE {
  ?s lp:LP_0000812 ?uri .          # ?s für-Schulart ?uri
  ?uri rdfs:label ?l .
  ?s lp:LP_0000029 <${bundeslandUri}> .
  FILTER(lang(?l) = "de")
} GROUP BY ?uri ORDER BY ?label
```

The same Schulart can be emitted by many Lehrpläne. `GROUP BY ?uri` + `SAMPLE`
collapses them to one row per URI. Inject `bundeslandUri` after validating
it as a URL.

### 3. `list_schulfaecher` — subjects in (state, schulart)

```sparql
SELECT DISTINCT ?uri (SAMPLE(?l) AS ?label) WHERE {
  ?s lp:LP_0000537 ?uri .          # ?s hat-Schulfach ?uri
  ?uri rdfs:label ?l .
  ?s lp:LP_0000029 <${bundeslandUri}> .
  ${schulartFilter}                # optional: ?s lp:LP_0000812 <${schulartUri}> .
  FILTER(lang(?l) = "de")
} GROUP BY ?uri ORDER BY ?label
```

The Schulart filter is **optional on purpose**. Some states (RP, SN, …) don't
tag every Lehrplan with a Schulart, so requiring `LP_0000812` silently hides
real subjects. Give users an "Alle Schularten" sentinel that strips the
filter (see the cascade UI section below).

### 4. `find_lehrplaene` — curricula matching all three filters

```sparql
SELECT DISTINCT ?s ?label WHERE {
  ?lpsubclass rdfs:subClassOf* lp:LP_0000438 .   # any sub-class of Lehrplan
  ?s rdf:type ?lpsubclass .
  ?s rdfs:label ?label .
  ?s lp:LP_0000029 <${bundeslandUri}> .
  ?s lp:LP_0000537 <${schulfachUri}> .
  ${schulartFilter}
} ORDER BY ?label LIMIT 50
```

The `rdfs:subClassOf*` walk matters. `lp:LP_0000438` is the abstract Lehrplan
class; the per-state subclasses (`LP_0000819` Bayern, `LP_0000818` Sachsen,
`LP_0000433` Rheinland-Pfalz, …) are what individual Lehrpläne actually
declare. Virtuoso does **no automatic RDFS reasoning** at our endpoint, so
the property path is what makes this work. Don't replace it with
`?s rdf:type lp:LP_0000438` — you'd get zero rows.

### 5. `get_node_children` — one level of the topic tree

```sparql
SELECT DISTINCT ?child ?childLabel
  (EXISTS { ?child obo:BFO_0000051 ?gc } AS ?hasChildren)
WHERE {
  <${nodeUri}> obo:BFO_0000051 ?child .
  FILTER NOT EXISTS {
    <${nodeUri}> obo:BFO_0000051 ?intermediate .
    ?intermediate obo:BFO_0000051 ?child .
    FILTER(?intermediate != ?child)
  }
  OPTIONAL { ?child rdfs:label ?childLabel . }
} ORDER BY DESC(?hasChildren) ?childLabel
```

`obo:BFO_0000051` is the "has part" relation. The ontology also declares
`lp:LP_0000008` ("hat Teil") as a sub-property of it, but the state data
graphs (`by/data`, `sn/data`, `rp/data`, `bb/data`) contain **zero**
`LP_0000008` triples — Virtuoso does no property-hierarchy reasoning, so
querying the sub-property returns nothing. Always query the super-property.

**The FILTER NOT EXISTS is load-bearing.** The state data over-asserts
`BFO_0000051` transitively — a Lehrplan with 5 chapters and 100 leaf
bullets emits all 105 nodes as direct has-part children. For Bayern
"Geographie 5" this is 53 raw children where only 5 are truly direct; for
the RP "Evangelische Religion 5-6" Lehrplan it's 124 → 12. The filter
excludes any `?child` that's also reachable from `?nodeUri` via an
intermediate has-part hop, leaving only the truly-direct children. Apply
it at every level — chapters over-assert their grandchildren too.

`EXISTS` lets you render an expand chevron only on nodes that actually have
children. Without it, every leaf looks expandable and clicking one wastes a
round-trip. `ORDER BY DESC(?hasChildren)` then lifts branch nodes above
leaves at internal levels that still mix both.

**Label language note:** node labels in the state graphs are mostly untagged
(`lang(?label) = ""`). A `FILTER(lang(?label) = "de")` would drop them all.
Use `OPTIONAL` for the label and accept whatever comes back.

## The server route

`/api/curricula` is a single POST endpoint. Skeleton:

```js
const ALLOWED_TOOLS = new Set([
  'list_bundeslaender', 'list_schularten', 'list_schulfaecher',
  'find_lehrplaene', 'get_node_children',
]);

function validateUri(val) {
  if (typeof val !== 'string') return null;
  if (/[<>"\\\s]/.test(val)) return null;
  try {
    const u = new URL(val);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return val;
  } catch { return null; }
}

function buildSparql(tool, args) {
  switch (tool) {
    case 'list_bundeslaender': return `${PREFIXES} SELECT ...`;
    case 'list_schularten': {
      const bl = validateUri(args.bundeslandUri);
      if (!bl) return null;
      return `${PREFIXES} SELECT ... <${bl}> ...`;
    }
    // ... etc
  }
}

export async function POST({ request }) {
  const { tool, args } = await request.json();
  if (!ALLOWED_TOOLS.has(tool)) return json({error: '...'}, {status: 400});
  const sparql = buildSparql(tool, args);
  if (!sparql)                  return json({error: '...'}, {status: 400});

  const result = await sparqlQuery(env.SPARQL_ENDPOINT_URL, sparql);
  const items = bindingsToItems(result.results.bindings);
  return json({ items }, { headers: { 'cache-control': 'public, max-age=86400' } });
}
```

One thing in `bindingsToItems` to know: the id column varies by tool (`?uri`
for the term listings, `?s` for `find_lehrplaene`, `?child` for
`get_node_children`), so coalesce: `b.uri?.value ?? b.s?.value ?? b.child?.value`.
Also: Virtuoso returns `EXISTS` as `xsd:integer "1"/"0"` while other SPARQL
stores use `xsd:boolean "true"/"false"` — accept both.

## The cascade UI

Every select waits on the one above. The pattern is the same at each level:

1. The parent's value is `''` → render placeholder, disable, do nothing.
2. The parent's value changes → reset all my downstream state, then fetch
   my options.
3. Show a "Lade…" placeholder option while the request is in flight.

In Svelte 5 this is one `$effect()` per level:

```js
$effect(() => {
  const bl = bundeslandUri;            // depend on parent
  schulartUri = ''; schulfachUri = ''; lehrplanUri = '';   // reset
  schularten = []; schulfaecher = []; lehrplaene = []; rootNodes = [];
  if (!bl) return;                     // nothing to fetch
  loadingSchularten = true;
  fetchTool('list_schularten', { bundeslandUri: bl })
    .then(body => { schularten = body.items ?? []; })
    .catch(() => { schularten = []; })
    .finally(() => { loadingSchularten = false; });
});
```

In React you'd use `useEffect([bundeslandUri])`. Same shape, same reset
behaviour.

**The "Alle Schularten" sentinel.** Don't omit this. Some states tag every
Lehrplan with a Schulart, others don't. If you require a Schulart selection,
RP/SN users see suspiciously empty subject lists. The fix:

```js
const ANY_SCHULART = '__any__';
// In the select:
<option value={ANY_SCHULART}>Alle Schularten</option>
// When firing downstream queries:
if (sa !== ANY_SCHULART) args.schulartUri = sa;
```

The server-side `schulartFilter` builder omits the `LP_0000812` clause when
the arg is absent. Result: Lehrpläne that don't declare a Schulart still
surface.

## The lazy tree

After a Lehrplan is selected, fetch its direct children via
`get_node_children` and render them as a list. Each node:

- Has an expand chevron **only if** the `hasChildren` flag from the API is
  truthy. Leaves get a `•` bullet glyph instead — clicking does nothing.
- Has three action buttons (`+T` / `+A` / `+R`) wired to
  `onaction(concept, relation)`.

Fetch on first expand, cache per node, then just toggle:

```js
const expanded         = new SvelteSet();    // currently open
const fetched          = new SvelteSet();    // fetched at least once
const childrenByParent = new SvelteMap();    // node id → child[]
const loadingByParent  = new SvelteSet();    // fetch in flight

async function toggle(node) {
  if (expanded.has(node.id)) { expanded.delete(node.id); return; }
  expanded.add(node.id);
  if (fetched.has(node.id) || loadingByParent.has(node.id)) return;
  loadingByParent.add(node.id);
  try {
    const body = await fetchTool('get_node_children', { nodeUri: node.id });
    childrenByParent.set(node.id, body.items ?? []);
  } catch {
    childrenByParent.set(node.id, []);
  } finally {
    fetched.add(node.id);
    loadingByParent.delete(node.id);
  }
}
```

The component renders itself recursively for each subtree (`<Self
rootNodes={children} … />` in Svelte; same idea with `<TreeNode>` recursion
in React).

## Selection → metadata serialization

When the user clicks `+T` / `+A` / `+R`, convert the tree node to a SKOS
Concept and append it to the right form-state array:

```js
function nodeToConcept(node) {
  return { id: node.id, type: 'Concept', prefLabel: { de: node.label } };
}
```

The form's persisted shape:

```js
formData = {
  teaches:            [{ id: 'https://…', type: 'Concept', prefLabel: {de: 'Lesen'} }, …],
  assesses:           [...],
  competencyRequired: [...],
  // ... rest of the metadata record
}
```

At serialize time, fold the concepts into the
[AMB](https://dini-ag-kim.github.io/amb/draft/) (Allgemeines Metadatenprofil
für Bildungsressourcen) JSON-LD output:

```js
for (const key of ['teaches', 'assesses', 'competencyRequired']) {
  const concepts = formData[key];
  if (Array.isArray(concepts) && concepts.length > 0) {
    amb[key] = concepts.map((c) => ({
      id: c.id,
      type: 'Concept',
      prefLabel: c.prefLabel ?? { [lang]: extractLabelFromUri(c.id) },
    }));
  }
}
```

The id is the curriculum node's URI (`https://w3id.org/lehrplan/…`). That's
the persistent, dereferenceable identifier — keep it.

## Caching

The `/api/curricula` route sets `cache-control: public, max-age=86400`.
Curriculum data changes on the order of months, not requests. Browser cache
+ a CDN in front of your app server handles 95 % of the traffic; the SPARQL
endpoint only sees first-touch requests.

Within a single page session, repeated cascades hit the HTTP cache. You
don't need an in-app cache layer for this.

## Accessibility checklist

- `aria-label` on every `<select>` (the visible `<label>` is fine, but the
  label is decorative chrome — the select needs its own accessible name).
- `aria-expanded={isOpen}` on tree expand buttons.
- `aria-pressed={isInThatRelation}` on the `+T`/`+A`/`+R` toggle buttons so
  screen readers announce when a node is already in the relation list.
- `aria-hidden="true"` on the `•` leaf glyph.
- Wrap the picker in `<details>/<summary>` if it's one section of a longer
  form — gives keyboard users a collapse affordance.

## What can go wrong

| Symptom | Cause | Fix |
|---|---|---|
| `list_bundeslaender` takes seconds | Query reverse-scans `?s lp:LP_0000029 ?uri` (~1.6M triples) to find 16 distinct objects | Query the Bundesland class directly: `?uri a lp:LP_0000040`. |
| Lehrplan root shows chapters mixed with leaf bullet points | Data over-asserts `obo:BFO_0000051` transitively — every descendant appears as a direct has-part of every ancestor | Add `FILTER NOT EXISTS { … intermediate hop … }` to `get_node_children` so only truly-direct children remain. |
| Tree expansion returns no children | Query uses `lp:LP_0000008` instead of `obo:BFO_0000051` | Switch to the super-property. State graphs contain zero `LP_0000008` triples. |
| `find_lehrplaene` returns nothing for known-valid combos | Hardcoded `?s rdf:type lp:LP_0000438` | Use the `rdfs:subClassOf*` walk — Virtuoso does no automatic reasoning. |
| Subjects missing for RP/SN/BB | Required `LP_0000812` (Schulart) filter | Make the Schulart filter optional; add an "Alle Schularten" sentinel. |
| Node labels show as URIs | `FILTER(lang(?label) = "de")` on tree node labels | Drop the language filter — state data labels are mostly untagged. |
| Expand chevron on every leaf | No `EXISTS` check in `get_node_children` | Add `(EXISTS { ?child obo:BFO_0000051 ?gc } AS ?hasChildren)`. |
| User can inject SPARQL via URI args | No URI validation before string interpolation | Validate as `http(s)://` URL free of `<` `>` `"` `\` whitespace. |

## Where the reference code lives

In the `edufeed-app` repo on branch `dev`:

- `src/lib/components/educational/CurriculumPicker.svelte` — cascade
- `src/lib/components/educational/CurriculumTree.svelte` — lazy tree
- `src/routes/api/curricula/+server.js` — SPARQL proxy
- `src/lib/helpers/educational/formDataToAmb.js` — `teaches`/`assesses`/`competencyRequired` serialization

The `mem-ontologie-mcp` MCP server (this repo) exposes the same queries as
LLM tools — handy when prototyping new query shapes interactively with
Claude Code or MCP Inspector before you embed them in your app.
