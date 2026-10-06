/**
 * The Research tools — read-only, through the existing services.
 *
 * Each tool reads one thing the product already reads for its own pages and
 * returns it as facts with citations, a typed card, and sentences for the
 * composer in both languages. Nothing here computes a balance, a size, a
 * settlement or a multiplier: amounts are the chain's decimal text, prices
 * are the venue's, sizes are the plan engine's, verdicts are the Review's.
 * An unavailable figure stays unavailable in words; nothing is summed across
 * states.
 */

import { z } from "zod";

import { BASE58, PLAN_ID, planAssetKind, type AgentCard, type AgentFigure, type AgentHandoff, type PlanMemoryFact, type PlanResult, type PlanReview, type TradingPlan } from "../../api/v1/contract.ts";
import { decimalText } from "../../analytics/operations.ts";
import { EVIDENCE_METRICS, EVIDENCE_PROVIDERS, EVIDENCE_WINDOWS, type EvidenceMetricId } from "../../evidence/metrics.ts";
import { providerRights } from "../../evidence/rights.ts";
import { conditionKindWords, findingOutcomeWords } from "../../monitoring/engine.ts";
import type { MarketEvidenceRead } from "../../evidence/snapshot.ts";
import type { SpotMarket } from "../../spot/markets.ts";
import type { StockRow } from "../../stocks/universe.server.ts";
import { memoryFactKey } from "../lens/reads.ts";
import { FRESHNESS_MS, figure, pctText, stateOf, unitsText, usdCompactText, usdText, whenText, type Locale } from "../provenance.ts";
import { resolveAsset, type ResolvedAsset } from "./readers.ts";
import { emptyRun, type AgentTool, type ToolContext, type ToolFact, type ToolNote, type ToolRun } from "./types.ts";

const Mint = z.string().regex(BASE58);
const Query = z.string().min(1).max(44);

/** One word in the reader's language. */
export const w = (locale: Locale, en: string, uk: string): string => (locale === "uk" ? uk : en);

const fact = (f: AgentFigure, key: string): ToolFact => ({ key, label: f.label, value: f.value, number: f.number, unit: f.unit, state: f.state, cite: f.cite });

function note(section: ToolNote["section"], text: string, cites: readonly string[]): ToolNote {
  return { section, text: text.slice(0, 400), cites };
}

function marketHref(market: Pick<SpotMarket, "mint" | "category">): string {
  return `/app/spot?view=${market.category ?? "all"}&mint=${market.mint}`;
}

function stockHref(row: StockRow): string {
  return `/app/stocks/${encodeURIComponent(row.representation.symbol)}`;
}

/* ------------------------------------------------------------ the market */

export function marketRun(market: SpotMarket, observedAt: string, stale: boolean, ctx: ToolContext): ToolRun {
  const locale = ctx.locale;
  const at = market.updatedAt ?? observedAt;
  const state = stale ? "stale" : stateOf(at, FRESHNESS_MS.market, ctx.nowMs);
  const cite = ctx.citations.add({ tool: "market_read", source: w(locale, "Spot catalogue (Jupiter)", "Каталог Spot (Jupiter)"), observedAt: at, state, ref: market.mint, href: marketHref(market) });
  const price = figure({ label: w(locale, "Price", "Ціна"), number: market.price, kind: "usd", unit: "USD", state, cite: cite.id }, locale);
  const change = figure({ label: w(locale, "24h change", "Зміна за 24 год"), number: market.change24hPct, kind: "pct", unit: "%", state, cite: cite.id }, locale);
  const liquidity = figure({ label: w(locale, "Liquidity", "Ліквідність"), number: market.liquidityUsd, kind: "usdCompact", unit: "USD", state, cite: cite.id }, locale);
  const volume = figure({ label: w(locale, "24h volume", "Обсяг за 24 год"), number: market.volume24hUsd, kind: "usdCompact", unit: "USD", state, cite: cite.id }, locale);
  const holders = figure({ label: w(locale, "Holders", "Тримачі"), number: market.holders, kind: "count", unit: null, state, cite: cite.id }, locale);
  const marketCap = figure({ label: w(locale, "Market cap", "Капіталізація"), number: market.marketCapUsd, kind: "usdCompact", unit: "USD", state, cite: cite.id }, locale);
  const verified = figure({ label: w(locale, "Verified", "Верифікація"), number: null, kind: "text", text: market.verified ? w(locale, "on Jupiter's verified list", "у верифікованому списку Jupiter") : w(locale, "not on Jupiter's verified list", "не у верифікованому списку Jupiter"), state: "current", cite: cite.id }, locale);
  const category = market.category === "meme" ? w(locale, "a meme", "мем") : market.category === "crypto" ? w(locale, "a crypto token", "крипто-токен") : market.category === "stock" ? w(locale, "a tokenized stock", "токенізована акція") : w(locale, "an uncategorised token", "токен без категорії");
  const figures = [price, change, liquidity, volume, marketCap, holders, verified];
  const card: AgentCard = { kind: "market", mint: market.mint, symbol: market.symbol, name: market.name.slice(0, 128), category: market.category, verified: market.verified, figures, cite: cite.id, href: marketHref(market) };
  const when = whenText(at, locale);
  const notes: ToolNote[] = [
    note("observation", w(locale, `${market.symbol} (${market.name}) is ${category} on the Spot catalogue; price ${price.value}, 24h change ${change.value}, liquidity ${liquidity.value}, 24h volume ${volume.value} — observed ${when}, ${state}.`, `${market.symbol} (${market.name}) — ${category} у каталозі Spot; ціна ${price.value}, зміна за 24 год ${change.value}, ліквідність ${liquidity.value}, обсяг за 24 год ${volume.value} — спостережено ${when}, ${state === "current" ? "актуально" : state === "stale" ? "застаріло" : "невідомо"}.`), [cite.id]),
  ];
  if (!market.verified) notes.push(note("risks", w(locale, `${market.symbol} is not on Jupiter's verified list: a copy can borrow a name, and no plan can name an unverified token.`, `${market.symbol} не у верифікованому списку Jupiter: копія може позичити назву, і план не може назвати неверифікований токен.`), [cite.id]));
  if (market.audit.suspicious) notes.push(note("risks", w(locale, `The venue's own audit flags ${market.symbol} as suspicious.`, `Власний аудит майданчика позначає ${market.symbol} як підозрілий.`), [cite.id]));
  if (market.liquidityUsd !== null && market.liquidityUsd < 100_000) notes.push(note("risks", w(locale, `Liquidity of ${liquidity.value} is thin: a sum of a few thousand dollars can move the price, and an exit can cost more than the entry suggested.`, `Ліквідність ${liquidity.value} тонка: сума в кілька тисяч доларів може зрушити ціну, а вихід може коштувати більше, ніж обіцяв вхід.`), [cite.id]));
  if (market.audit.mintAuthorityDisabled === false) notes.push(note("risks", w(locale, `The mint authority of ${market.symbol} is still present, so supply can be increased.`, `Право емісії ${market.symbol} досі не відкликане: пропозицію можна збільшити.`), [cite.id]));
  if (state !== "current") notes.push(note("risks", w(locale, `The market figures are ${state}; a decision needs a fresh read.`, `Ринкові цифри ${state === "stale" ? "застарілі" : "невідомі"}; рішенню потрібне свіже читання.`), [cite.id]));
  notes.push(note("checks", w(locale, `Liquidity and 24h volume before any size; the evidence layer for holders' concentration and the authorities (${market.symbol}).`, `Ліквідність і обсяг за 24 год перед будь-яким розміром; шар доказів — про концентрацію тримачів і права (${market.symbol}).`), [cite.id]));
  const handoffs: AgentHandoff[] = [{ kind: "market", href: marketHref(market), label: w(locale, `Open ${market.symbol} on Spot`, `Відкрити ${market.symbol} у Spot`), primary: false }];
  return { tool: "market_read", kind: "research", outcome: "ok", state, facts: figures.map((f, i) => fact(f, ["price", "change24h", "liquidity", "volume24h", "marketCap", "holders", "verified"][i])), notes, cards: [card], handoffs, draft: null };
}

export const marketRead: AgentTool<typeof MarketInput> = {
  name: "market_read",
  kind: "research",
  description: "The Spot catalogue's figures for one token: price, 24h change, liquidity, volume, market cap, holders, verification, the venue's audit flags — with the observation time.",
  input: z.object({ query: Query }).strict(),
  async run(input, ctx) {
    const resolved = await resolveAsset(ctx.readers, input.query);
    if (resolved.kind === "none") return resolved.reason === "retired" ? retiredRun("market_read", resolved.query, ctx.locale) : emptyRun("market_read", "research", resolved.reason === "not-listed" ? "empty" : "unavailable");
    if (resolved.kind === "stock") return stockRun(resolved.row, ctx);
    return marketRun(resolved.market, resolved.observedAt, resolved.stale, ctx);
  },
};

/** A token Ryntra no longer supports, in one plain line: its state and the way out. */
export function retiredLine(query: string, locale: Locale): string {
  const name = query.trim().replace(/^\$/, "");
  return w(locale, `${name} is no longer supported in Ryntra. You can sell it in your own wallet.`, `${name} більше не підтримується в Ryntra. Продати можна у своєму гаманці.`);
}

/** The run for a retired token: the one line, and nothing to open or prepare. */
function retiredRun(tool: string, query: string, locale: Locale): ToolRun {
  return { ...emptyRun(tool, "research", "empty"), notes: [note("observation", retiredLine(query, locale), [])] };
}
const MarketInput = z.object({ query: Query }).strict();

/* ------------------------------------------------------------ the stock */

