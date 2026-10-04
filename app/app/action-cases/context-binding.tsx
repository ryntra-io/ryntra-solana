"use client";

import { useCallback, useEffect, useState } from "react";

import {
  HOME_LOCAL_EVENT,
  parseHomeLocalEnvelope,
} from "@/lib/home/financial-twin";
import { StateChip } from "@/app/app/portfolio/tiles";
import styles from "./decisions.module.css";

/**
 * The first link of the chain, read where it actually lives.
 *
 * The declared InvestorContext is held in this browser — that was a deliberate
 * decision and it has not changed — so the server render binds
 * `NOT_SERVER_READABLE` and this island fills in the version once the browser
 * reports one. Rendering a version the server could not see would be inventing
 * the audit record's first field.
 *
 * The three states are distinct on purpose. `MISSING` means the reader has
 * never declared a context; `NOT_SERVER_READABLE` is what the page said before
 * this component ran; `BOUND` is a real version number. Collapsing the first
 * two would let "you have not told us yet" read as "we could not look".
 */
export function ContextBinding({ ownerRef, serverReason }: { ownerRef: string; serverReason: string }) {
  const [version, setVersion] = useState<number | null>(null);
  const [state, setState] = useState<"PENDING" | "BOUND" | "MISSING" | "UNREADABLE">("PENDING");

  const read = useCallback(() => {
    try {
      const stored = localStorage.getItem(`ryntra.home.v1.${ownerRef}`);
      if (stored === null) {
        setState("MISSING");
        return;
      }
      const parsed = parseHomeLocalEnvelope(stored, ownerRef);
      if (!parsed.ok) {
        setState("UNREADABLE");
        return;
      }
      const current = parsed.envelope.investorContexts.at(-1) ?? null;
      setVersion(current?.version ?? null);
      setState(current === null ? "MISSING" : "BOUND");
    } catch {
      setState("UNREADABLE");
    }
  }, [ownerRef]);

  useEffect(() => {
    read();
    window.addEventListener(HOME_LOCAL_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(HOME_LOCAL_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, [read]);

  const label =
    state === "BOUND" ? `Version ${version}` : state === "MISSING" ? "Not declared" : state === "UNREADABLE" ? "Unreadable" : "Reading";

  const reason =
    state === "BOUND"
      ? "Every case on this page is read against this version of your declared context. It is held in this browser, so it is never sent to a server."
      : state === "MISSING"
        ? "You have not declared a context yet. Cases still carry their facts; what they cannot carry is the goals, horizon and capacity a decision should be read against."
        : state === "UNREADABLE"
          ? "The context stored in this browser could not be read, so no version is bound to these cases."
          : serverReason;

  return (
    <div className={styles.fact}>
      <span className={styles.factKey}>
        Investor context <StateChip tone={state === "BOUND" ? "good" : "unknown"} label={label} />
      </span>
      <span className={styles.chainReason}>{reason}</span>
    </div>
  );
}
