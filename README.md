# MCP-BRVM

Get the latest research data from the BRVM stock market (Bourse Régionale des Valeurs Mobilières — the UEMOA regional exchange).

This repository is a **research-only** [Model Context Protocol](https://modelcontextprotocol.io) server. Grok Bot can install it with **AddMcpServer**; agents such as *The Wolf of BRVM* can call quotes, issuer profiles, and history tools. **There is no trade execution, order routing, or portfolio-advice feature.**

## Scope

| In scope | Out of scope |
| --- | --- |
| Equity list and session quotes from [brvm.org](https://www.brvm.org/fr/cours-actions/0) HTML | Order entry, broker APIs, paper trading |
| Issuer / listed-company profile from brvm.org HTML | Portfolio construction or “buy/sell” recommendations |
| Daily (and other) OHLCV from the [Fredysessie/brvm-data-public](https://github.com/Fredysessie/brvm-data-public) GitHub CSV archive | Real-time FIX / paid vendor feeds |
| `health` for adapter liveness | Account, cash, or position tools |

Contract notes (not invented features):

- Official session quotes are **EOD / last published table**, not a guaranteed last-tick stream. The site often shows “Séance fermée” outside the Abidjan session.
- Prices are **XOF (FCFA)**.
- `get_issuer` follows `/fr/emetteurs/societes-cotees` listing cards, then the issuer node. BRVM’s Drupal pager is incomplete at times; live mode may return quote-derived fields plus a `notes[]` explanation when the profile page cannot be resolved.
- Fixture mode ships a representative snapshot (`SNTS` and a short equity tape) so tools stay callable when live HTML flakes.

## Terms of use / reproduction risk

**Research and personal alerting only.** This server is not affiliated with BRVM SA, the AMF-UMOA, or Fredysessie.

Scraping [www.brvm.org](https://www.brvm.org) HTML is a **medium–high Terms of Service / reproduction risk**. The site publishes market data for human browsing; it does not offer a public machine API. Automated HTML collection can conflict with the site’s terms, robots policy, or copyright in the page markup. Use a polite `User-Agent`, prefer fixture mode for CI and development, cache live pages (this server uses a 5-minute in-memory TTL), and do not republish BRVM pages wholesale.

The OHLCV adapter reads CSVs already published on GitHub (`raw.githubusercontent.com/Fredysessie/brvm-data-public`). That archive is a third-party reproduction of BRVM history — treat it as unofficial and verify before any research conclusion.

**Do not use this server to place, size, or justify trades.** Outputs are observational market data for research agents.

## Tools

| Tool | Adapter | Result |
| --- | --- | --- |
| `list_equities` | brvm.org `/fr/cours-actions/0` | Listed tickers, names, volume, previous / open / last, change % |
| `get_quote` | same HTML table | One ticker’s session quote |
| `get_ohlcv` | Fredysessie CSV `{TICKER}/{TICKER}.{period}.csv` | OHLCV bars (`daily` default; `weekly` / `monthly` / `quarterly` / `yearly`) |
| `get_issuer` | brvm.org issuer listing + profile HTML | Legal name, sector, listing date, contacts when present |
| `health` | both adapters | Liveness, `researchOnly: true`, `trading: false` |

## Requirements

- Node.js 20+
- npm (or a compatible client)

## Install and build

```bash
git clone https://github.com/LoicMessela/MCP-BRVM.git
cd MCP-BRVM
npm install
npm run build
```

`npm run build` compiles `src/` to `dist/`. Fixtures stay in `fixtures/` and are read from the package root at runtime.

## Run

Default **fixture** mode (no live scrape). Stdio is the local MCP transport:

```bash
BRVM_DATA_MODE=fixture node dist/index.js
```

HTTP (Streamable HTTP at `/mcp`) for hosts that only accept a URL — including **Grok Bot AddMcpServer**:

```bash
BRVM_DATA_MODE=fixture node dist/index.js --http
# equivalent: MCP_TRANSPORT=http node dist/index.js
```

By default HTTP binds `127.0.0.1:8787`. Override with `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, and `MCP_ALLOWED_HOSTS` (comma-separated) when binding beyond localhost. Optional `MCP_AUTH_TOKEN` requires `Authorization: Bearer <token>` on `/mcp`.

`GET /healthz` is a process liveness URL (not an MCP tool).

### Live vs fixture

| `BRVM_DATA_MODE` | Behavior |
| --- | --- |
| `fixture` (default) | Parse checked-in HTML/CSV under `fixtures/`. Deterministic; used by `npm run smoke`. Issuer/OHLCV fixtures cover **SNTS**. |
| `live` | Fetch brvm.org HTML and Fredysessie CSVs. Subject to site changes, pagination gaps, and ToS risk. |

```bash
BRVM_DATA_MODE=live node dist/index.js --http
```

## Grok Bot — AddMcpServer

Grok Bot’s AddMcpServer form takes a **name**, a **public HTTPS URL**, and optional **headers**. It does **not** spawn a local stdio process. Host this server (or a tunnel to `--http`) so `/mcp` is reachable, then:

```
Name:     mcp-brvm
URL:      https://<your-host>/mcp
Headers:  Authorization: Bearer <MCP_AUTH_TOKEN>   # only if you set MCP_AUTH_TOKEN
```

Attach the connector to *The Wolf of BRVM* (or any research/alerts agent). Ask for quotes and history only — this package will not grow trading tools.

Local / terminal Grok (`grok mcp add`) can use stdio instead:

```bash
grok mcp add mcp-brvm -- node /absolute/path/to/MCP-BRVM/dist/index.js
```

Or HTTP:

```bash
grok mcp add --transport http mcp-brvm https://<your-host>/mcp
```

### Cursor / other stdio hosts

```json
{
  "mcpServers": {
    "mcp-brvm": {
      "command": "node",
      "args": ["/absolute/path/to/MCP-BRVM/dist/index.js"],
      "env": { "BRVM_DATA_MODE": "fixture" }
    }
  }
}
```

## Smoke (proof)

After `npm install` and `npm run build`:

```bash
npm run smoke
```

This drives the official MCP client against `createMcpHandler` **in process** (no socket), with `BRVM_DATA_MODE=fixture`. It asserts that all five tools are registered and return structured results from the adapters.

Inspector (optional):

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Layout

```
src/index.ts            stdio + HTTP entry
src/server.ts           createServer() + five tools
src/adapters/           brvm.org HTML, Fredysessie OHLCV
src/parse.ts            table / profile / CSV parsers
fixtures/               offline HTML + SNTS OHLCV
```

## License

MIT (server code). Upstream market data remains the publishers’.
