import { readFile } from "node:fs/promises";

import {
  BRVM_ISSUERS_PATH,
  BRVM_ORIGIN,
  BRVM_QUOTES_PATH,
  dataMode,
  fixturePath,
} from "../config.js";
import {
  inferCountry,
  isIssuerDetailPage,
  parseAsOf,
  parseIssuerCards,
  parseIssuerPager,
  parseIssuerProfile,
  parseQuoteTable,
  scoreIssuerMatch,
  slugCandidates,
} from "../parse.js";
import type { EquityListResult, EquityQuote, IssuerCard, IssuerResult, QuoteResult } from "../types.js";
import { fetchText } from "./fetch.js";

const cache = new Map<string, { expires: number; body: string }>();
const LIVE_TTL_MS = 5 * 60 * 1000;

function absoluteUrl(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return new URL(href, BRVM_ORIGIN).toString();
}

async function loadHtml(kind: "quotes" | "issuers" | "issuer", url: string, ticker?: string): Promise<string> {
  const mode = dataMode();
  if (mode === "fixture") {
    if (kind === "quotes") return readFile(fixturePath("cours-actions.html"), "utf8");
    if (kind === "issuers") return readFile(fixturePath("societes-cotees.html"), "utf8");
    const known = ticker?.toUpperCase() === "SNTS" ? fixturePath("issuer-snts.html") : fixturePath("issuer-snts.html");
    if (ticker && ticker.toUpperCase() !== "SNTS") {
      throw new Error(
        `Fixture mode only ships a full issuer profile for SNTS. Use BRVM_DATA_MODE=live for ${ticker.toUpperCase()}.`,
      );
    }
    return readFile(known, "utf8");
  }

  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.body;
  const body = await fetchText(url);
  cache.set(url, { expires: Date.now() + LIVE_TTL_MS, body });
  return body;
}

export async function listEquities(query?: string): Promise<EquityListResult> {
  const mode = dataMode();
  const sourceUrl = `${BRVM_ORIGIN}${BRVM_QUOTES_PATH}`;
  const html = await loadHtml("quotes", sourceUrl);
  const equities = parseQuoteTable(html);
  if (equities.length === 0) {
    throw new Error(`No equity rows parsed from ${mode} BRVM quotes HTML`);
  }
  const needle = query?.trim().toUpperCase();
  const filtered = needle
    ? equities.filter(
        (row) => row.ticker.includes(needle) || row.name.toUpperCase().includes(needle),
      )
    : equities;
  return {
    asOf: parseAsOf(html),
    count: filtered.length,
    currency: "XOF",
    source: "brvm.org HTML /fr/cours-actions/0",
    sourceUrl,
    mode,
    equities: filtered,
  };
}

export async function getQuote(ticker: string): Promise<QuoteResult> {
  const list = await listEquities();
  const row = findEquity(list.equities, ticker);
  if (!row) {
    throw new Error(`Unknown BRVM ticker ${ticker.toUpperCase()}. Call list_equities to see listed symbols.`);
  }
  return {
    ...row,
    asOf: list.asOf,
    source: list.source,
    sourceUrl: list.sourceUrl,
    mode: list.mode,
  };
}

function findEquity(equities: EquityQuote[], ticker: string): EquityQuote | undefined {
  const t = ticker.trim().toUpperCase();
  return equities.find((row) => row.ticker === t);
}

