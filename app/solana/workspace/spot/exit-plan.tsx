"use client";

import { Button } from "@ryntra/core/ui";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { explorerTxUrl } from "@/lib/solana/explorer";
import { classifySpotFill } from "@/lib/solana/fill-outcome";
import {
  EXIT_PRESETS,
  EXIT_STORAGE_PREFIX,
  EXIT_PRICE_MAX_AGE_MS,
  EXIT_TP_MAX,
  armExitPlan,
  cancelExitPlan,
  exitDraftErrors,
  exitPlanWrites,
  latestPlanFor,
  legSale,
  levelPastNow,
  levelUsd,
  observeExitPlan,
  openPlanFor,
  planOpen,
  readExitPlans,
  readyLegs,
  remainingRaw,
  settleLeg,
  typedPct,
  type ExitDraft,
  type ExitDraftError,
  type ExitLeg,
  type ExitPlan,
  type LegAnswer,
  type LegSale,
} from "@/lib/spot/meme-exits";
import { QUICK_SELL_SHARES_PCT, quickShareRaw } from "@/lib/spot/quick-trade";

import { QuickBuy, QuickSell } from "./quick-buy.tsx";
import { formatAmount, formatUsdPrice, rawToNumber } from "./spot-format.ts";

import styles from "./exit-plan.module.css";

/**
 * «Швидка торгівля» on a token's page (SOL-R2): the person's quick sums and
 * shares, each one tap to the exact Review of the ticket beside it — the
 * wallet signs there or nothing moves — and «План виходу»: take profit at up
 * to three levels with a share each, a stop loss and a trailing stop.
 *
 * The plan is an intent on this device (`lib/spot/meme-exits.ts`): set after
 * its own Review, with a receipt, and watched while the page is open. A level
 * reached offers its sale as one more tap to the same exact Review; nothing is
 * signed ahead and nothing sells by itself. A sale sent and not yet answered
 * is said as exactly that — never as sold, never as nothing sent.
 */

type Lang = "en" | "uk";

