import assert from "node:assert/strict";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { createServer } from "./server.js";
import { TOOL_NAMES } from "./types.js";

process.env.BRVM_DATA_MODE ??= "fixture";

function asObject(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object", "expected structured object");
  return value as Record<string, unknown>;
}

async function main(): Promise<void> {
  const handler = createMcpHandler(createServer);
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  const client = new Client({ name: "mcp-brvm-smoke", version: "0.1.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);

  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [...TOOL_NAMES].sort(), `registered tools: ${names.join(", ")}`);

  const health = asObject((await client.callTool({ name: "health", arguments: {} })).structuredContent);
  assert.equal(health.ok, true);
  assert.equal(health.researchOnly, true);
  assert.equal(health.trading, false);
  assert.deepEqual(health.tools, [...TOOL_NAMES]);

  const equities = asObject((await client.callTool({ name: "list_equities", arguments: {} })).structuredContent);
  assert.ok((equities.count as number) >= 8, "list_equities should return fixture rows");
  const rows = equities.equities as Array<Record<string, unknown>>;
  assert.ok(rows.some((row) => row.ticker === "SNTS"));

  const filtered = asObject(
    (await client.callTool({ name: "list_equities", arguments: { query: "SONATEL" } })).structuredContent,
  );
  assert.equal(filtered.count, 1);

  const quote = asObject((await client.callTool({ name: "get_quote", arguments: { ticker: "SNTS" } })).structuredContent);
  assert.equal(quote.ticker, "SNTS");
  assert.equal(quote.currency, "XOF");
  assert.equal(quote.last, 38500);

  const ohlcv = asObject(
    (await client.callTool({ name: "get_ohlcv", arguments: { ticker: "SNTS", period: "daily", limit: 5 } }))
      .structuredContent,
  );
  assert.equal(ohlcv.ticker, "SNTS");
  assert.ok((ohlcv.count as number) === 5);
  const bars = ohlcv.bars as Array<Record<string, unknown>>;
  assert.equal(bars[bars.length - 1]?.close, 38500);

  const issuer = asObject((await client.callTool({ name: "get_issuer", arguments: { ticker: "SNTS" } })).structuredContent);
  assert.equal(issuer.ticker, "SNTS");
  assert.match(String(issuer.sector), /TELECOMMUNICATION/i);
  assert.equal(issuer.legalName, "SONATEL SENEGAL");

  await client.close();
  await handler.close();
  console.error("mcp-brvm smoke: all five tools registered and returned structured fixture results");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
