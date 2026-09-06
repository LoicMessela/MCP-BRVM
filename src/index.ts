#!/usr/bin/env node
import { createServer as createHttpServer } from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { authToken, httpBind, SERVER_NAME, SERVER_VERSION, transportFromArgv } from "./config.js";
import { createServer } from "./server.js";

const transport = transportFromArgv(process.argv.slice(2));

if (transport === "stdio") {
  void serveStdio(createServer);
  console.error(`${SERVER_NAME} ${SERVER_VERSION} listening on stdio (research-only BRVM market data)`);
} else {
  const { host, port, allowedHosts } = httpBind();
  const handler = createMcpHandler(createServer);
  const app = createMcpExpressApp({
    host,
    allowedHosts,
  });
  const node = toNodeHandler(handler);
  const token = authToken();

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      name: SERVER_NAME,
      version: SERVER_VERSION,
      researchOnly: true,
      mcp: "/mcp",
    });
  });

  app.all("/mcp", (req, res) => {
    if (token) {
      const header = req.get("authorization") ?? "";
      const expected = `Bearer ${token}`;
      if (header !== expected) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
    }
    void node(req, res, req.body);
  });

  const httpServer = createHttpServer(app);
  httpServer.listen(port, host, () => {
    console.error(
      `${SERVER_NAME} ${SERVER_VERSION} HTTP ${host}:${port}/mcp (research-only; Grok Bot AddMcpServer URL ends with /mcp)`,
    );
  });

  const shutdown = async () => {
    await handler.close();
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
