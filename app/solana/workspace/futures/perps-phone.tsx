"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { Icon } from "@ryntra/core/ui";

import { perpsWord } from "./perps-words";

import styles from "./perps.module.css";

type Lang = "en" | "uk";
export type PerpSide = "long" | "short";

/**
 * The order's place on a phone (spec §15): not a desk's form squeezed into the width, but two large buttons — Long and
 * Short — each opening the order on a screen of its own. While an order is under way (a Review, a signature, a
 * position's own form), one more button leads back to it.
 */
export function PhoneTicketLauncher({ coin, lang, busy, onOpen, onResume }: { coin: string; lang: Lang; busy: boolean; onOpen: (side: PerpSide) => void; onResume: () => void }) {
  const w = (key: Parameters<typeof perpsWord>[1], fill?: Readonly<Record<string, string>>) => perpsWord(lang, key, fill);
  return (
    <div className={styles.launcher} data-perps-launcher>
      {busy ? (
        <button type="button" className={styles.resume} onClick={onResume} data-perps-resume>
          {w("phone.resume")}
        </button>
      ) : null}
      <div className={styles.launcherSides}>
        <button type="button" className={styles.launchSide} data-side-button="long" onClick={() => onOpen("long")} data-perps-open="long">
          {w("action.long", { coin })}
        </button>
        <button type="button" className={styles.launchSide} data-side-button="short" onClick={() => onOpen("short")} data-perps-open="short">
          {w("action.short", { coin })}
        </button>
      </div>
      <p className={styles.muted}>{w("phone.note")}</p>
    </div>
  );
}

/**
 * The order on a phone's whole screen (spec §15): a modal dialog over the page and the menu, its own scroll, so the
 * keyboard never covers the Review; Esc or ✕ closes it — what was typed, a Review or a signature on its way stays with
 * the ticket.
 */
export function PhoneTicketScreen({ open, coin, lang, onClose, children }: { open: boolean; coin: string; lang: Lang; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      if (typeof node.showModal === "function") node.showModal();
      else node.setAttribute("open", "");
    } else if (!open && node.open) node.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className={styles.phoneScreen}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      data-perps-phone-ticket
    >
      <header className={styles.sheetHead}>
        <h2 id={title} translate="no">{perpsWord(lang, "phone.title", { coin })}</h2>
        <button type="button" className={styles.iconButton} aria-label={perpsWord(lang, "phone.close")} onClick={onClose}>
          <Icon name="x" size={20} />
        </button>
      </header>
      <div className={styles.phoneBody}>{open ? children : null}</div>
    </dialog>
  );
}