export function stockRun(row: StockRow, ctx: ToolContext): ToolRun {
  const locale = ctx.locale;
  const rep = row.representation;
  const observedAt = row.market.observedAt;
  const state = stateOf(observedAt, FRESHNESS_MS.stock, ctx.nowMs);
  const href = stockHref(row);
  const cite = ctx.citations.add({ tool: "stock_read", source: w(locale, `Stocks desk · ${rep.issuer.label}`, `Стіл акцій · ${rep.issuer.label}`), observedAt, state, ref: rep.mint, href });
  const refCite = ctx.citations.add({ tool: "stock_read", source: row.reference.source.label || w(locale, "Issuer reference (none stated)", "Референс емітента (не заявлений)"), observedAt: row.reference.observedAt ?? row.reference.fetchedAt, state: row.reference.state === "current" ? "current" : row.reference.state === "stale" ? "stale" : "unavailable", ref: rep.mint, href });
  const unit = rep.instrument.unitBasis === "share" ? w(locale, "per share", "за акцію") : w(locale, "per token", "за токен");
  const price = figure({ label: w(locale, `Price ${unit}`, `Ціна ${unit}`), number: rep.instrument.unitBasis === "share" ? row.tokenPerShareUsd : row.market.priceUsd, kind: "usd", unit: "USD", state, cite: cite.id }, locale);
  const reference = figure({ label: w(locale, "Issuer reference", "Референс емітента"), number: row.reference.perShare, kind: "usd", unit: row.reference.currency, state: refCite.state, cite: refCite.id }, locale);
  const deviation = figure({ label: w(locale, "Deviation from reference", "Відхилення від референсу"), number: row.deviationPct, kind: "pct", unit: "%", state: row.deviationPct === null ? "unavailable" : state, cite: cite.id }, locale);
  const liquidity = figure({ label: w(locale, "Liquidity", "Ліквідність"), number: row.market.liquidityUsd, kind: "usdCompact", unit: "USD", state, cite: cite.id }, locale);
  const volume = figure({ label: w(locale, "24h volume", "Обсяг за 24 год"), number: row.market.volume24hUsd, kind: "usdCompact", unit: "USD", state, cite: cite.id }, locale);
  const multiplier = figure({ label: w(locale, "Multiplier", "Множник"), number: row.multiplier?.current ?? null, kind: "units", unit: null, state: row.multiplier ? "current" : "unknown", cite: cite.id }, locale);
  const sessionWord = row.session.period === "unknown" ? w(locale, "session unknown", "сесія невідома") : row.session.exchangeOpen === true ? w(locale, "exchange open", "біржа відкрита") : row.session.exchangeOpen === false ? w(locale, "exchange closed", "біржа закрита") : row.session.period;
  const session = figure({ label: w(locale, "Session", "Сесія"), number: null, kind: "text", text: sessionWord, state: row.session.source === "none" ? "unknown" : "current", cite: cite.id }, locale);
  const rights = rep.instrument.rights === "issuer-terms" ? w(locale, "the issuer's terms", "умови емітента") : rep.instrument.rights === "economic-exposure" ? w(locale, "economic exposure, no shareholder rights", "економічна експозиція без прав акціонера") : w(locale, "loan participation", "участь у позиці");
  const figures = [price, reference, deviation, liquidity, volume, multiplier, session];
  const card: AgentCard = {
    kind: "stock",
    mint: rep.mint,
    symbol: rep.symbol,
    name: (rep.underlying.name ?? rep.name).slice(0, 128),
    issuer: { id: rep.issuer.id, label: rep.issuer.label },
    instrument: rep.instrument,
    session: { period: row.session.period, exchangeOpen: row.session.exchangeOpen, nextChangeAt: row.session.nextChangeAt },
    lifecycle: { state: row.lifecycle.state, tradable: row.lifecycle.tradable },
    figures,
    cite: cite.id,
    href,
  };
  const klass = rep.instrument.class === "pre-ipo" ? w(locale, "a pre-IPO instrument", "pre-IPO інструмент") : w(locale, "a tokenized listed stock", "токенізована лістингована акція");
  const notes: ToolNote[] = [
    note("observation", w(locale, `${rep.symbol} is ${klass} issued by ${rep.issuer.label} on ${rep.underlying.name ?? rep.underlying.symbol}; what you hold is ${rights}. Price ${price.value} ${unit}, issuer reference ${reference.value} (${refCite.state}), deviation ${deviation.value}, liquidity ${liquidity.value}; ${sessionWord}.`, `${rep.symbol} — ${klass} від ${rep.issuer.label} на ${rep.underlying.name ?? rep.underlying.symbol}; те, що ти тримаєш, — ${rights}. Ціна ${price.value} ${unit}, референс емітента ${reference.value} (${refCite.state === "current" ? "актуально" : refCite.state === "stale" ? "застаріло" : "недоступно"}), відхилення ${deviation.value}, ліквідність ${liquidity.value}; ${sessionWord}.`), [cite.id, refCite.id]),
  ];
  if (row.reference.state !== "current") notes.push(note("risks", w(locale, `The issuer reference is ${row.reference.state}: the deviation cannot be judged, and a plan that requires the reference is blocked until it returns.`, `Референс емітента ${row.reference.state === "stale" ? "застарілий" : "недоступний"}: відхилення не оцінити, а план, що вимагає референс, заблокований до його повернення.`), [refCite.id]));
  if (row.session.exchangeOpen === false) notes.push(note("meaning", w(locale, `The reference exchange is closed, so the token trades against a reference that does not move until it opens; deviation can widen for that reason alone.`, `Референсна біржа закрита, тож токен торгується проти референсу, що не рухається до відкриття; відхилення може зрости лише через це.`), [cite.id]));
  if (row.deviationPct !== null && Math.abs(row.deviationPct) > 2) notes.push(note("risks", w(locale, `The token trades ${deviation.value} from the issuer's reference; the executable price at the Review is what counts, not the list figure.`, `Токен торгується з відхиленням ${deviation.value} від референсу емітента; рахується виконувана ціна на Review, а не цифра зі списку.`), [cite.id]));
  if (!row.lifecycle.tradable) notes.push(note("risks", w(locale, `The issuer's lifecycle for ${rep.symbol} is ${row.lifecycle.state}: a new purchase is not what the issuer supports right now.`, `Стан життєвого циклу ${rep.symbol} в емітента — ${row.lifecycle.state}: нова покупка зараз не те, що емітент підтримує.`), [cite.id]));
  if (row.transferFee && row.transferFee.basisPoints > 0) notes.push(note("risks", w(locale, `The mint withholds a transfer fee of ${(row.transferFee.basisPoints / 100).toFixed(2)} % on every transfer.`, `Мінт утримує комісію за переказ ${(row.transferFee.basisPoints / 100).toFixed(2)} % з кожного переказу.`), [cite.id]));
  if (rep.instrument.class === "pre-ipo") notes.push(note("counter", w(locale, `A pre-IPO token is not a share: its price stands on the issuer's mark and the venue's market, not on an exchange reference; the company's own valuation is context, never a price.`, `Pre-IPO токен — не акція: його ціна стоїть на оцінці емітента й ринку майданчика, а не на біржовому референсі; оцінка компанії — контекст, ніколи не ціна.`), [cite.id]));
  notes.push(note("checks", w(locale, `The issuer's terms on rights, redemption and corporate actions (${rep.issuer.label}); the reference and the session at the moment of the Review.`, `Умови емітента про права, викуп і корпоративні дії (${rep.issuer.label}); референс і сесія в момент Review.`), [cite.id]));
  const handoffs: AgentHandoff[] = [{ kind: "stocks", href, label: w(locale, `Open ${rep.symbol} on Stocks`, `Відкрити ${rep.symbol} у Stocks`), primary: false }];
  return { tool: "stock_read", kind: "research", outcome: "ok", state, facts: figures.map((f, i) => fact(f, ["price", "reference", "deviation", "liquidity", "volume24h", "multiplier", "session"][i])), notes, cards: [card], handoffs, draft: null };
}

export const stockRead: AgentTool<typeof MarketInput> = {
  name: "stock_read",
  kind: "research",
  description: "The stock desk's row for one tokenized stock: issuer, instrument and rights, price per unit, the issuer's reference and the deviation, session, liquidity, multiplier, lifecycle, transfer fee.",
  input: MarketInput,
  async run(input, ctx) {
    const resolved = await resolveAsset(ctx.readers, input.query);
    if (resolved.kind === "none") return resolved.reason === "retired" ? retiredRun("stock_read", resolved.query, ctx.locale) : emptyRun("stock_read", "research", resolved.reason === "not-listed" ? "empty" : "unavailable");
    if (resolved.kind === "token") return marketRun(resolved.market, resolved.observedAt, resolved.stale, ctx);
    return stockRun(resolved.row, ctx);
  },
};

/* ------------------------------------------------------------ the evidence */

const EvidenceInput = z.object({ mint: Mint, window: z.enum(EVIDENCE_WINDOWS), provider: z.enum(EVIDENCE_PROVIDERS).optional(), symbol: z.string().min(1).max(32).optional() }).strict();

function metricLabel(id: EvidenceMetricId, locale: Locale): string {
  const definition = EVIDENCE_METRICS.find((metric) => metric.id === id);
  return definition ? (locale === "uk" ? definition.words.uk.label : definition.words.en.label) : id;
}

