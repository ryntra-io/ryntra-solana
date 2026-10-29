"use client";

import { Button } from "@ryntra/core/ui";
import { useRouter } from "next/navigation";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";

import { useActionStates } from "./liquidity-api";
import { poolsWords } from "./pools-words";
import styles from "./pools.module.css";

/** A pool page's one orange action: «Додати ліквідність» when the wallet may act, grey with the reason while it may not. */
export function AddLiquidityAction({ locale, pool, enabled }: { locale: WorkspaceLocale; pool: string; enabled: boolean }) {
  const word = poolsWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const router = useRouter();
  const { connection } = useSolanaConnection();
  const states = useActionStates(connection?.address ?? null);
  const open = states.add.status === "on" && enabled;
  return (
    <div className={styles.pageAction} data-pools="add-action">
      <Button variant="primary" lang={lang} disabled={!open} onClick={() => router.push(`/app/markets/pools/${pool}/add`)}>
        {word("addLiquidity")}
      </Button>
      {states.add.status !== "on" ? <span className={styles.pageActionNote}>{word("actionsLaterShort")}</span> : null}
    </div>
  );
}
