"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  HOME_LOCAL_EVENT,
  emptyHomeLocalEnvelope,
  parseHomeLocalEnvelope,
  projectFinancialTwin,
} from "@/lib/home/financial-twin";
import type { ConnectionCenterCopy } from "../connect/copy";
import styles from "../connect/connection-center.module.css";

type Twin = ReturnType<typeof projectFinancialTwin>;

function short(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function FinancialTwinSummary({
  ownerRef,
  subjectKind,
  identityWallet,
  telegramVerified,
  copy,
}: {
  ownerRef: string | null;
  subjectKind: "TELEGRAM" | "WALLET" | "NONE";
  identityWallet: string | null;
  telegramVerified: boolean;
  copy: ConnectionCenterCopy["summary"];
}) {
  const [twin, setTwin] = useState<Twin | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const storageKey = ownerRef ? `ryntra.home.v1.${ownerRef}` : null;

  const readTwin = useCallback(() => {
    if (!ownerRef) return;
    try {
      const stored = localStorage.getItem(storageKey ?? "");
      const envelope = stored === null
        ? emptyHomeLocalEnvelope(ownerRef, new Date().toISOString())
        : (() => {
            const parsed = parseHomeLocalEnvelope(stored, ownerRef);
            return parsed.ok ? parsed.envelope : null;
          })();
      if (!envelope) {
        setUnavailable(true);
        setTwin(null);
        return;
      }
      setTwin(projectFinancialTwin({
        identity: { authenticated: true, subjectKind, identityWallet, telegramVerified },
        envelope,
        venueCredentials: [],
      }));
      setUnavailable(false);
    } catch {
      setUnavailable(true);
      setTwin(null);
    }
  }, [identityWallet, ownerRef, storageKey, subjectKind, telegramVerified]);

  useEffect(() => {
    readTwin();
    const refresh = (event: Event) => {
      if (event instanceof StorageEvent && event.key === storageKey) {
        readTwin();
        return;
      }
      if (event instanceof CustomEvent && event.detail?.ownerRef === ownerRef) readTwin();
    };
    window.addEventListener(HOME_LOCAL_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(HOME_LOCAL_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [ownerRef, readTwin, storageKey]);

  if (!ownerRef) {
    return <div className={styles.summaryEmpty}><p>{copy.signedOut}</p><Link href="/app/connect">{copy.open} →</Link></div>;
  }
  if (unavailable) {
    return <div className={styles.summaryEmpty}><p>{copy.unavailable}</p><Link href="/app/connect">{copy.open} →</Link></div>;
  }
  if (!twin) return <p className={styles.stateMessage} role="status">{copy.body}</p>;

  return (
    <div className={styles.summary}>
      <p>{copy.body}</p>
      <dl className={styles.summaryGrid}>
        <div><dt>{copy.identity}</dt><dd>{twin.identity.identityWallet ? `SIWE · ${short(twin.identity.identityWallet)}` : twin.identity.subjectKind}</dd></div>
        <div><dt>{copy.data}</dt><dd>{twin.data.active}</dd></div>
        <div><dt>{copy.context}</dt><dd>{twin.context.version ? `v${twin.context.version}` : copy.missing}</dd></div>
        <div><dt>{copy.authority}</dt><dd>{twin.authority.state}</dd></div>
      </dl>
      <Link className={styles.summaryLink} href="/app/connect">{copy.open} →</Link>
    </div>
  );
}
