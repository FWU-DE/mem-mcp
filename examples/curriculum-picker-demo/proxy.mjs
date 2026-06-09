// Minimal SPARQL proxy + static file server for the curriculum-picker demo.
//
// Why a proxy at all? The public MEM SPARQL endpoint (Virtuoso) does not
// set Access-Control-Allow-Origin, so a browser running on any other origin
// can't read its responses. This proxy is a CORS workaround — it forwards
// `{tool, args}` to the endpoint server-side and returns the JSON. No auth,
// no caching, no URI validation. For a real app you'd want all three.
//
// Run:
//   node proxy.mjs
//   # then open http://localhost:5173

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5174;
const ENDPOINT = 'https://sparql.mem.edufeed.org/sparql/';
const HERE = dirname(fileURLToPath(import.meta.url));

const PREFIXES = `PREFIX lp: <https://w3id.org/lehrplan/ontology/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX obo: <http://purl.obolibrary.org/obo/>`;

const SCHULART_FILTER = (uri) => (uri ? `\n  ?s lp:LP_0000812 <${uri}> .` : '');

const QUERIES = {
  list_bundeslaender: () => `${PREFIXES}
SELECT DISTINCT ?uri ?label WHERE {
  ?uri a lp:LP_0000040 ;
       rdfs:label ?label .
  FILTER(lang(?label) = "de")
} ORDER BY ?label`,

  list_schularten: ({ bundeslandUri }) => `${PREFIXES}
SELECT DISTINCT ?uri (SAMPLE(?l) AS ?label) WHERE {
  ?s lp:LP_0000812 ?uri .
  ?uri rdfs:label ?l .
  ?s lp:LP_0000029 <${bundeslandUri}> .
  FILTER(lang(?l) = "de")
} GROUP BY ?uri ORDER BY ?label`,

  list_schulfaecher: ({ bundeslandUri, schulartUri }) => `${PREFIXES}
SELECT DISTINCT ?uri (SAMPLE(?l) AS ?label) WHERE {
  ?s lp:LP_0000537 ?uri .
  ?uri rdfs:label ?l .
  ?s lp:LP_0000029 <${bundeslandUri}> .${SCHULART_FILTER(schulartUri)}
  FILTER(lang(?l) = "de")
} GROUP BY ?uri ORDER BY ?label`,

  find_lehrplaene: ({ bundeslandUri, schulfachUri, schulartUri }) => `${PREFIXES}
SELECT DISTINCT ?s ?label WHERE {
  ?lpsubclass rdfs:subClassOf* lp:LP_0000438 .
  ?s rdf:type ?lpsubclass .
  ?s rdfs:label ?label .
  ?s lp:LP_0000029 <${bundeslandUri}> .
  ?s lp:LP_0000537 <${schulfachUri}> .${SCHULART_FILTER(schulartUri)}
} ORDER BY ?label LIMIT 50`,

  get_node_children: ({ nodeUri }) => `${PREFIXES}
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
} ORDER BY DESC(?hasChildren) ?childLabel`
};

function bindingsToItems(bindings) {
  const out = [];
  for (const b of bindings) {
    const id = b.uri?.value ?? b.s?.value ?? b.child?.value ?? '';
    const label = b.label?.value ?? b.childLabel?.value ?? '';
    if (!id || !label) continue;
    const item = { id, label };
    if (b.hasChildren) {
      const v = b.hasChildren.value;
      item.hasChildren = v === 'true' || v === '1';
    }
    out.push(item);
  }
  return out;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/curricula') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
    const build = QUERIES[body.tool];
    if (!build) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: `Unknown tool '${body.tool}'` }));
    }
    const sparql = build(body.args ?? {});
    try {
      const upstream = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          accept: 'application/sparql-results+json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ query: sparql })
      });
      const json = await upstream.json();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ items: bindingsToItems(json.results?.bindings ?? []) }));
    } catch (err) {
      console.error('SPARQL fetch failed:', err);
      res.writeHead(502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Upstream SPARQL error' }));
    }
  }

  // Static file fallback — serves index.html.
  const path = req.url === '/' ? '/index.html' : req.url;
  try {
    const content = await readFile(join(HERE, path));
    const type = path.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(content);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, () => console.log(`curriculum-picker demo: http://localhost:${PORT}`));
