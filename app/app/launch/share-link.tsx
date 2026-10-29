"use client";

import { TelegramLogo, XLogo } from "@phosphor-icons/react";
import { Button } from "@ryntra/core/ui";
import { useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { localizedShareLink } from "@/lib/launch/share-link";

import { coreLang, LinkButton } from "./launch-blocks";
import { launchWords } from "./launch-words";
import styles from "./launch.module.css";

/**
 * A link to share, one tap to copy, one to post on X or in Telegram: the
 * creator's link to their token, or a person's link to the trade they just
 * made. A token's short address (SOL-L1e) is shared in the reader's language,
 * so its preview card speaks it too. `compact` leaves the address itself
 * off — beside a trade the actions say enough.
 */
export function ShareLink({
  link,
  symbol,
  locale,
  label,
  text,
  compact = false,
  bare = false,
}: {
  link: string;
  symbol: string;
  locale: WorkspaceLocale;
  /** The block's own words; the creator's «Share link» by default. */
  label?: string;
  /** The post's words; the launch's by default. */
  text?: string;
  compact?: boolean;
  /** In a block whose title already says it: no label of its own. */
  bare?: boolean;
}) {
  const word = launchWords(locale);
  const shared = localizedShareLink(link, locale);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shared);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  const words = text ?? word("shareText", { symbol });
  const post = `https://x.com/intent/post?text=${encodeURIComponent(words)}&url=${encodeURIComponent(shared)}`;
  const telegram = `https://t.me/share/url?url=${encodeURIComponent(shared)}&text=${encodeURIComponent(words)}`;
  return (
    <div className={compact ? `${styles.share} ${styles.shareCompact}` : styles.share}>
      {bare ? null : <span className={styles.shareLabel}>{label ?? word("share")}</span>}
      <div className={styles.shareRow}>
        {compact ? null : (
          <code className={styles.shareLink} title={shared}>
            {/* Shown without its scheme: the site, the token's letters and the code; the copy carries the whole link. */}
            {shared.replace(/^https?:\/\//, "").replace(/\?.*$/, "")}
          </code>
        )}
        <Button variant="secondary" icon={copied ? "check" : undefined} onClick={copy} aria-live="polite" lang={coreLang(locale)} className={styles.shareCopy}>
          {copied ? word("copied") : compact ? word("copyLink") : word("copy")}
        </Button>
        {/* Two places to post, side by side: each a logo and its name, the whole action read out and on hover. */}
        <LinkButton href={post} external label={word("shareOnX")}>
          <XLogo size={16} aria-hidden />X
        </LinkButton>
        <LinkButton href={telegram} external label={word("shareOnTelegram")}>
          <TelegramLogo size={16} aria-hidden />Telegram
        </LinkButton>
      </div>
    </div>
  );
}
