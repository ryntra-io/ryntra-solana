"use client";

import { CaretRight } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { deferredNow, heldByBudget, lastSettled, purchaseSumUsd, reminderOpenNow, ruleForMint, ruleZone } from "@/app/app/invest/autoinvest-model";
import { BudgetSheet } from "@/app/app/invest/budget-sheet";
import { gatheredLine, investWords } from "@/app/app/invest/invest-words";
import { deferralLine } from "@/app/app/invest/price-condition-view";
import { useAutoinvestRules } from "@/app/app/invest/use-rules";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { openSolanaConnection } from "@/app/solana/workspace/connection-trigger.client";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { AutoinvestRule, RuleOccurrence } from "@/lib/api/v1/contract";
import type { PriceReference } from "@/lib/autoinvest/price-condition";
import { dayWords, dueWords, priceWord, ruleWhenLine, usdWord } from "@/lib/autoinvest/words";

import { AutoinvestSheet, type AutoinvestMode } from "./autoinvest-sheet";
import { BuySheet, type BuySheetProps, type RuleBuy, type RuleOffer } from "./buy-sheet";
import { useHolds } from "./company-event";
import company from "./company.module.css";

/**
 * A company's two actions: «Купити» — the one orange action — and
 * «Автоінвест», quiet beside it. A company that has a rule shows the rule in
 * its place — how much, how often or how far its price must fall, when next.
 * A rule the month's budget holds says so: «Бюджет вичерпано · до 1-го
 * числа».
 *
 * **While the rule's reminder is open** the rule's purchase is the first
 * action — «Час твоєї покупки · Щотижня · чт о 19:00» over «Купити $20 за
 * правилом», the same purchase sheet on the rule's sum — and an ordinary
 * purchase is the second, saying the reminder stays open: the rule counts
 * only a purchase by the rule.
 *
 * A reminder's link (`?rule=…&due=…`, from the note or Telegram) opens that
 * purchase on arrival: the rule is read afresh behind the wallet's proof and
 * the Review prepared on its sum — or the page says what became of it. The
 * note that the budget is spent lands on Home, where the budget lives.
 */

type Props = Omit<BuySheetProps, "ruleBuy" | "onRuleBuyEnd" | "onRulesReload" | "onBuyWeekly" | "budget" | "onChangeBudget" | "ruleOffer" | "quiet"> &
  Readonly<{
    priceUsd: number | null;
    /** The IPO and conversion watch: while the swap is a holder's one orange action above, «Купити» steps back to quiet for a wallet that holds the token. */
    quietWhenHeld?: boolean;
    /** «Умова ціни»: whose figure a rule's price condition is set against for this company; null when it has none, and the condition is not offered. */
    conditionReference?: PriceReference | null;
  }>;

type Pending = Readonly<{ ruleId: string; dueAt: string | null }>;

