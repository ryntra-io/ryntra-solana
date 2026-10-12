"use client";

import { Gift, X } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { useReferral } from "./referral-card.tsx";
import { referralCopy } from "./referral-copy.ts";
import styles from "./invite.module.css";

/**
 * One line above every product page: who invited this browser — before the
 * first trade, not after — and, the moment it binds, that it did.
 *
 * A friend's link used to land on «Винагороди» and nowhere else. Somebody who
 * went on to Swap or a token page traded without ever seeing the invitation,
 * and the inviter waited for a friend who never appeared under them. The line
 * follows the person through the product until the invitation is confirmed,
 * dismissed, or too late; it is hidden on «Винагороди» itself, where the full
 * card leads the page.
 *
 * Reads the same `GET /api/rewards/referral` the card reads — which, for a
 * proven wallet, binds the carried invitation on its own; the line then says
 * so («Ви в Ryntra за запрошенням …») until it is hidden or the tab's session
 * ends — it is shown once per tab session.
 * "Hide" hides it for this tab's session only — the invitation itself is
 * untouched, and «Винагороди» still shows it.
 *
 * Mounted by the core's product shell (`app/app/product-shell.tsx`), which is
 * the core's file.
 */
export function InviteBanner() {
  const pathname = usePathname() ?? "";
  const { connection } = useSolanaConnection();
  const { locale } = useSolanaI18n();
  const words = referralCopy(locale);
  const address = connection?.address ?? null;
  const onRewards = pathname.startsWith("/app/rewards");
  const { state, load } = useReferral(address, false, null, !onRewards);

  /* The line lives in the shell and is not remounted between pages, so it
     asks again when something may have changed: a wallet proven anywhere on
     the page (the account channel after a header sign-in; `ryntra-wallet-proven`
     once the core announces every proof — a request to it), a return to the
     tab (twice: the proof cookie may land a moment after the wallet's window
     closes), a move to another page. Each read is also the moment the carried
     invitation binds for a wallet that has just been proven. Focus and page
     changes ask only while an invitation is carried — nobody else's reads go
     to the shared limiter. */
  const loadRef = useRef(load);
  loadRef.current = load;
  const carrying = useRef(false);
  carrying.current = Boolean(state?.pending);
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; return; }
    if (!onRewards && carrying.current) void loadRef.current();
  }, [pathname, onRewards]);
  useEffect(() => {
    if (onRewards) return;
    let timer: number | undefined;
    const again = () => { void loadRef.current(); };
    const onFocus = () => {
      if (!carrying.current) return;
      again();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (carrying.current) again(); }, 2_500);
    };
    window.addEventListener("focus", onFocus);
    const channels = typeof BroadcastChannel === "undefined"
      ? []
      : ["ryntra-account-context", "ryntra-wallet-proven"].map((name) => {
          const channel = new BroadcastChannel(name);
          channel.onmessage = again;
          return channel;
        });
    return () => {
      window.removeEventListener("focus", onFocus);
      for (const channel of channels) channel.close();
      window.clearTimeout(timer);
    };
  }, [onRewards]);

  /* «You joined with …» is held once seen, for that wallet: a later read of
     the same binding answers without `bound` and must not take the news away;
     another wallet — or none — must never inherit it. Only «Hide», a change of
     wallet or the end of the tab's session ends it. */
  const [boundSeen, setBoundSeen] = useState<Readonly<{ address: string; inviter: string }> | null>(null);
  /* `state` is only ever the answer read for this `address` (useReferral tags
     it), and the news is dropped the moment the wallet changes. */
  useEffect(() => {
    setBoundSeen((seen) => (seen && seen.address !== address ? null : seen));
  }, [address]);
  useEffect(() => {
    if (state?.bound && state.confirmed && address) setBoundSeen({ address, inviter: state.confirmed.inviterMasked });
  }, [state, address]);
  const bound = boundSeen && boundSeen.address === address ? boundSeen.inviter : null;
  const pending = bound ? null : (state?.pending ?? null);
  const inviter = bound ?? pending?.inviterMasked ?? null;
  const hideKey = bound ? `ryntra-invite-bound:${address}` : pending?.code ? `ryntra-invite-hidden:${pending.code}` : null;
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (!hideKey) return;
    try {
      setHidden(window.sessionStorage.getItem(hideKey) === "1");
      /* "You joined with …" is news once: the next mount in this tab is quiet. */
      if (bound) window.sessionStorage.setItem(hideKey, "1");
    } catch { setHidden(false); }
  }, [hideKey, bound]);

  const visible = !onRewards && Boolean(inviter) && !hidden && (bound !== null || !(state?.confirmed || state?.binding?.open === false));
  const lead = inviter ? (bound ? words.bannerBound(inviter) : words.bannerLead(inviter)) : "";

  /* The news of a binding goes into a live region mounted before it arrives,
     so a screen reader announces it; the line itself is not a live region. */
  const announcement = <span className={styles.live} role="status" aria-live="polite">{visible && bound ? lead : ""}</span>;
  if (!visible || !inviter) return announcement;

  return (
    <>
    {announcement}
    <aside className={styles.banner} data-invite-banner={bound ? "bound" : "pending"} aria-label={words.bannerLabel}>
      <Gift size={16} weight="bold" aria-hidden="true" className={styles.glyph} />
      <span className={styles.lead}>
        {lead.split(inviter).flatMap((part, index) =>
          index === 0 ? [part] : [<b key={index} translate="no">{inviter}</b>, part])}
      </span>
      <Link className={styles.action} href="/app/rewards">{words.bannerAction}</Link>
      <button
        type="button"
        className={styles.hide}
        aria-label={words.bannerHide}
        title={words.bannerHide}
        onClick={() => {
          setHidden(true);
          try { if (hideKey) window.sessionStorage.setItem(hideKey, "1"); } catch { /* hidden for this render only */ }
        }}
      >
        <X size={14} weight="bold" aria-hidden="true" />
      </button>
    </aside>
    </>
  );
}
