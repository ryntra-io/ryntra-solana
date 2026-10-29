"use client";

import { ArrowRight, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AutoinvestSheet } from "@/app/app/stocks/[ticker]/autoinvest-sheet";
import company from "@/app/app/stocks/[ticker]/company.module.css";
import { useWalletData } from "@/app/app/wallet-data";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { AutoinvestRule, RuleBudget } from "@/lib/api/v1/contract";
import { ruleAssetHref, rulePurchaseHref } from "@/lib/autoinvest/links";
import { SOLANA_MAINNET_USDC_MINT } from "@/lib/solana/send-kinds";
import { dueWords, priceWord, ruleWhenLine, usdWord } from "@/lib/autoinvest/words";
import { isRetiredMint } from "@/lib/stocks/retired";
import { companyFromTokenName, type ShelfCard } from "@/lib/stocks/shelf";

import { byNextPurchase, deferredNow, heldByBudget, purchaseSumUsd, reminderOpenNow, ruleZone } from "./autoinvest-model";
import block from "./autoinvest.module.css";
import { BudgetRow } from "./budget-row";
import { BudgetSheet } from "./budget-sheet";
import styles from "./invest.module.css";
import { gatheredLine, gatheredShort, investWords } from "./invest-words";
import { RuleTokenPicker, type RulePick } from "./rule-token-picker";
import { readShelfCopy } from "./shelf-copy";
import { isShelfCards, RowSkeleton } from "./shelf-ui";
import { useAutoinvestRules } from "./use-rules";

/**
 * «Автоінвест» — one block on Home and in Portfolio, for every connected
 * wallet: the month's budget as its own line — «Бюджет не задано · Задати»
 * or «Бюджет місяця $45 з $100» over its bar — the rules as cards with a
 * switch each, and «Додати правило».
 *
 * The rules and the budget are the wallet's, read behind its proof; a page
 * without one says so in one line with one quiet action. A rule's card opens
 * its company — the rule's own sheet lives there — or, while its reminder is
 * open, the purchase by the rule itself. The switch pauses a rule or turns it
 * on again (a «Якщо впаде» rule then falls from the price now). The budget's
 * line opens the budget's sheet — also where the note that the budget is
 * spent lands (`?budget=edit`); it shows once there is a rule or a ceiling,
 * so a wallet with neither reads one line and «Додати правило». «Додати
 * правило» asks for which token — what the wallet holds (a company, a coin, a
 * meme; 1.31.0), the popular companies and a search over the rest, the one
 * picker «Боти» and «Каталог» open too (SOL-C15) — and opens the same rule
 * sheet the company's page and Spot's «Регулярно» have; a token's card opens
 * its market in Spot. Nothing here is orange: the page's one orange action is «Купити»
 * or the step before it.
 *
 * `compact` is Home's right column: the same rules with their switches, each
 * in one line — the sum and the next purchase — by the nearest purchase,
 * three at most, and «Усі правила» to the block's own page, where the rest
 * and «Додати правило» are.
 */

/** How many rules Home's column names; the rest are on «Автоінвест»'s own page. */
const COMPACT_SHOWN = 3;

/** A token a rule may be written for (`rule-token-picker.tsx`). */
type Pick = RulePick;

