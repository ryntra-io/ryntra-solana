"use client";

import { ArrowRight, NotePencil, Plus, Sparkle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PlanListResponse } from "@/lib/api/v1/contract";

import type { RynWord } from "./ryn-words";
import { useAssistantPlans, waitsForWord } from "./ryntra-plans";
import { TradePlanComposer } from "./trade-plan";
import { tradePlanWordsFor } from "./trade-plan-words";
import styles from "./plans-tab.module.css";

type Word = (w: RynWord) => string;

/**
 * «Плани» in the assistant's panel and page. AI-20 (UX-704): a trade plan has one home — «Боти» — and this tab leads
 * there instead of keeping a second list. It holds the two ways to start one: «Скласти з Ryntra» composes a plan with
 * its critic at the price shown before the press (AI-11), the builder writes one by hand — on this token when the panel
 * was opened about one — and one row to «Боти» says how many plans wait there, this token's and those composed with
 * Ryntra that still wait for the person's word. Ryntra writes a plan only on the person's word and trades nothing.
 */
export function PlansTab({ locale, word, mint, symbol, active }: { locale: WorkspaceLocale; word: Word; mint: string | null; symbol: string | null; /** Kept for the panel's call; AI-11 composes a plan in the tab instead of asking in the conversation. */ onAsk?: (question: string) => void; active: boolean }) {
  const w = tradePlanWordsFor(locale);
  const [plans, setPlans] = useState<PlanListResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [composing, setComposing] = useState(false);
  const ryntra = useAssistantPlans(active, locale);

  /* Read when the tab is first shown: a person who never opens it costs no read. Only the counts are drawn here. */
  useEffect(() => {
    if (!active || plans !== null) return undefined;
    let live = true;
    void fetch("/api/v1/plans", { headers: { accept: "application/json", "X-Ryntra-API": "1" }, credentials: "same-origin" })
      .then((response) => (response.ok ? (response.json() as Promise<PlanListResponse>) : Promise.reject(new Error(String(response.status)))))
      .then((body) => {
        if (!live) return;
        setFailed(false);
        setPlans(body);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [active, plans]);

  const name = symbol?.trim() || (mint ? `${mint.slice(0, 4)}…` : null);
  const newHref = mint ? `/app/strategies/new?mint=${encodeURIComponent(mint)}` : "/app/strategies/new";
  /* «Боти» holds the person's plans and, above them, Ryntra's drafts that wait for their word: the counts are of both. */
  const drafts = ryntra.read ? ryntra.read.plans.filter(waitsForWord) : [];
  const waiting = drafts.length;
  const here = mint && plans ? plans.plans.filter((plan) => plan.asset.mint === mint).length + drafts.filter((plan) => plan.mint === mint).length : 0;
  const counts = plans
    ? [
        word("plansCount").replace("{n}", String(plans.total + waiting)),
        ...(name && here > 0 ? [word("plansCountOn").replace("{symbol}", name).replace("{n}", String(here))] : []),
        ...(waiting > 0 ? [word("plansWaiting").replace("{n}", String(waiting))] : []),
      ].join(" · ")
    : null;

  return (
    <div className={styles.tab}>
      <p className={styles.lead}>{word("plansLead")}</p>
      {composing ? (
        <TradePlanComposer locale={locale} mint={mint} symbol={symbol} prices={ryntra.read?.prices ?? null} onCancel={() => setComposing(false)} />
      ) : (
        <div className={styles.actions}>
          <button type="button" className="rw-btn rw-btn--primary" onClick={() => setComposing(true)}>
            <Sparkle size={14} weight="bold" aria-hidden="true" />
            <span>{w("compose")}</span>
          </button>
          <Link className="rw-btn" href={newHref} prefetch={false}>
            <Plus size={14} weight="bold" aria-hidden="true" />
            <span>{name ? word("plansNew").replace("{symbol}", name) : word("plansNewAny")}</span>
          </Link>
        </div>
      )}
      <Link className={styles.home} href="/app/bots" prefetch={false} data-plans-home="">
        <NotePencil size={18} aria-hidden="true" className={styles.homeIcon} />
        <span className={styles.homeTitle}>{word("plansHome")}</span>
        <span className={styles.homeMeta} aria-busy={plans === null && !failed ? true : undefined}>
          {counts ?? (failed ? word("plansFailed") : word("loadingList"))}
        </span>
        <ArrowRight size={16} weight="bold" aria-hidden="true" className={styles.homeArrow} />
      </Link>
    </div>
  );
}
