"use client";

import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";

import type { FundingNeed } from "./funding-model";
import styles from "./invest.module.css";
import { investWords } from "./invest-words";

/**
 * The wallet's next step as its actions — Home's head and Portfolio's value
 * say it alike. The orange action is the step that works next: dollars, then
 * the network's SOL, then a purchase; the other one beside it is quiet. An
 * empty wallet's first step is the top-up alone — no purchase it could not
 * make.
 */
export function FundingActions({ need, firstStep, locale }: { need: FundingNeed; firstStep: boolean; locale: WorkspaceLocale }) {
  const word = investWords(locale);
  return (
    <div className={styles.actions}>
      {need === "sol" ? (
        <Link className="rw-btn rw-btn--primary" href="/app/top-up?need=sol">
          {word("topUpSol")}
        </Link>
      ) : need === "usdc" ? (
        <>
          <Link className="rw-btn rw-btn--primary" href="/app/top-up">
            {word("topUp")}
          </Link>
          {firstStep ? null : (
            <Link className="rw-btn" href="/app/markets">
              {word("buy")}
            </Link>
          )}
        </>
      ) : (
        <>
          <Link className="rw-btn rw-btn--primary" href="/app/markets">
            {word("buy")}
          </Link>
          <Link className="rw-btn" href="/app/top-up">
            {word("topUp")}
          </Link>
        </>
      )}
    </div>
  );
}