export function AutoinvestBlock({
  locale,
  heading = true,
  compact = false,
}: {
  locale: WorkspaceLocale;
  /** False on «Автоінвест»'s own page, whose title already says it. */
  heading?: boolean;
  /** Home's right column: one line a rule, the nearest first, three at most. */
  compact?: boolean;
}) {
  const word = investWords(locale);
  const proof = useWalletProof();
  const proven = proof.state.status === "proven";
  const { state, create, setStatus, remove, setBudget, clearBudget } = useAutoinvestRules(proven);
  const { holdings } = useWalletData();
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Pick | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    /* The note that the month's budget is spent lands here: open the budget's sheet once, and drop the link so a reload does not open it again. */
    const params = new URLSearchParams(window.location.search);
    if (params.get("budget") !== "edit") return;
    params.delete("budget");
    params.delete("from");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    setBudgetOpen(true);
  }, []);

  /* Icons and names for the rules and the picker: what the wallet holds, then the popular companies this browser drew. */
  const owned = useMemo<readonly Pick[]>(() => {
    if (holdings.status !== "ready") return [];
    return holdings.data
      /* Any token the wallet holds that the venue lists (1.31.0) — never the dollars a rule pays with, never a token Ryntra no longer supports; the server judges the floor. */
      .filter((holding) => (holding.catalog?.category === "stock" || holding.catalog?.category === "crypto" || holding.catalog?.category === "meme") && holding.mint && holding.mint !== SOLANA_MAINNET_USDC_MINT && !isRetiredMint(holding.mint))
      .map((holding) => {
        const token = holding.catalog?.category !== "stock";
        const ticker = holding.catalog?.symbol ?? holding.symbol ?? "";
        return {
          mint: holding.mint as string,
          name: token ? ticker : companyFromTokenName(holding.catalog?.name ?? holding.name ?? holding.catalog?.symbol ?? ""),
          icon: holding.catalog?.icon ?? null,
          ticker,
          price: holding.catalog?.usdPrice && Number.isFinite(Number(holding.catalog.usdPrice)) ? Number(holding.catalog.usdPrice) : null,
          token,
        };
      })
      .filter((row) => row.ticker && row.name);
  }, [holdings]);
  const [popular, setPopular] = useState<readonly ShelfCard[]>([]);
  useEffect(() => {
    setPopular(readShelfCopy("popular", isShelfCards) ?? []);
  }, [picking, state.rules.length]);
  /* The rules' logos: what the wallet and the popular shelf already carry, and one read of the catalogue for the rest — the same icons the company pages draw. */
  const [icons, setIcons] = useState<ReadonlyMap<string, string>>(new Map());
  const mintsKey = useMemo(() => {
    const known = new Set([...owned.filter((row) => row.icon).map((row) => row.mint), ...popular.filter((card) => card.icon).map((card) => card.mint)]);
    return [...new Set(state.rules.map((rule) => rule.asset.mint))].filter((mint) => !known.has(mint)).sort().join(",");
  }, [state.rules, owned, popular]);
  useEffect(() => {
    if (!mintsKey) return undefined;
    let live = true;
    fetch(`/api/spot/markets?mints=${encodeURIComponent(mintsKey)}`, { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { rows?: readonly { mint: string; icon: string | null }[] } | null) => {
        if (!live || !body?.rows) return;
        const read = body.rows.filter((row) => typeof row.icon === "string" && row.icon.startsWith("https://")).map((row) => [row.mint, row.icon as string] as const);
        setIcons((current) => new Map([...current, ...read]));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [mintsKey]);
  const iconOf = useCallback((mint: string) => icons.get(mint) ?? owned.find((row) => row.mint === mint)?.icon ?? popular.find((card) => card.mint === mint)?.icon ?? null, [icons, owned, popular]);

  const toggle = async (rule: AutoinvestRule) => {
    setFailure(null);
    setSwitching(rule.id);
    const result = await setStatus(rule.id, rule.status === "active" ? "paused" : "active");
    setSwitching(null);
    if (!result.ok) setFailure(result.code === "UNAVAILABLE" && rule.dip ? word("priceUnknownNow") : word("ruleChangeFailed"));
  };

  const confirm = async () => {
    await proof.prove();
  };

  /* The budget's line once there is something for it to bound — a rule, or a ceiling already set. */
  const showBudget = state.budget !== null && (state.rules.length > 0 || state.budget.capUsd !== null);

  return (
    <section className={styles.section} aria-labelledby={heading ? "autoinvest-title" : undefined} aria-label={heading ? undefined : word("autoinvest")} data-block="autoinvest">
      {heading ? (
        <div className={styles.sectionHead}>
          <h2 id="autoinvest-title" className={styles.sectionTitle}>
            {word("autoinvest")}
          </h2>
          {compact ? (
            <Link className={styles.sectionLink} href="/app/bots" prefetch={false}>
              {word("allRules")}
              <ArrowRight size={14} weight="bold" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      ) : null}

      {proof.state.status === "idle" || proof.state.status === "checking" || (proven && (state.status === "idle" || state.status === "loading")) ? (
        <RowSkeleton count={2} />
      ) : !proven || state.status === "unproven" ? (
        <div className={block.panel}>
          <p className={block.line}>{word("confirmForRules")}</p>
          <button type="button" className={block.textButton} onClick={() => void confirm()} disabled={proof.state.status === "signing"}>
            {proof.state.status === "signing" ? word("confirming") : word("confirmWallet")}
          </button>
        </div>
      ) : state.status === "failed" ? (
        <div className={styles.status} role="status">
          <p>{word("ruleReadFailed")}</p>
        </div>
      ) : (
        <div className={block.panel}>
          {showBudget ? <BudgetRow budget={state.budget} locale={locale} variant="block" onEdit={() => setBudgetOpen(true)} /> : null}
          {state.rules.length === 0 ? (
            <p className={block.line}>{word("noRulesYet")}</p>
          ) : (
            <ul className={block.rules}>
              {(compact ? byNextPurchase(state.rules, Date.now()).slice(0, COMPACT_SHOWN) : state.rules).map((rule) => (
                <RuleCard key={rule.id} rule={rule} budget={state.budget} icon={iconOf(rule.asset.mint)} locale={locale} busy={switching === rule.id} onToggle={() => void toggle(rule)} compact={compact} />
              ))}
            </ul>
          )}
          {failure ? <p className={company.sheetError}>{failure}</p> : null}
          {/* In Home's column a rule is added on the block's own page, once there is one to read beside it. */}
          {compact && state.rules.length > 0 ? null : (
            <button type="button" className={block.add} onClick={() => setPicking(true)}>
              <Plus size={16} weight="bold" aria-hidden="true" />
              {word("addRule")}
            </button>
          )}
        </div>
      )}

      <RuleTokenPicker
        open={picking}
        locale={locale}
        owned={owned}
        popular={popular}
        onClose={() => setPicking(false)}
        onPick={(pick) => {
          setPicking(false);
          setPicked(pick);
        }}
      />
      <AutoinvestSheet
        open={picked !== null}
        mode={{ kind: "compose", amountUsd: null }}
        mint={picked?.mint ?? ""}
        name={picked?.name ?? ""}
        icon={picked?.icon ?? null}
        preIpo={false}
        truth=""
        priceUsd={picked?.price ?? null}
        token={picked?.token ?? false}
        budget={state.budget}
        locale={locale}
        onClose={() => setPicked(null)}
        onConnect={() => setPicked(null)}
        onCreate={create}
        onSetStatus={setStatus}
        onRemove={remove}
        onEditBudget={() => setBudgetOpen(true)}
        onBuyNow={() => setPicked(null)}
      />
      <BudgetSheet open={budgetOpen} budget={state.budget} locale={locale} onClose={() => setBudgetOpen(false)} onSave={setBudget} onClear={clearBudget} />
    </section>
  );
}

function RuleCard({ rule, budget, icon, locale, busy, onToggle, compact = false }: { rule: AutoinvestRule; budget: RuleBudget | null; icon: string | null; locale: WorkspaceLocale; busy: boolean; onToggle: () => void; compact?: boolean }) {
  const word = investWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  /* The reminder whose window is still open: the card then leads to the purchase by the rule. */
  const due = reminderOpenNow(rule, Date.now());
  /* A purchase the price condition holds back (1.18.0): the card says so, and leads to the company, where why is said. */
  const deferred = !due ? deferredNow(rule, Date.now()) : null;
  const held = !due && !deferred && heldByBudget(rule, budget);
  const active = rule.status === "active";
  const zone = ruleZone(rule);
  const href = due ? rulePurchaseHref(rule, due.dueAt) : ruleAssetHref(rule);
  const stateLine = !active
    ? word("onPause")
    : due
      ? `${word("timeToBuy")} · ${usdWord(purchaseSumUsd(rule, due), lang)}`
      : deferred
        ? word("purchaseDeferred")
        : held
        ? word("budgetSpent")
        : rule.payments
          ? compact
            ? gatheredShort(locale, rule.payments.gatheredUsd, rule.amountUsd)
            : gatheredLine(locale, rule.payments.gatheredUsd, rule.amountUsd)
        : rule.dip
          ? `${word("remindAtLine")} ${priceWord(rule.dip.triggerUsd, lang)}`
          : rule.nextDueAt
            ? `${word("nextPurchase")}: ${dueWords(Date.parse(rule.nextDueAt), zone, lang)}`
            : "";
  const tone = !active ? "paused" : due ? "due" : deferred ? "deferred" : held ? "held" : "on";
  /* One line in Home's column: the sum and what comes next — the next purchase, the price it waits for, or why it waits. */
  const compactLine = !active || due || deferred || held || rule.payments ? stateLine : rule.dip ? `${usdWord(rule.amountUsd, lang)} · ${word("remindAtLine")} ${priceWord(rule.dip.triggerUsd, lang)}` : rule.nextDueAt ? `${usdWord(rule.amountUsd, lang)} · ${dueWords(Date.parse(rule.nextDueAt), zone, lang)}` : `${usdWord(rule.amountUsd, lang)} · ${ruleWhenLine(rule, lang)}`;
  return (
    <li className={block.rule} data-state={tone} data-compact={compact ? "true" : undefined}>
      <Link className={block.ruleMain} href={href} prefetch={false}>
        <MarketIcon mint={rule.asset.mint} icon={icon} symbol={rule.name} size={compact ? 32 : 36} className={styles.rowLogo} />
        <span className={block.ruleText}>
          <span className={block.ruleName}>{rule.name}</span>
          {compact ? (
            <span className={block.ruleState} translate="no">
              {compactLine}
            </span>
          ) : (
            <>
              <span className={block.ruleSub} translate="no">{rule.payments ? ruleWhenLine(rule, lang) : `${usdWord(rule.amountUsd, lang)} · ${ruleWhenLine(rule, lang)}`}</span>
              {stateLine ? (
                <span className={block.ruleState} translate="no">
                  {stateLine}
                </span>
              ) : null}
            </>
          )}
        </span>
      </Link>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={`${word("autoinvest")} · ${rule.name}`}
        className={block.switch}
        disabled={busy}
        onClick={onToggle}
        title={active ? word("ruleOn") : word("onPause")}
      >
        <span className={block.track} aria-hidden="true">
          <span className={block.knob} />
        </span>
      </button>
    </li>
  );
}