export function evidenceRun(read: MarketEvidenceRead, input: z.output<typeof EvidenceInput>, ctx: ToolContext): ToolRun {
  const locale = ctx.locale;
  const provider = input.provider ?? (input.window === "now" ? "ddxyz" : "nansen");
  const rights = providerRights(provider);
  const symbol = input.symbol ?? read.snapshot?.subject.symbol ?? input.mint.slice(0, 6);
  const href = `/app/assets/${input.mint}`;
  if (!read.snapshot) {
    const state = read.state === "UNKNOWN" ? "unknown" : "unavailable";
    const cite = ctx.citations.add({ tool: "evidence_read", source: rights.attribution.text, observedAt: null, state, ref: `${provider}:${input.window}`, href });
    const card: AgentCard = { kind: "evidence", mint: input.mint, provider, window: input.window, state: read.state, reason: read.reason, figures: [], attribution: rights.attribution, cite: cite.id, href };
    const reason = read.reason ?? "";
    const notes: ToolNote[] = [
      note("risks", read.state === "UNKNOWN" ? w(locale, `${rights.attribution.text} covers no observation for ${symbol} over ${input.window}: not enough data, not a clean bill.`, `${rights.attribution.text} не має спостереження для ${symbol} за ${input.window}: даних недостатньо, і це не чиста довідка.`) : w(locale, `The ${input.window} observation from ${rights.attribution.text} is unavailable (${reason}); nothing here is a zero.`, `Спостереження за ${input.window} від ${rights.attribution.text} недоступне (${reason}); ніщо тут не є нулем.`), [cite.id]),
    ];
    return { tool: "evidence_read", kind: "research", outcome: read.state === "UNKNOWN" ? "empty" : "unavailable", state, facts: [], notes, cards: [card], handoffs: [], draft: null };
  }
  const snapshot = read.snapshot;
  const state = read.state === "FRESH" ? "current" : "stale";
  const cite = ctx.citations.add({ tool: "evidence_read", source: `${rights.attribution.text} · ${input.window}`, observedAt: snapshot.observedAt ?? snapshot.fetchedAt, state, ref: `${provider}:${snapshot.subject.mint}:${input.window}:${snapshot.fetchedAt}`, href });
  const figures: AgentFigure[] = snapshot.metrics.slice(0, 16).map((metric) => {
    const definition = EVIDENCE_METRICS.find((entry) => entry.id === metric.id);
    const kind = metric.unit === "usd" ? "usdCompact" : metric.unit === "percent" ? (definition?.sign === "signed" ? "pct" : "text") : metric.unit === "flag" ? "text" : "count";
    const text = metric.unit === "flag" ? (metric.value === null ? undefined : metric.value >= 1 ? w(locale, "present", "є") : w(locale, "renounced", "відкликано")) : metric.unit === "percent" && definition?.sign !== "signed" && metric.value !== null ? pctText(metric.value, locale).replace(/^\+/, "") : undefined;
    return figure({ label: metricLabel(metric.id, locale), number: metric.value, kind, text, unit: metric.unit === "usd" ? "USD" : metric.unit === "percent" ? "%" : null, state: metric.value === null ? "unavailable" : state, cite: cite.id }, locale);
  });
  const card: AgentCard = { kind: "evidence", mint: input.mint, provider, window: input.window, state: read.state, reason: read.reason, figures, attribution: snapshot.attribution, cite: cite.id, href };
  const facts = snapshot.metrics.slice(0, 16).map((metric, i) => fact(figures[i], `evidence.${metric.id}`));
  const said = figures.filter((f) => f.state !== "unavailable").slice(0, 5).map((f) => `${f.label.toLowerCase()} ${f.value}`).join(", ");
  const notes: ToolNote[] = [
    note("observation", w(locale, `${rights.attribution.text} over ${input.window} for ${symbol}: ${said || "no figure answered"} — observed ${whenText(snapshot.observedAt ?? snapshot.fetchedAt, locale)}, ${state}.`, `${rights.attribution.text} за ${input.window} для ${symbol}: ${said || "жодна цифра не відповіла"} — спостережено ${whenText(snapshot.observedAt ?? snapshot.fetchedAt, locale)}, ${state === "current" ? "актуально" : "застаріло"}.`), [cite.id]),
  ];
  const byId = new Map(snapshot.metrics.map((metric) => [metric.id, metric.value] as const));
  const top10 = byId.get("top10_holder_share_pct") ?? null;
  if (top10 !== null && top10 >= 50) notes.push(note("risks", w(locale, `The top ten holders hold ${pctText(top10, locale).replace("+", "")} of ${symbol}: a few wallets can move the price.`, `Десять найбільших тримачів тримають ${pctText(top10, locale).replace("+", "")} ${symbol}: кілька гаманців можуть зрушити ціну.`), [cite.id]));
  const mintAuthority = byId.get("mint_authority") ?? null;
  if (mintAuthority !== null && mintAuthority >= 1) notes.push(note("risks", w(locale, `The mint authority is present: supply can be increased by whoever holds it.`, `Право емісії є: той, хто його тримає, може збільшити пропозицію.`), [cite.id]));
  const freeze = byId.get("freeze_authority") ?? null;
  if (freeze !== null && freeze >= 1) notes.push(note("risks", w(locale, `The freeze authority is present: token accounts can be frozen.`, `Право заморозки є: токен-рахунки можна заморозити.`), [cite.id]));
  const tax = byId.get("transfer_tax_pct") ?? null;
  if (tax !== null && tax > 0) notes.push(note("risks", w(locale, `A transfer tax of ${pctText(tax, locale).replace("+", "")} is withheld on every transfer.`, `Податок на переказ ${pctText(tax, locale).replace("+", "")} утримується з кожного переказу.`), [cite.id]));
  const sniper = byId.get("sniper_holding_pct") ?? null;
  if (sniper !== null && sniper >= 10) notes.push(note("risks", w(locale, `Wallets the source labels as snipers hold ${pctText(sniper, locale).replace("+", "")} — a label, advisory only.`, `Гаманці, які джерело позначає як снайперів, тримають ${pctText(sniper, locale).replace("+", "")} — мітка, лише дорадчо.`), [cite.id]));
  const whales = byId.get("whale_net_flow_usd") ?? null;
  if (whales !== null && whales !== 0) notes.push(note("meaning", w(locale, `Whale net flow over ${input.window} is ${usdCompactText(whales, locale)}: ${whales > 0 ? "large wallets bought more than they sold" : "large wallets sold more than they bought"} — a cohort figure, not a forecast.`, `Чистий потік китів за ${input.window} — ${usdCompactText(whales, locale)}: ${whales > 0 ? "великі гаманці купили більше, ніж продали" : "великі гаманці продали більше, ніж купили"} — цифра когорти, не прогноз.`), [cite.id]));
  const netVolume = byId.get("dex_net_volume_usd") ?? null;
  if (netVolume !== null) notes.push(note("meaning", w(locale, `DEX net volume over ${input.window} is ${usdCompactText(netVolume, locale)} (${netVolume >= 0 ? "more buying than selling" : "more selling than buying"} by volume).`, `Чистий обсяг DEX за ${input.window} — ${usdCompactText(netVolume, locale)} (${netVolume >= 0 ? "купівлі більше, ніж продажу" : "продажу більше, ніж купівлі"} за обсягом).`), [cite.id]));
  if (state === "stale") notes.push(note("risks", w(locale, `This observation is stale (${read.reason ?? "past the provider's own rule"}); a condition on it would block until a fresh one.`, `Це спостереження застаріле (${read.reason ?? "поза власним правилом провайдера"}); умова на ньому блокувала б до свіжого.`), [cite.id]));
  notes.push(note("counter", w(locale, `Evidence describes the token's structure and flows at one moment; it does not say where the price goes, and a cohort label is the source's, not a fact about intent.`, `Докази описують структуру й потоки токена в один момент; вони не кажуть, куди піде ціна, а мітка когорти — джерела, не факт про намір.`), [cite.id]));
  notes.push(note("checks", w(locale, `Whether the figures hold on the next observation; a plan can carry them as conditions the Review judges (${symbol}).`, `Чи тримаються цифри на наступному спостереженні; план може нести їх як умови, які судить Review (${symbol}).`), [cite.id]));
  return { tool: "evidence_read", kind: "research", outcome: "ok", state, facts, notes, cards: [card], handoffs: [{ kind: "market", href, label: w(locale, `Open the asset passport`, `Відкрити паспорт активу`), primary: false }], draft: null };
}

export const evidenceRead: AgentTool<typeof EvidenceInput> = {
  name: "evidence_read",
  kind: "research",
  description: "A permitted, attributed observation about one mint over one window from the evidence layer (Nansen flows over 24h/7d; DD.xyz structure now), with its state and times; never a price.",
  input: EvidenceInput,
  async run(input, ctx) {
    const read = await ctx.readers.evidence({ mint: input.mint, window: input.window, provider: input.provider });
    return evidenceRun(read, input, ctx);
  },
};

/* ------------------------------------------------------------ the holdings */

