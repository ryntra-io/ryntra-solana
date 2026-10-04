"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useWalletData } from "@/app/app/wallet-data";
import { verifyArtifact } from "@/app/agents/agent-control-client";
import type { ArtifactVerificationView } from "@/app/agents/types";
import type { SolanaWalletAction } from "@/lib/solana/action-ledger";
import { enrichActivityMetadata } from "@/lib/solana/activity-projection";
import { displayAmount } from "@/lib/solana/amounts";
import { crossSwapReceiptSummary, receiptExplorerLinks, receiptMatchesAction, receiptMatchesFilter } from "@/lib/solana/receipt-view";
import {
  downloadReceipt,
  readSolanaReceipts,
  type StoredSendReceipt,
} from "@/lib/solana/send-receipt-vault.client";
import { useSolanaConnection } from "../connection";
import { ArchivePanel } from "./archive-panel";
import { useSolanaI18n } from "../i18n/provider";
import { WalletGate } from "../wallet-gate.tsx";

import styles from "./receipts.module.css";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function outcomeOf(receipt: Record<string, unknown>): Record<string, unknown> | null {
  return record(receipt.outcome);
}

/**
 * The swap facts, reassembled from the chunks the receipt stores them in.
 *
 * `buildSwapReceiptFacts` writes one JSON document and the receipt carries it
 * split across four `observedEffects` descriptions, each tagged `#n/4` in its
 * `sourceRef`. Anything unexpected — a missing chunk, a re-ordering, a
 * document that will not parse — returns null and the caller keeps the
 * literal status. This never invents a reading.
 */
function swapFacts(outcome: Record<string, unknown> | null): Record<string, unknown> | null {
  const effects = Array.isArray(outcome?.observedEffects) ? outcome.observedEffects.map(record) : [];
  const chunks: { index: number; body: string }[] = [];
  for (const effect of effects) {
    const ref = typeof effect?.sourceRef === "string" ? effect.sourceRef : "";
    const body = typeof effect?.description === "string" ? effect.description : "";
    if (!ref.startsWith("ryntra.solana.swap-receipt.facts@")) continue;
    const position = /#(\d+)\/(\d+)$/.exec(ref);
    if (!position) continue;
    chunks.push({ index: Number(position[1]), body });
  }
  if (chunks.length === 0) return null;
  chunks.sort((left, right) => left.index - right.index);
  try {
    return record(JSON.parse(chunks.map((chunk) => chunk.body).join("")));
  } catch {
    return null;
  }
}

/**
 * What a swap that went right is allowed to be called.
 *
 * `OUTPUT_MISMATCH` fires whenever the fill differs from the quote by a single
 * raw unit, which is every honest swap — a quote is an estimate and the fill is
 * the fill — so `MATCHED` is unreachable here and every customer receipt was
 * headed *Deviation recorded*. The promise a swap makes is the **minimum**, not
 * the quote, and the receipt should say whether that promise was kept.
 *
 * Softened only when both structural conditions hold and nothing else deviated:
 * the minimum was met, and the only codes present are the two that carry no
 * consequence for the person — the fill differing from the estimate, and our own
 * failure to read the provider's copy of a transaction the chain already
 * confirmed independently. A fee mismatch, an input mismatch, a provider
 * signature mismatch or a missed minimum all keep the literal status, because
 * each of those is something a reader must not be soothed about.
 *
 * The signed JSON is untouched: `DEVIATION_RECORDED` and the full deviation
 * list remain exactly where an auditor looks for them, and *Verify receipt*
 * still shows them. Only the sentence a person reads changes.
 */
const CONSEQUENCE_FREE_DEVIATIONS = new Set(["OUTPUT_MISMATCH", "PROVIDER_EVIDENCE_UNAVAILABLE"]);

function settledLabel(
  outcome: Record<string, unknown> | null,
  text: (value: string) => string,
): string | null {
  if (outcome?.status !== "DEVIATION_RECORDED") return null;
  const facts = swapFacts(outcome);
  const reconciliation = record(facts?.reconciliation);
  if (reconciliation?.minimumMet !== true) return null;
  const deviations = Array.isArray(reconciliation.deviations) ? reconciliation.deviations : null;
  if (!deviations || !deviations.every((code) => CONSEQUENCE_FREE_DEVIATIONS.has(String(code)))) return null;

  const settled = text("Settled");
  let delta: bigint;
  let quoted: bigint;
  try {
    delta = BigInt(String(reconciliation.outputDeltaRaw));
    quoted = BigInt(String(record(facts?.quote)?.outputRaw));
  } catch {
    return settled;
  }
  if (delta === 0n || quoted <= 0n) return settled;

  const share = (Number(delta < 0n ? -delta : delta) / Number(quoted)) * 100;
  const shown = share < 0.01 ? "<0.01" : share.toFixed(2);
  return delta < 0n
    ? `${settled} · ${shown}% ${text("below the quote, above your minimum")}`
    : `${settled} · ${shown}% ${text("above the quote")}`;
}

function outcomeLabel(status: unknown, text: (value: string) => string): string {
  if (status === "MATCHED") return text("Matched");
  if (status === "DEVIATION_RECORDED") return text("Deviation recorded");
  if (status === "FAILED") return text("Failed");
  return text("Receipt");
}

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
 * The signed facts of a bridge receipt, put back together.
 *
 * The issuer splits the facts JSON across numbered observed effects, each one
 * tagged `…#n/N` in its `sourceRef`, so reassembling them is deterministic
 * rather than a guess. Done defensively on purpose: a receipt whose shape this
 * does not recognise yields `null` and every caller falls back to what it
 * showed before, because a receipts page that throws is worse than a receipts
 * page that is terse.
 */
