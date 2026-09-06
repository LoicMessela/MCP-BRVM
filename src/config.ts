import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DataMode, OhlcvPeriod } from "./types.js";

export const SERVER_NAME = "mcp-brvm";
export const SERVER_VERSION = "0.1.0";

export const BRVM_ORIGIN = "https://www.brvm.org";
export const BRVM_QUOTES_PATH = "/fr/cours-actions/0";
export const BRVM_ISSUERS_PATH = "/fr/emetteurs/societes-cotees";

export const OHLCV_BASE =
  "https://raw.githubusercontent.com/Fredysessie/brvm-data-public/main/data";

export const USER_AGENT = "MCP-BRVM/0.1 (+https://github.com/LoicMessela/MCP-BRVM; research-only)";

export const OHLCV_PERIODS = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const satisfies readonly OhlcvPeriod[];

export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "fixtures"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate package root (package.json + fixtures/)");
}

export function fixturePath(...parts: string[]): string {
  return join(packageRoot(), "fixtures", ...parts);
}

export function dataMode(): DataMode {
  const raw = (process.env.BRVM_DATA_MODE ?? "fixture").trim().toLowerCase();
  if (raw === "live" || raw === "fixture") return raw;
  throw new Error(`BRVM_DATA_MODE must be "fixture" or "live", got ${JSON.stringify(raw)}`);
}

export type TransportKind = "stdio" | "http";

export function transportFromArgv(argv: string[]): TransportKind {
  if (argv.includes("--http") || process.env.MCP_TRANSPORT === "http") return "http";
  return "stdio";
}

export function httpBind(): { host: string; port: number; allowedHosts: string[] } {
  const host = process.env.MCP_HTTP_HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.MCP_HTTP_PORT ?? "8787", 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid MCP_HTTP_PORT: ${process.env.MCP_HTTP_PORT}`);
  }
  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowedHosts.length === 0) {
    allowedHosts.push("127.0.0.1", "localhost");
  }
  return { host, port, allowedHosts };
}

export function authToken(): string | undefined {
  const token = process.env.MCP_AUTH_TOKEN?.trim();
  return token && token.length > 0 ? token : undefined;
}