export const holdingsRead: AgentTool<z.ZodObject<Record<string, never>>> = {
  name: "holdings_read",
  kind: "research",
  description: "What the proven wallet holds — each asset's amount as the chain states it and the venue's price per unit where the catalogue has one; which positions have plans; never a computed total.",
  input: z.object({}).strict(),
  async run(_input, ctx) {
    const locale = ctx.locale;
    const read = await ctx.readers.holdings(ctx.owner);
    const href = "/app/portfolio";
    if (!read.ok) {
      const cite = ctx.citations.add({ tool: "holdings_read", source: w(locale, "Wallet holdings (RPC)", "Активи гаманця (RPC)"), observedAt: null, state: "unavailable", ref: null, href });
      return { ...emptyRun("holdings_read", "research", "unavailable", "unavailable"), notes: [note("risks", w(locale, `The wallet's holdings could not be read right now (${read.reason}); nothing here is an empty wallet.`, `Активи гаманця зараз не прочитати (${read.reason}); це не означає порожній гаманець.`), [cite.id])] };
    }
    const state = stateOf(read.observedAt, FRESHNESS_MS.holdings, ctx.nowMs);
    const cite = ctx.citations.add({ tool: "holdings_read", source: w(locale, `Wallet holdings (RPC${read.sourceHost ? ` · ${read.sourceHost}` : ""})`, `Активи гаманця (RPC${read.sourceHost ? ` · ${read.sourceHost}` : ""})`), observedAt: read.observedAt, state, ref: ctx.owner, href });
    const plans = await ctx.readers.plans(ctx.owner);
    const plansByMint = new Map<string, string[]>();
    for (const plan of plans.plans) {
      if (plan.status === "active" || plan.status === "draft") plansByMint.set(plan.asset.mint, [...(plansByMint.get(plan.asset.mint) ?? []), plan.id]);
    }
    const rows = read.holdings.slice(0, 60).map((row) => {
      const symbol = (row.catalog?.symbol ?? row.symbol ?? (row.kind === "NATIVE" ? "SOL" : row.mint.slice(0, 4) + "…")).slice(0, 32);
      const price = row.catalog?.usdPrice !== undefined && row.catalog?.usdPrice !== null ? Number(row.catalog.usdPrice) : null;
      return {
        mint: row.mint,
        symbol,
        amount: row.decimals === null ? row.amountRaw : decimalText(row.amountRaw, row.decimals),
        priceUsd: price !== null && Number.isFinite(price) && price >= 0 ? price : null,
        verified: row.catalog?.isVerified === true,
        category: (row.catalog?.category === "crypto" || row.catalog?.category === "meme" || row.catalog?.category === "stock" ? row.catalog.category : null) as "crypto" | "meme" | "stock" | null,
        plans: (plansByMint.get(row.mint) ?? []).slice(0, 10),
      };
    });
    const unpriced = rows.filter((row) => row.priceUsd === null).length;
    const card: AgentCard = { kind: "holdings", tokenRead: read.tokenRead, rows, unpriced, cite: cite.id, href };
    const counts = { stock: rows.filter((r) => r.category === "stock").length, crypto: rows.filter((r) => r.category === "crypto").length, meme: rows.filter((r) => r.category === "meme").length, other: rows.filter((r) => r.category === null).length };
    const withPlans = rows.filter((r) => r.plans.length > 0);
    const facts: ToolFact[] = [
      fact(figure({ label: w(locale, "Positions", "Позиції"), number: rows.length, kind: "count", state, cite: cite.id }, locale), "positions"),
      fact(figure({ label: w(locale, "Unpriced", "Без ціни"), number: unpriced, kind: "count", state, cite: cite.id }, locale), "unpriced"),
      fact(figure({ label: w(locale, "Read", "Читання"), number: null, kind: "text", text: read.tokenRead, state: read.tokenRead === "COMPLETE" ? "current" : read.tokenRead === "PARTIAL" ? "stale" : "unavailable", cite: cite.id }, locale), "tokenRead"),
    ];
    const names = rows.slice(0, 8).map((r) => `${r.symbol} ${Number(r.amount) < 1e15 ? unitsText(Number(r.amount), locale) : r.amount}`).join(", ");
    const notes: ToolNote[] = [
      note("observation", w(locale, `The wallet holds ${rows.length} position${rows.length === 1 ? "" : "s"} (${counts.stock} stock, ${counts.crypto} crypto, ${counts.meme} meme, ${counts.other} uncategorised): ${names}${rows.length > 8 ? ", …" : ""} — read ${whenText(read.observedAt, locale)}, ${read.tokenRead === "COMPLETE" ? "complete" : read.tokenRead === "PARTIAL" ? "partial" : "unavailable"}.`, `Гаманець тримає ${rows.length} ${rows.length === 1 ? "позицію" : rows.length < 5 ? "позиції" : "позицій"} (${counts.stock} акцій, ${counts.crypto} крипто, ${counts.meme} мемів, ${counts.other} без категорії): ${names}${rows.length > 8 ? ", …" : ""} — прочитано ${whenText(read.observedAt, locale)}, ${read.tokenRead === "COMPLETE" ? "повністю" : read.tokenRead === "PARTIAL" ? "частково" : "недоступно"}.`), [cite.id]),
    ];
    if (unpriced > 0) notes.push(note("risks", w(locale, `${unpriced} held token${unpriced === 1 ? " has" : "s have"} no price on the catalogue; ${unpriced === 1 ? "it is" : "they are"} listed, never valued at zero.`, `${unpriced} ${unpriced === 1 ? "токен не має" : "токенів не мають"} ціни в каталозі; ${unpriced === 1 ? "він показаний" : "вони показані"} без оцінки, ніколи як нуль.`), [cite.id]));
    if (read.tokenRead !== "COMPLETE") notes.push(note("risks", w(locale, `The token read is ${read.tokenRead.toLowerCase()}: a position may be missing from this list.`, `Читання токенів ${read.tokenRead === "PARTIAL" ? "часткове" : "недоступне"}: позиція може бути відсутня в цьому списку.`), [cite.id]));
    notes.push(note("meaning", withPlans.length > 0 ? w(locale, `${withPlans.length} position${withPlans.length === 1 ? " has" : "s have"} a plan behind ${withPlans.length === 1 ? "it" : "them"} (${withPlans.map((r) => r.symbol).join(", ")}); the rest ${rows.length - withPlans.length === 1 ? "is" : "are"} held without one.`, `${withPlans.length} ${withPlans.length === 1 ? "позиція має" : "позицій мають"} план (${withPlans.map((r) => r.symbol).join(", ")}); решта тримається без плану.`) : w(locale, `No position has a plan behind it: nothing is being monitored for you.`, `Жодна позиція не має плану: для тебе ніщо не моніториться.`), [cite.id]));
    notes.push(note("counter", w(locale, `Performance is not stated: the cost basis of these positions is not established here, so no gain or loss is computed.`, `Результативність не наводиться: базис вартості цих позицій тут не встановлено, тож прибуток чи збиток не рахується.`), [cite.id]));
    notes.push(note("checks", w(locale, `History for what was paid; the evidence layer for any meme held without a plan; the plans that need attention.`, `History — що було заплачено; шар доказів — для мемів без плану; плани, що потребують уваги.`), [cite.id]));
    return { tool: "holdings_read", kind: "research", outcome: rows.length === 0 ? "empty" : "ok", state, facts, notes, cards: [card], handoffs: [{ kind: "portfolio", href, label: w(locale, "Open Portfolio", "Відкрити Портфель"), primary: false }], draft: null };
  },
};

/* ------------------------------------------------------------ the plans */

function planFigures(plan: TradingPlan, cite: string, locale: Locale): AgentFigure[] {
  const rules = plan.current.rules;
  const unit = planAssetKind(plan.asset) === "stock" && (plan.asset.unitBasis ?? "share") === "share" ? w(locale, "per share", "за акцію") : w(locale, "per token", "за токен");
  return [
    figure({ label: w(locale, `Entry ${unit}`, `Вхід ${unit}`), number: rules.entry.pricePerShare, kind: "usd", unit: "USD", state: "current", cite }, locale),
    figure({ label: w(locale, "Max price", "Макс. ціна"), number: rules.entry.maxPricePerShare, kind: "usd", unit: "USD", state: rules.entry.maxPricePerShare === null ? "unknown" : "current", cite }, locale),
    figure({ label: w(locale, "Invalidation", "Інвалідація"), number: rules.risk.invalidationPerShare, kind: "usd", unit: "USD", state: "current", cite }, locale),
    figure({ label: w(locale, "Planned risk", "Плановий ризик"), number: rules.risk.plannedRiskUsd, kind: "usd", unit: "USD", state: "current", cite }, locale),
    figure({ label: w(locale, "Budget", "Бюджет"), number: rules.capital.budgetUsd, kind: "usd", unit: "USD", state: "current", cite }, locale),
    figure({ label: w(locale, "Planned size", "Плановий розмір"), number: plan.current.sizing.units, kind: "units", unit: plan.asset.symbol, state: "current", cite }, locale),
    figure({ label: w(locale, "Planning price", "Ціна планування"), number: plan.current.planningPrice?.perUnit ?? null, kind: "usd", unit: "USD", state: plan.current.planningPrice ? plan.current.planningPrice.state : "unknown", cite }, locale),
    figure({ label: w(locale, "Valid until", "Дійсний до"), number: null, kind: "text", text: rules.entry.validUntil ? whenText(rules.entry.validUntil, locale) : w(locale, "no expiry", "без терміну"), state: "current", cite }, locale),
  ];
}

const statusWord = (status: TradingPlan["status"], locale: Locale): string =>
  ({ draft: w(locale, "a draft", "чернетка"), active: w(locale, "active", "активний"), executed: w(locale, "executed", "виконаний"), cancelled: w(locale, "cancelled", "скасований"), expired: w(locale, "expired", "прострочений") })[status];

export function planCard(plan: TradingPlan, reviews: readonly PlanReview[], ctx: ToolContext): Readonly<{ card: AgentCard; cite: string; facts: readonly ToolFact[] }> {
  const locale = ctx.locale;
  const href = `/app/strategies/plans/${plan.id}`;
  const cite = ctx.citations.add({ tool: "plan_read", source: w(locale, `Plan ${plan.asset.symbol} v${plan.version}`, `План ${plan.asset.symbol} v${plan.version}`), observedAt: plan.updatedAt, state: "current", ref: plan.id, href });
  const figures = planFigures(plan, cite.id, locale);
  const latest = reviews.length > 0 ? reviews[reviews.length - 1] : null;
  const review = latest
    ? { reviewId: latest.reviewId, checkedAt: latest.checkedAt, verdict: latest.verdict, failed: latest.checks.filter((check) => check.outcome !== "pass").slice(0, 24).map((check) => ({ id: check.id, outcome: check.outcome as "fail" | "unknown", required: check.required, expected: check.expected, actual: check.actual })) }
    : null;
  const card: AgentCard = { kind: "plan", planId: plan.id, symbol: plan.asset.symbol, assetKind: planAssetKind(plan.asset), status: plan.status, version: plan.version, figures, review, cite: cite.id, href };
  const keys = ["plan.entry", "plan.maxPrice", "plan.invalidation", "plan.risk", "plan.budget", "plan.size", "plan.planningPrice", "plan.validUntil"];
  return { card, cite: cite.id, facts: [...figures.map((f, i) => fact(f, keys[i])), ...planShapeFacts(plan, cite.id, locale, ctx.nowMs)] };
}

/**
 * What the plan's own version says beyond its figures — the thesis in the
 * person's words, whether it carries a measurable condition, whether it
 * names an exit, its horizon. These are facts of the run, never figures of
 * the card: the Critic reads them to argue with a thesis on its own terms,
 * and no surface renders them as numbers.
 */
