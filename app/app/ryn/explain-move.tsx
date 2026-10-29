"use client";

import { Bell, NotePencil, Sparkle } from "@phosphor-icons/react";
import { useEffect, useMemo } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";

import { ASSISTANT_PANEL_ID, closeAssistant, openAssistant, readAssistantPanel, useAssistantPanel, type AssistantTab } from "./assistant-open";
import styles from "./explain-move.module.css";
import { rynWordsFor } from "./ryn-words";

/**
 * Ryntra beside a token's price and over its chart — three presses that open
 * the assistant's side panel about this token:
 *
 * - «Пояснити рух» (AI-06a) asks «Що зрушило ціну …?» — the move with its
 *   sources, marked fact, unverified, inference or unknown; the cause is never
 *   claimed. A guest is answered too; a wallet's question is asked by itself
 *   only while the day's free credits pay for it.
 * - «Стежити» (AI-06) opens «Стежу» with this token chosen: a preset and
 *   «Увімкнути» are what is left.
 * - «План» (AI-06) opens «Плани»: this token's plans and a new one in the
 *   builder. Nothing here signs, trades or spends.
 */
export function ExplainMove({ mint, symbol, locale, className }: { mint: string; symbol: string | null; locale: WorkspaceLocale; className?: string }) {
  const word = useMemo(() => rynWordsFor(locale), [locale]);
  const { open, request } = useAssistantPanel();
  const aboutThis = open && request.context?.kind === "asset" && request.context.mint === mint;
  /* Spot changes its token without leaving the page: a panel about the token before is closed, not answered about the wrong one. */
  useEffect(() => {
    const now = readAssistantPanel();
    if (now.open && now.request.context?.kind === "asset" && now.request.context.mint !== mint) closeAssistant();
  }, [mint]);
  const name = symbol?.trim() || null;
  const context = { kind: "asset" as const, mint, ...(symbol ? { symbol } : {}) };
  const press = (tab: AssistantTab | null) => (tab === null ? openAssistant(context, name ? word("explainAsk").replace("{symbol}", name) : word("explainAskThis")) : openAssistant(context, null, tab));
  const actions = [
    { tab: null, label: word("explainMove"), Glyph: Sparkle, key: "explain" },
    { tab: "watch" as const, label: word("actWatch"), Glyph: Bell, key: "watch" },
    { tab: "plans" as const, label: word("actPlan"), Glyph: NotePencil, key: "plan" },
  ];
  return (
    <span className={styles.group} role="group" aria-label={name ? word("actsLabel").replace("{symbol}", name) : word("actsLabelThis")} data-assistant-actions="">
      {actions.map(({ tab, label, Glyph, key }) => (
        <button
          key={key}
          type="button"
          className={className ?? styles.explain}
          aria-controls={ASSISTANT_PANEL_ID}
          aria-expanded={aboutThis && (request.tab ?? null) === tab}
          data-explain-move={tab === null ? "" : undefined}
          data-assistant-action={key}
          title={label}
          onClick={() => press(tab)}
        >
          <Glyph size={14} weight="bold" aria-hidden="true" />
          <span className={styles.word}>{label}</span>
        </button>
      ))}
    </span>
  );
}
