"use client";

import { ArrowSquareOut, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { rynHref } from "@/lib/agent/context";
import { usePagePath } from "@/lib/site/use-page-path";

import { AssistantCreditsBadge } from "./assistant-badge";
import { ASSISTANT_PANEL_ID, closeAssistant, useAssistantPanel } from "./assistant-open";
import "./assistant-panel.css";
import styles from "./assistant-panel.module.css";
import { RynSurface } from "./ryn-surface";
import { rynWordsFor } from "./ryn-words";

/**
 * The assistant Ryntra beside the page (AI-06a): the header's button on every
 * page of Ryntra on Solana opens this panel, and «Пояснити рух» on a token's
 * page opens it with the question asked. It is the same conversation as the
 * full page `/app/ryn` — the guest's or the proven wallet's, «Нова розмова»
 * and the list — in a column at the right; the full page keeps the morning
 * brief and the credits one press away.
 *
 * On a desk the page steps aside for it, so the chart is never covered; below
 * a desk it is a sheet over the page under the header. Escape and the close
 * button close it, the focus goes into the field as it opens and back to the
 * press that opened it as it closes; leaving the page closes it too, since
 * what it was opened about is that page.
 */
export function AssistantPanel({ locale }: { locale: WorkspaceLocale }) {
  const { open, request } = useAssistantPanel();
  const word = useMemo(() => rynWordsFor(locale), [locale]);
  const pathname = usePagePath();
  const panelRef = useRef<HTMLElement | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const openedOn = useRef<string | null>(null);

  /* The page steps aside on a desk while the panel is open: one attribute the stylesheet reads. */
  useEffect(() => {
    const root = document.documentElement;
    if (open) root.setAttribute("data-assistant-panel", "open");
    else root.removeAttribute("data-assistant-panel");
    return () => root.removeAttribute("data-assistant-panel");
  }, [open]);

  /* Opened: remember the press, move the focus into the field. Closed: give the focus back. */
  useEffect(() => {
    if (open) {
      const active = document.activeElement;
      returnTo.current = active instanceof HTMLElement && active !== document.body ? active : document.querySelector<HTMLElement>(".ryntra-header__assistant");
      const frame = requestAnimationFrame(() => (panelRef.current?.querySelector<HTMLElement>("textarea:not([disabled])") ?? panelRef.current?.querySelector<HTMLElement>("button:not([disabled])"))?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(frame);
    }
    const back = returnTo.current;
    returnTo.current = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
    return undefined;
  }, [open, request.seq]);

  /* Escape closes from inside the panel or from the header's button — never a page's own layer's Escape elsewhere. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      /* Focus that fell to the page's body (a field disabled while Ryntra reads) still belongs to the open panel. */
      const here = target === null || target === document.body || Boolean(panelRef.current?.contains(target) || (target instanceof Element && target.closest(".ryntra-header__assistant")));
      if (event.key === "Escape" && !event.defaultPrevented && here) closeAssistant();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /* Another page is another subject: the panel closes as the page changes. */
  useEffect(() => {
    if (open && openedOn.current === null) openedOn.current = pathname;
    if (!open) openedOn.current = null;
    else if (openedOn.current !== pathname) closeAssistant();
  }, [open, pathname]);

  /* AI-06b: the credits on the header's button live with the panel — mounted on every page the shell draws. */
  const badge = <AssistantCreditsBadge locale={locale} pathname={pathname} />;
  if (!open) return badge;
  return (
    <>
    {badge}
    <aside ref={panelRef} id={ASSISTANT_PANEL_ID} className={styles.panel} role="dialog" aria-modal="false" aria-label={word("panelLabel")} data-assistant-panel="">
      <header className={styles.head}>
        <h2 className={styles.title}>Ryntra</h2>
        <span className={styles.headEnd}>
          <Link className={styles.full} href={rynHref(request.context)} prefetch={false} aria-label={word("panelOpenFull")} title={word("panelOpenFull")} onClick={() => closeAssistant()}>
            <span>{word("panelOpenFull")}</span>
            <ArrowSquareOut size={14} weight="bold" aria-hidden="true" />
          </Link>
          <button type="button" className={styles.close} aria-label={word("panelClose")} title={`${word("panelClose")} · Esc`} onClick={() => closeAssistant()}>
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        </span>
      </header>
      <p className={styles.lead}>{word("lead")}</p>
      <div className={styles.body}>
        {/* A new opening is a new conversation view: the press's question is asked once, in that opening. */}
        <RynSurface key={request.seq} locale={locale} context={request.context} initialQuestion={request.ask} initialTab={request.tab} compact autoAsk={request.ask !== null} />
      </div>
    </aside>
    </>
  );
}
