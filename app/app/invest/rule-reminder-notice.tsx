"use client";

import { ArrowRight } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { rulePurchaseHref } from "@/lib/autoinvest/links";
import { usdWord } from "@/lib/autoinvest/words";

import { purchaseSumUsd, reminderOpenNow, ruleForMint } from "./autoinvest-model";
import { buyByRuleWord, investWords } from "./invest-words";
import { useAutoinvestRules } from "./use-rules";

/**
 * Spot's line while a rule's reminder is open for the token on the ticket:
 * the reminder is open, a purchase here does not close it — the rule counts
 * only a purchase by the rule — and the way to that purchase: the company's
 * page, the Review on the rule's sum. The rules are the wallet's, read only
 * behind its proof; the ticket, its figures and its path do not change.
 */
export function RuleReminderNotice({ mint, proven, locale, className }: Readonly<{ mint: string | null; proven: boolean; locale: WorkspaceLocale; className?: string }>) {
  const word = investWords(locale);
  const { state } = useAutoinvestRules(proven);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const rule = useMemo(() => (mint ? ruleForMint(state.rules, mint) : null), [state.rules, mint]);
  const due = rule ? reminderOpenNow(rule, nowMs) : null;
  if (!rule || !due) return null;
  return (
    <div className={className} role="note" data-rule-reminder>
      <b translate="no">{`${word("reminderOpenHere")} · ${usdWord(purchaseSumUsd(rule, due), locale)}`}</b>
      <span>{word("plainHereLeavesOpen")}</span>
      <Link href={rulePurchaseHref(rule, due.dueAt)} prefetch={false}>
        {buyByRuleWord(locale, purchaseSumUsd(rule, due))}
        <ArrowRight size={14} weight="bold" aria-hidden="true" />
      </Link>
    </div>
  );
}
