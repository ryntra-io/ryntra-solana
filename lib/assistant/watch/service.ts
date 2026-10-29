/**
 * «Стежити за токеном» as the person's page and phone read and write it
 * (AI-05): the watches with what each reads now and its latest note, the
 * presets, how many of the three free watches are left; start a watch from a
 * preset or a rule, pause, resume, change or remove it. Writes only the
 * proven wallet's own watches; the pass that judges them is `run.ts`.
 */

import type { AssistantWatch, AssistantWatchCreate, AssistantWatchesResponse, AssistantWatchUpdate } from "../../api/v1/contract.ts";
import type { GuardStore } from "../../guard/store.ts";
import { readPreferences } from "../../monitoring/store.ts";
import { judgeWatch } from "./evaluate.ts";
import { DELIVERIES_PER_HOUR, FREE_WATCHES, PRESET_WORDS, presetRule, pctSigned, ruleWords, usd, usdShort, WATCH_LIMIT, WATCH_PRESETS, windowWords, type WatchLocale, type WatchRule } from "./rules.ts";
import { listWatches, newWatchId, readMarket, readWatch, deleteWatch, writeWatch, type MarketRecord, type WatchRecord } from "./store.ts";
import { explainQuestion, noteWords } from "./words.ts";

/** What the catalogue knows of a mint: its ticker, whether Jupiter calls it suspicious, its price now. */
export type TokenFacts = Readonly<{ symbol: string; suspicious: boolean; priceUsd: number | null; /** Jupiter Price v3 prices it — a price level is judged on Jupiter's price only. */ priced?: boolean }>;
export type TokenLookup = (mint: string) => Promise<TokenFacts | null>;

export type WatchFailure = Readonly<{ ok: false; code: "VALIDATION_ERROR" | "WATCH_NOT_FOUND" | "WATCH_LIMIT_REACHED" | "WATCH_VERSION_CONFLICT" | "ASSET_UNCONFIRMED" | "PRICE_UNAVAILABLE" | "UNAVAILABLE"; reason: string }>;
export type WatchWrite = Readonly<{ ok: true; watch: WatchRecord }> | WatchFailure;

