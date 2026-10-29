"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { BudgetSheet } from "@/app/app/invest/budget-sheet";
import { readShelfCopy } from "@/app/app/invest/shelf-copy";
import { isShelfCards } from "@/app/app/invest/shelf-ui";
import { RuleTokenPicker, type RulePick } from "@/app/app/invest/rule-token-picker";
import { useAutoinvestRules } from "@/app/app/invest/use-rules";
import { AutoinvestSheet } from "@/app/app/stocks/[ticker]/autoinvest-sheet";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { openSolanaConnection } from "@/app/solana/workspace/connection-trigger.client";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import { rulePurchaseHref } from "@/lib/autoinvest/links";
import type { ShelfCard } from "@/lib/stocks/shelf";

import { botsWords } from "./bots-words";

/**
 * «Обрати токен» (SOL-C15, UX-701): the one way to a recurring-buy rule from «Боти» and «Каталог» — the press opens the
 * token picker, the pick opens the rule's own sheet on that token, the same sheet the company's page, Spot's «Регулярна
 * купівля» and «Додати правило» draw. Two presses to the form, never a detour through Markets.
 *
 * A guest fills the rule as it is; the sheet's one button is «Підключити гаманець» — the header's own panel (B14) — and
 * the sheet comes back as it was once the wallet is connected (within a minute and a half, as on the company's page).
 * Nothing is written before the wallet is confirmed; every purchase is still the person's own signature.
 */
export function RecurringStart({ locale, className }: { locale: WorkspaceLocale; className: string }) {
  const start = useRecurringStart(locale);
  return (
    <>
      <RecurringStartButton locale={locale} className={className} onOpen={start.open} />
      {start.sheets}
    </>
  );
}

/** The press «Обрати токен» — the button only; the sheets live where `useRecurringStart` is held. */
export function RecurringStartButton({ locale, className, onOpen }: { locale: WorkspaceLocale; className: string; onOpen: () => void }) {
  return (
    <button type="button" className={className} onClick={onOpen} aria-haspopup="dialog" data-recurring-start="">
      {botsWords(locale)("pickToken")}
      <ArrowRight size={14} weight="bold" aria-hidden="true" />
    </button>
  );
}

/**
 * The picker and the rule's sheet, held by a page part that stays mounted while the wallet connects: «Боти» swaps the
 * guest's cards for the wallet's blocks the moment a wallet appears, and the sheet must come back over them as it was.
 */
export function useRecurringStart(locale: WorkspaceLocale): Readonly<{ open: () => void; sheets: ReactNode }> {
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const proven = proof.state.status === "proven";
  const [picked, setPicked] = useState<RulePick | null>(null);
  /* The rules are read only while the sheet is open — the page's own list reads them otherwise. */
  const { state, create, setStatus, remove, setBudget, clearBudget, markOwn } = useAutoinvestRules(proven && picked !== null);
  const [picking, setPicking] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [popular, setPopular] = useState<readonly ShelfCard[]>([]);
  useEffect(() => {
    if (picking) setPopular(readShelfCopy("popular", isShelfCards) ?? []);
  }, [picking]);

  /* A rule written behind a proof the sheet just made: the page's proof follows. */
  const recheck = proof.recheck;
  const createRule = useCallback<typeof create>(
    async (request) => {
      const result = await create(request);
      if (!proven) void recheck();
      return result;
    },
    [create, proven, recheck],
  );

  /* One way to connect: the header's own panel; the sheet steps aside first, or the panel would sit under it. */
  const [resume, setResume] = useState<RulePick | null>(null);
  const connectFirst = useCallback(() => {
    setResume(picked);
    setPicked(null);
    window.requestAnimationFrame(() => openSolanaConnection());
  }, [picked]);
  useEffect(() => {
    if (!resume) return undefined;
    if (connection) {
      setPicked(resume);
      setResume(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setResume(null), 90_000);
    return () => window.clearTimeout(timer);
  }, [resume, connection]);

  const open = useCallback(() => setPicking(true), []);
  const sheets = (
    <>
      <RuleTokenPicker
        open={picking}
        locale={locale}
        owned={[]}
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
        onConnect={connectFirst}
        onCreate={createRule}
        onSetStatus={setStatus}
        onRemove={remove}
        onEditBudget={() => setBudgetOpen(true)}
        onMarkOwn={markOwn}
        onBuyNow={(rule, occurrence) => {
          setPicked(null);
          window.location.assign(rulePurchaseHref(rule, occurrence.dueAt));
        }}
      />
      <BudgetSheet open={budgetOpen} budget={state.budget} locale={locale} onClose={() => setBudgetOpen(false)} onSave={setBudget} onClear={clearBudget} />
    </>
  );
  return { open, sheets };
}
