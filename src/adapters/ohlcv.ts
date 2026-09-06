import { readFile } from "node:fs/promises";

import { dataMode, fixturePath, OHLCV_BASE, OHLCV_PERIODS } from "../config.js";
import { parseOhlcvCsv } from "../parse.js";
import type { OhlcvPeriod, OhlcvResult } from "../types.js";
import { fetchText } from "./fetch.js";

export function assertPeriod(period: string): OhlcvPeriod {
  if ((OHLCV_PERIODS as readonly string[]).includes(period)) return period as OhlcvPeriod;
  throw new Error(`Unsupported OHLCV period ${period}. Use one of: ${OHLCV_PERIODS.join(", ")}`);
}

export async function getOhlcv(input: {
  ticker: string;
  period?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<OhlcvResult> {
  const ticker = input.ticker.trim().toUpperCase();
  const period = assertPeriod(input.period ?? "daily");
  const mode = dataMode();
  const sourceUrl = `${OHLCV_BASE}/${ticker}/${ticker}.${period}.csv`;

  let csv: string;
  if (mode === "fixture") {
    if (ticker !== "SNTS" || period !== "daily") {
      throw new Error(
        `Fixture mode ships OHLCV only for SNTS daily. Use BRVM_DATA_MODE=live for ${ticker} ${period}.`,
      );
    }
    csv = await readFile(fixturePath("ohlcv", "SNTS.daily.csv"), "utf8");
  } else {
    csv = await fetchText(sourceUrl, { accept: "text/csv,*/*" });
  }

  let bars = parseOhlcvCsv(csv);
  if (input.from) bars = bars.filter((bar) => bar.date >= input.from!);
  if (input.to) bars = bars.filter((bar) => bar.date <= input.to!);
  const limit = input.limit ?? 60;
  if (limit < 1) throw new Error("limit must be >= 1");
  bars = bars.slice(-Math.min(limit, 500));

  return {
    ticker,
    period,
    currency: "XOF",
    count: bars.length,
    from: bars[0]?.date ?? null,
    to: bars[bars.length - 1]?.date ?? null,
    source: "Fredysessie/brvm-data-public CSV",
    sourceUrl,
    mode,
    bars,
  };
}
