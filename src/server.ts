import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getIssuer, getQuote, listEquities } from "./adapters/brvm-html.js";
import { getOhlcv } from "./adapters/ohlcv.js";
import { dataMode, OHLCV_PERIODS, SERVER_NAME, SERVER_VERSION } from "./config.js";
import { TOOL_NAMES, type HealthResult } from "./types.js";

const tickerSchema = z
  .string()
  .min(3)
  .max(8)
  .describe("BRVM ticker, e.g. SNTS, ORAC, ECOC");

function jsonResult<T extends Record<string, unknown>>(data: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

async function healthPayload(): Promise<HealthResult> {
  const mode = dataMode();
  const adapters = [];
  try {
    const list = await listEquities();
    adapters.push({
      id: "brvm-html",
      ok: list.count > 0,
      mode,
      detail: `${list.count} equities from ${list.source}`,
    });
  } catch (error) {
    adapters.push({
      id: "brvm-html",
      ok: false,
      mode,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    const hist = await getOhlcv({ ticker: "SNTS", period: "daily", limit: 5 });
    adapters.push({
      id: "fredysessie-ohlcv",
      ok: hist.count > 0,
      mode,
      detail: `${hist.count} SNTS ${hist.period} bars from ${hist.source}`,
    });
  } catch (error) {
    adapters.push({
      id: "fredysessie-ohlcv",
      ok: false,
      mode,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    ok: adapters.every((adapter) => adapter.ok),
    name: SERVER_NAME,
    version: SERVER_VERSION,
    researchOnly: true,
    trading: false,
    mode,
    tools: [...TOOL_NAMES],
    adapters,
  };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Research-only BRVM market data. Use list_equities, get_quote, get_ohlcv, get_issuer, and health. Do not place orders, size positions, or give portfolio advice.",
    },
  );

  server.registerTool(
    "list_equities",
    {
      description:
        "List BRVM-listed equities from the official brvm.org quotes table (research-only). Optional query filters by ticker or name.",
      inputSchema: z.object({
        query: z.string().min(1).max(80).optional().describe("Optional ticker or name substring"),
      }),
      outputSchema: z.object({
        asOf: z.string().nullable(),
        count: z.number(),
        currency: z.literal("XOF"),
        source: z.string(),
        sourceUrl: z.string(),
        mode: z.enum(["fixture", "live"]),
        equities: z.array(z.object({}).passthrough()),
      }),
    },
    async ({ query }) => {
      try {
        return jsonResult((await listEquities(query)) as unknown as Record<string, unknown>);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "get_quote",
    {
      description:
        "Get the latest official-session quote for one BRVM ticker from brvm.org HTML. Research/alerts only — not an executable price feed.",
      inputSchema: z.object({ ticker: tickerSchema }),
      outputSchema: z.object({
        ticker: z.string(),
        name: z.string(),
        last: z.number().nullable(),
        currency: z.literal("XOF"),
        mode: z.enum(["fixture", "live"]),
      }).passthrough(),
    },
    async ({ ticker }) => {
      try {
        return jsonResult((await getQuote(ticker)) as unknown as Record<string, unknown>);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "get_ohlcv",
    {
      description:
        "Get historical OHLCV bars for a BRVM ticker from the Fredysessie/brvm-data-public GitHub CSV archive. Research-only; not a broker feed.",
      inputSchema: z.object({
        ticker: tickerSchema,
        period: z.enum(OHLCV_PERIODS).optional().describe("Aggregation period (default daily)"),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive start date YYYY-MM-DD"),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive end date YYYY-MM-DD"),
        limit: z.number().int().min(1).max(500).optional().describe("Max bars to return from the end of the range (default 60)"),
      }),
      outputSchema: z.object({
        ticker: z.string(),
        period: z.string(),
        count: z.number(),
        bars: z.array(z.object({}).passthrough()),
      }).passthrough(),
    },
    async (args) => {
      try {
        return jsonResult((await getOhlcv(args)) as unknown as Record<string, unknown>);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "get_issuer",
    {
      description:
        "Get the brvm.org issuer profile for a listed equity (legal name, sector, listing date, contacts when present). Research-only.",
      inputSchema: z.object({ ticker: tickerSchema }),
      outputSchema: z.object({
        ticker: z.string(),
        name: z.string(),
        sector: z.string().nullable(),
        mode: z.enum(["fixture", "live"]),
      }).passthrough(),
    },
    async ({ ticker }) => {
      try {
        return jsonResult((await getIssuer(ticker)) as unknown as Record<string, unknown>);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "health",
    {
      description:
        "Liveness and adapter status. Confirms research-only mode and that quote/OHLCV adapters return data (fixtures or live).",
      inputSchema: z.object({}),
      outputSchema: z.object({
        ok: z.boolean(),
        name: z.string(),
        version: z.string(),
        researchOnly: z.literal(true),
        trading: z.literal(false),
        mode: z.enum(["fixture", "live"]),
        tools: z.array(z.string()),
        adapters: z.array(z.object({}).passthrough()),
      }),
    },
    async () => {
      try {
        return jsonResult((await healthPayload()) as unknown as Record<string, unknown>);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );

  return server;
}
