"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { formatPrice } from "@/app/app/launch/launch-format";
import { launchWords } from "@/app/app/launch/launch-words";
import type { LaunchMarketResponse } from "@/lib/api/v1/contract";

import { useSolanaI18n } from "../i18n/provider.tsx";
import styles from "./spot.module.css";

const API_HEADERS = { "X-Ryntra-API": "1" } as const;

/**
 * A token launched on Ryntra, in Spot (SOL-C10, UX-403): one line under the strip — where it was launched, its price
 * from the same read its launch page shows, and the way there. Spot's own figures keep their definitions; this line
 * only says which page is the token's own and what it reads now. Without the read the line keeps the link.
 */
export function LaunchHeaderLine({ mint }: { mint: string }) {
  const { locale } = useSolanaI18n();
  const word = launchWords(locale);
  const [market, setMarket] = useState<LaunchMarketResponse | null>(null);
  useEffect(() => {
    let live = true;
    setMarket(null);
    void fetch(`/api/v1/launch/${mint}/market`, { headers: API_HEADERS, cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as LaunchMarketResponse) : null))
      .then((answer) => {
        if (live) setMarket(answer);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [mint]);
  const price = market ? formatPrice(market.price.usd ?? market.price.pair, locale) : null;
  return (
    <p className={styles.launchLine} data-launch-line>
      <span>{word("spotLaunched")}</span>
      {market && price ? (
        <span title={price.plain}>
          {word("spotLaunchPrice", { price: market.price.usd !== null ? `$${price.text}` : `${price.text} ${market.pair.symbol}`, venue: word(market.venue === "curve" ? "spotLaunchCurve" : "spotLaunchPool") })}
        </span>
      ) : null}
      <Link href={`/app/launch/${mint}`}>{word("spotLaunchOpen")} →</Link>
    </p>
  );
}
