"use client";

import { ArrowsLeftRight, CaretDown, Gift, SlidersHorizontal, Warning } from "@phosphor-icons/react";
import { useId, type ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchPresetsResponse, LaunchPresetView } from "@/lib/api/v1/contract";
import {
  ADVANCED_DEFAULT_CHOICE,
  ADVANCED_RECOMMENDED_SUPPLY,
  SNIPER_FEES,
  advancedPrices,
  advancedProblems,
  type AdvancedBounds,
  type AdvancedChoice,
  type AdvancedProblem,
  type SniperStrength,
  unusualTokenomics,
} from "@/lib/core/launch/advanced";
import { boostRuleLines, boostRuleProblems, type BoostBounds, type BoostRules } from "@/lib/core/launch/boost";
import { termsOf } from "@/lib/core/launch/preset-terms";
import { transferFeeOn } from "@/lib/core/launch/transfer-fee";
import { LAUNCH_PRESETS } from "@/lib/core/venues/meteora-dbc/presets";

import { formatBps, formatNumber, formatPrice, formatRaw, toRaw } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";

/**
 * «Розширені параметри» (SOL-L5) — the formats of Лаунч 2 inside the form, never a page of their own: the community token
 * «Спільнота» pairs against, «Розширений» — the creator's own numbers within the operator's bounds —, and Launch Boost, a
 * bonus for buyers from the creator's own money whose rules buyers read before a purchase. Each part is drawn only
 * where this network offers it; where it does not, the line says so. The server checks every number again.
 */

/**
 * «Розширений» as typed: numbers as the person writes them. `transferFee` — «Комісія за переказ» (SOL-L10) in per cent as
 * typed, used only while `transferFeeOn`.
 */
export type AdvancedDraft = Readonly<{ supply: number; startCap: string; dexCap: string; share: string; sniper: SniperStrength; poolStart: string; poolEnd: string; transferFeeOn: boolean; transferFee: string }>;
export const ADVANCED_DRAFT: AdvancedDraft = {
  supply: ADVANCED_DEFAULT_CHOICE.supply,
  startCap: String(ADVANCED_DEFAULT_CHOICE.startMarketCapUsd),
  dexCap: String(ADVANCED_DEFAULT_CHOICE.graduationMarketCapUsd),
  share: String(ADVANCED_DEFAULT_CHOICE.creatorTradingFeePct),
  sniper: ADVANCED_DEFAULT_CHOICE.sniper,
  poolStart: String(ADVANCED_DEFAULT_CHOICE.poolStartFeeBps),
  poolEnd: String(ADVANCED_DEFAULT_CHOICE.poolEndFeeBps),
  transferFeeOn: false,
  transferFee: "1",
};

/** Launch Boost as typed: amounts in the pair currency, the window and the hold in hours. */
export type BoostDraft = Readonly<{ bonusPct: string; budget: string; min: string; cap: string; hours: string; hold: string; any: boolean }>;
export const BOOST_DRAFT: BoostDraft = { bonusPct: "2", budget: "", min: "10", cap: "", hours: "24", hold: "24", any: false };

const number = (text: string): number => {
  const clean = text.trim().replace(",", ".").replace(/\s/g, "");
  return /^\d+(\.\d+)?$/.test(clean) ? Number(clean) : Number.NaN;
};

/** A rate typed in per cent as basis points: «1» — 100, «0,5» — 50; NaN for what is not a whole number of basis points. */
export function transferFeeBpsOfText(text: string): number {
  const pct = number(text);
  const bps = pct * 100;
  return Number.isFinite(bps) && Math.abs(bps - Math.round(bps)) < 1e-9 ? Math.round(bps) : Number.NaN;
}

