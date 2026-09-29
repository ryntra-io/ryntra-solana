"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import styles from "./holdings.module.css";
import { dollars } from "@/lib/rewards/format";

/**
 * One line in Portfolio: what is waiting in Rewards, and the way there.
 *
 * ## Deliberately not part of the total
 *
 * The owner's instruction is explicit and the reasoning is worth keeping: an
 * unclaimed reward is a **claim against Ryntra**, not an asset in the person's
 * wallet. Adding it to portfolio value would mix two different kinds of thing
 * and would make the total disagree with what any block explorer says the
 * wallet holds. Once claimed, the USDC arrives on chain and the total picks it
 * up the way it picks up everything else — through the balance read, with no
 * special case anywhere.
 *
 * ## Deliberately not a second Rewards page
 *
 * A figure and a link. No sources breakdown, no referral panel, no claim
 * control. Rewards has a page; duplicating it here would be the second copy of
 * a surface that canon §3.2 exists to prevent, and it would give a person two
 * places to press Claim.
 *
 * It renders nothing at all until there is something to say — no wallet, no
 * proof, or a zero balance draws no row rather than an empty one.
 */
export function RewardsSummary() {
  const { connection } = useSolanaConnection();
  const { text, locale } = useSolanaI18n();
  const [available, setAvailable] = useState<string | null>(null);
  const address = connection?.address ?? null;

  useEffect(() => {
    if (!address) {
      setAvailable(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/rewards?address=${encodeURIComponent(address)}&locale=${locale}`);
        /* 401 is the ordinary answer for a wallet that has not proved itself.
           It is not an error and it is not worth a row. */
        if (!response.ok) return;
        const body = (await response.json()) as { available?: string };
        if (live && typeof body.available === "string") setAvailable(body.available);
      } catch {
        /* Portfolio must not fail because Rewards did. */
      }
    })();
    return () => {
      live = false;
    };
  }, [address, locale]);

  if (available === null || available === "0.00") return null;

  return (
    <Link className={styles.rewardsRow} href="/app/rewards">
      <span className={styles.rewardsLabel}>{text("Rewards")}</span>
      <span className={styles.rewardsValue} translate="no">
        {dollars(available)}
      </span>
      <span className={styles.rewardsGo} aria-hidden="true">
        →
      </span>
    </Link>
  );
}
