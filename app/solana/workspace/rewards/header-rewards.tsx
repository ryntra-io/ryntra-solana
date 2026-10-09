"use client";

import { Gift } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { dollars } from "@/lib/rewards/format";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { rankCopy } from "./rank-copy.ts";
import styles from "./header-rewards.module.css";

/**
 * «Винагороди» in the product's header, beside «Спитати Ryntra»: the way to
 * Rewards from every page, with what is ready to claim.
 *
 * Quiet like its neighbours. Money gathered in Rewards: its sum stands beside
 * the gift and a small orange light breathes on it — the one place on the
 * screen that says «there is something for you here», never the screen's own
 * action. Its name says honestly what the money is: «to claim» only when a
 * claim would go through (the minimum met, payouts on — the same rule as
 * Rewards), else «gathered · claim from $1». Money still on its way: the
 * light is there and still. On Rewards itself nothing breathes — the person
 * is already there. With reduced motion the light never moves. No wallet, no
 * proof, or nothing earned: the plain button.
 *
 * It asks `/api/rewards/balance` — a read and nothing else — when it appears,
 * on every page change, when the tab comes back, after a claim, and once a
 * minute while in view; a wallet without proof is not asked again until it
 * proves itself.
 */

const REFRESH_MS = 60_000;
/** Sent by Rewards after a claim, so the header does not keep offering money that left. */
export const REWARDS_CHANGED_EVENT = "ryntra-rewards-changed";
/** Sent when a wallet proves itself (the invitation line listens to the same). */
const WALLET_PROVEN_CHANNEL = "ryntra-wallet-proven";

/** Anything but nothing. «<0.01» counts — it is money too. */
function some(amount: string | null | undefined): amount is string {
  if (!amount) return false;
  if (amount.startsWith("<")) return true;
  const value = Number(amount);
  return Number.isFinite(value) && value > 0;
}

/** Under the minimum a claim needs — the only reason worth naming; past it, a claim is held back by something else (payouts paused). */
function belowMinimum(amount: string, minimum: string): boolean {
  return amount.startsWith("<") || Number(amount) < Number(minimum);
}

type Money = Readonly<{ address: string; available: string; pending: string; claimable: boolean; minimum: string }>;

export function HeaderRewards() {
  const { connection } = useSolanaConnection();
  const { locale } = useSolanaI18n();
  const words = rankCopy(locale);
  const pathname = usePathname() ?? "";
  const address = connection?.address ?? null;
  const [money, setMoney] = useState<Money | null>(null);
  /* A wallet the server refused (no proof): not asked again until it proves itself or changes. */
  const refused = useRef<string | null>(null);
  /* Several reads can be in flight (a page change, the minute, a claim): only the latest answer is kept. */
  const latest = useRef(0);
  const here = pathname === "/app/rewards" || pathname.startsWith("/app/rewards/");

  const read = useCallback(async () => {
    if (!address || refused.current === address || document.visibilityState !== "visible") return;
    const ask = ++latest.current;
    try {
      const response = await fetch(`/api/rewards/balance?address=${encodeURIComponent(address)}`, { headers: { accept: "application/json" } });
      if (ask !== latest.current) return;
      if (response.status === 401) {
        refused.current = address;
        setMoney(null);
        return;
      }
      if (!response.ok) return;
      const body = (await response.json()) as { address?: string; available?: string; pending?: string; claimable?: boolean; minimum?: string };
      if (ask !== latest.current) return;
      if (body.address === address && typeof body.available === "string") {
        setMoney({
          address,
          available: body.available,
          pending: typeof body.pending === "string" ? body.pending : "0.00",
          claimable: body.claimable === true,
          minimum: typeof body.minimum === "string" ? body.minimum : "1.00",
        });
      }
    } catch {
      /* The button works without the sum. */
    }
  }, [address]);

  /* On first sight and on every page change. */
  useEffect(() => {
    void read();
  }, [read, pathname]);

  useEffect(() => {
    if (!address) return undefined;
    const timer = window.setInterval(() => void read(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    const onChanged = () => void read();
    const proven = typeof BroadcastChannel === "function" ? new BroadcastChannel(WALLET_PROVEN_CHANNEL) : null;
    if (proven) {
      proven.onmessage = () => {
        refused.current = null;
        void read();
      };
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(REWARDS_CHANGED_EVENT, onChanged);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(REWARDS_CHANGED_EVENT, onChanged);
      proven?.close();
    };
  }, [address, read]);

  const mine = money && money.address === address ? money : null;
  const gathered = some(mine?.available) ? mine!.available : null;
  const coming = some(mine?.pending) ? mine!.pending : null;
  const light = gathered ? "breathing" : coming ? "still" : null;
  const title = gathered
    ? mine!.claimable
      ? words.headerReady(dollars(gathered))
      : belowMinimum(gathered, mine!.minimum)
        ? words.headerGathered(dollars(gathered), dollars(mine!.minimum.replace(/\.00$/, "")))
        : words.headerHeld(dollars(gathered))
    : coming
      ? words.headerPending(dollars(coming))
      : words.header;

  return (
    <Link
      className={styles.button}
      href="/app/rewards"
      prefetch={false}
      aria-label={title}
      title={title}
      aria-current={here ? "page" : undefined}
      data-light={light ?? undefined}
      data-here={here || undefined}
      data-header-rewards
    >
      <span className={styles.icon} aria-hidden="true">
        <Gift size={16} weight="bold" />
        {light ? <span className={styles.light} /> : null}
      </span>
      <span className={styles.label}>{words.header}</span>
      {gathered ? (
        <span className={styles.sum} translate="no">
          {dollars(gathered)}
        </span>
      ) : null}
    </Link>
  );
}