/** The figure a rule reads now, said for a card: «−3,2 % за добу», «$182,40», «обсяг ×1,4», «ліквідність $2,1 млн». */
function nowText(rule: WatchRule, value: number, beside: number | null, locale: WatchLocale): string {
  const uk = locale === "uk";
  switch (rule.kind) {
    case "price":
      return usd(value, locale);
    case "move":
      return uk ? `${pctSigned(value, locale)} за ${windowWords(rule.window, locale)}` : `${pctSigned(value, locale)} in ${windowWords(rule.window, locale)}`;
    case "volume":
      return uk ? `обсяг ×${value.toLocaleString("uk-UA", { maximumFractionDigits: 1 })}` : `volume ×${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
    case "liquidity":
      return `${pctSigned(value, locale)} · ${beside !== null ? usdShort(beside, locale) : "—"}`;
  }
}

/** A watch as a reader sees it, judged against the token's latest read without writing anything. */
export function watchView(watch: WatchRecord, market: MarketRecord | null, nowMs: number, locale: WatchLocale, explainPrice: number): AssistantWatch {
  const judged = watch.status === "active" ? judgeWatch({ watchId: watch.id, rule: watch.rule, state: watch.state, cooldownMinutes: watch.cooldownMinutes, read: market?.read, samples: market?.samples ?? [], nowMs }) : null;
  const state: AssistantWatch["now"]["state"] =
    watch.status === "paused"
      ? "paused"
      : judged?.outcome === "unread" || judged?.outcome === "learning"
        ? judged.outcome
        : judged?.outcome === "cooling"
          ? "cooling"
          : watch.state.armed
            ? "armed"
            : "rang";
  const figure = judged?.figure ?? null;
  const lastWords = watch.last ? noteWords(watch.rule, watch.symbol, watch.last.figure, locale) : null;
  return {
    id: watch.id,
    version: watch.version,
    mint: watch.mint,
    symbol: watch.symbol,
    rule: watch.rule,
    ruleText: ruleWords(watch.rule, locale),
    status: watch.status,
    cooldownMinutes: watch.cooldownMinutes,
    channels: watch.channels,
    now: { state, text: figure ? nowText(watch.rule, figure.value, figure.beside, locale) : null, source: figure?.source ?? null, observedAt: figure?.observedAt ?? market?.read.observedAt ?? null },
    last: watch.last && lastWords ? { at: watch.last.at, title: lastWords.title, reason: lastWords.reason, inboxId: watch.last.inboxId } : null,
    explain: lastWords ? { question: explainQuestion(lastWords, locale), priceCredits: explainPrice } : null,
    createdAt: watch.createdAt,
    updatedAt: watch.updatedAt,
  };
}

export async function readWatchSurface(store: GuardStore, owner: string, nowMs: number, locale: WatchLocale, explainPrice: number): Promise<AssistantWatchesResponse> {
  const watches = await listWatches(store, owner);
  const markets = new Map<string, MarketRecord | null>();
  for (const mint of new Set(watches.map((watch) => watch.mint))) markets.set(mint, await readMarket(store, mint));
  const prefs = await readPreferences(store, owner);
  return {
    watches: watches.map((watch) => watchView(watch, markets.get(watch.mint) ?? null, nowMs, locale, explainPrice)),
    limit: { free: FREE_WATCHES, used: watches.length, left: Math.max(0, WATCH_LIMIT - watches.length) },
    presets: WATCH_PRESETS.map((id) => ({ id, text: PRESET_WORDS[id][locale] })),
    explainPriceCredits: explainPrice,
    channels: { inbox: true, telegram: prefs.telegram, push: prefs.push },
    deliveriesPerHour: DELIVERIES_PER_HOUR,
  };
}

const sameRule = (a: WatchRule, b: WatchRule) => JSON.stringify(a) === JSON.stringify(b);

export async function createWatch(store: GuardStore, owner: string, input: Required<Omit<AssistantWatchCreate, "preset" | "rule">> & Pick<AssistantWatchCreate, "preset" | "rule">, nowMs: number, lookup: TokenLookup): Promise<WatchWrite> {
  const existing = await listWatches(store, owner);
  if (existing.length >= WATCH_LIMIT) return { ok: false, code: "WATCH_LIMIT_REACHED", reason: `${FREE_WATCHES} watches are free and that is the ceiling for now; remove one first.` };
  const token = await lookup(input.mint).catch(() => undefined);
  if (token === undefined) return { ok: false, code: "UNAVAILABLE", reason: "The token catalogue did not answer; try again in a moment." };
  if (token === null) return { ok: false, code: "ASSET_UNCONFIRMED", reason: "Jupiter's catalogue does not know this mint." };
  if (token.suspicious) return { ok: false, code: "ASSET_UNCONFIRMED", reason: "Jupiter marks this token as suspicious." };
  const unpriced = { ok: false, code: "PRICE_UNAVAILABLE", reason: "Jupiter does not price this token, so a price level cannot be watched; watch a move in % instead." } as const;
  /* A level preset on a token Jupiter does not price is told so at once — not sent to «Детально» to be refused again. */
  if (token.priced === false && (input.preset === "below" || input.preset === "above")) return unpriced;
  const rule = input.rule ?? (input.preset ? presetRule(input.preset, token.priceUsd) : null);
  if (!rule) return { ok: false, code: "PRICE_UNAVAILABLE", reason: "The price could not be read now, so a level cannot be set from it; name the level yourself." };
  if (rule.kind === "price" && token.priced === false) return unpriced;
  if (existing.some((watch) => watch.mint === input.mint && sameRule(watch.rule, rule))) return { ok: false, code: "VALIDATION_ERROR", reason: "You already watch this token by this rule." };
  const at = new Date(nowMs).toISOString();
  const watch: WatchRecord = {
    schema: "ryntra.assistant.watch",
    version: 1,
    id: newWatchId(),
    owner,
    mint: input.mint,
    symbol: token.symbol && token.symbol !== "?" ? token.symbol.slice(0, 32) : input.mint.slice(0, 4),
    rule,
    status: "active",
    cooldownMinutes: input.cooldownMinutes,
    channels: input.channels,
    locale: input.locale,
    /* Armed from the start: a threshold already crossed rings on the next pass — the person learns where it stands. */
    state: { armed: true, armedSince: at, lastFiredAt: null },
    last: null,
    fired: 0,
    createdAt: at,
    updatedAt: at,
  };
  if (!(await writeWatch(store, watch, null))) return { ok: false, code: "UNAVAILABLE", reason: "The watch could not be written; try again." };
  /* Two tabs at once could pass the count together: the later one gives its watch back. */
  const after = await listWatches(store, owner);
  if (after.length > WATCH_LIMIT && after.findIndex((row) => row.id === watch.id) >= WATCH_LIMIT) {
    await deleteWatch(store, owner, watch.id);
    return { ok: false, code: "WATCH_LIMIT_REACHED", reason: `${FREE_WATCHES} watches are free and that is the ceiling for now; remove one first.` };
  }
  return { ok: true, watch };
}

export async function updateWatch(store: GuardStore, owner: string, id: string, input: AssistantWatchUpdate, nowMs: number): Promise<WatchWrite> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const found = await readWatch(store, owner, id);
    if (!found) return { ok: false, code: "WATCH_NOT_FOUND", reason: "No watch of this wallet has that id." };
    if (input.ifVersion !== undefined && input.ifVersion !== found.version) return { ok: false, code: "WATCH_VERSION_CONFLICT", reason: "The watch changed meanwhile; read it again." };
    const at = new Date(nowMs).toISOString();
    const ruleChanged = input.rule !== undefined && !sameRule(input.rule, found.rule);
    const resumed = input.status === "active" && found.status === "paused";
    const nothing = !ruleChanged && (input.status ?? found.status) === found.status && (input.cooldownMinutes ?? found.cooldownMinutes) === found.cooldownMinutes && JSON.stringify(input.channels ?? found.channels) === JSON.stringify(found.channels);
    if (nothing) return { ok: true, watch: found };
    const next: WatchRecord = {
      ...found,
      version: found.version + 1,
      rule: input.rule ?? found.rule,
      status: input.status ?? found.status,
      cooldownMinutes: input.cooldownMinutes ?? found.cooldownMinutes,
      channels: input.channels ?? found.channels,
      /* A changed rule is a new watch in all but its id; a resumed one is armed afresh but keeps its pause between alerts, so pausing is no way round it. */
      state: ruleChanged ? { armed: true, armedSince: at, lastFiredAt: null } : resumed ? { armed: true, armedSince: at, lastFiredAt: found.state.lastFiredAt } : found.state,
      last: ruleChanged ? null : found.last,
      updatedAt: at,
    };
    if (await writeWatch(store, next, found.version)) return { ok: true, watch: next };
    if (input.ifVersion !== undefined) return { ok: false, code: "WATCH_VERSION_CONFLICT", reason: "The watch changed meanwhile; read it again." };
  }
  return { ok: false, code: "UNAVAILABLE", reason: "The watch kept changing meanwhile; try again." };
}

export async function removeWatch(store: GuardStore, owner: string, id: string): Promise<WatchFailure | Readonly<{ ok: true }>> {
  const found = await readWatch(store, owner, id);
  if (!found) return { ok: false, code: "WATCH_NOT_FOUND", reason: "No watch of this wallet has that id." };
  await deleteWatch(store, owner, id);
  return { ok: true };
}
