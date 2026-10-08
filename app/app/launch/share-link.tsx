"use client";

import { Check, Copy, XLogo } from "@phosphor-icons/react";
import { useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";

import { launchWords } from "./launch-words";
import styles from "./launch.module.css";

/**
 * A link to share, one tap to copy, one to post: the creator's link to their
 * token, or a person's link to the trade they just made. `compact` leaves the
 * address itself off — beside a trade the two actions say enough.
 */
export function ShareLink({
  link,
  symbol,
  locale,
  label,
  text,
  compact = false,
}: {
  link: string;
  symbol: string;
  locale: WorkspaceLocale;
  /** The block's own words; the creator's «Share link» by default. */
  label?: string;
  /** The post's words; the launch's by default. */
  text?: string;
  compact?: boolean;
}) {
  const word = launchWords(locale);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  const post = `https://x.com/intent/post?text=${encodeURIComponent(text ?? word("shareText", { symbol }))}&url=${encodeURIComponent(link)}`;
  return (
    <div className={compact ? `${styles.share} ${styles.shareCompact}` : styles.share}>
      <span className={styles.shareLabel}>{label ?? word("share")}</span>
      <div className={styles.shareRow}>
        {compact ? null : (
          <code className={styles.shareLink} title={link}>
            {/* Shown short — the address and the code; the copy carries the whole link with the token's page. */}
            {link.replace(/^https?:\/\//, "").replace(/\?.*$/, "")}
          </code>
        )}
        <button type="button" className="rw-btn" onClick={copy} aria-live="polite">
          {copied ? <Check size={16} weight="bold" aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied ? word("copied") : compact ? word("copyLink") : word("copy")}
        </button>
        <a className="rw-btn" href={post} target="_blank" rel="noreferrer noopener">
          <XLogo size={16} aria-hidden />
          {word("shareOnX")}
        </a>
      </div>
    </div>
  );
}
