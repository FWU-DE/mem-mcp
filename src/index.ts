#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  querySparql,
  formatResults,
  requireEnv,
  SPARQL_ENDPOINT,
} from "./sparql.js";

// --- Named Graphs ---

// Infrastructure graphs (always included in queries)
const INFRA_GRAPHS = [
  requireEnv("GRAPH_ONTOLOGY"),
  requireEnv("GRAPH_SCHULART"),
  requireEnv("GRAPH_SCHULFACH"),
];

// State graphs — discovered dynamically from GRAPH_STATE_<CODE> env vars
const STATE_GRAPHS: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("GRAPH_STATE_") && value) {
    const code = key.slice("GRAPH_STATE_".length);
    STATE_GRAPHS[code] = value;
  }
}

const ALL_GRAPHS = [...INFRA_GRAPHS, ...Object.values(STATE_GRAPHS)];

function fromClauses(graphs: string[]): string {
  return graphs.map((g) => `FROM <${g}>`).join("\n");
}

/** Return only the graphs relevant for a given Bundesland code. */
function graphsForBundesland(code: string): string[] {
  const stateGraph = STATE_GRAPHS[code];
  return stateGraph ? [...INFRA_GRAPHS, stateGraph] : [...INFRA_GRAPHS];
}

// --- Bundesland Lookup ---

const BUNDESLAND_URI: Record<string, string> = {
  BW: "https://w3id.org/lehrplan/ontology/LP_3000049",
  BY: "https://w3id.org/lehrplan/ontology/LP_3000051",
  BE: "https://w3id.org/lehrplan/ontology/LP_3000048",
  BB: "https://w3id.org/lehrplan/ontology/LP_3000057",
  HB: "https://w3id.org/lehrplan/ontology/LP_3000056",
  HH: "https://w3id.org/lehrplan/ontology/LP_3000045",
  HE: "https://w3id.org/lehrplan/ontology/LP_3000050",
  MV: "https://w3id.org/lehrplan/ontology/LP_3000052",
  NI: "https://w3id.org/lehrplan/ontology/LP_3000043",
  NW: "https://w3id.org/lehrplan/ontology/LP_3000044",
  RP: "https://w3id.org/lehrplan/ontology/LP_3000046",
  SL: "https://w3id.org/lehrplan/ontology/LP_3000055",
  SN: "https://w3id.org/lehrplan/ontology/LP_3000047",
  ST: "https://w3id.org/lehrplan/ontology/LP_3000053",
  SH: "https://w3id.org/lehrplan/ontology/LP_3000054",
  TH: "https://w3id.org/lehrplan/ontology/LP_3000031",
};

const BUNDESLAND_NAME: Record<string, string> = {
  "baden-württemberg": "BW",
  "bayern": "BY",
  "berlin": "BE",
  "brandenburg": "BB",
  "bremen": "HB",
  "hamburg": "HH",
  "hessen": "HE",
  "mecklenburg-vorpommern": "MV",
  "niedersachsen": "NI",
  "nordrhein-westfalen": "NW",
  "rheinland-pfalz": "RP",
  "saarland": "SL",
  "sachsen": "SN",
  "sachsen-anhalt": "ST",
  "schleswig-holstein": "SH",
  "thüringen": "TH",
};

/** Resolve a Bundesland name, code, or URI to { code, uri }. */
function resolveBundesland(input: string): { code: string; uri: string } {
  const trimmed = input.trim();

  // Two-letter code (case-insensitive)
  const upper = trimmed.toUpperCase();
  if (BUNDESLAND_URI[upper]) return { code: upper, uri: BUNDESLAND_URI[upper] };

  // Full name (case-insensitive)
  const lower = trimmed.toLowerCase();
  const nameCode = BUNDESLAND_NAME[lower];
  if (nameCode) return { code: nameCode, uri: BUNDESLAND_URI[nameCode] };

  // Already a URI — reverse-lookup the code
  if (trimmed.startsWith("http")) {
    for (const [c, u] of Object.entries(BUNDESLAND_URI)) {
      if (u === trimmed) return { code: c, uri: trimmed };
    }
    return { code: "", uri: trimmed };
  }

  throw new Error(
    `Unknown Bundesland: "${input}". Use a code (BY, SN, RP, ...) or name (Bayern, Sachsen, ...).`
  );
}