function planShapeFacts(plan: TradingPlan, cite: string, locale: Locale, nowMs: number): readonly ToolFact[] {
  const rules = plan.current.rules;
  const validUntil = rules.entry.validUntil ? Date.parse(rules.entry.validUntil) : null;
  const entryWindow = rules.entry.validUntil === null ? w(locale, "no expiry", "без терміну") : validUntil !== null && validUntil < nowMs ? w(locale, "over", "минуло") : w(locale, "open", "відкрите");
  const horizon = rules.thesis.horizon;
  const horizonWord = horizon ? `${horizon.value} ${horizon.unit === "days" ? w(locale, "days", "днів") : horizon.unit === "weeks" ? w(locale, "weeks", "тижнів") : w(locale, "months", "місяців")}` : w(locale, "no horizon stated", "горизонт не заявлено");
  return [
    fact(figure({ label: w(locale, "Thesis", "Теза"), number: null, kind: "text", text: rules.thesis.text.slice(0, 80), state: "current", cite }, locale), "plan.thesis"),
    fact(figure({ label: w(locale, "Why now", "Чому зараз"), number: null, kind: "text", text: rules.thesis.whyNow ? rules.thesis.whyNow.slice(0, 80) : w(locale, "not stated", "не заявлено"), state: rules.thesis.whyNow ? "current" : "unknown", cite }, locale), "plan.whyNow"),
    fact(figure({ label: w(locale, "Horizon", "Горизонт"), number: horizon?.value ?? null, kind: "text", text: horizonWord, state: horizon ? "current" : "unknown", cite }, locale), "plan.horizon"),
    fact(figure({ label: w(locale, "Stated assumptions", "Заявлені припущення"), number: rules.thesis.assumptions.length, kind: "count", state: "current", cite }, locale), "plan.assumptions"),
    fact(figure({ label: w(locale, "Stated sources", "Заявлені джерела"), number: rules.thesis.sources.length, kind: "count", state: "current", cite }, locale), "plan.sources"),
    fact(figure({ label: w(locale, "Evidence conditions", "Умови доказів"), number: rules.evidenceConditions.length, kind: "count", state: "current", cite }, locale), "plan.conditions"),
    fact(figure({ label: w(locale, "Target", "Ціль"), number: rules.exit.targetPerShare, kind: "usd", unit: "USD", state: rules.exit.targetPerShare === null ? "unknown" : "current", cite }, locale), "plan.target"),
    fact(figure({ label: w(locale, "Time exit", "Вихід за часом"), number: null, kind: "text", text: rules.exit.timeExitAt ? whenText(rules.exit.timeExitAt, locale) : w(locale, "none", "немає"), state: rules.exit.timeExitAt ? "current" : "unknown", cite }, locale), "plan.timeExit"),
    fact(figure({ label: w(locale, "Minimum liquidity", "Мінімальна ліквідність"), number: rules.execution.minLiquidityUsd, kind: "usdCompact", unit: "USD", state: rules.execution.minLiquidityUsd === null ? "unknown" : "current", cite }, locale), "plan.minLiquidity"),
    fact(figure({ label: w(locale, "Executions", "Виконання"), number: plan.executions.length, kind: "count", state: "current", cite }, locale), "plan.executions"),
    fact(figure({ label: w(locale, "Versions", "Версії"), number: plan.versions.length, kind: "count", state: "current", cite }, locale), "plan.versions"),
    fact(figure({ label: w(locale, "Entry window", "Вікно входу"), number: null, kind: "text", text: entryWindow, state: "current", cite }, locale), "plan.entryWindow"),
    fact(figure({ label: w(locale, "Status", "Статус"), number: null, kind: "text", text: statusWord(plan.status, locale), state: "current", cite }, locale), "plan.status"),
    fact(figure({ label: w(locale, "Version written", "Версію записано"), number: null, kind: "text", text: whenText(plan.current.createdAt, locale), state: "current", cite }, locale), "plan.versionAt"),
  ];
}

export const plansRead: AgentTool<z.ZodObject<Record<string, never>>> = {
  name: "plans_read",
  kind: "research",
  description: "The proven wallet's trading plans: each on its current version with its state, entry, invalidation, planned risk, budget and size, and which ones need a decision.",
  input: z.object({}).strict(),
  async run(_input, ctx) {
    const locale = ctx.locale;
    const listed = await ctx.readers.plans(ctx.owner);
    const href = "/app/bots";
    if (listed.plans.length === 0) {
      const cite = ctx.citations.add({ tool: "plans_read", source: w(locale, "Plan store", "Сховище планів"), observedAt: new Date(ctx.nowMs).toISOString(), state: "current", ref: null, href });
      return { ...emptyRun("plans_read", "research", "empty", "current"), notes: [note("observation", w(locale, "This wallet has no trading plan yet.", "У цього гаманця ще немає торгового плану."), [cite.id])], handoffs: [{ kind: "builder", href: "/app/strategies/new", label: w(locale, "Create a plan", "Створити план"), primary: false }] };
    }
    const cards: AgentCard[] = [];
    const facts: ToolFact[] = [];
    const attention: string[] = [];
    for (const plan of listed.plans.slice(0, 8)) {
      const made = planCard(plan, [], ctx);
      cards.push(made.card);
      facts.push(...made.facts.map((f) => ({ ...f, key: `${plan.id}.${f.key}` })));
      const validUntil = plan.current.rules.entry.validUntil ? Date.parse(plan.current.rules.entry.validUntil) : null;
      if (plan.status === "expired" || (plan.status === "active" && validUntil !== null && validUntil < ctx.nowMs)) attention.push(`${plan.asset.symbol} (${w(locale, "entry window over", "вікно входу минуло")})`);
    }
    const first = cards[0].kind === "plan" ? cards[0].cite : "c1";
    const summary = listed.plans.slice(0, 8).map((plan) => `${plan.asset.symbol} v${plan.version} — ${statusWord(plan.status, locale)}`).join("; ");
    const notes: ToolNote[] = [note("observation", w(locale, `${listed.total} plan${listed.total === 1 ? "" : "s"}: ${summary}.`, `${listed.total} ${listed.total === 1 ? "план" : listed.total < 5 ? "плани" : "планів"}: ${summary}.`), cards.map((c) => (c.kind === "plan" ? c.cite : first)))];
    if (attention.length > 0) notes.push(note("meaning", w(locale, `Needs a decision: ${attention.join(", ")}.`, `Потребує рішення: ${attention.join(", ")}.`), cards.map((c) => (c.kind === "plan" ? c.cite : first))));
    else notes.push(note("meaning", w(locale, "No plan's entry window has passed; the active ones are being monitored.", "Жодне вікно входу не минуло; активні плани моніторяться."), [first]));
    return { tool: "plans_read", kind: "research", outcome: "ok", state: "current", facts, notes, cards, handoffs: [{ kind: "plan", href, label: w(locale, "Open My strategies", "Відкрити Мої стратегії"), primary: false }], draft: null };
  },
};

const PlanInput = z.object({ planId: z.string().regex(PLAN_ID).optional(), symbol: z.string().min(1).max(32).optional() }).strict();

export const checkWord = (id: PlanReview["checks"][number]["id"], locale: Locale): string =>
  ({
    status: w(locale, "the plan's status", "статус плану"),
    asset: w(locale, "the asset", "актив"),
    side: w(locale, "the side", "сторона"),
    version: w(locale, "the version", "версія"),
    validity: w(locale, "the entry window", "вікно входу"),
    budget: w(locale, "the budget", "бюджет"),
    entryPrice: w(locale, "the maximum price", "максимальна ціна"),
    reference: w(locale, "the issuer reference", "референс емітента"),
    deviation: w(locale, "the deviation from the reference", "відхилення від референсу"),
    slippage: w(locale, "the slippage", "сліпедж"),
    quoteAge: w(locale, "the quote's age", "вік котирування"),
    liquidity: w(locale, "the liquidity", "ліквідність"),
    units: w(locale, "the units", "одиниці"),
    invalidation: w(locale, "the price against the invalidation", "ціна проти інвалідації"),
    spend: w(locale, "what the plan may spend", "що план може витратити"),
    risk: w(locale, "the modelled loss against the planned risk", "змодельований збиток проти планового ризику"),
    size: w(locale, "the size", "розмір"),
    evidence: w(locale, "an evidence condition", "умова доказів"),
    /* 1.9.0 — judged on an exit, never on a Review before an entry. */
    exitTarget: w(locale, "the exit target", "ціль виходу"),
    exitInvalidation: w(locale, "the exit against the invalidation", "вихід проти інвалідації"),
    exitTime: w(locale, "the time exit", "вихід за часом"),
  })[id];