function bridgeFacts(receipt: Record<string, unknown>): Record<string, unknown> | null {
  const outcome = record(receipt.outcome);
  const effects = Array.isArray(outcome?.observedEffects) ? outcome.observedEffects.map(record) : [];
  const chunks: { at: number; body: string }[] = [];
  for (const effect of effects) {
    const ref = String(effect?.sourceRef ?? "");
    if (!ref.includes("ryntra.solana.bridge-receipt.facts@")) continue;
    const numbered = /#(\d+)\/(\d+)$/.exec(ref);
    if (!numbered) continue;
    chunks.push({ at: Number(numbered[1]), body: String(effect?.description ?? "") });
  }
  if (chunks.length === 0) return null;
  chunks.sort((left, right) => left.at - right.at);
  try {
    return record(JSON.parse(chunks.map((chunk) => chunk.body).join("")));
  } catch {
    return null;
  }
}

/**
 * The one line a person actually reads on a bridge receipt.
 *
 * Its id is not that line. An `outcome_solana_bridge_…` id was the primary
 * identifier on this screen in production on 2026-09-04, above a status word
 * and nothing else — no amount, no direction, no chains. That is internal text
 * on a customer page, where it does not belong, and it is also simply
 * useless: a person with three bridge receipts could not tell which was which.
 *
 * The chain names are proper nouns and stay in both locales.
 */
function bridgeLine(receipt: Record<string, unknown>): string | null {
  const facts = bridgeFacts(receipt);
  if (facts === null) return null;
  const amounts = record(facts.amounts);
  const raw =
    typeof amounts?.mintedRaw === "string"
      ? amounts.mintedRaw
      : typeof amounts?.burnedRaw === "string"
        ? amounts.burnedRaw
        : null;
  if (raw === null) return null;
  const lane = facts.direction === "BASE_TO_SOLANA" ? "Base → Solana" : "Solana → Base";
  return `${displayAmount(raw, 6)} USDC · ${lane}`;
}

/**
 * Which kind of receipt this is.
 *
 * Bridge receipts were titled `Send receipt` in production, because the only
 * test here was whether a registry ref mentioned a swap and a bridge mentions
 * none. A bridge and a send were therefore indistinguishable on the one screen
 * whose job is to tell a person what happened.
 */
function receiptLabel(receipt: Record<string, unknown>, text: (value: string) => string): string {
  /* Asked before the two below, because a cross-chain receipt pins the same
     Solana adapter a send does and would otherwise be titled `Send receipt` —
     the exact defect that made bridges and sends indistinguishable here in
     production on 2026-09-04, one lane later. */
  if (crossSwapReceiptSummary(receipt) !== null) return text("Bridge receipt");
  if (String(receipt.id ?? "").startsWith("outcome_solana_bridge_") || bridgeFacts(receipt) !== null) {
    return text("Bridge receipt");
  }
  const registry = record(receipt.registry);
  const refs = Array.isArray(registry?.refs) ? registry.refs.map(record) : [];
  const joined = refs.map((entry) => String(entry?.ref ?? "")).join(" ").toLowerCase();
  return text(joined.includes("swap") ? "Swap receipt" : "Send receipt");
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

function movement(movement: SolanaWalletAction["out"]): string | null {
  if (!movement || movement.decimals === null) return movement?.symbol ?? null;
  const amount = displayAmount(movement.amountRaw, movement.decimals);
  return movement.symbol ? `${amount} ${movement.symbol}` : amount;
}

/**
 * The one line a person reads on a cross-chain receipt.
 *
 * Read from the receipt's own signed facts rather than from the History row
 * beside it, so a receipt opened on a device whose Activity has not loaded still
 * says what it is. Chain names are proper nouns and stay in both locales.
 */
function crossSwapLine(receipt: Record<string, unknown>): string | null {
  const summary = crossSwapReceiptSummary(receipt);
  if (!summary) return null;
  const leg = (side: { amountRaw: string; symbol: string | null; decimals: number | null } | null): string | null => {
    if (!side || side.decimals === null) return side?.symbol ?? null;
    const amount = displayAmount(side.amountRaw, side.decimals);
    return side.symbol ? `${amount} ${side.symbol}` : amount;
  };
  const sent = leg(summary.sent);
  const received = leg(summary.received);
  const lane = `${summary.from} → ${summary.to}`;
  if (sent && received) return `${sent} → ${received} · ${lane}`;
  return sent ? `${sent} · ${lane}` : lane;
}

function operationLine(action: SolanaWalletAction | null, receipt: Record<string, unknown>, text: (value: string) => string) {
  const cross = crossSwapLine(receipt);
  if (cross) return cross;
  const bridge = bridgeLine(receipt);
  if (bridge) return bridge;
  if (!action) return text("Details not available");
  const out = movement(action.out);
  const incoming = movement(action.in);
  if (action.lane === "SWAP" || action.lane === "CROSS_SWAP") {
    if (out && incoming) return `${out} → ${incoming}`;
    return out ?? incoming ?? text("Details not available");
  }
  return out ?? incoming ?? text("Details not available");
}

type StoredState = Readonly<{ owner: string | null; rows: readonly StoredSendReceipt[] }>;

export function LocalReceiptList({ filter = "", archiveOn = false }: { filter?: string; archiveOn?: boolean }) {
  const { connection } = useSolanaConnection();
  const { owner, holdings, activity } = useWalletData();
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

  if (!connection) return <WalletGate title={text("Every transfer you have made here.")} />;

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
                <time dateTime={row.storedAt}>
                  {new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.storedAt))}
                </time>
              </header>

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
