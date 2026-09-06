export type DataMode = "fixture" | "live";

export type OhlcvPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

export interface EquityQuote {
  ticker: string;
  name: string;
  volume: number | null;
  previousClose: number | null;
  open: number | null;
  last: number | null;
  changePercent: number | null;
  currency: "XOF";
}

export interface QuoteResult extends EquityQuote {
  asOf: string | null;
  source: string;
  sourceUrl: string;
  mode: DataMode;
}

export interface EquityListResult {
  asOf: string | null;
  count: number;
  currency: "XOF";
  source: string;
  sourceUrl: string;
  mode: DataMode;
  equities: EquityQuote[];
}

export interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OhlcvResult {
  ticker: string;
  period: OhlcvPeriod;
  currency: "XOF";
  count: number;
  from: string | null;
  to: string | null;
  source: string;
  sourceUrl: string;
  mode: DataMode;
  bars: OhlcvBar[];
}

export interface IssuerResult {
  ticker: string;
  name: string;
  legalName: string | null;
  sector: string | null;
  listingDate: string | null;
  shareCapital: string | null;
  website: string | null;
  country: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  chairman: string | null;
  ceo: string | null;
  source: string;
  sourceUrl: string;
  mode: DataMode;
  notes: string[];
}

export interface AdapterStatus {
  id: string;
  ok: boolean;
  mode: DataMode;
  detail: string;
}

export interface HealthResult {
  ok: boolean;
  name: string;
  version: string;
  researchOnly: true;
  trading: false;
  mode: DataMode;
  tools: string[];
  adapters: AdapterStatus[];
}

export interface IssuerCard {
  name: string;
  href: string;
  country: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export const TOOL_NAMES = [
  "list_equities",
  "get_quote",
  "get_ohlcv",
  "get_issuer",
  "health",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
