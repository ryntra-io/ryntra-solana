"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import {
  ecosystemMaturityLabel,
  publicEcosystemEntries,
} from "@/lib/site/public-ecosystems";
import type { PublicLocale } from "@/lib/site/locale";
import type { PublicCopy } from "@/lib/site/public-copy";

import styles from "./chrome.module.css";

export function EcosystemMenu({
  copy,
  locale,
  stacked = false,
}: {
  copy: PublicCopy;
  locale: PublicLocale;
  stacked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrap = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const entries = publicEcosystemEntries();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (entries.length === 0) return null;

  return (
    <div className={stacked ? styles.ecoMenuStack : styles.ecoMenuWrap} ref={wrap}>
      <button
        type="button"
        ref={trigger}
        className={stacked ? styles.mobileLink : `${styles.navLink} ${styles.ecoMenuTrigger}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {copy.navEcosystems}
        <span className={styles.ecoMenuCaret} aria-hidden="true" />
      </button>

      <div className={stacked ? styles.ecoMenuInline : styles.ecoMenu} id={menuId} hidden={!open}>
        <ul className={styles.ecoMenuList}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link className={styles.ecoMenuItem} href={entry.href} onClick={() => setOpen(false)}>
                <span className={styles.ecoMenuLabel}>{entry.name}</span>
                <span className={styles.ecoMenuTags}>
                  {entry.description[locale]}
                </span>
                <span className={styles.ecoMenuMeta}>
                  {entry.environment ? `${copy.ecoEnvironment}: ${entry.environment}` : null}
                  {entry.environment ? " · " : null}
                  {copy.ecoMaturity}: {ecosystemMaturityLabel(entry.maturity, locale)}
                </span>
                <span className={styles.ecoMenuCta}>{copy.ecoOpen}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