export async function getIssuer(ticker: string): Promise<IssuerResult> {
  const mode = dataMode();
  const quote = await getQuote(ticker);
  const notes: string[] = [];

  if (mode === "fixture") {
    const html = await loadHtml("issuer", `${BRVM_ORIGIN}${BRVM_ISSUERS_PATH}/snts`, quote.ticker);
    const listing = parseIssuerCards(await loadHtml("issuers", `${BRVM_ORIGIN}${BRVM_ISSUERS_PATH}`));
    const card = pickIssuerCard(quote.ticker, quote.name, listing);
    return mergeIssuer(quote, parseIssuerProfile(html), card, {
      source: "fixture HTML (issuer-snts.html + societes-cotees.html)",
      sourceUrl: `${BRVM_ORIGIN}${BRVM_ISSUERS_PATH}/societe-nationale-de-telecommunication-du-senegal-sonatel`,
      mode,
      notes,
    });
  }

  const cards = await loadIssuerDirectory();
  const ranked = [...cards]
    .map((card) => ({ card, score: scoreIssuerMatch(quote.ticker, quote.name, card) }))
    .sort((a, b) => b.score - a.score);

  const tried = new Set<string>();
  for (const { card, score } of ranked) {
    if (score < 25) continue;
    const url = absoluteUrl(card.href);
    if (tried.has(url)) continue;
    tried.add(url);
    const html = await loadHtml("issuer", url, quote.ticker);
    if (!isIssuerDetailPage(html)) {
      notes.push(`Listing href ${url} did not look like an issuer profile`);
      continue;
    }
    const profile = parseIssuerProfile(html);
    if (profile.symbole && profile.symbole !== quote.ticker) {
      notes.push(`Skipped ${url}: profile symbole ${profile.symbole} != ${quote.ticker}`);
      continue;
    }
    return mergeIssuer(quote, profile, card, {
      source: "brvm.org HTML /fr/emetteurs/societes-cotees",
      sourceUrl: url,
      mode,
      notes,
    });
  }

  for (const slug of slugCandidates(quote.name)) {
    const url = `${BRVM_ORIGIN}${BRVM_ISSUERS_PATH}/${slug}`;
    if (tried.has(url)) continue;
    tried.add(url);
    try {
      const html = await loadHtml("issuer", url, quote.ticker);
      if (!isIssuerDetailPage(html)) continue;
      const profile = parseIssuerProfile(html);
      if (profile.symbole && profile.symbole !== quote.ticker) continue;
      notes.push(`Resolved issuer via slug guess ${slug}`);
      return mergeIssuer(quote, profile, undefined, {
        source: "brvm.org HTML issuer slug guess",
        sourceUrl: url,
        mode,
        notes,
      });
    } catch {
      // slug miss is expected
    }
  }

  notes.push(
    "Full issuer profile page was not resolved from the listing (BRVM pagination is often incomplete). Returning quote-derived issuer fields only.",
  );
  return {
    ticker: quote.ticker,
    name: quote.name,
    legalName: null,
    sector: null,
    listingDate: null,
    shareCapital: null,
    website: null,
    country: inferCountry(quote.name),
    address: null,
    phone: null,
    email: null,
    chairman: null,
    ceo: null,
    source: "brvm.org HTML quotes + partial issuer listing",
    sourceUrl: `${BRVM_ORIGIN}${BRVM_ISSUERS_PATH}`,
    mode,
    notes,
  };
}

function pickIssuerCard(ticker: string, name: string, cards: IssuerCard[]): IssuerCard | undefined {
  return [...cards].sort((a, b) => scoreIssuerMatch(ticker, name, b) - scoreIssuerMatch(ticker, name, a))[0];
}

async function loadIssuerDirectory(): Promise<IssuerCard[]> {
  const seen = new Set<string>();
  const cards: IssuerCard[] = [];
  const queue = [`${BRVM_ORIGIN}${BRVM_ISSUERS_PATH}`];
  let pages = 0;

  while (queue.length > 0 && pages < 8) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    pages += 1;
    const html = await loadHtml("issuers", url);
    const pageCards = parseIssuerCards(html);
    const before = cards.length;
    for (const card of pageCards) {
      if (!cards.some((existing) => existing.href === card.href)) cards.push(card);
    }
    if (cards.length === before && pages > 1) break;
    for (const href of parseIssuerPager(html)) {
      const next = absoluteUrl(href);
      if (!seen.has(next)) queue.push(next);
    }
  }
  return cards;
}

function mergeIssuer(
  quote: QuoteResult,
  profile: ReturnType<typeof parseIssuerProfile>,
  card: IssuerCard | undefined,
  meta: { source: string; sourceUrl: string; mode: IssuerResult["mode"]; notes: string[] },
): IssuerResult {
  return {
    ticker: quote.ticker,
    name: profile.name ?? card?.name ?? quote.name,
    legalName: profile.legalName,
    sector: profile.sector,
    listingDate: profile.listingDate,
    shareCapital: profile.shareCapital,
    website: profile.website,
    country: card?.country ?? inferCountry(`${profile.name ?? ""} ${quote.name}`),
    address: card?.address ?? null,
    phone: card?.phone ?? null,
    email: card?.email ?? null,
    chairman: profile.chairman,
    ceo: profile.ceo,
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    mode: meta.mode,
    notes: meta.notes,
  };
}
