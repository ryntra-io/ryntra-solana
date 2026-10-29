"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useWalletData } from "@/app/app/wallet-data";
import { verifyArtifact } from "@/app/agents/agent-control-client";
import type { ArtifactVerificationView } from "@/app/agents/types";
import { enrichActivityMetadata } from "@/lib/solana/activity-projection";
import { receiptExplorerLinks, receiptMatchesAction, receiptMatchesFilter, sendRecipientOf } from "@/lib/solana/receipt-view";
import { addressGroups } from "@/lib/solana/skr-name";
import {
  downloadReceipt,
  readSolanaReceipts,
  type StoredSendReceipt,
} from "@/lib/solana/send-receipt-vault.client";
import { useSolanaConnection } from "../connection";
import { ArchivePanel } from "./archive-panel";
import { ExecutionTruth } from "./execution-truth";
import { assetsOfMovements } from "@/lib/solana/receipt-truth";
import { operationLine, outcomeLabel, outcomeOf, receiptLabel, receiptTime, record, settledLabel } from "./receipt-lines.ts";
import { useSolanaI18n } from "../i18n/provider";
import { WalletGate } from "../wallet-gate.tsx";
import { useSkrName } from "../skr-name.tsx";

import styles from "./receipts.module.css";

function verdictLabel(value: string, text: (value: string) => string): string {
  const labels: Readonly<Record<string, string>> = {
    SIGNATURE_VALID: "Signature valid",
    SIGNATURE_INVALID: "Signature invalid",
    UNSIGNED: "Unsigned",
    UNTRUSTED_KEY: "Untrusted issuer",
    AUTHORIZED: "Authorized",
    NOT_AUTHORIZED: "Not authorized",
    DEMO_ACKNOWLEDGEMENT_ONLY: "Demo acknowledgement only",
    NOT_APPLICABLE: "Not applicable",
    OBSERVED: "Observed",
    NOT_OBSERVED: "Not observed",
  };
  return text(labels[value] ?? value.replaceAll("_", " "));
}


/**
 * What the authorization axis may say on a receipt.
 *
 * The verifier is right and the screen was not. An `OUTCOME_RECEIPT` carries
 * `actionPassportHash` and no authorization proof — the proof is on the Action
 * Passport the receipt is hash-bound to — so the axis correctly resolves to
 * `NOT_APPLICABLE`, meaning *this artifact kind carries no authorization*.
 * Printed as "Not applicable" under the heading "Human authorization", beside
 * a swap the person had just approved in their own wallet, it reads as the one
 * thing it does not mean: that nobody authorized it.
 *
 * So the receipt says where the proof lives instead of denying that it exists.
 * Every other verdict prints unchanged — a receipt that really is unauthorized
 * still has to say so, and that is the sentence this must not weaken.
 */
function authorizationCell(
  verification: ArtifactVerificationView,
  text: (value: string) => string,
): string {
  if (verification.kind === "OUTCOME_RECEIPT" && verification.authorization.verdict === "NOT_APPLICABLE") {
    return text("On the bound proposal, not on this receipt");
  }
  return verdictLabel(verification.authorization.verdict, text);
}

function VerificationAxes({
  verification,
  text,
}: {
  verification: ArtifactVerificationView;
  text: (value: string) => string;
}) {
  return (
    <dl className={styles.axes}>
      <div><dt>{text("Integrity")}</dt><dd>{verification.integrity.valid ? text("Valid") : text("Invalid")}</dd></div>
      <div><dt>{text("Issuer")}</dt><dd>{verdictLabel(verification.issuer.verdict, text)}</dd></div>
      <div><dt>{text("Human authorization")}</dt><dd>{authorizationCell(verification, text)}</dd></div>
      <div><dt>{text("Observation")}</dt><dd>{verdictLabel(verification.observation.verdict, text)}</dd></div>
    </dl>
  );
}

type ReceiptCorrectionView = Readonly<{ correctionHash: string; codes: readonly string[] }>;