export const planRead: AgentTool<typeof PlanInput> = {
  name: "plan_read",
  kind: "research",
  description: "One plan of the proven wallet in full — its current rules and size, its versions and journal, the latest Review it kept with every check that did not pass, and the notes Monitoring wrote about it.",
  input: PlanInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    let planId = input.planId ?? null;
    if (planId === null && input.symbol) {
      const listed = await ctx.readers.plans(ctx.owner);
      const match = listed.plans.filter((plan) => plan.asset.symbol.toLowerCase() === input.symbol!.toLowerCase() || plan.asset.underlying.symbol.toLowerCase() === input.symbol!.toLowerCase());
      const pick = match.find((plan) => plan.status === "active") ?? match[0] ?? null;
      planId = pick?.id ?? null;
      if (planId === null) return emptyRun("plan_read", "research", "empty", "current");
    }
    if (planId === null) return emptyRun("plan_read", "research", "empty", "current");
    const read = await ctx.readers.plan(ctx.owner, planId);
    if (!read.ok) return emptyRun("plan_read", "research", read.code === "PLAN_NOT_FOUND" ? "empty" : "unavailable", read.code === "PLAN_NOT_FOUND" ? "current" : "unavailable");
    const plan = read.plan;
    const made = planCard(plan, read.reviews, ctx);
    const rules = plan.current.rules;
    const validUntil = rules.entry.validUntil ? Date.parse(rules.entry.validUntil) : null;
    const expired = plan.status === "expired" || (plan.status === "active" && validUntil !== null && validUntil < ctx.nowMs);
    const notes: ToolNote[] = [
      note("observation", w(locale, `Your ${plan.asset.symbol} plan is ${statusWord(plan.status, locale)} on version ${plan.version}: entry ${made.facts[0].value}, max price ${made.facts[1].value}, invalidation ${made.facts[2].value}, planned risk ${made.facts[3].value} inside a budget of ${made.facts[4].value}, size ${made.facts[5].value} ${plan.asset.symbol}; ${rules.entry.validUntil ? `valid until ${whenText(rules.entry.validUntil, locale)}` : "no expiry"}.`, `Твій план на ${plan.asset.symbol} — ${statusWord(plan.status, locale)}, версія ${plan.version}: вхід ${made.facts[0].value}, макс. ціна ${made.facts[1].value}, інвалідація ${made.facts[2].value}, плановий ризик ${made.facts[3].value} у бюджеті ${made.facts[4].value}, розмір ${made.facts[5].value} ${plan.asset.symbol}; ${rules.entry.validUntil ? `дійсний до ${whenText(rules.entry.validUntil, locale)}` : "без терміну"}.`), [made.cite]),
    ];
    if (plan.versions.length > 1) {
      const previous = plan.versions[plan.versions.length - 2];
      notes.push(note("observation", w(locale, `Version ${plan.version} was written ${whenText(plan.current.createdAt, locale)}${plan.current.reason ? ` — “${plan.current.reason}”` : ""}; version ${previous.version} stood before it.`, `Версію ${plan.version} записано ${whenText(plan.current.createdAt, locale)}${plan.current.reason ? ` — «${plan.current.reason}»` : ""}; до неї стояла версія ${previous.version}.`), [made.cite]));
    }
    if (expired) notes.push(note("meaning", w(locale, `The entry window has passed: the Review refuses this version until you write a new one with a new validity.`, `Вікно входу минуло: Review відмовляє цій версії, доки ти не запишеш нову з новим терміном.`), [made.cite]));
    const latest = read.reviews.length > 0 ? read.reviews[read.reviews.length - 1] : null;
    if (latest) {
      const failed = latest.checks.filter((check) => check.outcome !== "pass");
      const said = failed.slice(0, 5).map((check) => `${checkWord(check.id, locale)} (${check.outcome === "fail" ? w(locale, "failed", "не пройшла") : w(locale, "unknown", "невідомо")}: ${w(locale, "expected", "очікувалось")} ${check.expected}${check.actual ? `, ${w(locale, "found", "знайдено")} ${check.actual}` : ""})`).join("; ");
      notes.push(note("observation", latest.verdict === "ready" ? w(locale, `The latest Review (${whenText(latest.checkedAt, locale)}) found every check passing at ${usdText(latest.quote.perShareUsd, locale)} per unit.`, `Останній Review (${whenText(latest.checkedAt, locale)}) знайшов усі перевірки пройденими за ${usdText(latest.quote.perShareUsd, locale)} за одиницю.`) : w(locale, `The latest Review (${whenText(latest.checkedAt, locale)}) was ${latest.verdict}: ${said}.`, `Останній Review (${whenText(latest.checkedAt, locale)}) — ${latest.verdict === "blocked" ? "заблоковано" : "увага"}: ${said}.`), [made.cite]));
      if (latest.verdict === "blocked") notes.push(note("meaning", w(locale, `A required check failed or could not be judged, so that order could not pass this version; a Review on a fresh quote decides again.`, `Обов'язкова перевірка не пройшла або не оцінена, тож той ордер не міг пройти цю версію; Review на свіжому котируванні вирішує знову.`), [made.cite]));
    }
    const monitoring = await ctx.readers.monitoring(ctx.owner, locale);
    const notesOnPlan = monitoring.recent.filter((row) => row.subject?.id === plan.id).slice(0, 3);
    for (const row of notesOnPlan) {
      const cite = ctx.citations.add({ tool: "monitoring_read", source: w(locale, "Monitoring note", "Нотатка Нагляду"), observedAt: row.finding?.facts.observedAt ?? row.createdAt, state: "current", ref: row.id, href: row.href });
      notes.push(note("observation", w(locale, `Monitoring wrote ${whenText(row.createdAt, locale)}: ${row.title} — ${row.reason}`, `Нагляд записав ${whenText(row.createdAt, locale)}: ${row.title} — ${row.reason}`), [cite.id]));
    }
    if (plan.executions.length > 0) notes.push(note("observation", w(locale, `${plan.executions.length} execution${plan.executions.length === 1 ? "" : "s"} recorded under this plan.`, `Під цим планом записано ${plan.executions.length} ${plan.executions.length === 1 ? "виконання" : "виконань"}.`), [made.cite]));
    notes.push(note("counter", w(locale, `A note or a Review describes the moment it was written; whether the condition still holds is decided on a fresh read, not on the note.`, `Нотатка чи Review описують момент запису; чи тримається умова досі, вирішує свіже читання, а не нотатка.`), [made.cite]));
    notes.push(note("checks", w(locale, `The market against the invalidation ${made.facts[2].value} and the max price ${made.facts[1].value}; the entry window; the evidence conditions the version carries.`, `Ринок проти інвалідації ${made.facts[2].value} і макс. ціни ${made.facts[1].value}; вікно входу; умови доказів, які несе версія.`), [made.cite]));
    const handoffs: AgentHandoff[] = [
      { kind: "plan", href: `/app/strategies/plans/${plan.id}`, label: w(locale, `Open the ${plan.asset.symbol} plan`, `Відкрити план ${plan.asset.symbol}`), primary: true },
      { kind: "review", href: `/app/spot?view=${planAssetKind(plan.asset)}&mint=${plan.asset.mint}&plan=${plan.id}&v=${plan.version}`, label: w(locale, "Review under this plan", "Review під цим планом"), primary: false },
    ];
    return { tool: "plan_read", kind: "research", outcome: "ok", state: "current", facts: made.facts, notes, cards: [made.card], handoffs, draft: null };
  },
};

export const resultsRead: AgentTool<typeof PlanInput> = {
  name: "results_read",
  kind: "research",
  description: "Plan · Before signing · Actual for the executions made under a plan (or across the wallet's plans): the version, the Review that stood before the signature, the settled row and the verdict about the entry.",
  input: PlanInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const listed = await ctx.readers.plans(ctx.owner);
    const target = input.planId ? listed.plans.find((plan) => plan.id === input.planId) ?? null : input.symbol ? listed.plans.find((plan) => plan.asset.symbol.toLowerCase() === input.symbol!.toLowerCase()) ?? null : null;
    const plans = target ? [target] : listed.plans.slice(0, 5);
    const results: { plan: TradingPlan; rows: readonly PlanResult[] }[] = [];
    for (const plan of plans) {
      const read = await ctx.readers.planResults(ctx.owner, plan.id);
      if (read.ok && read.results.length > 0) results.push({ plan, rows: read.results });
    }
    const href = "/app/bots";
    if (results.length === 0) {
      const cite = ctx.citations.add({ tool: "results_read", source: w(locale, "Results", "Результати"), observedAt: new Date(ctx.nowMs).toISOString(), state: "current", ref: null, href });
      return { ...emptyRun("results_read", "research", "empty", "current"), notes: [note("observation", w(locale, "No execution has been made under a plan yet, so there is no Plan vs Actual to read.", "Під планом ще не було виконання, тож Plan vs Actual читати нема чого."), [cite.id])], handoffs: [{ kind: "results", href, label: w(locale, "Open Results", "Відкрити Результати"), primary: false }] };
    }
    const notes: ToolNote[] = [];
    const facts: ToolFact[] = [];
    const cites: string[] = [];
    for (const entry of results) {
      const cite = ctx.citations.add({ tool: "results_read", source: w(locale, `Results · ${entry.plan.asset.symbol}`, `Результати · ${entry.plan.asset.symbol}`), observedAt: entry.rows[entry.rows.length - 1].actual.settledAt, state: "current", ref: entry.plan.id, href: `/app/strategies/plans/${entry.plan.id}` });
      cites.push(cite.id);
      for (const row of entry.rows.slice(-3)) {
        const actual = row.actual;
        const verdictWord = row.verdict === "followed" ? w(locale, "the entry followed the plan", "вхід відповідав плану") : row.verdict === "deviated" ? w(locale, "the entry deviated from the plan", "вхід відхилився від плану") : w(locale, "the entry could not be judged", "вхід не оцінити");
        facts.push(fact(figure({ label: w(locale, `${entry.plan.asset.symbol} actual per unit`, `${entry.plan.asset.symbol} фактично за одиницю`), number: actual.perShareUsd, kind: "usd", unit: "USD", state: actual.perShareUsd === null ? "unavailable" : "current", cite: cite.id }, locale), `${entry.plan.id}.actual.perShare`));
        notes.push(note("observation", w(locale, `${entry.plan.asset.symbol} v${row.version}: ${actual.outcome} at ${usdText(actual.perShareUsd, locale)} per unit for ${usdText(actual.usd, locale)} (${whenText(actual.settledAt, locale)}); ${verdictWord}.`, `${entry.plan.asset.symbol} v${row.version}: ${actual.outcome} за ${usdText(actual.perShareUsd, locale)} за одиницю на ${usdText(actual.usd, locale)} (${whenText(actual.settledAt, locale)}); ${verdictWord}.`), [cite.id]));
      }
    }
    notes.push(note("counter", w(locale, `A result says whether the entry followed the plan; it says nothing about profit, because the exit and the cost basis are not part of it.`, `Результат каже, чи вхід відповідав плану; про прибуток він мовчить, бо вихід і базис вартості не є його частиною.`), cites));
    return { tool: "results_read", kind: "research", outcome: "ok", state: "current", facts, notes, cards: [], handoffs: [{ kind: "results", href, label: w(locale, "Open Results", "Відкрити Результати"), primary: false }], draft: null };
  },
};

/* ------------------------------------------------------------ the history */