/** The choice a draft makes; every number as typed, the bounds checked apart. No transfer fee unless it is on. */
export function choiceOfDraft(draft: AdvancedDraft): AdvancedChoice {
  return {
    ...(draft.transferFeeOn ? { transferFeeBps: transferFeeBpsOfText(draft.transferFee) } : {}),
    supply: draft.supply,
    startMarketCapUsd: number(draft.startCap),
    graduationMarketCapUsd: number(draft.dexCap),
    creatorTradingFeePct: number(draft.share),
    sniper: draft.sniper,
    poolStartFeeBps: number(draft.poolStart),
    poolEndFeeBps: number(draft.poolEnd),
  };
}

/** The preset the form shows for «Розширений» — the cards' and the review's shape, the choice's numbers. */
export function advancedPresetView(choice: AdvancedChoice, bounds: AdvancedBounds, base: LaunchPresetView): LaunchPresetView {
  return {
    ...base,
    id: "advanced",
    name: { uk: "Розширений", en: "Advanced" },
    startMarketCapUsd: choice.startMarketCapUsd,
    graduationMarketCapUsd: choice.graduationMarketCapUsd,
    sniperFee: { startBps: SNIPER_FEES[choice.sniper].startBps, endBps: SNIPER_FEES[choice.sniper].endBps, seconds: SNIPER_FEES[choice.sniper].seconds },
    creatorTradingFeePct: choice.creatorTradingFeePct,
    graduationFee: { ...bounds.graduationFee },
    firstBuyCapBps: bounds.firstBuyCapBps,
    creatorLockMinDays: null,
    graduationQuote: null,
    technicalValidation: false,
    terms: undefined,
  };
}

/** The rules a Boost draft makes from a start second, in the pair currency; null while an amount is not a number. */
export function boostRulesOfDraft(draft: BoostDraft, pairDecimals: number, nowSeconds: number): BoostRules | null {
  const budget = toRaw(draft.budget, pairDecimals);
  const min = toRaw(draft.min, pairDecimals);
  const cap = toRaw(draft.cap, pairDecimals);
  const bonus = number(draft.bonusPct);
  const hours = number(draft.hours);
  const hold = number(draft.hold);
  if (budget === null || min === null || cap === null || !Number.isFinite(bonus) || !Number.isFinite(hours) || !Number.isFinite(hold)) return null;
  return {
    currency: "PAIR",
    bonusBps: Math.round(bonus * 100),
    minBuyRaw: min.toString(),
    capPerWalletRaw: cap.toString(),
    budgetRaw: budget.toString(),
    startsAt: nowSeconds,
    endsAt: nowSeconds + Math.round(hours * 3_600),
    holdHours: hold,
    routes: draft.any ? "any" : "ryntra",
  };
}

/**
 * The field a problem of the choice marks. Partial on purpose: the pair currency a choice may name (SOL-L11) is not a
 * field of this form — the register's pairs are offered through the API, and this form never names one — so such a
 * problem marks nothing here.
 */
const ADVANCED_PROBLEM_FIELD: Readonly<Partial<Record<AdvancedProblem, Exclude<keyof AdvancedDraft, "transferFeeOn">>>> = {
  SUPPLY: "supply",
  START_CAP: "startCap",
  GRADUATION_CAP: "dexCap",
  MULTIPLE: "dexCap",
  CREATOR_SHARE: "share",
  SNIPER: "sniper",
  POOL_START_FEE: "poolStart",
  POOL_END_FEE: "poolEnd",
  POOL_FEE_ORDER: "poolEnd",
  TRANSFER_FEE: "transferFee",
};