// --- SPARQL name resolution helpers ---

async function resolveSchulfachUri(
  name: string,
  bundeslandUri: string,
  graphs: string[]
): Promise<string> {
  const query = `
PREFIX lp: <https://w3id.org/lehrplan/ontology/>
SELECT ?uri
${fromClauses(graphs)}
WHERE {
  ?s lp:LP_0000537 ?uri .
  ?uri rdfs:label ?l .
  ?s lp:LP_0000029 <${bundeslandUri}> .
  FILTER(LCASE(STR(?l)) = "${name.toLowerCase()}")
}
LIMIT 1`;

  const results = await querySparql(query);
  if (results.results.bindings.length === 0) {
    throw new Error(
      `Schulfach "${name}" not found for this Bundesland. Use list_schulfaecher to see available subjects.`
    );
  }
  return results.results.bindings[0].uri.value;
}

async function resolveSchulartUri(
  name: string,
  bundeslandUri: string,
  graphs: string[]
): Promise<string> {
  const query = `
PREFIX lp: <https://w3id.org/lehrplan/ontology/>
SELECT ?uri
${fromClauses(graphs)}
WHERE {
  ?s lp:LP_0000812 ?uri .
  ?uri rdfs:label ?l .
  ?s lp:LP_0000029 <${bundeslandUri}> .
  FILTER(LCASE(STR(?l)) = "${name.toLowerCase()}")
}
LIMIT 1`;

  const results = await querySparql(query);
  if (results.results.bindings.length === 0) {
    throw new Error(
      `Schulart "${name}" not found for this Bundesland. Use list_schularten to see available school types.`
    );
  }
  return results.results.bindings[0].uri.value;
}

// --- Error wrapper ---

function toolError(msg: string) {
  return {
    content: [{ type: "text" as const, text: msg }],
    isError: true,
  };
}