export function RecordedReceiptVerifier({
  receiptPath,
  correctionPath,
}: {
  receiptPath: string;
  correctionPath?: string;
}) {
  const { text } = useSolanaI18n();
  const [checking, setChecking] = useState(false);
  const [verification, setVerification] = useState<ArtifactVerificationView | null>(null);
  const [correction, setCorrection] = useState<ReceiptCorrectionView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function verifyRecordedReceipt() {
    setChecking(true);
    setProblem(null);
    setVerification(null);
    setCorrection(null);
    try {
      const response = await fetch(receiptPath, { cache: "no-store" });
      if (!response.ok) throw new Error(text("The receipt could not be loaded."));
      const artifact: unknown = await response.json();
      setVerification(await verifyArtifact(artifact));
      if (correctionPath) {
        const correctionResponse = await fetch(correctionPath, { cache: "no-store" });
        if (!correctionResponse.ok) throw new Error(text("The provenance correction could not be loaded."));
        const envelope = record(await correctionResponse.json());
        const correctionRecord = record(envelope?.correction);
        const correctionHash = correctionRecord?.correctionHash;
        const codes = correctionRecord?.codes;
        if (
          typeof correctionHash !== "string" ||
          !/^0x[0-9a-f]{64}$/.test(correctionHash) ||
          !Array.isArray(codes) ||
          !codes.every((code) => typeof code === "string")
        ) {
          throw new Error(text("The provenance correction is malformed."));
        }
        setCorrection({ correctionHash, codes });
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : text("Verification failed"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className={styles.recordedVerify}>
      <button className="rw-btn" type="button" onClick={() => void verifyRecordedReceipt()} disabled={checking}>
        {checking ? text("Verifying…") : text("Verify this receipt")}
      </button>
      {problem ? <p className={styles.problem} role="alert">{problem}</p> : null}
      {verification ? <VerificationAxes verification={verification} text={text} /> : null}
      {correction ? (
        <div className={styles.correction} role="status">
          <strong>{text("Provenance correction recorded")}</strong>
          <p>{text("The original signed receipt remains valid and immutable. Its submitter sentence and action-path label are corrected by this hash-bound public record.")}</p>
          <a href={correctionPath} target="_blank" rel="noreferrer noopener">
            {text("Open correction record")}
          </a>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Whom a transfer paid (SKR-4): the address from the receipt's own signed facts, in full, and its primary `.skr` name
 * beside it when that wallet chose one — read now, so a name is never part of what the receipt signed.
 */
function ReceiptRecipient({ receipt, text }: { receipt: Record<string, unknown>; text: (value: string) => string }) {
  const recipient = sendRecipientOf(receipt);
  const name = useSkrName(recipient);
  if (!recipient) return null;
  return (
    <p className={styles.recipient}>
      <span>{text("To")}</span>
      {name ? <b translate="no" data-skr-name="">{name}</b> : null}
      <code translate="no">{addressGroups(recipient).join(" ")}</code>
    </p>
  );
}

type StoredState = Readonly<{ owner: string | null; rows: readonly StoredSendReceipt[] }>;

export function LocalReceiptList({ filter = "", archiveOn = false }: { filter?: string; archiveOn?: boolean }) {
  const { connection } = useSolanaConnection();
  const { owner, holdings, activity, cashback } = useWalletData();
  const { locale, text } = useSolanaI18n();
  const [stored, setStored] = useState<StoredState>({ owner: null, rows: [] });
  const [checking, setChecking] = useState<string | null>(null);
  const [checks, setChecks] = useState<Readonly<Record<string, ArtifactVerificationView | string>>>({});

  useEffect(() => {
    setStored({
      owner,
      rows: owner ? readSolanaReceipts(window.localStorage, owner) : [],
    });
    setChecks({});
  }, [owner]);

  const allRows = useMemo(() => stored.owner === owner ? stored.rows : [], [owner, stored]);
  const actions = useMemo(
    () => activity.status === "ready"
      ? activity.data.map((action) => enrichActivityMetadata(action, holdings.status === "ready" ? holdings.data : []))
      : [],
    [activity, holdings],
  );
  const rows = useMemo(
    () => allRows.filter((row) => receiptMatchesFilter(row, filter, actions)),
    [actions, allRows, filter],
  );

  async function verify(row: StoredSendReceipt) {
    const key = String(row.receipt.contentHash);
    setChecking(key);
    try {
      const result = await verifyArtifact(row.receipt);
      setChecks((current) => ({ ...current, [key]: result }));
    } catch (error) {
      setChecks((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : text("Verification failed"),
      }));
    } finally {
      setChecking(null);
    }
  }

  if (!connection) return <WalletGate title={text("Connect a wallet — the receipts of your transfers will be here.")} />;

  const reload = () => setStored({ owner, rows: owner ? readSolanaReceipts(window.localStorage, owner) : [] });

  if (rows.length === 0) {
    return (
      <>
        <div className={styles.empty}>
          <strong>{filter ? text("No matching receipt in this browser") : text("No receipts in this browser")}</strong>
          {filter ? <Link className="rw-btn" href="/app/receipts">{text("Show all")}</Link> : <Link className="rw-btn" href="/app/activity">{text("History")}</Link>}
        </div>
        {archiveOn && owner ? <ArchivePanel owner={owner} localRows={allRows} onImported={reload} /> : null}
      </>
    );
  }

  return (
    <>
      <p className={styles.boundary}>{text("Stored on this device")}</p>
      {archiveOn && owner ? <ArchivePanel owner={owner} localRows={allRows} onImported={reload} /> : null}
      <ol className={styles.list}>
        {rows.map((row) => {
          const receipt = row.receipt;
          const outcome = outcomeOf(receipt);
          const status = settledLabel(outcome, text) ?? outcomeLabel(outcome?.status, text);
          const key = String(receipt.contentHash);
          const verification = checks[key];
          const action = actions.find((candidate) => receiptMatchesAction(row, candidate)) ?? null;
          const explorerLinks = receiptExplorerLinks(receipt);
          return (
            <li className={styles.item} key={key}>
              <header className={styles.itemHead}>
                <div>
                  <b>{receiptLabel(receipt, text)}</b>
                  <span className={styles.receiptSummary} translate="no">{operationLine(action, receipt, text)}</span>
                </div>
                <span className={styles.result} data-status={String(outcome?.status ?? "UNKNOWN")}>{status}</span>
                {/* The receipt's own time — when the operation settled — never when this device kept it. */}
                <time dateTime={receiptTime(receipt, row.storedAt)}>
                  {new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(receiptTime(receipt, row.storedAt)))}
                </time>
              </header>

              <ExecutionTruth receipt={receipt} known={action ? assetsOfMovements([action.in, action.out]) : undefined} cashback={cashback} />

              <ReceiptRecipient receipt={receipt} text={text} />

              {action ? (
                <Link className={styles.operation} href={`/app/activity?action=${encodeURIComponent(action.actionId)}`}>
                  {text("Operation details")}
                </Link>
              ) : <span className={styles.unbound}>{text("Operation details unavailable")}</span>}

              <details className={styles.more}>
                <summary>{text("More")}</summary>
                <div className={styles.actions}>
                  <button className="rw-btn" type="button" onClick={() => downloadReceipt(receipt)}>{text("Download signed JSON")}</button>
                  <button className="rw-btn" type="button" onClick={() => void verify(row)} disabled={checking === key}>{checking === key ? text("Verifying…") : text("Verify receipt")}</button>
                  {explorerLinks.map((link) => (
                    <a className="rw-btn" href={link.href} target="_blank" rel="noreferrer noopener" key={`${link.leg}:${link.hash}`}>
                      {link.leg === "source" ? text("Source transaction") : link.leg === "destination" ? text("Destination transaction") : text("Open on explorer")}
                    </a>
                  ))}
                </div>
                {typeof verification === "string" ? <p className={styles.problem} role="alert">{verification}</p> : verification ? <VerificationAxes verification={verification} text={text} /> : null}
              </details>
            </li>
          );
        })}
      </ol>
    </>
  );
}
