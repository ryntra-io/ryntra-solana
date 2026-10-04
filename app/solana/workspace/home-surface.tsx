"use client";

/**
 * Home — the start of Ryntra.
 *
 * A person lands here and has four questions in this order: what do I have, is
 * anything moving, what happened lately, and what can I do next. The page
 * answers them in that order and stops. It is not a metrics dashboard, and it
 * does not fill space with cards for capabilities that do not exist yet.
 *
 * ## What it refuses to do
 *
 * **An unknown price is not zero.** The value line counts what could be priced
 * and says plainly how many holdings could not, because a portfolio total that
 * silently drops unpriced assets is a number that lies in the direction of
 * comfort. Holdings applies the same rule and this reuses its arithmetic
 * wholesale rather than repeating it differently.
 *
 * **Nothing is narrated.** A number, a state, a time — drawn as a value with a
 * chip, never as a sentence about a value. That rule is the reason there is
 * no explanatory paragraph anywhere below.
 *
 * **In motion appears only when something is in motion.** A row reading "0 in
 * motion" is a fact nobody came for, and a resting screen that lists its own
 * emptiness reads as a product with nothing in it.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowsLeftRight, ArrowLineRight, Path, QrCode } from "@phosphor-icons/react";

import { Panel } from "@/app/shell/panel";
import { crossSwapTarget, type SolanaActionLane, type SolanaActionOutcome } from "@/lib/solana/action-lanes";
import { displayAmount } from "@/lib/solana/amounts";
import { useSolanaConnection } from "./connection.tsx";
import { useSolanaI18n } from "./i18n/provider.tsx";
import { WalletGate } from "./wallet-gate.tsx";
import styles from "./home-surface.module.css";

const BASE = "/app";

type Catalog = Readonly<{ usdPrice: string | null }>;

type Holding = Readonly<{
  mint: string | null;
  amountRaw: string;
  decimals: number;
  symbol: string | null;
  catalog?: Catalog | null;
}>;

type Action = Readonly<{
  actionId: string;
  /* The ledger's own unions, not a copy of them: this list was written by hand
     and then stayed still while the ledger grew a cross-chain lane and an
     Ethereum destination, so every cross-chain swap on this feed read "Sent". */
  lane: SolanaActionLane;
  outcome: SolanaActionOutcome;
  destination: "BASE" | "SOLANA" | "ETHEREUM" | null;
  out: Readonly<{ amountRaw: string; decimals: number | null; symbol: string | null }> | null;
  in: Readonly<{ amountRaw: string; decimals: number | null; symbol: string | null }> | null;
  updatedAt: string;
}>;

/** USD micros for one holding, or null when nothing can price it. */
function valueUsdMicros(holding: Holding): bigint | null {
  const price = holding.catalog?.usdPrice ?? null;
  if (price === null || !/^\d+(\.\d+)?$/.test(price)) return null;
  const [whole, fraction = ""] = price.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  let amount: bigint;
  try {
    amount = BigInt(holding.amountRaw);
  } catch {
    return null;
  }
  return (amount * micros) / 10n ** BigInt(holding.decimals);
}