const WORDS = {
  en: {
    title: "Quick trade",
    oneTap: "One tap opens the Review. Your wallet signs.",
    planTitle: "Exit plan",
    planNone: "Take profit, stop loss and a trailing stop — your wallet signs each sale.",
    planNoHolding: "Buy the token to set an exit plan.",
    planConnect: "Connect a wallet to set an exit plan.",
    set: "Set TP/SL",
    presetHalf: "Half at 2×",
    presetLadder: "Ladder",
    tp: "Take profit",
    sl: "Stop loss",
    trail: "Trailing stop",
    rise: "Rise, %",
    share: "Sell, %",
    fall: "Fall, %",
    fromPeak: "Fall from the high, %",
    addTp: "Add a level",
    removeTp: "Remove level",
    review: "Review plan",
    back: "Back",
    arm: "Turn plan on",
    off: "Turn plan off",
    reviewTitle: (symbol: string) => `Exit plan for ${symbol}`,
    covers: "Covers",
    coversValue: (amount: string) => `${amount} · all you can sell now`,
    entry: "Price when set",
    sellShare: (pct: number) => `sell ${pct}%`,
    sellRest: "sell the rest",
    fromHigh: (pct: number) => `−${pct}% from the high`,
    costs: "Plan cost",
    costsValue: "None · each sale's fees in its Review",
    signs: "Who sells",
    signsValue: "You, signing each sale",
    watches: "Watches",
    watchesValue: "This page, on this device, while open",
    whatItIs: "An intent, not an order: nothing is signed ahead.",
    risk: "The price can pass a level between reads; a sale goes at its Review's price.",
    pageOnly: "Watches only while this page is open — closed page, nothing watches, nothing sells.",
    receiptTitle: (symbol: string) => `Exit plan · ${symbol}`,
    watching: "Watching on this device",
    checking: "A sale is waiting for its answer",
    setAt: "Set",
    soldSoFar: "Sold by the plan",
    planId: "Plan",
    finished: "Finished",
    turnedOff: "Turned off",
    download: "Download receipt",
    stale: "The price has not updated for over a minute — levels are not checked.",
    reached: (what: string, price: string) => `${what} reached at ${price}`,
    priceNow: (price: string) => `Price now: ${price}`,
    backBelow: "Price is back below this level now.",
    backAbove: "Price is back above this level now.",
    saleOf: (amount: string) => `Sale: ${amount}`,
    capped: "Your wallet holds less than the plan: the sale covers what it holds.",
    missed: "The last sale did not go through — only a network fee may have been spent.",
    reviewSale: "Review sale",
    sent: "Sale signed — its answer is not known yet. Check it before you sell again.",
    check: "Check by signature",
    explorer: "Open in explorer",
    stillPending: "Still no answer from the chain — check again in a moment.",
    checkFailed: "Could not check right now — try again, or open it in the explorer.",
    states: { armed: "watching", ready: "ready", sent: "signed, answer unknown", sold: "sold", closed: "nothing left", cancelled: "off" },
    errors: {
      EMPTY: "Set at least one level.",
      TP_COUNT: "Up to three take-profit levels.",
      TP_MOVE: "A rise is a whole number from 1 to 10,000%.",
      TP_SHARE: "A share is a whole number from 1 to 100%.",
      TP_ORDER: "Each take profit is higher than the one before.",
      TP_SHARES_OVER: "The take profits sell more than 100% together.",
      SL_MOVE: "A stop loss is a fall from 1 to 99%.",
      TRAIL_MOVE: "A trailing stop is a fall from 1 to 90%.",
    } satisfies Record<ExitDraftError, string>,
    armErrors: { NO_HOLDING: "Your wallet holds none of this token.", NO_PRICE: "No price to measure from — try again in a moment.", STALE_PRICE: "The price is over a minute old — wait for a fresh one.", DRAFT: "Fix the plan first.", TAKEN: "A plan for this token is already on — turn it off first." },
    level: (what: string, move: string) => `${what} ${move}`,
  },
  uk: {
    title: "Швидка торгівля",
    oneTap: "Один дотик відкриває Review. Підписує твій гаманець.",
    planTitle: "План виходу",
    planNone: "Тейк-профіт, стоп-лос і трейлінг — кожен продаж підписує твій гаманець.",
    planNoHolding: "Купи токен — тоді задаси план виходу.",
    planConnect: "Підключи гаманець, щоб задати план виходу.",
    set: "Задати TP/SL",
    presetHalf: "Половина на 2×",
    presetLadder: "Драбина",
    tp: "Тейк-профіт",
    sl: "Стоп-лос",
    trail: "Трейлінг-стоп",
    rise: "Ріст, %",
    share: "Продати, %",
    fall: "Падіння, %",
    fromPeak: "Падіння від максимуму, %",
    addTp: "Додати рівень",
    removeTp: "Прибрати рівень",
    review: "Переглянути план",
    back: "Назад",
    arm: "Увімкнути план",
    off: "Вимкнути план",
    reviewTitle: (symbol: string) => `План виходу для ${symbol}`,
    covers: "Покриває",
    coversValue: (amount: string) => `${amount} · усе, що можна продати зараз`,
    entry: "Ціна на момент плану",
    sellShare: (pct: number) => `продати ${pct} %`,
    sellRest: "продати решту",
    fromHigh: (pct: number) => `−${pct} % від максимуму`,
    costs: "Ціна плану",
    costsValue: "Нуль · комісії продажу — у його Review",
    signs: "Хто продає",
    signsValue: "Ти, підписом кожного продажу",
    watches: "Стежить",
    watchesValue: "Ця сторінка на цьому пристрої, поки відкрита",
    whatItIs: "Намір, не ордер: наперед нічого не підписано.",
    risk: "Ціна може пройти рівень між зчитуваннями; продаж — за ціною свого Review.",
    pageOnly: "Стежить, лише поки сторінка відкрита: закрили — ніхто не стежить і нічого не продає.",
    receiptTitle: (symbol: string) => `План виходу · ${symbol}`,
    watching: "Стежить на цьому пристрої",
    checking: "Продаж чекає відповіді",
    setAt: "Задано",
    soldSoFar: "Продано за планом",
    planId: "План",
    finished: "Завершено",
    turnedOff: "Вимкнено",
    download: "Завантажити квитанцію",
    stale: "Ціна не оновлювалась понад хвилину — рівні не перевіряються.",
    reached: (what: string, price: string) => `${what}: досягнуто на ${price}`,
    priceNow: (price: string) => `Ціна зараз: ${price}`,
    backBelow: "Ціна вже знову нижче цього рівня.",
    backAbove: "Ціна вже знову вище цього рівня.",
    saleOf: (amount: string) => `Продаж: ${amount}`,
    capped: "У гаманці менше, ніж у плані: продаж — на те, що є.",
    missed: "Минулий продаж не відбувся — могла піти лише комісія мережі.",
    reviewSale: "Переглянути продаж",
    sent: "Продаж підписано — відповіді ще немає. Перевір його, перш ніж продавати знову.",
    check: "Перевірити за підписом",
    explorer: "Відкрити в оглядачі",
    stillPending: "Ланцюг ще не відповів — перевір за мить.",
    checkFailed: "Зараз не вдалося перевірити — спробуй ще або відкрий в оглядачі.",
    states: { armed: "стежить", ready: "готовий", sent: "підписано, відповіді немає", sold: "продано", closed: "нічого не лишилось", cancelled: "вимкнено" },
    errors: {
      EMPTY: "Задай хоча б один рівень.",
      TP_COUNT: "До трьох рівнів тейк-профіту.",
      TP_MOVE: "Ріст — ціле число від 1 до 10 000 %.",
      TP_SHARE: "Частка — ціле число від 1 до 100 %.",
      TP_ORDER: "Кожен тейк-профіт вищий за попередній.",
      TP_SHARES_OVER: "Тейк-профіти разом продають понад 100 %.",
      SL_MOVE: "Стоп-лос — падіння від 1 до 99 %.",
      TRAIL_MOVE: "Трейлінг — падіння від 1 до 90 %.",
    } satisfies Record<ExitDraftError, string>,
    armErrors: { NO_HOLDING: "У гаманці немає цього токена.", NO_PRICE: "Немає ціни, від якої міряти, — спробуй за мить.", STALE_PRICE: "Ціні понад хвилину — дочекайся свіжої.", DRAFT: "Спершу виправ план.", TAKEN: "План для цього токена вже ввімкнено — спершу вимкни його." },
    level: (what: string, move: string) => `${what} ${move}`,
  },
} as const;