// --- MCP Server Factory ---

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mem-ontology-server",
    version: "0.0.1",
  });

  // Tool 1: Execute arbitrary SPARQL queries
  server.registerTool(
    "sparql_query",
    {
      title: "SPARQL Query",
      description:
        "Execute a SPARQL query against the MEM ontology triple store. " +
        "PREFIX lp: <https://w3id.org/lehrplan/ontology/> is available. " +
        "You MUST include FROM clauses for the graphs you need. " +
        "Available graphs: " +
        [
          ...INFRA_GRAPHS.map((g) => `<${g}>`),
          ...Object.entries(STATE_GRAPHS).map(([code, g]) => `${code}: <${g}>`),
        ].join(", "),
      inputSchema: {
        query: z.string().describe("The full SPARQL SELECT query to execute"),
      },
    },
    async ({ query }) => {
      try {
        const results = await querySparql(query);
        return { content: [{ type: "text", text: formatResults(results) }] };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // Tool 2: List available Bundesländer
  server.registerTool(
    "list_bundeslaender",
    {
      title: "List Bundesländer",
      description:
        "List all German federal states (Bundesländer) available in the ontology with their codes and URIs.",
      inputSchema: {},
    },
    async () => {
      try {
        const query = `
PREFIX lp: <https://w3id.org/lehrplan/ontology/>
SELECT DISTINCT ?uri ?label
${fromClauses(ALL_GRAPHS)}
WHERE {
  ?s lp:LP_0000029 ?uri .
  ?uri rdfs:label ?label .
  FILTER(lang(?label) = "de")
}
ORDER BY ?label`;

        const results = await querySparql(query);
        return { content: [{ type: "text", text: formatResults(results) }] };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // Tool 3: List Schulfächer for a Bundesland
  server.registerTool(
    "list_schulfaecher",
    {
      title: "List Schulfächer",
      description:
        "List all school subjects (Schulfächer) for a Bundesland. " +
        "Accepts a state code (BY, SN, RP, ...) or name (Bayern, Sachsen, ...).",
      inputSchema: {
        bundesland: z
          .string()
          .describe(
            "State code (BY, SN, RP, ...) or name (Bayern, Sachsen, Rheinland-Pfalz, ...)"
          ),
      },
    },
    async ({ bundesland }) => {
      try {
        const bl = resolveBundesland(bundesland);
        const graphs = graphsForBundesland(bl.code);
        const query = `
PREFIX lp: <https://w3id.org/lehrplan/ontology/>
SELECT DISTINCT ?uri (SAMPLE(?l) AS ?label)
${fromClauses(graphs)}
WHERE {
  ?s lp:LP_0000537 ?uri .
  ?uri rdfs:label ?l .
  ?s lp:LP_0000029 <${bl.uri}> .
  FILTER(lang(?l) = "de")
}
GROUP BY ?uri
ORDER BY ?label`;

        const results = await querySparql(query);
        return { content: [{ type: "text", text: formatResults(results) }] };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // Tool 4: List Schularten for a Bundesland
  server.registerTool(
    "list_schularten",
    {
      title: "List Schularten",
      description:
        "List all school types (Schularten) for a Bundesland. " +
        "Accepts a state code (BY, SN, RP, ...) or name (Bayern, Sachsen, ...).",
      inputSchema: {
        bundesland: z
          .string()
          .describe(
            "State code (BY, SN, RP, ...) or name (Bayern, Sachsen, Rheinland-Pfalz, ...)"
          ),
      },
    },
    async ({ bundesland }) => {
      try {
        const bl = resolveBundesland(bundesland);
        const graphs = graphsForBundesland(bl.code);
        const query = `
PREFIX lp: <https://w3id.org/lehrplan/ontology/>
SELECT DISTINCT ?uri (SAMPLE(?l) AS ?label)
${fromClauses(graphs)}
WHERE {
  ?s lp:LP_0000812 ?uri .
  ?uri rdfs:label ?l .
  ?s lp:LP_0000029 <${bl.uri}> .
}
GROUP BY ?uri
ORDER BY ?label`;

        const results = await querySparql(query);
        return { content: [{ type: "text", text: formatResults(results) }] };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // Tool 5: Find Lehrpläne
  server.registerTool(
    "find_lehrplaene",
    {
      title: "Find Lehrpläne",
      description:
        "Find curricula (Lehrpläne) by Bundesland, optionally filtered by Schulfach, Schulart, or Jahrgangsstufe. " +
        "Use state codes/names. For Schulfach and Schulart, use the German name as shown by the list tools.",
      inputSchema: {
        bundesland: z
          .string()
          .describe("State code (BY, SN, RP, ...) or name (Bayern, Sachsen, ...)"),
        schulfach: z
          .string()
          .optional()
          .describe("Optional: subject name in German (e.g. Biologie, Mathematik)"),
        schulart: z
          .string()
          .optional()
          .describe("Optional: school type name (e.g. Gymnasium, Grundschule)"),
        jahrgangsstufe: z
          .number()
          .int()
          .min(1)
          .max(13)
          .optional()
          .describe("Optional: grade level (1-13)"),
      },
    },
    async ({ bundesland, schulfach, schulart, jahrgangsstufe }) => {
      try {
        const bl = resolveBundesland(bundesland);
        const graphs = graphsForBundesland(bl.code);

        const filters = [`?s lp:LP_0000029 <${bl.uri}> .`];

        if (schulfach) {
          const sfUri = await resolveSchulfachUri(schulfach, bl.uri, graphs);
          filters.push(`?s lp:LP_0000537 <${sfUri}> .`);
        }
        if (schulart) {
          const saUri = await resolveSchulartUri(schulart, bl.uri, graphs);
          filters.push(`?s lp:LP_0000812 <${saUri}> .`);
        }
        if (jahrgangsstufe) {
          const jsUri = `https://w3id.org/lehrplan/ontology/LP_${String(2000000 + jahrgangsstufe).padStart(7, "0")}`;
          filters.push(`?s lp:LP_0000026 <${jsUri}> .`);
        }

        const query = `
PREFIX lp: <https://w3id.org/lehrplan/ontology/>
SELECT DISTINCT ?s ?label
${fromClauses(graphs)}
WHERE {
  ?lpsubclass rdfs:subClassOf* lp:LP_0000438 .
  ?s rdf:type ?lpsubclass .
  ?s rdfs:label ?label .
  ${filters.join("\n  ")}
}
ORDER BY ?label
LIMIT 50`;

        const results = await querySparql(query);
        return { content: [{ type: "text", text: formatResults(results) }] };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // Tool 6: Get curriculum tree (has part) — bounded by depth
  server.registerTool(
    "get_lehrplan_tree",
    {
      title: "Get Lehrplan Tree",
      description:
        "Get the hierarchical structure (parent-child via obo:BFO_0000051 'has part') of a specific Lehrplan. " +
        "Use a Lehrplan URI obtained from find_lehrplaene. " +
        "The depth parameter controls how many levels deep the tree goes (default 2). " +
        "Use get_children to drill deeper into specific nodes. " +
        "For the flat list of all competency-level labels (the typical 'welche Kompetenzen werden entwickelt?' question) prefer get_kompetenzen.",
      inputSchema: {
        lehrplanUri: z.string().describe("URI of the Lehrplan (from find_lehrplaene results)"),
        depth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(2)
          .describe("How many levels deep to retrieve (default 2)"),
      },
    },
    async ({ lehrplanUri, depth }) => {
      try {
        // Build UNION clauses for each depth level (1..depth)
        // Level 1: root -> child
        // Level 2: root -> intermediate -> child
        // etc.
        const unions: string[] = [];
        for (let d = 1; d <= depth; d++) {
          if (d === 1) {
            unions.push(
              `{ BIND(<${lehrplanUri}> AS ?parent) . ?parent obo:BFO_0000051 ?child . }`
            );
          } else {
            // Chain d-1 intermediate hops from root to ?parent, then ?parent -> ?child
            const steps: string[] = [];
            steps.push(`<${lehrplanUri}> obo:BFO_0000051 ?step1 .`);
            for (let i = 2; i < d; i++) {
              steps.push(`?step${i - 1} obo:BFO_0000051 ?step${i} .`);
            }
            steps.push(`BIND(?step${d - 1} AS ?parent)`);
            steps.push(`?parent obo:BFO_0000051 ?child .`);
            unions.push(`{ ${steps.join(" ")} }`);
          }
        }

        const query = `
PREFIX lp: <https://w3id.org/lehrplan/ontology/>
PREFIX obo: <http://purl.obolibrary.org/obo/>
SELECT DISTINCT ?parent ?parentLabel ?child ?childLabel
${fromClauses(ALL_GRAPHS)}
WHERE {
  ${unions.join("\n  UNION\n  ")}
  OPTIONAL { ?parent rdfs:label ?parentLabel . }
  OPTIONAL { ?child rdfs:label ?childLabel . }
}
ORDER BY ?parent ?child`;

        const results = await querySparql(query);

        // Check if any leaf nodes at the deepest level have further children
        const leafUris = new Set<string>();
        const parentUris = new Set<string>();
        for (const binding of results.results.bindings) {
          parentUris.add(binding.parent.value);
          leafUris.add(binding.child.value);
        }
        // Leaves are children that never appear as parents
        const leaves = [...leafUris].filter((u) => !parentUris.has(u));

        let text = formatResults(results);
        if (leaves.length > 0) {
          text += `\n\n(Tree shown to depth ${depth}. Deeper levels may exist. Use get_children to explore further.)`;
        }

        return { content: [{ type: "text", text }] };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // Tool 7: Get direct children of a node
  server.registerTool(
    "get_children",
    {
      title: "Get Children",
      description:
        "Get the direct children of a specific node in the Lehrplan hierarchy (via obo:BFO_0000051 'has part'). " +
        "Use this to drill down into a specific branch after using get_lehrplan_tree.",
      inputSchema: {
        nodeUri: z
          .string()
          .describe("URI of the node to get children for"),
      },
    },
    async ({ nodeUri }) => {
      try {
        const query = `
PREFIX lp: <https://w3id.org/lehrplan/ontology/>
PREFIX obo: <http://purl.obolibrary.org/obo/>
SELECT DISTINCT ?child ?childLabel
${fromClauses(ALL_GRAPHS)}
WHERE {
  <${nodeUri}> obo:BFO_0000051 ?child .
  OPTIONAL { ?child rdfs:label ?childLabel . }
}
ORDER BY ?child`;

        const results = await querySparql(query);
        if (results.results.bindings.length === 0) {
          return {
            content: [{ type: "text", text: "No children found (leaf node)." }],
          };
        }
        return { content: [{ type: "text", text: formatResults(results) }] };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // Tool 8: Full-text search across Lehrpläne
  server.registerTool(
    "search",
    {
      title: "Search Lehrpläne",
      description:
        "Full-text search over Lehrplan node labels by keyword (Virtuoso bif:contains, prefix-matching — 'Fisch' also matches 'Fische'). " +
        "Returns matching nodes with their parent Lehrplan for context. Optionally filter by Bundesland and/or Schulfach. " +
        "NOTE: this matches LABEL TEXT, not concept type. Terms like 'Kompetenz' or 'Lernbereich' return no results because labels carry the competency wording itself (e.g. 'beschreiben…', 'erläutern…'), not the category name. " +
        "To list all competencies of a Lehrplan, use get_kompetenzen instead.",
      inputSchema: {
        query: z.string().describe("Search term (e.g. 'Fisch', 'Evolution')"),
        bundesland: z
          .string()
          .optional()
          .describe(
            "Optional: state code (BY, SN, RP, ...) or name (Bayern, Sachsen, ...) to limit search"
          ),
        schulfach: z
          .string()
          .optional()
          .describe(
            "Optional: subject name in German (e.g. Biologie, Mathematik) to limit search to a specific subject"
          ),
      },
    },
    async ({ query, bundesland, schulfach }) => {
      try {
        let graphs: string[] = ALL_GRAPHS;
        let blUri: string | undefined;
        if (bundesland) {
          const bl = resolveBundesland(bundesland);
          graphs = graphsForBundesland(bl.code);
          blUri = bl.uri;
        }

        const containsExpr = query.trim().split(/\s+/).map(w => `'${w.replace(/'/g, "")}*'`).join(" AND ");

        let sparql: string;
        if (schulfach) {
          if (!blUri) {
            return toolError("Bundesland is required when filtering by Schulfach.");
          }
          const sfUri = await resolveSchulfachUri(schulfach, blUri, graphs);
          sparql = `
PREFIX lp: <https://w3id.org/lehrplan/ontology/>
PREFIX obo: <http://purl.obolibrary.org/obo/>
SELECT DISTINCT ?s ?label ?lp ?lpLabel
${fromClauses(graphs)}
WHERE {
  ?s rdfs:label ?label .
  ?label bif:contains "${containsExpr}" .
  ?lp obo:BFO_0000051+ ?s .
  ?lp lp:LP_0000537 <${sfUri}> .
  ?lp rdfs:label ?lpLabel .
}
ORDER BY ?s
LIMIT 50`;
        } else {
          sparql = `
PREFIX lp: <https://w3id.org/lehrplan/ontology/>
PREFIX obo: <http://purl.obolibrary.org/obo/>
SELECT DISTINCT ?s ?label ?parent ?parentLabel
${fromClauses(graphs)}
WHERE {
  ?s rdfs:label ?label .
  ?label bif:contains "${containsExpr}" .
  OPTIONAL {
    ?parent obo:BFO_0000051 ?s .
    ?parent rdfs:label ?parentLabel .
  }
}
ORDER BY ?s
LIMIT 50`;
        }

        const results = await querySparql(sparql);
        if (results.results.bindings.length === 0) {
          return {
            content: [
              { type: "text", text: `No results found for "${query}".` },
            ],
          };
        }
        let text = formatResults(results);
        if (results.results.bindings.length === 50) {
          text += "\n\n(Results limited to 50. Try a more specific query or add filters.)";
        }
        return { content: [{ type: "text", text }] };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // Tool 9: Flat catalogue of all Kompetenzen/Inhalte under matching Lehrpläne
  server.registerTool(
    "get_kompetenzen",
    {
      title: "Get Kompetenzen",
      description:
        "List all educational content of matching Lehrpläne as a flat catalogue: every descendant node (Kompetenzerwartung, Lernbereich, Inhalt zu den Kompetenzen, …) reachable via obo:BFO_0000051+ together with its class label (e.g. 'Kompetenzerwartung (BY)') and its parent Lehrplan label. " +
        "This is the right tool for 'Welche Kompetenzen werden in <Bundesland> im Fach <X> in der <Schulart> der Jahrgangsstufe <N> entwickelt?'-style questions. " +
        "Takes the same filters as find_lehrplaene (bundesland required; schulfach, schulart, jahrgangsstufe optional). " +
        "If multiple Lehrpläne match the filter set, results are merged — narrow the filters if the response is truncated.",
      inputSchema: {
        bundesland: z
          .string()
          .describe("State code (BY, SN, RP, ...) or name (Bayern, Sachsen, ...)"),
        schulfach: z
          .string()
          .optional()
          .describe("Optional: subject name in German (e.g. Biologie, Mathematik)"),
        schulart: z
          .string()
          .optional()
          .describe("Optional: school type name (e.g. Gymnasium, Grundschule)"),
        jahrgangsstufe: z
          .number()
          .int()
          .min(1)
          .max(13)
          .optional()
          .describe("Optional: grade level (1-13)"),
      },
    },
    async ({ bundesland, schulfach, schulart, jahrgangsstufe }) => {
      try {
        const bl = resolveBundesland(bundesland);
        const graphs = graphsForBundesland(bl.code);

        const filters = [`?lp lp:LP_0000029 <${bl.uri}> .`];
        if (schulfach) {
          const sfUri = await resolveSchulfachUri(schulfach, bl.uri, graphs);
          filters.push(`?lp lp:LP_0000537 <${sfUri}> .`);
        }
        if (schulart) {
          const saUri = await resolveSchulartUri(schulart, bl.uri, graphs);
          filters.push(`?lp lp:LP_0000812 <${saUri}> .`);
        }
        if (jahrgangsstufe) {
          const jsUri = `https://w3id.org/lehrplan/ontology/LP_${String(2000000 + jahrgangsstufe).padStart(7, "0")}`;
          filters.push(`?lp lp:LP_0000026 <${jsUri}> .`);
        }

        const LIMIT = 500;
        // NOTE: the type-label join is required rather than OPTIONAL because Virtuoso
        // mis-evaluates OPTIONAL { ?node rdf:type ?t . ?t rdfs:label ?l } against the
        // configured FROM set (returns ~2 rows instead of all). In practice every node
        // under a Lehrplan has a labelled LP_-prefixed type, so the required join is safe.
        const query = `
PREFIX lp: <https://w3id.org/lehrplan/ontology/>
PREFIX obo: <http://purl.obolibrary.org/obo/>
SELECT DISTINCT ?lpLabel ?typeLabel ?nodeLabel ?node
${fromClauses(graphs)}
WHERE {
  ?lpsubclass rdfs:subClassOf* lp:LP_0000438 .
  ?lp rdf:type ?lpsubclass .
  ?lp rdfs:label ?lpLabel .
  ${filters.join("\n  ")}
  ?lp obo:BFO_0000051+ ?node .
  ?node rdfs:label ?nodeLabel .
  ?node rdf:type ?type .
  ?type rdfs:label ?typeLabel .
  FILTER(STRSTARTS(STR(?type), "https://w3id.org/lehrplan/ontology/"))
  FILTER(lang(?nodeLabel) = "" || lang(?nodeLabel) = "de")
  FILTER(lang(?lpLabel) = "" || lang(?lpLabel) = "de")
  FILTER(lang(?typeLabel) = "" || lang(?typeLabel) = "de")
}
ORDER BY ?lpLabel ?typeLabel ?node
LIMIT ${LIMIT}`;

        const results = await querySparql(query);
        if (results.results.bindings.length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  "No Kompetenzen found. Verify the filter set with find_lehrplaene first — if find_lehrplaene returns a Lehrplan but get_kompetenzen is empty, the curriculum likely has no structured child nodes in the triple store yet.",
              },
            ],
          };
        }
        let text = formatResults(results);
        if (results.results.bindings.length === LIMIT) {
          text += `\n\n(Results limited to ${LIMIT}. Narrow the filters — e.g. add a Jahrgangsstufe — to see the rest.)`;
        }
        return { content: [{ type: "text", text }] };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  return server;
}

// --- Start ---

async function main() {
  if (process.argv.includes("--http")) {
    const { startHttpServer } = await import("./http.js");
    startHttpServer(createServer);
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MEM Ontology MCP Server running on stdio");
    console.error(`SPARQL endpoint: ${SPARQL_ENDPOINT}`);
    console.error(`Infrastructure graphs: ${INFRA_GRAPHS.join(", ")}`);
    console.error(
      `State graphs: ${Object.entries(STATE_GRAPHS).map(([c, g]) => `${c}=${g}`).join(", ") || "(none)"}`
    );
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