export function CompanyActions({ priceUsd, quietWhenHeld = false, conditionReference = null, ...props }: Props) {
  const { mint, name, locale } = props;
  const holds = useHolds(mint);
  const word = investWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const proven = proof.state.status === "proven";
  const { state, reload, create, setStatus, remove, setBudget, clearBudget, markOwn } = useAutoinvestRules(proven);
  const rule = useMemo(() => ruleForMint(state.rules, mint), [state.rules, mint]);

  const [sheet, setSheet] = useState<AutoinvestMode | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);

  useEffect(() => {
    /* The reminder's link: which rule and which occurrence — read once; the link itself is dropped so a reload does not buy again. */
    const params = new URLSearchParams(window.location.search);
    const ruleId = params.get("rule");
    if (!ruleId || !/^rule_[0-9a-f]{32}$/.test(ruleId)) return;
    const due = params.get("due");
    setPending({ ruleId, dueAt: due && Number.isFinite(Date.parse(due)) ? due : null });
    params.delete("rule");
    params.delete("due");
    params.delete("from");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  }, []);

  /* The rules read again — after a purchase under one, or after the purchase sheet proved the wallet, when this page's proof follows. A proof that stands is never re-checked here: a re-check would hide the rules for a moment. */
  const proofStatus = proof.state.status;
  const recheckProof = proof.recheck;
  const reloadRules = useCallback(() => {
    if (proofStatus !== "proven") void recheckProof();
    void reload();
  }, [proofStatus, recheckProof, reload]);

  const ruleBuy: RuleBuy | null = pending
    ? {
        ruleId: pending.ruleId,
        dueAt: pending.dueAt,
        rule: state.rules.find((candidate) => candidate.id === pending.ruleId) ?? null,
        read: !connection ? "idle" : proof.state.status === "unproven" ? "unproven" : state.status,
      }
    : null;

  /* A rule written behind a proof the sheet just made: this page's proof follows, so the rule shows in its place at once. */
  const createRule = useCallback<typeof create>(
    async (request) => {
      const result = await create(request);
      if (proofStatus !== "proven") void recheckProof();
      return result;
    },
    [create, proofStatus, recheckProof],
  );

  const buyNow = useCallback((picked: AutoinvestRule, occurrence: RuleOccurrence) => {
    setSheet(null);
    setPending({ ruleId: picked.id, dueAt: occurrence.dueAt });
  }, []);

  /* A wallet connected for the rule's sheet: the sheet comes back as it was — within a minute and a half, never later. */
  const [resume, setResume] = useState<AutoinvestMode | null>(null);
  const connectFirst = useCallback(() => {
    /* One way to connect: the header's own panel; the sheet steps aside first, or the panel would sit under it. */
    setResume(sheet);
    setSheet(null);
    window.requestAnimationFrame(() => openSolanaConnection());
  }, [sheet]);
  useEffect(() => {
    if (!resume) return undefined;
    if (connection) {
      setSheet(resume);
      setResume(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setResume(null), 90_000);
    return () => window.clearTimeout(timer);
  }, [resume, connection]);

  /* The reminder's window is the server's: the page keeps a clock, so a reminder whose window passed stops being offered without a reload. */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const due = rule ? reminderOpenNow(rule, nowMs) : null;
  /* A purchase the price condition holds back (1.18.0): said on the rule's card, nothing offered — the rule judges it again. */
  const deferred = rule && !due ? deferredNow(rule, nowMs) : null;
  const last = rule ? lastSettled(rule) : null;
  const held = rule ? heldByBudget(rule, state.budget) && !due : false;
  const zone = rule ? ruleZone(rule) : "UTC";
  /* The reminder open now: the rule's purchase first, an ordinary one second — on the reminder's own sum (1.19.0). */
  const ruleOffer: RuleOffer | null = rule && due ? { amountUsd: purchaseSumUsd(rule, due), context: `${word("timeToBuy")} · ${ruleWhenLine(rule, lang)}`, onBuy: () => buyNow(rule, due) } : null;

  const cardSub = (() => {
    if (!rule) return "";
    if (rule.status === "paused") return `${ruleWhenLine(rule, lang)} · ${word("onPause")}`;
    if (due) return ruleWhenLine(rule, lang);
    if (deferred) return word("deferredShort");
    if (held) return word("heldShort");
    if (rule.payments) return `${ruleWhenLine(rule, lang)} · ${gatheredLine(locale, rule.payments.gatheredUsd, rule.amountUsd)}`;
    if (rule.dip) return `${ruleWhenLine(rule, lang)} · ${word("remindAtShort")} ${priceWord(rule.dip.triggerUsd, lang)}`;
    return rule.nextDueAt ? `${word("nextPurchase")}: ${dueWords(Date.parse(rule.nextDueAt), zone, lang)}` : ruleWhenLine(rule, lang);
  })();

  return (
    <>
      <BuySheet
        {...props}
        quiet={quietWhenHeld && holds}
        ruleBuy={ruleBuy}
        ruleOffer={ruleOffer}
        budget={state.budget}
        onChangeBudget={() => setBudgetOpen(true)}
        onRuleBuyEnd={() => setPending(null)}
        onRulesReload={reloadRules}
        onBuyWeekly={rule ? undefined : (amountUsd) => setSheet({ kind: "compose", amountUsd, cadence: "weekly" })}
      />
      {rule ? (
        /* While its reminder is open the rule speaks through its purchase above; otherwise its card opens it — how much, how often, when next. */
        due ? null : (
          <button type="button" className={company.ruleCard} data-state={deferred ? "deferred" : held ? "held" : rule.status} aria-haspopup="dialog" onClick={() => setSheet({ kind: "manage", rule })}>
            <span className={company.ruleCardText}>
              <span className={company.ruleCardTitle}>{`${word("autoinvest")} · ${rule.payments ? word("fromPayments") : usdWord(rule.amountUsd, lang)}`}</span>
              <span className={company.ruleCardSub} translate="no">
                {cardSub}
              </span>
              {deferred?.condition ? (
                <span className={company.ruleCardSub} data-deferral translate="no">
                  {deferralLine(deferred.condition, name, nowMs, zone, lang)}
                </span>
              ) : null}
              {!held && !deferred && last && last.state === "missed" ? <span className={company.ruleCardSub}>{`${word("lastMissed")} · ${rule.dip ? dayWords(Date.parse(last.dueAt), zone, lang) : dueWords(Date.parse(last.dueAt), zone, lang)}`}</span> : null}
            </span>
            <CaretRight size={16} weight="bold" aria-hidden="true" />
          </button>
        )
      ) : (
        <button type="button" className={`rw-btn ${company.autoinvest}`} aria-haspopup="dialog" onClick={() => setSheet({ kind: "compose", amountUsd: null })}>
          {word("autoinvest")}
        </button>
      )}
      <AutoinvestSheet
        open={sheet !== null}
        /* The rule's own sheet reads the rule as the wallet holds it now — a pause, a gathered payment or «Мій рахунок» shows at once. */
        mode={sheet?.kind === "manage" ? { kind: "manage", rule: state.rules.find((candidate) => candidate.id === sheet.rule.id) ?? sheet.rule } : (sheet ?? { kind: "compose", amountUsd: null })}
        mint={mint}
        name={name}
        icon={props.icon}
        preIpo={props.preIpo}
        truth={props.truth}
        eventLine={props.eventLine ?? null}
        priceUsd={priceUsd}
        conditionReference={conditionReference}
        conditionFacts={props.conditionFacts ?? null}
        budget={state.budget}
        locale={locale}
        onClose={() => setSheet(null)}
        onConnect={connectFirst}
        onCreate={createRule}
        onSetStatus={setStatus}
        onRemove={remove}
        onEditBudget={() => setBudgetOpen(true)}
        onBuyNow={buyNow}
        onMarkOwn={markOwn}
      />
      <BudgetSheet open={budgetOpen} budget={state.budget} locale={locale} onClose={() => setBudgetOpen(false)} onSave={setBudget} onClear={clearBudget} />
    </>
  );
}
