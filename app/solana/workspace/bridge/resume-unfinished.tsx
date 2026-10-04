"use client";

/**
 * The way back into a transfer that is still in the air.
 *
 * Bridge is out of the menu, and that is safe — a cross-network route is
 * chosen by picking assets and networks inside Swap, so there was never a
 * second product to remove. What the menu entry *also* was, and what nothing
 * else replaced, is the door back to an unfinished transfer: the CCTP and
 * Mayan engines remember a run across a closed tab, but each of them only
 * reads its own memory **while it is mounted**, and each is mounted only for
 * its own pair. Open Swap on the default SOL → USDC and a burn that already
 * happened on Base is invisible.
 *
 * That is exactly the failure the rule *completing the first transaction does
 * not mark the whole operation complete* exists for — arriving through the
 * navigation rather than through the money. So this reads both memories
 * unconditionally, on any pair, and offers the one thing that fixes it: the
 * pair that mounts the engine which owns the run.
 *
 * It states what it knows and nothing more. It does not say the money is safe,
 * it does not say how far along the transfer is, and it does not re-price
 * anything: those answers belong to the engine, which is one press away.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";

import { readBridgeRun } from "@/lib/solana/bridge-run.client";
import { CROSS_SWAP_TUPLES, type CrossSwapTupleId } from "@/lib/swap/catalog";
import { useSolanaI18n } from "../i18n/provider";
import styles from "./resume-unfinished.module.css";

/** The cross-swap engine's own key. Read here, never written here. */
const CROSS_RUN_KEY = "ryntra.solana.cross-swap-run.v1";

const BRIDGE_PAIR: Readonly<Record<string, Readonly<{ from: string; to: string }>>> = {
  SOLANA_TO_BASE: { from: "solana", to: "base" },
  BASE_TO_SOLANA: { from: "base", to: "solana" },
  SOLANA_TO_ETHEREUM: { from: "solana", to: "ethereum" },
  ETHEREUM_TO_SOLANA: { from: "ethereum", to: "solana" },
};

type Unfinished = Readonly<{ href: string; kind: "transfer" | "swap" }>;

function swapHref(from: { network: string; asset: string }, to: { network: string; asset: string }) {
  return `/app/swap?from=${from.network}&fa=${from.asset}&to=${to.network}&ta=${to.asset}`;
}

/** What the browser remembers, resolved into the pair that reopens it. */
function findUnfinished(storage: Storage): Unfinished | null {
  /* Mayan first: a cross-chain swap is the newer lane and the one whose run key
     carries the pair outright. */
  try {
    const raw = storage.getItem(CROSS_RUN_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const tupleId =
        typeof parsed === "object" && parsed !== null
          ? (parsed as { tupleId?: unknown }).tupleId
          : undefined;
      const tuple = CROSS_SWAP_TUPLES.find((entry) => entry.id === (tupleId as CrossSwapTupleId));
      if (tuple) return { href: swapHref(tuple.from, tuple.to), kind: "swap" };
      if (typeof parsed === "object" && parsed !== null && /^0x[0-9a-f]{64}$/.test(String((parsed as { intentDigest?: unknown }).intentDigest))) {
        return { href: "/app/bridge", kind: "swap" };
      }
    }
  } catch {
    /* Unreadable storage is not an unfinished transfer. Say nothing. */
  }

  try {
    const run = readBridgeRun(storage);
    if (run) {
      const pair = run.direction ? BRIDGE_PAIR[run.direction] : BRIDGE_PAIR.SOLANA_TO_BASE;
      /* A run written before the lane had two directions was always Solana to
         Base — the store's own comment says so, and that is what an absent
         direction means. */
      return {
        href: swapHref({ network: pair.from, asset: "USDC" }, { network: pair.to, asset: "USDC" }),
        kind: "transfer",
      };
    }
  } catch {
    /* Same. */
  }

  return null;
}

export function ResumeUnfinished() {
  const { locale } = useSolanaI18n();
  const uk = locale === "uk";
  const [found, setFound] = useState<Unfinished | null>(null);

  useEffect(() => {
    /* After paint, and only in a browser: the server has no idea what this
       person's tab remembers, and rendering a guess would be worse than
       rendering nothing for one frame. */
    const read = () => setFound(findUnfinished(window.localStorage));
    read();
    window.addEventListener("ryntra:bridge-run", read);
    window.addEventListener("storage", read);
    return () => { window.removeEventListener("ryntra:bridge-run", read); window.removeEventListener("storage", read); };
  }, []);

  if (!found) return null;

  return (
    <aside className={styles.resume} aria-live="polite">
      <p className={styles.line}>
        <span className={styles.dot} aria-hidden />
        <span>
        {found.kind === "transfer"
          ? uk
            ? "У тебе є незавершений переказ між мережами."
            : "You have a transfer between networks that is not finished."
          : uk
            ? "У тебе є незавершений обмін між мережами."
            : "You have a swap between networks that is not finished."}
        </span>
      </p>
      <Link className={styles.link} href={found.href}>
        <span>{uk ? "Повернутися до нього" : "Go back to it"}</span>
        <ArrowRight size={17} weight="bold" aria-hidden />
      </Link>
      {/* No second link. Since 2026-09-08 the transfer has no page of its
          own — the cross-chain swap replaces it — so the full evidence panel
          now renders inside Swap itself, under the engine that owns the run.
          Pressing the line above is the whole way back. */}
    </aside>
  );
}
