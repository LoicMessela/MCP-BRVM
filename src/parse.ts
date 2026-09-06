import * as cheerio from "cheerio";

import type { EquityQuote, IssuerCard, OhlcvBar } from "./types.js";

const ACCENTS = /[\u0300-\u036f]/g;

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(ACCENTS, "")
    .replace(/&#039;|&apos;|&amp;|&nbsp;/gi, " ")
    .replace(/['’`]/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

export function parseFrNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw
    .replace(/\u00a0/g, " ")
    .replace(/%/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .trim();
  if (!cleaned || cleaned === "-" || cleaned === "—") return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function cellText($: cheerio.CheerioAPI, cell: unknown): string {
  return $(cell as never).text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function headerKey(label: string): string {
  return normalizeText(label)
    .replace("FCFA", "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeQuoteHeader(headers: string[]): boolean {
  const joined = headers.join(" ");
  return joined.includes("SYMBOLE") && (joined.includes("NOM") || joined.includes("VOLUME"));
}

export function parseAsOf(html: string): string | null {
  const match = html.match(/Derni[eè]re mise [aà] jour\s*:\s*([^<\n]+)/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}

export function parseQuoteTable(html: string): EquityQuote[] {
  const $ = cheerio.load(html);
  let quotes: EquityQuote[] = [];

  $("table").each((_, table) => {
    const headers = $(table)
      .find("thead th, thead td, tr:first-child th")
      .toArray()
      .map((node) => headerKey(cellText($, node)))
      .filter(Boolean);
    if (!looksLikeQuoteHeader(headers)) return;

    const tickerIdx = headers.findIndex((h) => h === "SYMBOLE" || h === "SYMBOL");
    const nameIdx = headers.findIndex((h) => h === "NOM" || h === "NAME" || h === "COMPANY NAME");
    const volumeIdx = headers.findIndex((h) => h.includes("VOLUME"));
    const prevIdx = headers.findIndex((h) => h.includes("VEILLE") || h.includes("PREVIOUS"));
    const openIdx = headers.findIndex((h) => h.includes("OUVERTURE") || h === "OPEN" || h.includes("OPENING"));
    const lastIdx = headers.findIndex(
      (h) => h.includes("CLOTURE") || h.includes("CLOSING") || h === "LAST" || h.includes("COURS") && h.includes("CLOTURE"),
    );
    const changeIdx = headers.findIndex((h) => h.includes("VARIATION") || h.includes("CHANGE"));

    const rows: EquityQuote[] = [];
    $(table)
      .find("tbody tr, tr")
      .each((__, row) => {
        const cells = $(row).find("td").toArray();
        if (cells.length < 2) return;
        const ticker = cellText($, cells[tickerIdx >= 0 ? tickerIdx : 0]!).toUpperCase();
        if (!/^[A-Z]{3,6}$/.test(ticker)) return;
        const name = cellText($, cells[nameIdx >= 0 ? nameIdx : 1]!);
        rows.push({
          ticker,
          name,
          volume: volumeIdx >= 0 ? parseFrNumber(cellText($, cells[volumeIdx]!)) : null,
          previousClose: prevIdx >= 0 ? parseFrNumber(cellText($, cells[prevIdx]!)) : null,
          open: openIdx >= 0 ? parseFrNumber(cellText($, cells[openIdx]!)) : null,
          last: lastIdx >= 0 ? parseFrNumber(cellText($, cells[lastIdx]!)) : null,
          changePercent: changeIdx >= 0 ? parseFrNumber(cellText($, cells[changeIdx]!)) : null,
          currency: "XOF",
        });
      });

    if (rows.length > quotes.length) quotes = rows;
  });

  return quotes;
}

export function parseIssuerCards(html: string): IssuerCard[] {
  const $ = cheerio.load(html);
  const cards: IssuerCard[] = [];

  $(".views-row").each((_, row) => {
    const name = $(row).find(".title").first().text().replace(/\s+/g, " ").trim();
    const href =
      $(row).find('a[href*="/emetteurs/societes-cotees/"]').first().attr("href") ??
      $(row).find("a[href]").first().attr("href") ??
      "";
    if (!name || !href) return;
    const email = $(row).find(".email_sgi a").attr("href")?.replace(/^mailto:/i, "") ?? null;
    cards.push({
      name,
      href,
      country: inferCountry(`${name} ${$(row).find(".bp").text()}`),
      address: [$(row).find(".adresse_sgi").text(), $(row).find(".bp").text()]
        .map((part) => part.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" — ") || null,
      phone: $(row).find(".tel_sgi").text().replace(/\s+/g, " ").trim() || null,
      email,
    });
  });

  return cards;
}

export function parseIssuerPager(html: string): string[] {
  const $ = cheerio.load(html);
  const hrefs = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (/[?&]page=\d+/.test(href) || /pager/.test($(el).parent().attr("class") ?? "")) {
      hrefs.add(href);
    }
  });
  return [...hrefs];
}

export function isIssuerDetailPage(html: string): boolean {
  if (/node-societe-cote/.test(html)) return true;
  if (/field-name-field-descriptif-s-cote/.test(html)) return true;
  if (/PROFIL DE L[’']ENTREPRISE/i.test(html) && /Symbole/i.test(html)) return true;
  const $ = cheerio.load(html);
  const title = $("title").text();
  if (/^Toutes\b/i.test(title.trim())) return false;
  return $("h1.page-header").length > 0 && $(".views-row").length === 0;
}

function labeledField(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}\\s*(?:\\([^)]*\\))?\\s*[:：]\\s*(.+)`, "i"));
    const value = match?.[1]?.split("\n")[0]?.replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return null;
}

export function parseIssuerProfile(html: string): {
  name: string | null;
  legalName: string | null;
  sector: string | null;
  listingDate: string | null;
  shareCapital: string | null;
  symbole: string | null;
  website: string | null;
  chairman: string | null;
  ceo: string | null;
} {
  const $ = cheerio.load(html);
  const name = $("h1.page-header, h1").first().text().replace(/\s+/g, " ").trim() || null;
  const website =
    $(".field-name-field-site-acteur a").attr("href") ??
    $(".field-name-field-site-acteur").text().replace(/Site:\s*/i, "").trim() ??
    null;
  const blob = [
    $(".field-name-field-descriptif-s-cote").text(),
    $("article").text(),
    $.root().text(),
  ]
    .join("\n")
    .replace(/\u00a0/g, " ");

  const listingRaw = labeledField(blob, [
    "Date d’introduction à la BRVM",
    "Date d'introduction à la BRVM",
    "Date d’introduction a la BRVM",
  ]);

  return {
    name,
    legalName: labeledField(blob, ["Raison sociale"]),
    sector: labeledField(blob, ["Secteur d’activités", "Secteur d'activités", "Secteur d’activites"]),
    listingDate: toIsoDate(listingRaw),
    shareCapital: labeledField(blob, ["Capital social"]),
    symbole: labeledField(blob, ["Symbole"])?.replace(/\s+/g, "").toUpperCase() ?? null,
    website: website && website !== "Site:" ? website : null,
    chairman: labeledField(blob, [
      "Président du conseil d’administration",
      "President du conseil d’administration",
      "Président du conseil d'administration",
    ]),
    ceo: labeledField(blob, ["Directeur Général (ou équivalent)", "Directeur General (ou equivalent)"]),
  };
}

export function toIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const dmy = raw.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    return `${yyyy}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`;
  }
  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/);
  return iso?.[1] ?? null;
}

export function inferCountry(text: string): string | null {
  const n = normalizeText(text);
  if (n.includes("COTE D IVOIRE") || n.includes("IVOIRE") || /\bCI\b/.test(n)) return "Côte d'Ivoire";
  if (n.includes("SENEGAL")) return "Sénégal";
  if (n.includes("BENIN")) return "Bénin";
  if (n.includes("BURKINA")) return "Burkina Faso";
  if (n.includes("MALI")) return "Mali";
  if (n.includes("NIGER") && !n.includes("NIGERIA")) return "Niger";
  if (n.includes("TOGO")) return "Togo";
  if (n.includes("GUINEE BISSAU") || n.includes("BISSAU")) return "Guinée-Bissau";
  return null;
}

export function parseOhlcvCsv(csv: string): OhlcvBar[] {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const dateIdx = header.findIndex((h) => h === "date");
  const openIdx = header.findIndex((h) => h === "open");
  const highIdx = header.findIndex((h) => h === "high");
  const lowIdx = header.findIndex((h) => h === "low");
  const closeIdx = header.findIndex((h) => h === "close");
  const volumeIdx = header.findIndex((h) => h === "volume");
  if (dateIdx < 0 || closeIdx < 0) {
    throw new Error("OHLCV CSV is missing Date/Close columns");
  }

  const bars: OhlcvBar[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const date = cols[dateIdx]?.trim();
    const close = Number.parseFloat(cols[closeIdx] ?? "");
    if (!date || !Number.isFinite(close)) continue;
    bars.push({
      date,
      open: Number.parseFloat(cols[openIdx] ?? "") || close,
      high: Number.parseFloat(cols[highIdx] ?? "") || close,
      low: Number.parseFloat(cols[lowIdx] ?? "") || close,
      close,
      volume: Number.parseFloat(cols[volumeIdx] ?? "") || 0,
    });
  }
  return bars;
}

const GENERIC_NAME_TOKENS = new Set([
  "AFRICA",
  "BANK",
  "BENIN",
  "BISSAU",
  "BURKINA",
  "COTE",
  "DIVOIRE",
  "FASO",
  "GUINEE",
  "INTERNATIONAL",
  "IVOIRE",
  "MALI",
  "NIGER",
  "SENEGAL",
  "SOCIETE",
  "TOGO",
]);

export function scoreIssuerMatch(ticker: string, quoteName: string, card: IssuerCard): number {
  const t = normalizeText(ticker);
  const title = normalizeText(card.name);
  const slug = normalizeText(card.href.replace(/[-/]/g, " "));
  const qn = normalizeText(quoteName);
  let score = 0;
  if (title.split(" ").includes(t) || slug.split(" ").includes(t)) score += 120;
  const quoteTokens = qn.split(" ").filter((tok) => tok.length >= 4 && !GENERIC_NAME_TOKENS.has(tok));
  const titleTokens = new Set(title.split(" ").filter((tok) => !GENERIC_NAME_TOKENS.has(tok)));
  const overlap = quoteTokens.filter((tok) => titleTokens.has(tok)).length;
  score += overlap * 40;
  if (quoteTokens.some((tok) => title.includes(tok) || slug.includes(tok))) score += 30;
  if (qn && title.includes(qn)) score += 60;
  return score;
}

export function slugCandidates(name: string): string[] {
  const base = name
    .normalize("NFD")
    .replace(ACCENTS, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const compact = base.replace(/^(societe-nationale-de-telecommunication-du-senegal-)/, "sonatel-");
  return [...new Set([base, compact, base.replace(/-cote-d-ivoire$/, "-ci")])].filter((s) => s.length >= 3);
}