export const activityRead: AgentTool<z.ZodObject<{ limit: z.ZodDefault<z.ZodNumber> }>> = {
  name: "activity_read",
  kind: "research",
  description: "The wallet's own history — the recent operations as History records them: lane, outcome, what left and what arrived, when.",
  input: z.object({ limit: z.number().int().min(1).max(20).default(8) }).strict(),
  async run(input, ctx) {
    const locale = ctx.locale;
    const rows = [...(await ctx.readers.activity(ctx.owner))].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, input.limit);
    const href = "/app/activity";
    const cite = ctx.citations.add({ tool: "activity_read", source: w(locale, "History", "Історія"), observedAt: rows[0]?.updatedAt ?? new Date(ctx.nowMs).toISOString(), state: "current", ref: null, href });
    if (rows.length === 0) return { ...emptyRun("activity_read", "research", "empty", "current"), notes: [note("observation", w(locale, "History holds no operation of this wallet yet.", "Історія ще не має операцій цього гаманця."), [cite.id])], handoffs: [{ kind: "portfolio", href, label: w(locale, "Open History", "Відкрити Історію"), primary: false }] };
    /* The lane and the outcome in the words History uses — never the stored
       codes (`SEND IN_FLIGHT`), which are the ledger's bookkeeping, not a
       sentence. */
    const laneWord = (lane: string): string =>
      ({ SEND: w(locale, "Send", "Переказ"), SWAP: w(locale, "Swap", "Обмін"), BRIDGE: w(locale, "Bridge", "Міст"), CROSS_SWAP: w(locale, "Bridge", "Міст"), RECEIVE: w(locale, "Receive", "Отримання") } as Record<string, string>)[lane] ?? w(locale, "Operation", "Операція");
    const outcomeWord = (outcome: string): string =>
      ({ IN_FLIGHT: w(locale, "pending", "очікує"), DONE: w(locale, "done", "виконано"), FAILED: w(locale, "failed", "не вдалося"), NEEDS_YOU: w(locale, "waiting for you", "чекає на тебе") } as Record<string, string>)[outcome] ?? w(locale, "unknown", "невідомо");
    const said = rows.slice(0, 5).map((row) => {
      const out = row.out ? `${row.out.symbol ?? "?"} ${row.out.decimals !== null && row.out.amountRaw ? decimalText(row.out.amountRaw, row.out.decimals) : ""}`.trim() : null;
      const inn = row.in ? `${row.in.symbol ?? "?"} ${row.in.decimals !== null && row.in.amountRaw ? decimalText(row.in.amountRaw, row.in.decimals) : ""}`.trim() : null;
      return `${laneWord(row.lane)}${out ? ` ${out}` : ""}${inn ? ` → ${inn}` : ""} — ${outcomeWord(row.outcome)} (${whenText(row.updatedAt, locale)})`;
    });
    const facts: ToolFact[] = [fact(figure({ label: w(locale, "Recent operations", "Останні операції"), number: rows.length, kind: "count", state: "current", cite: cite.id }, locale), "operations")];
    const inFlight = rows.filter((row) => row.outcome === "IN_FLIGHT").length;
    const notes: ToolNote[] = [note("observation", w(locale, `Recent operations: ${said.join("; ")}.`, `Останні операції: ${said.join("; ")}.`), [cite.id])];
    if (inFlight > 0) notes.push(note("risks", w(locale, `${inFlight} operation${inFlight === 1 ? " is" : "s are"} still in flight: the answer has not been read back yet, and an unknown is not a licence to send again.`, `${inFlight} ${inFlight === 1 ? "операція досі в дорозі" : "операцій досі в дорозі"}: відповідь ще не прочитана, і невідомість — не дозвіл відправити знову.`), [cite.id]));
    return { tool: "activity_read", kind: "research", outcome: "ok", state: "current", facts, notes, cards: [], handoffs: [{ kind: "portfolio", href, label: w(locale, "Open History", "Відкрити Історію"), primary: false }], draft: null };
  },
};

/* ------------------------------------------------------------ the watchlist */

export const watchlistRead: AgentTool<z.ZodObject<Record<string, never>>> = {
  name: "watchlist_read",
  kind: "research",
  description: "The proven wallet's watchlist — the mints it follows, with each one's market figures.",
  input: z.object({}).strict(),
  async run(_input, ctx) {
    const locale = ctx.locale;
    const mints = await ctx.readers.watchlist(ctx.owner);
    const cite = ctx.citations.add({ tool: "watchlist_read", source: w(locale, "Watchlist", "Список спостереження"), observedAt: new Date(ctx.nowMs).toISOString(), state: "current", ref: null, href: "/app/spot?view=watchlist" });
    if (mints.length === 0) return { ...emptyRun("watchlist_read", "research", "empty", "current"), notes: [note("observation", w(locale, "The watchlist is empty.", "Список спостереження порожній."), [cite.id])] };
    const runs: ToolRun[] = [];
    for (const mint of mints.slice(0, 5)) {
      const read = await ctx.readers.spotMarket(mint);
      if (read.ok && read.market) runs.push(marketRun(read.market, read.observedAt, read.stale, ctx));
    }
    return { tool: "watchlist_read", kind: "research", outcome: "ok", state: "current", facts: runs.flatMap((run) => run.facts), notes: [note("observation", w(locale, `The watchlist follows ${mints.length} token${mints.length === 1 ? "" : "s"}.`, `Список спостереження стежить за ${mints.length} ${mints.length === 1 ? "токеном" : "токенами"}.`), [cite.id]), ...runs.flatMap((run) => run.notes.filter((entry) => entry.section === "observation"))], cards: runs.flatMap((run) => run.cards).slice(0, 5), handoffs: [{ kind: "market", href: "/app/spot?view=watchlist", label: w(locale, "Open the watchlist", "Відкрити список спостереження"), primary: false }], draft: null };
  },
};

/* ------------------------------------------------------------ strategy memory (1.9.0) */

const MemoryInput = z.object({ symbol: z.string().min(1).max(32).optional(), planId: z.string().regex(PLAN_ID).optional() }).strict();

/**
 * What the product remembers about how this wallet decides.
 *
 * The tool reads memory; it cannot write it. There is no writer on the
 * reader seam at all, so the only way a fact reaches Ryn is by already being
 * true of a plan, a Review, an execution or a monitoring note the wallet
 * owns. Ryn may **summarise** those facts and must cite them; it can no more
 * invent a result here than it can invent a price.
 */
export const memoryRead: AgentTool<typeof MemoryInput> = {
  name: "memory_read",
  kind: "research",
  description: "Strategy memory for the proven wallet: how many plans were written on an asset, how many were reviewed and traded, which rule refused the rest, how an actual entry stood against the planned one, a position still open, an exit against the rules that existed before it, and what Monitoring wrote. Every fact cites the record it stands on; none can be written from here.",
  input: MemoryInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const href = "/app/bots";
    const read = await ctx.readers.planMemory(ctx.owner);
    const wanted = read.facts.filter((entry) => {
      if (input.planId) return entry.scope.planId === input.planId;
      if (input.symbol) return (entry.scope.symbol ?? "").toLowerCase() === input.symbol.toLowerCase();
      return true;
    });
    if (wanted.length === 0) {
      const cite = ctx.citations.add({ tool: "memory_read", source: w(locale, "Results", "Результати"), observedAt: new Date(ctx.nowMs).toISOString(), state: "current", ref: null, href });
      return {
        ...emptyRun("memory_read", "research", "empty", "current"),
        notes: [note("observation", w(locale, "There is nothing to remember yet: memory is made of your own plans, reviews and operations.", "Пам'ятати ще нема чого: пам'ять складається з твоїх планів, рев'ю та операцій."), [cite.id])],
        handoffs: [{ kind: "results", href, label: w(locale, "Open Results", "Відкрити Результати"), primary: false }],
      };
    }
    const notes: ToolNote[] = [];
    const facts: ToolFact[] = [];
    const cites: string[] = [];
    for (const entry of wanted.slice(0, 8)) {
      const first = entry.cites[0];
      const cite = ctx.citations.add({ tool: "memory_read", source: w(locale, `Memory · ${entry.scope.symbol ?? "wallet"}`, `Пам'ять · ${entry.scope.symbol ?? "гаманець"}`), observedAt: entry.observedAt, state: "current", ref: first?.id ?? null, href: first?.href ?? href });
      cites.push(cite.id);
      for (const value of entry.figures) {
        if (value.value === null && value.text === null) continue;
        facts.push(
          fact(
            figure(
              {
                label: memoryFigureLabel(value.key, locale),
                number: value.value,
                kind: value.unit === "usd" ? "usd" : value.unit === "pct" ? "pct" : value.unit === "count" ? "count" : "text",
                text: value.text === null ? undefined : memoryFigureText(value.key, value.text, locale),
                unit: value.unit === "usd" ? "USD" : value.unit === "pct" ? "%" : null,
                state: "current",
                cite: cite.id,
              },
              locale,
            ),
            memoryFactKey(entry.kind, entry.scope.symbol, entry.id, value.key),
          ),
        );
      }
      notes.push(note("observation", memoryNote(entry, locale), [cite.id]));
    }
    notes.push(note("counter", w(locale, "Memory describes what was recorded, not what will happen; a plan that worked once is not a reason for the next one.", "Пам'ять описує записане, а не майбутнє; план, що спрацював раз, не є підставою для наступного."), cites));
    return { tool: "memory_read", kind: "research", outcome: "ok", state: "current", facts, notes, cards: [], handoffs: [{ kind: "results", href, label: w(locale, "Open Results", "Відкрити Результати"), primary: false }], draft: null };
  },
};

/**
 * What a memory figure is called for a person, and what its word says. The
 * server files a fact under stable keys and stores the engine's own ids in
 * the `word` figures; a surface must show neither.
 */
function memoryFigureLabel(key: string, locale: Locale): string {
  const words: Readonly<Record<string, readonly [string, string]>> = {
    plans: ["Plans written", "Написано планів"],
    active: ["Live", "Активних"],
    reviewed: ["Reviewed", "Перевірено"],
    traded: ["Became trades", "Стали угодами"],
    rule: ["The rule that refused", "Правило, що відмовило"],
    bound: ["Its bound", "Його межа"],
    actual: ["Actual entry", "Фактичний вхід"],
    planned: ["Planned entry", "Плановий вхід"],
    diff: ["Difference", "Різниця"],
    unitsHeld: ["Units held", "Одиниць утримується"],
    costBasis: ["Cost basis", "Базис вартості"],
    price: ["Price", "Ціна"],
    verdict: ["Verdict", "Вердикт"],
    ruledByVersion: ["Judged by version", "Оцінено версією"],
    finding: ["What was watched", "За чим стежили"],
    outcome: ["What was found", "Що знайшли"],
  };
  const found = words[key];
  return found ? found[locale === "uk" ? 1 : 0] : key;
}

function memoryFigureText(key: string, text: string, locale: Locale): string {
  if (key === "rule") return checkWord(text as PlanReview["checks"][number]["id"], locale);
  if (key === "finding") return conditionKindWords(text, locale);
  if (key === "outcome") return findingOutcomeWords(text, locale);
  return text;
}

