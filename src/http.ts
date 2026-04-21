import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response, NextFunction } from "express";

export function startHttpServer(
  createServer: () => McpServer
): void {
  const port = parseInt(process.env.PORT || "3000", 10);
  const apiKey = process.env.API_KEY;

  const app = express();
  app.use(express.json());
  app.use(cors({ origin: "*", exposedHeaders: ["Mcp-Session-Id"] }));

  // Bearer token auth middleware (only if API_KEY is set)
  if (apiKey) {
    app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== apiKey) {
        res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Unauthorized" },
          id: null,
        });
        return;
      }
      next();
    });
  }

  // Session management
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // POST /mcp — initialize or route to existing session
  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            console.log(`Session initialized: ${sid}`);
            transports.set(sid, transport);
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports.has(sid)) {
            console.log(`Transport closed for session ${sid}`);
            transports.delete(sid);
          }
        };

        const server = createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // GET /mcp — SSE stream for existing session
  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // DELETE /mcp — session termination
  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  app.listen(port, () => {
    console.log(`MEM Ontology MCP Server (HTTP) listening on port ${port}`);
    if (apiKey) {
      console.log("Bearer token authentication enabled");
    } else {
      console.log("No API_KEY set — authentication disabled");
    }
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    for (const [sid, transport] of transports) {
      try {
        await transport.close();
        transports.delete(sid);
      } catch (error) {
        console.error(`Error closing session ${sid}:`, error);
      }
    }
    process.exit(0);
  });
}