/* ------------------------------------------------------------ the plans on this device */

/** This page's own name among the tabs: a level's sale on this tab's Review is held under it. */
export const TAB_ID = `tab-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

const CHANGED = "ryntra:exit-plans";
/* What a device that refuses storage was told to keep, key by key (null — removed): it wins until the page is left. */
const memory = new Map<string, string | null>();
let cachedText: string | undefined;
let cachedPlans: readonly ExitPlan[] = [];

function storedEntries(): Map<string, string> {
  const entries = new Map<string, string>();
  try {
    const store = window.localStorage;
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key || !key.startsWith(EXIT_STORAGE_PREFIX)) continue;
      const value = store.getItem(key);
      if (value !== null) entries.set(key, value);
    }
  } catch {
    /* Storage refused: only what this page kept in memory. */
  }
  for (const [key, value] of memory) {
    if (value === null) entries.delete(key);
    else entries.set(key, value);
  }
  return entries;
}

const plansOf = (entries: Map<string, string>): ExitPlan[] => readExitPlans((key) => entries.get(key) ?? null, [...entries.keys()].sort());

/** The plans as storage holds them at this moment — read again, never the page's last snapshot. */
export function readPlansNow(): ExitPlan[] {
  return plansOf(storedEntries());
}

function snapshot(): readonly ExitPlan[] {
  const entries = storedEntries();
  const text = [...entries.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, value]) => `${key}=${value}`).join("\n");
  if (text !== cachedText) {
    cachedText = text;
    cachedPlans = plansOf(entries);
  }
  return cachedPlans;
}

const EMPTY: readonly ExitPlan[] = [];

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(EXIT_STORAGE_PREFIX)) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGED, onChange);
  };
}

/**
 * One change to the plans: read again from storage at the moment of the
 * change, and only the keys the change moved are written — a level this tab
 * did not move is never written, so another tab's level stays as it left it.
 */
export function changePlans(change: (plans: readonly ExitPlan[]) => readonly ExitPlan[]): void {
  const before = readPlansNow();
  const after = change(before);
  if (after === before) return;
  for (const [key, value] of exitPlanWrites(before, after)) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
      memory.delete(key);
    } catch {
      memory.set(key, value);
    }
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Every plan on this device, and one change to them. */
export function useExitPlans(): readonly [readonly ExitPlan[], typeof changePlans] {
  const plans = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  return [plans, changePlans] as const;
}

/** One plan replaced by its new state, the rest untouched. */
export function replacePlan(plans: readonly ExitPlan[], next: ExitPlan): readonly ExitPlan[] {
  let changed = false;
  const out = plans.map((plan) => {
    if (plan.id !== next.id) return plan;
    changed = plan !== next;
    return next;
  });
  return changed ? out : plans;
}

/**
 * The wallet's open plan on this token, watched against every fresh price the
 * page reads: the levels it reaches turn ready. A read counts once, when it
 * arrives, timed by this device's clock (a server's clock that runs apart
 * from it can neither make an old read look new nor a new one look old), and
 * only when the server says it is newer than the last one counted and not
 * stale. Its latest plan (open or not) stays for its receipt.
 */
export function useTokenExitPlan(owner: string | null, mint: string | null, priceUsd: number | null, serverAt: number | null, serverStale: boolean, now: number) {
  const [plans, update] = useExitPlans();
  const open = owner && mint ? openPlanFor(plans, owner, mint) : null;
  const latest = owner && mint ? latestPlanFor(plans, owner, mint) : null;
  /* The read the page holds: its price and when it arrived here; null until a fresh, newer read arrives. */
  const [read, setRead] = useState<Readonly<{ mint: string; price: number; at: number; serverAt: number }> | null>(null);
  /* The smallest gap seen between this device's clock and a read's server time: the clocks' difference plus the least
     age a read has had. A read's age is how far its own gap exceeds that — a cached answer counts as old as it is. */
  const leastGap = useRef<Readonly<{ mint: string; gap: number }> | null>(null);
  useEffect(() => {
    if (!mint || priceUsd === null || !(priceUsd > 0) || serverAt === null || serverStale) return;
    const arrivedAt = Date.now();
    const gap = arrivedAt - serverAt;
    const least = leastGap.current && leastGap.current.mint === mint ? Math.min(leastGap.current.gap, gap) : gap;
    leastGap.current = { mint, gap: least };
    const age = gap - least;
    if (age > EXIT_PRICE_MAX_AGE_MS) return;
    setRead((current) => (current && current.mint === mint && current.serverAt >= serverAt ? current : { mint, price: priceUsd, at: arrivedAt - age, serverAt }));
  }, [mint, priceUsd, serverAt, serverStale]);
  /* A read of another token never speaks for this one. */
  const arrived = read && read.mint === mint ? read : null;
  const fresh = arrived !== null && now - arrived.at <= EXIT_PRICE_MAX_AGE_MS ? arrived : null;
  const stale = open !== null && open.legs.some((leg) => leg.state === "armed") && fresh === null;
  const openId = open?.id ?? null;
  useEffect(() => {
    if (!openId || !owner || !mint || !arrived) return;
    update((current) => {
      const plan = openPlanFor(current, owner, mint);
      if (!plan || plan.id !== openId) return current;
      const seen = observeExitPlan(plan, arrived.price, arrived.at, Date.now());
      return seen.plan === plan ? current : replacePlan(current, seen.plan);
    });
  }, [openId, owner, mint, arrived, update]);
  return { open, latest, stale, update, entry: fresh };
}

/**
 * A sent level's transaction read by its signature, through the same recovery
 * route the ticket uses — nothing is signed or sent again. Filled — sold;
 * rejected or never landed — not sold; anything else — still no answer.
 */
async function checkSentLeg(plan: ExitPlan, leg: ExitLeg): Promise<"settled" | "pending" | "failed"> {
  if (!leg.signature || !leg.requestId) return "failed";
  let body: Record<string, unknown>;
  try {
    const response = await fetch("/api/solana/swap/recover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature: leg.signature, owner: plan.owner, requestId: leg.requestId }) });
    body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok && response.status !== 202) return "failed";
  } catch {
    return "failed";
  }
  const state = typeof body.state === "string" ? body.state : "PENDING";
  const observation = (body.observation ?? null) as { actualInputRaw: string; actualOutputRaw: string } | null;
  const outcome = classifySpotFill({ state, observation, facts: (body.facts ?? null) as never, receipt: body.receipt ?? null });
  const sold = observation && /^\d+$/.test(observation.actualInputRaw) ? BigInt(observation.actualInputRaw) : null;
  const answer: LegAnswer | null = outcome.kind === "FILLED" ? { kind: "sold", soldRaw: sold } : outcome.kind === "NOT_FILLED" || outcome.kind === "NOTHING_HAPPENED" ? { kind: "notSold" } : null;
  if (!answer) return "pending";
  const signature = leg.signature;
  changePlans((current) => {
    const now = current.find((entry) => entry.id === plan.id);
    return now ? replacePlan(current, settleLeg(now, signature, answer)) : current;
  });
  return "settled";
}

/* ------------------------------------------------------------ the panel */

type Draft = Readonly<{
  tp: readonly Readonly<{ move: string; share: string }>[];
  sl: string | null;
  trail: string | null;
}>;

const draftFromPreset = (preset: ExitDraft): Draft => ({
  tp: preset.tp.map((leg) => ({ move: String(leg.movePct), share: String(leg.sharePct) })),
  sl: preset.sl ? String(preset.sl.movePct) : null,
  trail: preset.trail ? String(preset.trail.movePct) : null,
});

/** The typed draft as numbers; a field that is not a whole per cent reads as NaN, so the checks name it. */
function parsedDraft(draft: Draft): ExitDraft {
  const pct = (text: string) => typedPct(text) ?? Number.NaN;
  return {
    tp: draft.tp.map((leg) => ({ movePct: pct(leg.move), sharePct: pct(leg.share) })),
    sl: draft.sl === null ? null : { movePct: pct(draft.sl) },
    trail: draft.trail === null ? null : { movePct: pct(draft.trail) },
  };
}

/** A level's sale asked from the panel: which plan and level, what it sells, and the level as the Review names it. */
export type ExitSaleRequest = Readonly<{ planId: string; legId: string; sale: LegSale; label: string }>;

export function FastTrade({
  locale,
  owner,
  mint,
  symbol,
  decimals,
  spendableRaw,
  priceSource,
  now,
  busy,
  canBuy,
  buyNote,
  onQuickBuy,
  onQuickSell,
  onExitSale,
  plan,
}: Readonly<{
  locale: Lang;
  owner: string | null;
  mint: string;
  symbol: string;
  decimals: number | null;
  /** What the wallet may sell of the token now, raw units; null — not read or no wallet. */
  spendableRaw: bigint | null;
  /** Whose price the plan measures from: the fresh read it watched arrive (`plan.entry`). */
  priceSource: string;
  now: number;
  /** An order is on its Review or on its way: no tap starts another. */
  busy: boolean;
  canBuy: boolean;
  buyNote: string | null;
  onQuickBuy: (usd: number) => void;
  onQuickSell: (raw: bigint) => void;
  onExitSale: (request: ExitSaleRequest) => void;
  plan: ReturnType<typeof useTokenExitPlan>;
}>) {
  const word = WORDS[locale];
  const numbers = locale === "uk" ? "uk-UA" : "en-US";
  const [mode, setMode] = useState<"idle" | "compose" | "review">("idle");
  const [draft, setDraft] = useState<Draft>(() => draftFromPreset(EXIT_PRESETS.halfAtDouble));
  const [armError, setArmError] = useState<string | null>(null);
  const errorsId = useId();
  const holding = spendableRaw !== null && spendableRaw > 0n ? spendableRaw : null;
  const tokens = (raw: bigint): string => {
    const units = decimals === null ? null : rawToNumber(raw.toString(), decimals);
    return `${units === null ? "—" : formatAmount(units, locale)} ${symbol}`;
  };
  const usd = (value: number) => formatUsdPrice(value, locale);
  const parsed = useMemo(() => parsedDraft(draft), [draft]);
  const errors = exitDraftErrors(parsed);
  const { open, latest, stale, update, entry } = plan;
  /* Every level ready now with what its sale would sell; the first is the one orange action, the rest wait beside it. */
  const ready = open ? readyLegs(open, TAB_ID, now).flatMap((leg) => {
    const sale = legSale(open, leg, spendableRaw);
    return sale ? [{ leg, sale }] : [];
  }) : [];
  const sentLeg = open?.legs.find((leg) => leg.state === "sent") ?? null;
  const [checking, setChecking] = useState<"idle" | "busy" | "pending" | "failed">("idle");
  useEffect(() => {
    setChecking("idle");
  }, [sentLeg?.signature]);

  /* A new token or wallet starts the plan's panel again. */
  useEffect(() => {
    setMode("idle");
    setArmError(null);
  }, [mint, owner]);

  const legName = (leg: Pick<ExitLeg, "kind" | "movePct">): string =>
    leg.kind === "tp" ? word.level(word.tp, `+${leg.movePct.toLocaleString(numbers)}${locale === "uk" ? " %" : "%"}`) : leg.kind === "sl" ? word.level(word.sl, `−${leg.movePct}${locale === "uk" ? " %" : "%"}`) : word.level(word.trail, word.fromHigh(leg.movePct));
  const legAction = (leg: Pick<ExitLeg, "kind" | "sharePct">): string => (leg.kind === "tp" && leg.sharePct < 100 ? word.sellShare(leg.sharePct) : word.sellRest);

  const arm = () => {
    if (!owner || decimals === null || holding === null) return;
    const armed = armExitPlan({
      id: `xp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      owner,
      mint,
      symbol,
      decimals,
      holdingRaw: holding,
      entryUsd: entry?.price ?? null,
      entrySource: priceSource,
      entryAt: entry?.at ?? null,
      now: Date.now(),
      draft: parsed,
    });
    if (!armed.ok) {
      setArmError(word.armErrors[armed.code]);
      return;
    }
    let placed = false;
    update((current) => {
      /* One open plan per wallet and token: another tab may have set one meanwhile. */
      if (openPlanFor(current, owner, mint)) return current;
      placed = true;
      return [...current, armed.plan];
    });
    setArmError(placed ? null : word.armErrors.TAKEN);
    setMode("idle");
  };

  const turnOff = () => {
    if (!open) return;
    update((current) => {
      const plan = current.find((entry) => entry.id === open.id);
      return plan ? replacePlan(current, cancelExitPlan(plan, Date.now())) : current;
    });
  };

  const download = (receipt: ExitPlan) => {
    const blob = new Blob([JSON.stringify({ kind: "ryntra.exit-plan", ...receipt }, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `ryntra-exit-plan-${receipt.symbol}-${receipt.id}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
  };

  /* The levels a draft would set, measured from the price now: what the Review shows before the plan is on. */
  const previewLevels = (): { name: string; at: string | null; action: string }[] => {
    const base = entry?.price ?? null;
    return [
      ...parsed.tp.map((leg) => ({ kind: "tp" as const, movePct: leg.movePct, sharePct: leg.sharePct })),
      ...(parsed.sl ? [{ kind: "sl" as const, movePct: parsed.sl.movePct, sharePct: 100 }] : []),
      ...(parsed.trail ? [{ kind: "trail" as const, movePct: parsed.trail.movePct, sharePct: 100 }] : []),
    ].map((leg) => ({
      name: legName(leg),
      at: base === null || !Number.isFinite(leg.movePct) ? null : usd(levelUsd({ entryUsd: base, peakUsd: base }, leg)),
      action: legAction(leg),
    }));
  };

  const pctField = (label: string, value: string, onChange: (next: string) => void, key: string) => (
    <label className={styles.field} key={key}>
      <span>{label}</span>
      <input
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={value}
        aria-invalid={typedPct(value) === null ? true : undefined}
        aria-describedby={errors.length > 0 ? errorsId : undefined}
        onChange={(event) => onChange(event.target.value)}
        data-exit-field={key}
      />
    </label>
  );

  return (
    <section className={styles.panel} aria-label={word.title} data-fast-trade>
      <header className={styles.head}>
        <h3 className={styles.title}>{word.title}</h3>
        <span className={styles.hint}>{word.oneTap}</span>
      </header>
      <QuickBuy locale={locale} size="dense" disabled={busy || !canBuy} note={buyNote} onPick={onQuickBuy} />
      {holding !== null ? (
        <QuickSell
          locale={locale}
          shares={QUICK_SELL_SHARES_PCT}
          disabled={busy}
          unavailable={(pct) => quickShareRaw(holding, pct) <= 0n}
          onPick={(pct) => onQuickSell(quickShareRaw(holding, pct))}
        />
      ) : null}

      {/* A level reached: its sale is one tap to the exact Review — never sold by itself. */}
      {open
        ? ready.map(({ leg, sale }, index) => (
            <div key={leg.id} className={styles.ready} role="status" data-exit-ready={leg.id}>
              <b>{word.reached(legName(leg), leg.reachedUsd === null ? "—" : usd(leg.reachedUsd))}</b>
              {entry ? <span translate="no">{word.priceNow(usd(entry.price))}</span> : null}
              {levelPastNow(open, leg, entry?.price ?? null, entry?.at ?? null, now) === false ? <span className={styles.warning}>{leg.kind === "tp" ? word.backBelow : word.backAbove}</span> : null}
              <span translate="no">{word.saleOf(tokens(sale.raw))}</span>
              {sale.cappedByWallet ? <span>{word.capped}</span> : null}
              {leg.missed ? <span>{word.missed}</span> : null}
              <Button variant={index === 0 ? "primary" : "secondary"} lang={locale} block disabled={busy} onClick={() => onExitSale({ planId: open.id, legId: leg.id, sale, label: `${legName(leg)} · ${legAction(leg)}` })} data-exit-sale={leg.id}>
                {word.reviewSale}
              </Button>
            </div>
          ))
        : null}
      {sentLeg && sentLeg.signature ? (
        <div className={styles.sent} role="status" data-exit-sent>
          <span>{word.sent}</span>
          {checking === "pending" ? <span>{word.stillPending}</span> : checking === "failed" ? <span>{word.checkFailed}</span> : null}
          <div className={styles.actions}>
            <Button variant="ghost" lang={locale} onClick={() => window.open(explorerTxUrl("mainnet", sentLeg.signature ?? ""), "_blank", "noopener,noreferrer")}>
              {word.explorer}
            </Button>
            {sentLeg.requestId && open ? (
              <Button
                variant="secondary"
                lang={locale}
                loading={checking === "busy"}
                disabled={busy}
                onClick={() => {
                  setChecking("busy");
                  void checkSentLeg(open, sentLeg).then((answer) => setChecking(answer === "settled" ? "idle" : answer));
                }}
                data-exit-check
              >
                {word.check}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={styles.plan} data-exit-plan={open ? "open" : mode}>
        <h4 className={styles.planTitle}>{word.planTitle}</h4>
        {mode === "idle" && !open ? (
          <>
            <p className={styles.note}>{!owner ? word.planConnect : holding === null ? word.planNoHolding : word.planNone}</p>
            {owner && holding !== null ? (
              <Button variant="secondary" lang={locale} disabled={busy} onClick={() => setMode("compose")} data-exit-compose>
                {word.set}
              </Button>
            ) : null}
          </>
        ) : null}

        {mode === "compose" && !open ? (
          <form
            className={styles.compose}
            onSubmit={(event) => {
              event.preventDefault();
              if (errors.length === 0) setMode("review");
            }}
            noValidate
          >
            <div className={styles.presets} role="group" aria-label={word.planTitle}>
              <Button type="button" variant="ghost" lang={locale} onClick={() => setDraft(draftFromPreset(EXIT_PRESETS.halfAtDouble))}>
                {word.presetHalf}
              </Button>
              <Button type="button" variant="ghost" lang={locale} onClick={() => setDraft(draftFromPreset(EXIT_PRESETS.ladder))}>
                {word.presetLadder}
              </Button>
            </div>
            <fieldset className={styles.group}>
              <legend>{word.tp}</legend>
              {draft.tp.map((leg, index) => (
                <div className={styles.legRow} key={index}>
                  {pctField(word.rise, leg.move, (move) => setDraft((current) => ({ ...current, tp: current.tp.map((entry, at) => (at === index ? { ...entry, move } : entry)) })), `tp${index}-move`)}
                  {pctField(word.share, leg.share, (share) => setDraft((current) => ({ ...current, tp: current.tp.map((entry, at) => (at === index ? { ...entry, share } : entry)) })), `tp${index}-share`)}
                  <Button type="button" variant="ghost" lang={locale} icon="x" aria-label={word.removeTp} title={word.removeTp} onClick={() => setDraft((current) => ({ ...current, tp: current.tp.filter((_, at) => at !== index) }))} />
                </div>
              ))}
              {draft.tp.length < EXIT_TP_MAX ? (
                <Button type="button" variant="ghost" lang={locale} icon="plus" onClick={() => setDraft((current) => ({ ...current, tp: [...current.tp, { move: String((typedPct(current.tp[current.tp.length - 1]?.move ?? "") ?? 50) * 2), share: "25" }] }))}>
                  {word.addTp}
                </Button>
              ) : null}
            </fieldset>
            <fieldset className={styles.group}>
              <legend>
                <label className={styles.toggle}>
                  <input type="checkbox" checked={draft.sl !== null} onChange={(event) => setDraft((current) => ({ ...current, sl: event.target.checked ? "30" : null }))} />
                  {word.sl}
                </label>
              </legend>
              {draft.sl !== null ? pctField(word.fall, draft.sl, (sl) => setDraft((current) => ({ ...current, sl })), "sl") : null}
            </fieldset>
            <fieldset className={styles.group}>
              <legend>
                <label className={styles.toggle}>
                  <input type="checkbox" checked={draft.trail !== null} onChange={(event) => setDraft((current) => ({ ...current, trail: event.target.checked ? "25" : null }))} />
                  {word.trail}
                </label>
              </legend>
              {draft.trail !== null ? pctField(word.fromPeak, draft.trail, (trail) => setDraft((current) => ({ ...current, trail })), "trail") : null}
            </fieldset>
            {errors.length > 0 ? (
              <ul id={errorsId} className={styles.errors} role="alert">
                {errors.map((code) => (
                  <li key={code}>{word.errors[code]}</li>
                ))}
              </ul>
            ) : null}
            <div className={styles.actions}>
              <Button type="button" variant="ghost" lang={locale} onClick={() => setMode("idle")}>
                {word.back}
              </Button>
              <Button type="submit" variant="primary" lang={locale} disabled={errors.length > 0} data-exit-review>
                {word.review}
              </Button>
            </div>
          </form>
        ) : null}

        {mode === "review" && !open && holding !== null ? (
          <div className={styles.review} data-exit-plan-review>
            <h5 className={styles.reviewTitle}>{word.reviewTitle(symbol)}</h5>
            <dl className={styles.rows}>
              <div>
                <dt>{word.covers}</dt>
                <dd translate="no">{word.coversValue(tokens(holding))}</dd>
              </div>
              <div>
                <dt>{word.entry}</dt>
                <dd translate="no">{entry === null ? "—" : `${usd(entry.price)} · ${priceSource}`}</dd>
              </div>
              {previewLevels().map((leg) => (
                <div key={leg.name}>
                  <dt>{leg.name}</dt>
                  <dd translate="no">{`${leg.at ?? "—"} · ${leg.action}`}</dd>
                </div>
              ))}
              <div>
                <dt>{word.signs}</dt>
                <dd>{word.signsValue}</dd>
              </div>
              <div>
                <dt>{word.watches}</dt>
                <dd>{word.watchesValue}</dd>
              </div>
              <div>
                <dt>{word.costs}</dt>
                <dd>{word.costsValue}</dd>
              </div>
            </dl>
            <p className={styles.what}>{word.whatItIs}</p>
            <p className={styles.risk}>{word.risk}</p>
            <p className={styles.risk}>{word.pageOnly}</p>
            {armError ? (
              <p className={styles.error} role="alert">
                {armError}
              </p>
            ) : null}
            <div className={styles.actions}>
              <Button variant="ghost" lang={locale} onClick={() => setMode("compose")}>
                {word.back}
              </Button>
              <Button variant="primary" lang={locale} disabled={busy} onClick={arm} data-exit-arm>
                {word.arm}
              </Button>
            </div>
          </div>
        ) : null}

        {open || (latest && mode === "idle") ? <PlanReceipt plan={(open ?? latest) as ExitPlan} locale={locale} stale={open ? stale : false} legName={legName} legAction={legAction} tokens={tokens} onDownload={download} onTurnOff={open && open.cancelledAt === null ? turnOff : undefined} busy={busy} /> : null}
      </div>
    </section>
  );
}

function PlanReceipt({
  plan,
  locale,
  stale,
  legName,
  legAction,
  tokens,
  onDownload,
  onTurnOff,
  busy,
}: Readonly<{
  plan: ExitPlan;
  locale: Lang;
  stale: boolean;
  legName: (leg: ExitLeg) => string;
  legAction: (leg: ExitLeg) => string;
  tokens: (raw: bigint) => string;
  onDownload: (plan: ExitPlan) => void;
  onTurnOff?: (() => void) | undefined;
  busy: boolean;
}>) {
  const word = WORDS[locale];
  const open = planOpen(plan);
  const time = new Date(plan.armedAt).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  /* The plan's own receipt — an intent's, not a transaction's: when it was set, for how much, from which price, what it
     has sold, and its id; never «paid» or a transaction, because none exists until a sale is signed. */
  const state = open ? (plan.legs.some((leg) => leg.state === "sent") ? word.checking : word.watching) : plan.cancelledAt !== null ? word.turnedOff : word.finished;
  return (
    <div className={styles.receipt} data-exit-receipt={open ? "open" : "closed"}>
      <div className={styles.receiptHead}>
        <h5 className={styles.reviewTitle}>{word.receiptTitle(plan.symbol)}</h5>
        <span className={styles.receiptState} data-open={open ? "true" : undefined}>
          {state}
        </span>
      </div>
      <dl className={styles.rows}>
        <div>
          <dt>{word.setAt}</dt>
          <dd>{time}</dd>
        </div>
        <div>
          <dt>{word.covers}</dt>
          <dd translate="no">{tokens(BigInt(plan.sizeRaw))}</dd>
        </div>
        <div>
          <dt>{word.entry}</dt>
          <dd translate="no">{`${formatUsdPrice(plan.entryUsd, locale)} · ${plan.entrySource}`}</dd>
        </div>
        <div>
          <dt>{word.soldSoFar}</dt>
          <dd translate="no">{tokens(BigInt(plan.soldRaw))}</dd>
        </div>
        <div>
          <dt>{word.planId}</dt>
          <dd translate="no" className={styles.mono}>{plan.id}</dd>
        </div>
      </dl>
      <ul className={styles.legs}>
        {plan.legs.map((leg) => (
          <li key={leg.id} data-leg-state={leg.state}>
            <span className={styles.legName}>{legName(leg)}</span>
            <b className={styles.legState}>{word.states[leg.state]}</b>
            <span className={styles.legDetail} translate="no">
              {`${formatUsdPrice(levelUsd(plan, leg), locale)} · ${legAction(leg)}${leg.soldRaw ? ` · −${tokens(BigInt(leg.soldRaw))}` : ""}${leg.signature ? ` · ${leg.signature.slice(0, 4)}…${leg.signature.slice(-4)}` : ""}`}
            </span>
          </li>
        ))}
      </ul>
      {open && remainingRaw(plan) > 0n && stale ? <p className={styles.warning}>{word.stale}</p> : null}
      {open ? <p className={styles.risk}>{word.pageOnly}</p> : null}
      <div className={styles.actions}>
        <Button variant="ghost" lang={locale} icon="receipt" onClick={() => onDownload(plan)}>
          {word.download}
        </Button>
        {onTurnOff ? (
          <Button variant="ghost" lang={locale} disabled={busy} onClick={onTurnOff} data-exit-off>
            {word.off}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