/** One memory fact as a sentence for the composer — built from its own figures, in the reader's language, never from prose the server stored. */
function memoryNote(entry: PlanMemoryFact, locale: Locale): string {
  const symbol = entry.scope.symbol ?? w(locale, "this wallet", "цей гаманець");
  const value = (key: string) => entry.figures.find((f) => f.key === key) ?? null;
  const n = (key: string) => value(key)?.value ?? null;
  const t = (key: string) => value(key)?.text ?? null;
  switch (entry.kind) {
    case "plans-written":
      return w(locale, `${n("plans") ?? 0} plan(s) written on ${symbol}, ${n("active") ?? 0} live.`, `${n("plans") ?? 0} план(ів) на ${symbol}, ${n("active") ?? 0} активних.`);
    case "trades-made":
      return w(locale, `On ${symbol}: ${n("reviewed") ?? 0} reviewed, ${n("traded") ?? 0} became trades.`, `По ${symbol}: ${n("reviewed") ?? 0} перевірено, ${n("traded") ?? 0} стали угодами.`);
    case "blocked-by-rule": {
      /* The rule is named the way a person reads it, never by the check's own id. */
      const rule = t("rule") === null ? "" : checkWord(t("rule")! as PlanReview["checks"][number]["id"], locale);
      return w(locale, `${n("plans") ?? 0} plan(s) on ${symbol} never traded: ${rule} (${t("bound") ?? "—"}) refused every Review.`, `${n("plans") ?? 0} план(ів) на ${symbol} так і не торгували: ${rule} (${t("bound") ?? "—"}) відмовило кожному Review.`);
    }
    case "entry-vs-plan":
      return w(
        locale,
        `The ${symbol} entry was ${usdText(n("actual"), locale)} against the planned ${usdText(n("planned"), locale)} — ${pctText(n("diff"), locale)}.`,
        `Вхід на ${symbol} був ${usdText(n("actual"), locale)} проти планових ${usdText(n("planned"), locale)} — ${pctText(n("diff"), locale)}.`,
      );
    case "position-open":
      return w(locale, `A ${symbol} position is open: ${unitsText(n("unitsHeld"), locale)} for ${usdText(n("costBasis"), locale)}.`, `Позиція на ${symbol} відкрита: ${unitsText(n("unitsHeld"), locale)} на ${usdText(n("costBasis"), locale)}.`);
    case "exit-adherence":
      return w(
        locale,
        `The ${symbol} exit at ${usdText(n("price"), locale)} was judged ${t("verdict") ?? "unknown"} against the rules of version ${n("ruledByVersion") ?? "—"}.`,
        `Вихід із ${symbol} за ${usdText(n("price"), locale)} оцінено як ${t("verdict") ?? "unknown"} проти правил версії ${n("ruledByVersion") ?? "—"}.`,
      );
    case "monitoring-said": {
      /* The engine's ids belong in the store: a reader is told what was watched and what was found. */
      const what = t("finding") === null ? "" : conditionKindWords(t("finding")!, locale);
      const how = t("outcome") === null ? "" : findingOutcomeWords(t("outcome")!, locale);
      return w(locale, `Monitoring wrote on ${symbol}: ${what} ${how}.`.replace(/\s+/g, " "), `Нагляд записав по ${symbol}: ${what} ${how}.`.replace(/\s+/g, " "));
    }
    default:
      return w(locale, `A fact about ${symbol}.`, `Факт про ${symbol}.`);
  }
}

/* ------------------------------------------------------------ monitoring */

const MonitoringInput = z.object({ inboxId: z.string().min(4).max(64).optional(), symbol: z.string().min(1).max(32).optional() }).strict();

export const monitoringRead: AgentTool<typeof MonitoringInput> = {
  name: "monitoring_read",
  kind: "research",
  description: "The monitoring surface of the proven wallet — what needs attention, what is watched, the recent notes with the exact record each is about and the finding as figures.",
  input: MonitoringInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const surface = await ctx.readers.monitoring(ctx.owner, locale);
    const href = "/app/alerts";
    const one = input.inboxId ? await ctx.readers.inboxNote(ctx.owner, input.inboxId) : null;
    const recent = one ? [one] : surface.recent.filter((row) => !input.symbol || row.title.toLowerCase().includes(input.symbol.toLowerCase()) || row.context.toLowerCase().includes(input.symbol.toLowerCase())).slice(0, 4);
    if (recent.length === 0 && surface.attention.length === 0 && surface.watching.length === 0) {
      const cite = ctx.citations.add({ tool: "monitoring_read", source: w(locale, "Monitoring", "Нагляд"), observedAt: new Date(ctx.nowMs).toISOString(), state: "current", ref: null, href });
      return { ...emptyRun("monitoring_read", "research", "empty", "current"), notes: [note("observation", w(locale, "Nothing is monitored for this wallet yet: a plan is what Monitoring watches.", "Для цього гаманця ще ніщо не моніториться: Нагляд стежить за планами."), [cite.id])], handoffs: [{ kind: "monitoring", href, label: w(locale, "Open Monitoring", "Відкрити Нагляд"), primary: false }] };
    }
    const cards: AgentCard[] = [];
    const notes: ToolNote[] = [];
    const facts: ToolFact[] = [];
    for (const row of recent) {
      const observedAt = row.finding?.facts.observedAt ?? row.createdAt;
      const cite = ctx.citations.add({ tool: "monitoring_read", source: w(locale, "Monitoring note", "Нотатка Нагляду"), observedAt, state: "current", ref: row.id, href: row.href });
      const facts0 = row.finding?.facts;
      /* A plan's note names its plan; autoinvest's notes — a rule's reminder (1.12.0), the month's budget (1.13.0) — are no plan's, so their cards name none. */
      const subject = row.subject && (row.subject.kind === "trading-plan" || row.subject.kind === "prediction-plan") ? { kind: row.subject.kind, id: row.subject.id } : null;
      cards.push({ kind: "note", inboxId: row.id, subject, title: row.title.slice(0, 200), reason: row.reason.slice(0, 600), createdAt: row.createdAt, finding: row.finding ? { kind: row.finding.kind, outcome: row.finding.outcome, observedAt: facts0?.observedAt ?? null } : null, cite: cite.id, href: row.href });
      if (facts0?.price !== undefined && facts0.price !== null) facts.push(fact(figure({ label: w(locale, "Price at the note", "Ціна на момент нотатки"), number: facts0.price, kind: "usd", unit: "USD", state: "current", cite: cite.id }, locale), `${row.id}.price`));
      if (facts0?.bound !== undefined && facts0.bound !== null) facts.push(fact(figure({ label: w(locale, "Plan's bound", "Межа плану"), number: facts0.bound, kind: "usd", unit: "USD", state: "current", cite: cite.id }, locale), `${row.id}.bound`));
      if (facts0?.invalidation !== undefined && facts0.invalidation !== null) facts.push(fact(figure({ label: w(locale, "Invalidation", "Інвалідація"), number: facts0.invalidation, kind: "usd", unit: "USD", state: "current", cite: cite.id }, locale), `${row.id}.invalidation`));
      notes.push(note("observation", w(locale, `The note of ${whenText(row.createdAt, locale)}${subject ? ` about ${subject.kind === "trading-plan" ? "the plan" : "the prediction plan"} ${subject.id.slice(0, 13)}…` : ""}: ${row.title} — ${row.reason}${facts0?.price !== undefined && facts0.price !== null ? ` (price then ${usdText(facts0.price, locale)}${facts0.bound !== undefined && facts0.bound !== null ? `, bound ${usdText(facts0.bound, locale)}` : ""}${facts0.invalidation !== undefined && facts0.invalidation !== null ? `, invalidation ${usdText(facts0.invalidation, locale)}` : ""})` : ""}.`, `Нотатка від ${whenText(row.createdAt, locale)}${subject ? ` про ${subject.kind === "trading-plan" ? "план" : "прогнозний план"} ${subject.id.slice(0, 13)}…` : ""}: ${row.title} — ${row.reason}${facts0?.price !== undefined && facts0.price !== null ? ` (ціна тоді ${usdText(facts0.price, locale)}${facts0.bound !== undefined && facts0.bound !== null ? `, межа ${usdText(facts0.bound, locale)}` : ""}${facts0.invalidation !== undefined && facts0.invalidation !== null ? `, інвалідація ${usdText(facts0.invalidation, locale)}` : ""})` : ""}.`), [cite.id]));
    }
    const attention = surface.attention.slice(0, 4);
    if (attention.length > 0) {
      const cite = ctx.citations.add({ tool: "monitoring_read", source: w(locale, "Monitoring surface", "Нагляд"), observedAt: new Date(ctx.nowMs).toISOString(), state: "current", ref: null, href });
      /* The label is dropped when the title already opens with it, so a person is not told the symbol twice. */
      const said = attention.map((card) => (card.title.toLowerCase().startsWith(card.label.toLowerCase()) ? card.title : `${card.label} — ${card.title}`)).join("; ");
      notes.push(note("meaning", w(locale, `Needs attention now: ${said}.`, `Потребує уваги зараз: ${said}.`), [cite.id]));
    }
    if (recent.length > 0) {
      const cites = cards.map((card) => (card.kind === "note" ? card.cite : "c1"));
      notes.push(note("counter", w(locale, `A note records the condition at the moment it was checked; it is not a current authorization and does not say the condition still holds — the fresh Review decides.`, `Нотатка фіксує умову в момент перевірки; це не поточний дозвіл і не твердження, що умова досі тримається — вирішує свіжий Review.`), cites));
      notes.push(note("checks", w(locale, `The plan's page for the version the note is about, and the market now against the figures in the note.`, `Сторінка плану для версії, про яку нотатка, і ринок зараз проти цифр у нотатці.`), cites));
    }
    const handoffs: AgentHandoff[] = [{ kind: "monitoring", href, label: w(locale, "Open Monitoring", "Відкрити Нагляд"), primary: false }];
    for (const card of cards.slice(0, 1)) if (card.kind === "note" && card.subject?.kind === "trading-plan") handoffs.unshift({ kind: "plan", href: card.href, label: w(locale, "Open the plan of this note", "Відкрити план цієї нотатки"), primary: true });
    return { tool: "monitoring_read", kind: "research", outcome: "ok", state: "current", facts, notes, cards, handoffs, draft: null };
  },
};

export const RESEARCH_TOOLS = [marketRead, stockRead, evidenceRead, holdingsRead, plansRead, planRead, resultsRead, memoryRead, activityRead, watchlistRead, monitoringRead] as const;

export { resolveAsset };
export type { ResolvedAsset };