function formatUsd(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const cents = (micros % 1_000_000n) / 10_000n;
  return `${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

export function HomeSurface() {
  const { text } = useSolanaI18n();
  const { connection } = useSolanaConnection();
  const address = connection?.address ?? null;

  const [holdings, setHoldings] = useState<readonly Holding[] | null>(null);
  const [actions, setActions] = useState<readonly Action[] | null>(null);

  useEffect(() => {
    if (!address) {
      setHoldings(null);
      setActions(null);
      return;
    }
    let live = true;
    const body = JSON.stringify({ owner: address, network: "mainnet" });
    const headers = { "content-type": "application/json" };
    void (async () => {
      const [held, did] = await Promise.all([
        fetch("/api/solana/holdings", { method: "POST", headers, body })
          .then((response) => response.json())
          .catch(() => null),
        fetch("/api/solana/activity", { method: "POST", headers, body })
          .then((response) => response.json())
          .catch(() => null),
      ]);
      if (!live) return;
      setHoldings(held?.data?.holdings ?? []);
      setActions(did?.data?.actions ?? []);
    })();
    return () => {
      live = false;
    };
  }, [address]);

  if (!address) {
    /* Named for what it will hold rather than "Home", which the page heading
       directly above already says — two identical headings stacked is a defect
       a reader has to resolve. A person sees the panel they are about to get. */
    return (
      <Panel id="ry-home-gate" title={text("Portfolio value")} w={12} h={4} essential stretch>
        <WalletGate title={text("Connect a wallet to see what you hold and what is moving.")} />
      </Panel>
    );
  }

  const priced = (holdings ?? []).map(valueUsdMicros);
  const total = priced.reduce<bigint>((sum, value) => (value === null ? sum : sum + value), 0n);
  const pricedCount = priced.filter((value) => value !== null).length;
  const unpriced = priced.length - pricedCount;

  const moving = (actions ?? []).filter(
    (action) => action.outcome === "IN_FLIGHT" || action.outcome === "NEEDS_YOU",
  );
  /* Six, not three. Three was measured against a disconnected page; with a
     wallet the panel had three rows in a 490px body and the page as a whole
     used 560px of a 1156px canvas. */
  const recent = (actions ?? []).slice(0, 6);

  return (
    <>
      <Panel id="ry-home-value" title={text("Portfolio value")} w={8} h={4} essential metric>
        <div className={styles.value}>
        <p className={styles.valueAmount} translate="no">
          <span className={styles.valueCurrency}>$</span>
          {holdings === null ? "—" : formatUsd(total)}
        </p>
        <dl className={styles.valueFacts}>
          <div className={styles.fact}>
            <dt>{text("Priced assets")}</dt>
            <dd translate="no">{holdings === null ? "—" : pricedCount}</dd>
          </div>
          {unpriced > 0 ? (
            <div className={styles.fact} data-tone="unknown">
              <dt>{text("No price")}</dt>
              <dd translate="no">{unpriced}</dd>
            </div>
          ) : null}
          {moving.length > 0 ? (
            <div className={styles.fact} data-tone="motion">
              <dt>{text("In motion")}</dt>
              <dd translate="no">{moving.length}</dd>
            </div>
          ) : null}
        </dl>

      <nav className={styles.actions} aria-label={text("Money")}>
        <Link className={styles.action} data-primary="true" href={`${BASE}/swap`}>
          <ArrowsLeftRight size={20} weight="bold" aria-hidden />
          <span>{text("Swap")}</span>
        </Link>
        <Link className={styles.action} href={`${BASE}/send`}>
          <ArrowLineRight size={20} weight="bold" aria-hidden />
          <span>{text("Send")}</span>
        </Link>
        <Link className={styles.action} href={`${BASE}/receive`}>
          <QrCode size={20} weight="bold" aria-hidden />
          <span>{text("Receive")}</span>
        </Link>
        <Link className={styles.action} href={`${BASE}/bridge`}>
          <Path size={20} weight="bold" aria-hidden />
          <span>{text("Bridge")}</span>
        </Link>
      </nav>
        </div>
      </Panel>

      <Panel id="ry-home-motion" title={text("In motion")} w={4} h={4} essential>
        {moving.length === 0 ? (
          <p className={styles.empty}>
            <span className={styles.emptyLead}>{text("Nothing is moving right now.")}</span>
            <span>{text("Everything you send, swap or bridge shows here while it travels.")}</span>
          </p>
        ) : (
          <ul className={styles.rows}>
            {moving.map((action) => (
              <li key={action.actionId} className={styles.row}>
                <span className={styles.rowWhat}>{describe(action, text)}</span>
                <span className={styles.rowState} data-outcome={action.outcome}>
                  {stateWord(action.outcome, text)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        id="ry-home-recent"
        title={text("Recent")}
        w={12}
        /* Eleven rows in all, which is the intended canvas with a foot rather
           than 596px of dead page under a connected Home. */
        h={7}
        essential
        scroll
        actions={
          <Link className={styles.seeAll} href={`${BASE}/history`}>
            {text("See all")}
          </Link>
        }
      >
        {actions !== null && actions.length === 0 ? (
          <p className={styles.empty}>
            <span className={styles.emptyLead}>{text("Nothing has moved yet.")}</span>
            <span>{text("Your first transfer appears here.")}</span>
          </p>
        ) : (
          <ul className={styles.rows}>
            {recent.map((action) => (
              <li key={action.actionId} className={styles.row}>
                <span className={styles.rowWhat}>{describe(action, text)}</span>
                <span className={styles.rowWhen} translate="no">
                  {action.updatedAt.slice(0, 10)}
                </span>
                <span className={styles.rowState} data-outcome={action.outcome}>
                  {stateWord(action.outcome, text)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function leg(movement: Action["out"]): string | null {
  if (movement === null) return null;
  if (movement.decimals === null) return movement.symbol;
  const amount = displayAmount(movement.amountRaw, movement.decimals);
  return movement.symbol === null ? amount : `${amount} ${movement.symbol}`;
}

function describe(action: Action, text: (value: string) => string): string {
  const out = leg(action.out);
  const got = leg(action.in);
  if (action.lane === "BRIDGE") {
    const amount = action.destination === "SOLANA" ? (got ?? out) : (out ?? got);
    if (action.destination === null) {
      return amount === null
        ? text("Moved between chains")
        : `${text("Moved")} ${amount} ${text("between chains")}`;
    }
    const where = action.destination === "SOLANA" ? text("to Solana") : text("to Base");
    return amount === null ? `${text("Moved")} ${where}` : `${text("Moved")} ${amount} ${where}`;
  }
  if (action.lane === "SWAP") {
    if (out !== null && got !== null) return `${text("Swapped")} ${out} → ${got}`;
    return out === null ? text("Swapped") : `${text("Swapped")} ${out}`;
  }
  if (action.lane === "CROSS_SWAP") {
    const head = out !== null && got !== null
      ? `${text("Swapped across chains")} ${out} → ${got}`
      : out !== null ? `${text("Swapped across chains")} ${out}` : text("Swapped across chains");
    const target = crossSwapTarget(action.destination, text);
    return target === null ? head : `${head} ${target}`;
  }
  if (action.lane === "RECEIVE") {
    return got === null ? text("Received") : `${text("Received")} ${got}`;
  }
  return out === null ? text("Sent") : `${text("Sent")} ${out}`;
}

function stateWord(outcome: Action["outcome"], text: (value: string) => string): string {
  if (outcome === "DONE") return text("Arrived");
  if (outcome === "FAILED") return text("Did not happen");
  if (outcome === "NEEDS_YOU") return text("Needs you");
  return text("On its way");
}