export function FormatsSection({
  locale,
  presets,
  preset,
  symbol,
  community,
  onCommunity,
  advancedOn,
  onAdvancedOn,
  advanced,
  onAdvanced,
  boostOn,
  onBoostOn,
  boost,
  onBoost,
  pair,
  early,
  earlyOn = false,
  refFor,
}: {
  locale: WorkspaceLocale;
  presets: LaunchPresetsResponse;
  preset: LaunchPresetView;
  symbol: string;
  community: string | null;
  onCommunity: (mint: string) => void;
  advancedOn: boolean;
  onAdvancedOn: (on: boolean) => void;
  advanced: AdvancedDraft;
  onAdvanced: (draft: AdvancedDraft) => void;
  boostOn: boolean;
  onBoostOn: (on: boolean) => void;
  boost: BoostDraft;
  onBoost: (draft: BoostDraft) => void;
  pair: Readonly<{ symbol: string; decimals: number }>;
  /** «Ранній доступ» — drawn by the form where the network offers it. */
  early?: ReactNode;
  /** «Ранній доступ» is on: it has no curve, so «Розширений» and Launch Boost step aside. */
  earlyOn?: boolean;
  refFor: (element: HTMLElement | null) => void;
}) {
  const word = launchWords(locale);
  const communities = presets.communities ?? [];
  const advancedBounds = presets.formats?.advanced?.bounds ?? null;
  const boostBounds = presets.formats?.boost?.bounds ?? null;
  const choice = choiceOfDraft(advanced);
  const problems = advancedOn && advancedBounds ? advancedProblems(choice, advancedBounds) : [];
  const badFields = new Set(problems.map((problem) => ADVANCED_PROBLEM_FIELD[problem]).filter((field) => field !== undefined));
  const prices = advancedPrices(choice);
  /* The share typed is of what is left after Meteora's part; the line under it says the same share as the review does — of every fee (UX-401). */
  const split = advancedOn && !badFields.has("share") && Number.isFinite(choice.creatorTradingFeePct) ? advancedSplit(choice.creatorTradingFeePct) : null;
  const unusual = advancedOn && problems.length === 0 ? unusualTokenomics(choice) : [];
  const rules = boostOn ? boostRulesOfDraft(boost, pair.decimals, Math.floor(Date.now() / 1000) + 60) : null;
  const boostProblems = boostOn && boostBounds ? (rules ? boostRuleProblems(rules, boostBounds, Math.floor(Date.now() / 1000)) : null) : [];
  const set = (key: keyof AdvancedDraft) => (value: string) => onAdvanced({ ...advanced, [key]: value });
  const setBoost = (key: keyof BoostDraft) => (value: string) => onBoost({ ...boost, [key]: value });
  const pairWord = (value: string) => word("boostBudget", { symbol: value });
  return (
    <details className={styles.details} open={advancedOn || boostOn || earlyOn || preset.id === "community" ? true : undefined} ref={refFor}>
      <summary className={styles.summary}>
        <SlidersHorizontal size={16} aria-hidden /> {word("advancedParams")} <CaretDown size={14} aria-hidden className={styles.caret} />
      </summary>
      <div className={styles.formats}>
        <p className={styles.hint}>{word("advancedParamsHint")}</p>

        {preset.id === "community" && communities.length > 1 ? (
          <div className={styles.format} data-on="">
            <span className={styles.label}>{word("communityPick")}</span>
            <div className={styles.segments} role="radiogroup" aria-label={word("communityPick")}>
              {communities.map((entry) => (
                <button key={entry.mint} type="button" role="radio" aria-checked={entry.mint === community} className={styles.segment} onClick={() => onCommunity(entry.mint)}>
                  {entry.symbol}
                </button>
              ))}
            </div>
            <p className={styles.hint}>{word("communityPickHint")}</p>
          </div>
        ) : null}

        <div className={styles.format} data-on={advancedOn ? "" : undefined}>
          <label className={styles.lockToggle}>
            <input type="checkbox" checked={advancedOn} disabled={!advancedBounds || earlyOn} onChange={(event) => onAdvancedOn(event.target.checked)} />
            <span className={styles.lockIcon} aria-hidden>
              <SlidersHorizontal size={18} />
            </span>
            <span className={styles.lockText}>
              <span className={styles.lockTitle}>{word("advancedTitle")}</span>
              <span className={styles.hint}>{advancedBounds ? word("advancedToggleHint") : word("advancedNotOffered")}</span>
            </span>
          </label>
          {advancedOn && advancedBounds ? (
            <>
              <span className={styles.label}>{word("advancedSupply")}</span>
              <div className={styles.segments} role="radiogroup" aria-label={word("advancedSupply")} data-invalid={badFields.has("supply") ? "" : undefined}>
                {advancedBounds.supplies.map((supply) => (
                  <button key={supply} type="button" role="radio" aria-checked={supply === advanced.supply} className={styles.segment} onClick={() => onAdvanced({ ...advanced, supply })}>
                    {formatNumber(supply, locale)}
                    {supply === ADVANCED_RECOMMENDED_SUPPLY ? ` · ${word("advancedSupplyRecommended")}` : ""}
                  </button>
                ))}
              </div>
              <div className={styles.formatGrid}>
                <NumberField label={word("advancedStartCap")} value={advanced.startCap} onValue={set("startCap")} bad={badFields.has("startCap")} hint={word("advancedBounds", { min: formatNumber(advancedBounds.startMarketCapUsd.min, locale), max: formatNumber(advancedBounds.startMarketCapUsd.max, locale) })} />
                <NumberField label={word("advancedDexCap")} value={advanced.dexCap} onValue={set("dexCap")} bad={badFields.has("dexCap")} hint={word("advancedBounds", { min: formatNumber(advancedBounds.graduationMarketCapUsd.min, locale), max: formatNumber(advancedBounds.graduationMarketCapUsd.max, locale) })} />
                <NumberField
                  label={word("advancedCreatorShare")}
                  value={advanced.share}
                  onValue={set("share")}
                  bad={badFields.has("share")}
                  hint={word("advancedBounds", { min: advancedBounds.creatorTradingFeePct.min, max: advancedBounds.creatorTradingFeePct.max })}
                  live={split ? word("advancedShareOfEvery", { creator: formatBps(split.creatorBps, locale), ryntra: formatBps(split.ryntraBps, locale), meteora: formatBps(split.meteoraBps, locale) }) : null}
                />
                <NumberField label={word("advancedPoolStart")} value={advanced.poolStart} onValue={set("poolStart")} bad={badFields.has("poolStart")} hint={word("advancedBounds", { min: advancedBounds.poolStartFeeBps.min, max: advancedBounds.poolStartFeeBps.max })} />
                <NumberField label={word("advancedPoolEnd")} value={advanced.poolEnd} onValue={set("poolEnd")} bad={badFields.has("poolEnd")} hint={word("advancedBounds", { min: advancedBounds.poolEndFeeBps.min, max: advancedBounds.poolEndFeeBps.max })} />
              </div>
              <span className={styles.label}>{word("advancedSniper")}</span>
              <div className={styles.segments} role="radiogroup" aria-label={word("advancedSniper")}>
                {advancedBounds.snipers.map((strength) => (
                  <button key={strength} type="button" role="radio" aria-checked={strength === advanced.sniper} className={styles.segment} onClick={() => onAdvanced({ ...advanced, sniper: strength })}>
                    {word(`advancedSniper_${strength}` as LaunchWordKey, { start: formatBps(SNIPER_FEES[strength].startBps, locale) })}
                  </button>
                ))}
              </div>
              <div className={styles.formatPreview} aria-live="polite">
                {Number.isFinite(prices.startPriceUsd) && Number.isFinite(prices.graduationPriceUsd) ? (
                  <span>
                    {word("advancedPrices", { start: `$${formatPrice(prices.startPriceUsd, locale).text}`, dex: `$${formatPrice(prices.graduationPriceUsd, locale).text}`, multiple: formatNumber(prices.multiple, locale, 1) })}
                  </span>
                ) : null}
                <span>{word("advancedSameCap")}</span>
              </div>
              {problems.length ? <p className={styles.problem}>{word("advancedProblem")}</p> : null}
              {unusual.length ? (
                <div className={styles.unusual} role="note">
                  <p className={styles.unusualTitle}>
                    <Warning size={16} weight="fill" aria-hidden /> {word("unusualTitle")}
                  </p>
                  <ul>
                    {unusual.map((reason) => (
                      <li key={reason}>{word(`unusual_${reason}` as LaunchWordKey)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {advancedBounds?.transferFeeMaxBps ? (
          <TransferFeeFormat
            locale={locale}
            symbol={symbol}
            supply={advanced.supply}
            maxBps={advancedBounds.transferFeeMaxBps}
            advancedOn={advancedOn && !earlyOn}
            draft={advanced}
            bad={badFields.has("transferFee")}
            onDraft={onAdvanced}
          />
        ) : null}

        <div className={styles.format} data-on={boostOn ? "" : undefined}>
          <label className={styles.lockToggle}>
            <input type="checkbox" checked={boostOn} disabled={!boostBounds || earlyOn} onChange={(event) => onBoostOn(event.target.checked)} />
            <span className={styles.lockIcon} aria-hidden>
              <Gift size={18} />
            </span>
            <span className={styles.lockText}>
              <span className={styles.lockTitle}>{word("boostToggle")}</span>
              <span className={styles.hint}>{boostBounds ? word("boostToggleHint") : word("advancedNotOffered")}</span>
            </span>
          </label>
          {boostOn && boostBounds ? (
            <>
              <div className={styles.formatGrid}>
                <NumberField label={word("boostBonus")} value={boost.bonusPct} onValue={setBoost("bonusPct")} bad={false} />
                <NumberField label={pairWord(pair.symbol)} value={boost.budget} onValue={setBoost("budget")} bad={false} />
                <NumberField label={word("boostMin", { symbol: pair.symbol })} value={boost.min} onValue={setBoost("min")} bad={false} />
                <NumberField label={word("boostCap", { symbol: pair.symbol })} value={boost.cap} onValue={setBoost("cap")} bad={false} />
                <NumberField label={word("boostDays")} value={boost.hours} onValue={setBoost("hours")} bad={false} />
                <NumberField label={word("boostHold")} value={boost.hold} onValue={setBoost("hold")} bad={false} />
              </div>
              {boostBounds.routes.includes("any") ? (
                <label className={styles.lockToggle}>
                  <input type="checkbox" checked={boost.any} onChange={(event) => onBoost({ ...boost, any: event.target.checked })} />
                  <span className={styles.lockText}>
                    <span className={styles.hint}>{word("boostAny")}</span>
                  </span>
                </label>
              ) : null}
              {boostProblems === null || (boostProblems && boostProblems.length) ? (
                <p className={styles.problem}>{word("boostProblem", { why: boostProblems ? boostProblems.map((problem) => problem.message).join(" ") : word("errAmount") })}</p>
              ) : rules ? (
                <div className={styles.formatPreview}>
                  <span className={styles.label}>{word("boostPreview")}</span>
                  {boostRuleLines(rules, { symbol: symbol || "TOKEN", decimals: 6, pairSymbol: pair.symbol, pairDecimals: pair.decimals, dollar: pair.symbol === "USDC" }, locale).map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {early}
      </div>
    </details>
  );
}

/** Whether the formats the person turned on hold — the form's step is done only then. */
export function formatsHold(presets: LaunchPresetsResponse, advancedOn: boolean, advanced: AdvancedDraft, boostOn: boolean, boost: BoostDraft, pairDecimals: number): boolean {
  const advancedBounds = presets.formats?.advanced?.bounds ?? null;
  if (advancedOn && (!advancedBounds || advancedProblems(choiceOfDraft(advanced), advancedBounds).length > 0)) return false;
  const boostBounds = presets.formats?.boost?.bounds ?? null;
  if (boostOn) {
    if (!boostBounds) return false;
    const now = Math.floor(Date.now() / 1000);
    const rules = boostRulesOfDraft(boost, pairDecimals, now + 60);
    if (!rules || boostRuleProblems(rules, boostBounds as BoostBounds, now).length > 0) return false;
  }
  return true;
}

/** «Розширений»'s split of every fee on the curve for a typed share — read from `termsOf`, the review's one source. */
export function advancedSplit(creatorTradingFeePct: number) {
  return termsOf({ ...LAUNCH_PRESETS.advanced, creatorTradingFeePct }).curve.split;
}

/** One transfer the form shows as the example: a thousandth of the supply. */
const EXAMPLE_SHARE = 1_000n;

/**
 * «Комісія за переказ» (SOL-L10) — a format of its own beside «Розширений», on that config only: the rate, what one
 * transfer leaves, and what the move to the DEX does to it. Drawn only where the network offers it (its flag open on
 * SDK 2.0.0); the server checks the rate again and builds nothing outside Ryntra's rule.
 */
function TransferFeeFormat({
  locale,
  symbol,
  supply,
  maxBps,
  advancedOn,
  draft,
  bad,
  onDraft,
}: {
  locale: WorkspaceLocale;
  symbol: string;
  supply: number;
  maxBps: number;
  advancedOn: boolean;
  draft: AdvancedDraft;
  bad: boolean;
  onDraft: (draft: AdvancedDraft) => void;
}) {
  const word = launchWords(locale);
  const on = advancedOn && draft.transferFeeOn;
  const bps = transferFeeBpsOfText(draft.transferFee);
  const ticker = `$${symbol || "TOKEN"}`;
  const gross = (BigInt(supply) * 1_000_000n) / EXAMPLE_SHARE;
  const example = on && !bad && Number.isFinite(bps) ? transferFeeOn(gross, bps) : null;
  return (
    <div className={styles.format} data-on={on ? "" : undefined}>
      <label className={styles.lockToggle}>
        <input type="checkbox" checked={on} disabled={!advancedOn} onChange={(event) => onDraft({ ...draft, transferFeeOn: event.target.checked })} />
        <span className={styles.lockIcon} aria-hidden>
          <ArrowsLeftRight size={18} />
        </span>
        <span className={styles.lockText}>
          <span className={styles.lockTitle}>{word("transferFeeTitle")}</span>
          <span className={styles.hint}>{advancedOn ? word("transferFeeToggleHint") : word("transferFeeNeedsAdvanced")}</span>
        </span>
      </label>
      {on ? (
        <>
          <div className={styles.formatGrid}>
            <NumberField
              label={word("transferFeeRate")}
              value={draft.transferFee}
              onValue={(value) => onDraft({ ...draft, transferFee: value })}
              bad={bad}
              hint={word("transferFeeBounds", { max: formatBps(maxBps, locale) })}
            />
          </div>
          <div className={styles.formatPreview} aria-live="polite">
            {example ? (
              <span>
                {word("transferFeeExample", {
                  gross: `${formatNumber(Number(example.grossRaw / 1_000_000n), locale)} ${ticker}`,
                  withheld: `${formatRaw(example.withheldRaw.toString(), 6, locale, 2)} ${ticker}`,
                  net: `${formatRaw(example.netRaw.toString(), 6, locale, 2)} ${ticker}`,
                })}
              </span>
            ) : null}
            <span>{word("transferFeeAfterDex")}</span>
            <span>{word("transferFeeWithheldBy")}</span>
            <span>{word("transferFeeExitCost", { pct: Number.isFinite(bps) ? formatBps(bps, locale) : "—" })}</span>
          </div>
          {bad ? <p className={styles.problem}>{word("transferFeeProblem", { max: formatBps(maxBps, locale) })}</p> : null}
        </>
      ) : null}
    </div>
  );
}

function NumberField({ label, value, onValue, bad, hint, live }: { label: string; value: string; onValue: (value: string) => void; bad: boolean; hint?: string; live?: string | null }) {
  const id = useId();
  return (
    <div className={styles.field} data-invalid={bad ? "" : undefined}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input id={id} className={`${styles.input} ${styles.mono}`} value={value} onChange={(event) => onValue(event.target.value)} inputMode="decimal" autoComplete="off" aria-invalid={bad || undefined} />
      {hint ? <span className={styles.hint}>{hint}</span> : null}
      {live !== undefined ? (
        <span className={styles.hint} aria-live="polite">
          {live ?? " "}
        </span>
      ) : null}
    </div>
  );
}
