"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";

import { creditBadgeShort, creditCompact, creditNumber, creditsWord, loadCredits, useCredits } from "./credits-store";
import styles from "./assistant-panel.module.css";

const BUTTON = ".ryntra-header__assistant";

/**
 * The credits on the header's button (AI-06b): a small figure beside «Ryntra» on every page that has the button, so
 * the balance is one glance away without opening the assistant. The core's header has no slot for it, so the figure
 * is drawn into its button (`.ryntra-header__assistant`) — the request for a slot of its own is in line A's handoff.
 * Only for a proven wallet with a balance: zero says nothing new, and a guest has no credits.
 */
export function AssistantCreditsBadge({ locale, pathname }: { locale: WorkspaceLocale; pathname: string }) {
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const owner = proof.state.status === "proven" && proof.state.address === address ? address : null;
  const credits = useCredits(owner);
  const [button, setButton] = useState<HTMLElement | null>(null);

  /* The button is the core's: found after each page change (the assistant's own page has none), and again if the header redraws it. */
  useEffect(() => {
    let frame = 0;
    const find = () => setButton((current) => {
      const next = document.querySelector<HTMLElement>(BUTTON);
      return current === next ? current : next;
    });
    find();
    /* The whole page, not the header found once: a header drawn anew without a page change is found too — looked up once a frame at most. */
    const watch = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(() => {
        frame = 0;
        find();
      });
    });
    watch.observe(document.body, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [pathname]);

  useEffect(() => {
    if (owner && button) loadCredits(owner);
  }, [owner, button]);

  if (!button || !credits || credits.balance <= 0) return null;
  const full = `${creditNumber(credits.balance, locale)} ${creditsWord(credits.balance, locale)}`;
  return createPortal(
    <span className={styles.badge} title={full} data-assistant-credits="">
      <span className={styles.badgeFull} aria-hidden="true">
        {creditCompact(credits.balance, locale)}
      </span>
      <span className={styles.badgeShort} aria-hidden="true">
        {creditBadgeShort(credits.balance)}
      </span>
      <span className={styles.srOnly}>{full}</span>
    </span>,
    button,
  );
}
