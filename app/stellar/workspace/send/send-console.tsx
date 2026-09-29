"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { InfoControl } from "@/app/shell/info-control";
import { AlertStrip, EmptyState, KeyValue, Panel, PanelGrid, Stepper, type StepState } from "@/app/shell/panel";
import { horizonGet } from "@/lib/stellar/client";
import { NATIVE_ASSET } from "@/lib/stellar/asset";
import { STELLAR_TESTNET, transactionExplorerUrl } from "@/lib/stellar/network";
import { isResolved } from "@/lib/stellar/evidence";
import { AUTHORIZATION_WINDOW_SECONDS, DEFAULT_FEE_STROOPS, buildPayment, type BuiltTransaction } from "@/lib/stellar/transactions/build";
import { preflightPayment, type Preflight } from "@/lib/stellar/transactions/preflight";
import {
  verifySignedTransaction,
  type SubmissionVerdict,
  type TransactionFingerprint,
} from "@/lib/stellar/transactions/fingerprint";
import { awaitInclusion, submitCleared, type SubmissionOutcome } from "@/lib/stellar/transactions/submit";
import { expectedFromFingerprint, observeActualEffects } from "@/lib/stellar/transactions/effects";
import { finalizeReceipt, type StellarLifecycleReceipt } from "@/lib/stellar/transactions/receipt";
import { recordActivity } from "@/lib/stellar/activity/store";
import { isUserDecision } from "@/lib/stellar/wallets/adapter";
import { walletEntry } from "@/lib/stellar/wallets/registry";
import { useStellarWallet } from "../../components/stellar-wallet-provider.tsx";

/**
 * The whole lifecycle, on one screen.
 *
 * It exists to make two distinctions visible, because they are the argument of
 * the product and both are invisible in every ordinary wallet flow:
 *
 *   a wallet signature is not a Ryntra authorization,
 *   and a signature is not a submission.
 *
 * So they are separate presses. You authorize an exact intent here, against a
 * fingerprint taken *before* the bytes leave. Freighter signs. What comes back
 * is compared field by field. Only then is there a submit button, and it can
 * only ever send the bytes that passed that comparison — the function takes the
 * cleared verdict, not an XDR, so there is no way to hand it anything else.
 *
 * After submission the lifecycle keeps going, which is the part most products
 * skip: the ledger is read back independently, what it actually did is compared
 * against what was authorized, and the result is a receipt whose every hash can
 * be recomputed by somebody who does not trust us.
 *
 * **Testnet only, and Ryntra holds no key.** The signature happens inside
 * Freighter and the submission goes from this browser straight to the public
 * Stellar endpoint — no signed transaction reaches a Ryntra server.
 */

type Phase =
  | "idle"
  | "building"
  | "built"
  | "authorized"
  | "signing"
  | "verified"
  | "submitting"
  | "observing"
  | "settled";

const NETWORK = STELLAR_TESTNET;

export function SendConsole() {
  const { state: walletState, address, connect } = useStellarWallet();

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("1.0000000");
  const [memo, setMemo] = useState("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [built, setBuilt] = useState<BuiltTransaction | null>(null);
  const [authorized, setAuthorized] = useState<TransactionFingerprint | null>(null);
  const [authorizedAt, setAuthorizedAt] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<SubmissionVerdict | null>(null);
  const [submission, setSubmission] = useState<SubmissionOutcome | null>(null);
  const [ledgerNote, setLedgerNote] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<StellarLifecycleReceipt | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  /*
   * The record this run writes to.
   *
   * One id per prepared payment, created when the intent is first checked and
   * reused through every stage — so a payment is one row on Activity rather than
   * eight. `remembered` is false when this browser refuses to store anything,
   * and the surface says so rather than implying a run was kept.
   */
  const [activityId, setActivityId] = useState<string | null>(null);
  const [remembered, setRemembered] = useState(true);

  /** Write this run's current state. Silent about success, honest about failure. */
  const remember = useCallback(
    (id: string, patch: Parameters<typeof recordActivity>[1]) => {
      const ok = recordActivity(id, patch, {
        now: new Date().toISOString(),
        network: NETWORK.label,
        assetCode: NATIVE_ASSET.code,
        amount: amount.trim(),
        destination: destination.trim(),
        memo: memo.trim() || null,
        source: address,
      });
      if (!ok) setRemembered(false);
    },
    [amount, destination, memo, address],
  );

  const connected = walletState === "CONNECTED" && address !== null;
  const cleared = verdict?.allowed === true ? verdict : null;

  /*
   * The panels size to what they hold.
   *
   * Before a wallet connects, two of the three have one sentence in them, and
   * an eight-row panel around one sentence reads as unfinished rather than as
   * waiting. All three move together so the row keeps equal heights, which the
   * rendered-geometry audit checks and which is what makes a grid look built.
   *
   * Six rather than four when disconnected, because the row is sized by its
   * tallest real content and the Lifecycle panel now lists eight steps: adding
   * the preflight step pushed it 12px past a four-row panel, which the audit
   * caught as clipped content on a surface that does not scroll.
   */
  const rows = connected ? 8 : 6;

  function reset() {
    setPreflight(null);
    setVerdict(null);
    setAuthorized(null);
    setAuthorizedAt(null);
    setSubmission(null);
    setLedgerNote(null);
    setReceipt(null);
  }

  /**
   * Check before building, not after signing.
   *
   * Added because this surface let the same doomed payment be authorized and
   * signed twice: the destination account had never been created, and both
   * runs came back `paymentNoDestination` — correctly reported, after a
   * signature had already been given. A workspace whose argument is that a
   * decision is checked before a person authorizes it cannot be the one that
   * skips the check.
   *
   * It blocks only what is certain to fail. An unreadable source or a timed-out
   * endpoint is reported and the build continues, because the network is the
   * authority and a preflight that stops a payment which would have worked is a
   * preflight people learn to click past.
   */
  async function build() {
    if (!address) return;
    setProblem(null);
    reset();
    setPhase("building");

    /* A new id per prepared payment. The record exists from the first check
       onward, which is the point: a payment the preflight refuses is the most
       useful row on Activity, and a store that only remembers successes has
       remembered the uninteresting half. */
    const id = crypto.randomUUID();
    setActivityId(id);
    remember(id, { state: "DRAFT" });

    try {
      const checked = await preflightPayment({
        network: NETWORK,
        source: address,
        destination: destination.trim(),
        asset: NATIVE_ASSET,
        amount: amount.trim(),
        feeStroops: DEFAULT_FEE_STROOPS,
      });
      setPreflight(checked);
      if (checked.state === "BLOCKED") {
        const blocker = checked.checks.find((check) => check.outcome === "BLOCK");
        remember(id, {
          state: "BLOCKED",
          reason: blocker ? `${blocker.label}: ${blocker.detail}` : "The preflight refused this payment.",
          recovery: "Correct what the check named, then prepare it again. Nothing was signed and no fee was charged.",
        });
        setPhase("idle");
        return;
      }

      /* The sequence is read, never assumed. A stale sequence produces a
         transaction the network refuses after a person has already signed it. */
      const account = await horizonGet(NETWORK.horizonUrl, `accounts/${address}`);
      if (!account.ok) throw new Error(`The testnet account could not be read: ${account.reason}`);
      const sequence = (account.value as { sequence?: string }).sequence;
      if (!sequence) throw new Error("Horizon returned no sequence for this account.");

      setBuilt(
        buildPayment({
          network: NETWORK,
          source: address,
          sequence,
          destination: destination.trim(),
          asset: NATIVE_ASSET,
          amount: amount.trim(),
          memo: memo.trim() || undefined,
        }),
      );
      remember(id, { state: "AWAITING_AUTHORIZATION" });
      setPhase("built");
    } catch (error) {
      remember(id, {
        state: "FAILED",
        reason: (error as Error).message,
        recovery: "The transaction was never built, so nothing was signed. Check the source account and try again.",
      });
      setProblem((error as Error).message);
      setPhase("idle");
    }
  }

  async function signAndVerify() {
    if (!built || !authorized || !address) return;
    setProblem(null);
    setPhase("signing");
    try {
      const adapter = await walletEntry("freighter").load();
      const signed = await adapter.signTransaction({
        unsignedXdr: built.unsignedXdr,
        address,
        networkPassphrase: NETWORK.passphrase,
      });
      /* The only place a signed transaction may be called the authorized one. */
      const compared = verifySignedTransaction({ authorized, signedXdr: signed.signedXdr });
      setVerdict(compared);
      if (activityId) {
        remember(
          activityId,
          compared.allowed
            ? { state: "SIGNED" }
            : {
                state: "FAILED",
                reason: `The signed transaction did not match what was authorized: ${compared.reason}`,
                recovery:
                  "Nothing was submitted — the submit path takes the cleared verdict rather than an envelope, so mismatched bytes have no way in. Prepare the payment again.",
              },
        );
      }
      setPhase(compared.allowed ? "verified" : "settled");
    } catch (error) {
      const cancelled = isUserDecision(error);
      if (activityId && !cancelled) {
        remember(activityId, {
          state: "FAILED",
          reason: (error as Error).message,
          recovery: "The wallet did not return a signature. Nothing was submitted.",
        });
      }
      setProblem(
        cancelled
          ? "Signature cancelled. Nothing was submitted, and the intent is unchanged."
          : (error as Error).message,
      );
      setPhase("authorized");
    }
  }

  /**
   * Submit, wait, read the ledger, reconcile, finalize.
   *
   * One press because they are one act from a person's side, and separating
   * them would leave a submitted transaction sitting on a screen with a second
   * button nobody knows to press. Every step records what it learned, so a
   * failure part-way through leaves the earlier facts on screen rather than
   * resetting to nothing.
   */
  async function submitAndSettle() {
    if (!cleared || !authorizedAt) return;
    setProblem(null);
    setPhase("submitting");

    const outcome = await submitCleared(NETWORK, cleared);
    setSubmission(outcome);
    if (outcome.kind !== "SUBMITTED") {
      if (activityId) {
        remember(activityId, {
          state: "FAILED",
          reason: outcome.reason,
          recovery:
            "The network refused the transaction. An uncertain submission is reconciled by transaction hash on the Receipts surface, never re-sent.",
        });
      }
      setPhase("settled");
      return;
    }

    setPhase("observing");
    const submittedAt = outcome.acceptedAt;
    if (activityId) remember(activityId, { state: "SUBMITTED", transactionHash: outcome.transactionHash });

    const inclusion = await awaitInclusion(NETWORK, outcome.transactionHash);
    if (inclusion.kind !== "INCLUDED") {
      setLedgerNote(inclusion.reason);
      if (activityId) {
        remember(activityId, {
          state: "RECONCILIATION_REQUIRED",
          reason: inclusion.reason,
          recovery:
            "The transaction was accepted but has not been seen in a closed ledger. Re-read it by hash on the Receipts surface rather than sending it again.",
        });
      }
      setPhase("settled");
      return;
    }

    if (activityId) {
      remember(activityId, {
        state: "CONFIRMED",
        ledger: inclusion.inclusion.ledger,
        resultCode: inclusion.inclusion.status === "SUCCESS" ? "txSuccess" : "txFailed",
      });
    }

    const effects = await observeActualEffects(NETWORK, outcome.transactionHash);
    if (!isResolved(effects)) {
      setLedgerNote(effects.reason);
      if (activityId) {
        remember(activityId, {
          state: "RECONCILIATION_REQUIRED",
          reason: effects.reason,
          recovery:
            "The transaction is in a closed ledger but its effects could not be read, so expected and actual were never compared. Re-read it on the Receipts surface.",
        });
      }
      setPhase("settled");
      return;
    }

    try {
      const finalized = await finalizeReceipt({
        network: NETWORK,
        fingerprint: cleared.fingerprint,
        subject: cleared.fingerprint.source,
        authorizedAt,
        expiresAtUnix: built?.transaction.timeBounds?.maxTime ? Number(built.transaction.timeBounds.maxTime) : null,
        submittedAt,
        expected: expectedFromFingerprint(cleared.fingerprint),
        actual: effects.data,
        sources: effects.sources,
        observedAt: effects.observedAt,
        finalizedAt: new Date().toISOString(),
      });
      setReceipt(finalized);

      /* The record's terminal state is the reconciliation's, not the network's.
         A transaction that succeeded is not evidence that what was authorized is
         what happened, and this is the row where that distinction has to survive
         the session. */
      const matched = finalized.reconciliation.status === "MATCHED";
      if (activityId) {
        remember(activityId, {
          state: matched ? "RECONCILED" : "RECONCILIATION_REQUIRED",
          reconciliation: matched ? "MATCHED" : "DEVIATION_RECORDED",
          receiptHash: finalized.receiptHash,
          authorizationHash: finalized.authorization.hash,
          reason: matched ? null : "Expected and actual movements disagree. The receipt records every check.",
          recovery: matched
            ? null
            : "Open the receipt and compare movement by movement. Nothing is re-sent to correct a deviation.",
        });
      }
    } catch (error) {
      setLedgerNote(`The ledger was read, but the receipt could not be hashed: ${(error as Error).message}`);
      if (activityId) {
        remember(activityId, {
          state: "RECONCILIATION_REQUIRED",
          reason: `The ledger was read, but the receipt could not be hashed: ${(error as Error).message}`,
          recovery: "Re-verify the transaction by hash on the Receipts surface, which rebuilds the receipt from the ledger.",
        });
      }
    }
    setPhase("settled");
  }

  /*
   * The preflight reads as a checklist, not as key/value pairs.
   *
   * The first version used `KeyValue`, which right-aligns a mono value against
   * its label — correct for "Sequence 177186…", wrong for a three-line sentence
   * explaining why a payment cannot go through. `Stepper` is already the marker
   * plus label plus detail-underneath shape this needs, so it costs no new CSS
   * and no new class for the stylesheet gate to cover.
   */
  const preflightSteps: ReadonlyArray<{ id: string; label: string; state: StepState; detail?: string }> =
    preflight?.checks.map((check) => ({
      id: check.id,
      label: check.label,
      state: check.outcome === "PASS" ? "done" : check.outcome === "BLOCK" ? "blocked" : "idle",
      detail: check.detail,
    })) ?? [];

  const blockedOnDestination =
    preflight?.checks.some((check) => check.id === "destination.exists" && check.outcome === "BLOCK") ?? false;
  const friendbotUrl = `https://friendbot.stellar.org/?addr=${encodeURIComponent(destination.trim())}`;

  const submitted = submission?.kind === "SUBMITTED";
  const reconciliation = receipt?.reconciliation ?? null;

  const steps: ReadonlyArray<{ id: string; label: string; state: StepState; detail?: string }> = [
    {
      id: "preflight",
      label: "Ryntra checks what can be known first",
      state: preflight
        ? preflight.state === "BLOCKED"
          ? "blocked"
          : "done"
        : phase === "building"
          ? "active"
          : "idle",
      detail: preflight && preflight.state !== "READY" ? preflight.state : undefined,
    },
    { id: "build", label: "Ryntra builds the exact transaction", state: built ? "done" : phase === "building" ? "active" : "idle" },
    { id: "authorize", label: "You authorize this exact intent", state: authorized ? "done" : built ? "active" : "idle" },
    { id: "sign", label: "Freighter signs it", state: verdict ? "done" : phase === "signing" ? "active" : "idle" },
    {
      id: "verify",
      label: "Ryntra compares what came back",
      state: verdict ? (verdict.allowed ? "done" : "blocked") : "idle",
      detail: verdict ? (verdict.allowed ? "It matches what you authorized." : verdict.reason) : undefined,
    },
    {
      id: "submit",
      label: "Your browser submits it",
      state: submitted ? "done" : submission ? "blocked" : phase === "submitting" ? "active" : "idle",
      detail: submission && !submitted ? submission.reason : undefined,
    },
    {
      id: "observe",
      label: "The ledger is read back",
      state: receipt ? "done" : ledgerNote ? "blocked" : phase === "observing" ? "active" : "idle",
      detail: ledgerNote ?? undefined,
    },
    {
      id: "reconcile",
      label: "Expected against actual",
      state: reconciliation ? (reconciliation.status === "MATCHED" ? "done" : "blocked") : "idle",
      detail: reconciliation?.status,
    },
  ];

  const receiptFile = receipt
    ? `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(receipt, null, 2))}`
    : null;

  return (
    <PanelGrid label="Send XLM">
      <Panel
        id="authorize-form"
        title="Prepare a payment"
        /* DESIGN.md §4 fixes the Action template at FORM 4 · EVIDENCE 5 ·
           LIFECYCLE 3, and the grid has no width token 5 — the legal set is
           3, 4, 6, 8, 9, 12. Equal quarters rather than widening the shared
           token set for one page: the intent panel still holds the most rows,
           and a form with a 56-character address in it is unusable at 3. */
        w={4}
        h={rows}
        essential
        badge="TESTNET"
        tone="caution"
        headerExtra={
          <InfoControl label="Why testnet only">
            <p>
              This surface exists to show the authorization gate and the lifecycle behind it, not to move value. It is
              fixed to Stellar Testnet, where the assets have no worth, and nothing it produces can reach mainnet.
            </p>
          </InfoControl>
        }
        footer={
          connected ? (
            <button className="rw-btn rw-btn--primary" type="button" onClick={() => void build()} disabled={phase === "building" || !destination.trim()}>
              {phase === "building" ? "Reading the account…" : "Build the transaction"}
            </button>
          ) : (
            <button className="rw-btn rw-btn--primary" type="button" onClick={() => void connect()}>
              Connect a wallet
            </button>
          )
        }
      >
        {connected ? (
          <>
            <KeyValue label="From">
              <span className="st-domain" translate="no">{address}</span>
            </KeyValue>
            <div className="rw-field">
              <label htmlFor="az-dest">Destination</label>
              <div className="rw-input">
                <input id="az-dest" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="G…" spellCheck={false} autoComplete="off" />
              </div>
            </div>
            <div className="rw-field">
              <label htmlFor="az-amount">Amount, XLM</label>
              <div className="rw-input">
                <input id="az-amount" value={amount} onChange={(e) => setAmount(e.target.value)} spellCheck={false} autoComplete="off" />
              </div>
            </div>
            <div className="rw-field">
              <label htmlFor="az-memo">Memo, optional</label>
              <div className="rw-input">
                <input id="az-memo" value={memo} onChange={(e) => setMemo(e.target.value)} autoComplete="off" />
              </div>
            </div>
          </>
        ) : (
          <EmptyState title="No wallet connected">
            A wallet supplies the source account and the signature. Everything else on this workspace reads without
            one.
          </EmptyState>
        )}
        {problem ? <AlertStrip tone="warn">{problem}</AlertStrip> : null}
        {/* Said plainly rather than implied. Every other surface tells a person
            their activity is kept; if this browser refuses to store anything,
            that promise is false here and staying quiet about it would be the
            worse half of a privacy feature. */}
        {remembered ? null : (
          <AlertStrip tone="warn">
            This browser will not keep a record of this run — local storage is unavailable. The payment still works and
            the receipt is still downloadable; nothing will appear on Activity afterwards.
          </AlertStrip>
        )}
      </Panel>

      <Panel
        id="authorize-intent"
        title="What you authorize"
        w={4}
        h={rows}
        essential
        scroll
        badge={authorized ? "AUTHORIZED" : built ? "UNAUTHORIZED" : preflight ? preflight.state : "EMPTY"}
        tone={authorized ? "verified" : preflight && !built ? (preflight.state === "BLOCKED" ? "danger" : "caution") : "muted"}
        headerExtra={
          <InfoControl label="What a fingerprint is">
            <p>
              The fields that decide what the transaction does, captured before the bytes leave this page. Signing
              appends signatures and necessarily changes the bytes, so the comparison afterwards is over these fields
              and never over raw XDR.
            </p>
            <p>
              Authorizing also starts a clock. The transaction carries an upper time bound of{" "}
              {AUTHORIZATION_WINDOW_SECONDS} seconds, so a signature that is never submitted expires instead of
              waiting indefinitely for a moment nobody intended.
            </p>
          </InfoControl>
        }
        footer={
          built && !authorized ? (
            <button
              className="rw-btn rw-btn--authorize"
              type="button"
              onClick={() => {
                const at = new Date().toISOString();
                setAuthorized(built.fingerprint);
                setAuthorizedAt(at);
                /* The authorization hash is computed with the receipt, because
                   hashing is async and a click handler that awaits is a button
                   that can be pressed twice. The timestamp is what binds this
                   record to that hash later. */
                if (activityId) remember(activityId, { state: "AUTHORIZED", authorizedAt: at });
                setPhase("authorized");
              }}
            >
              Authorize this exact intent
            </button>
          ) : authorized && !verdict ? (
            <button className="rw-btn rw-btn--primary" type="button" onClick={() => void signAndVerify()} disabled={phase === "signing"}>
              {phase === "signing" ? "Waiting for the signature…" : "Sign in Freighter"}
            </button>
          ) : cleared && !submission ? (
            <button className="rw-btn rw-btn--primary" type="button" onClick={() => void submitAndSettle()} disabled={phase === "submitting"}>
              {phase === "submitting" ? "Submitting…" : "Submit to Stellar Testnet"}
            </button>
          ) : (
            <span>A signature is not a submission.</span>
          )
        }
      >
        {!built && preflight ? (
          <>
            <Stepper steps={preflightSteps} />
            {blockedOnDestination ? (
              <>
                <div className="rw-hair" />
                <KeyValue label="Create it on testnet">
                  <a href={friendbotUrl} target="_blank" rel="noreferrer">
                    Fund this address with Friendbot
                  </a>
                </KeyValue>
              </>
            ) : null}
            {preflight.state === "BLOCKED" ? (
              <AlertStrip tone="danger">
                Nothing was built and nothing was signed. Every one of these was knowable before a signature, which is
                why it is checked here rather than reported after the network refuses.
              </AlertStrip>
            ) : null}
          </>
        ) : built ? (
          <>
            <KeyValue label="Network">{built.fingerprint.networkPassphrase}</KeyValue>
            <KeyValue label="Source"><span className="st-domain" translate="no">{built.fingerprint.source}</span></KeyValue>
            <KeyValue label="Sequence"><span translate="no">{built.fingerprint.sequence}</span></KeyValue>
            <KeyValue label="Fee ceiling, stroops"><span translate="no">{built.fingerprint.fee}</span></KeyValue>
            <KeyValue label="Memo">{built.fingerprint.memo}</KeyValue>
            {built.fingerprint.operations.map((operation, index) => (
              <KeyValue key={index} label={`Operation ${index + 1} · ${operation.type}`}>
                {Object.entries(operation.fields).map(([key, value]) => `${key} ${value}`).join(" · ")}
              </KeyValue>
            ))}
            {cleared ? (
              <KeyValue label="Transaction hash">
                <span className="rw-mono" translate="no">{cleared.transactionHash}</span>
              </KeyValue>
            ) : null}
          </>
        ) : (
          <EmptyState title="Nothing built yet">
            Build a transaction to see exactly what a signature would cover.
          </EmptyState>
        )}
      </Panel>

      <Panel
        id="authorize-lifecycle"
        title="Lifecycle"
        w={4}
        h={rows}
        essential
        badge={reconciliation ? reconciliation.status : verdict ? (verdict.allowed ? "VERIFIED" : "BLOCKED") : "OPEN"}
        tone={
          reconciliation
            ? reconciliation.status === "MATCHED"
              ? "verified"
              : "caution"
            : verdict
              ? verdict.allowed
                ? "verified"
                : "danger"
              : "muted"
        }
      >
        <Stepper steps={steps} />
        {verdict && !verdict.allowed && verdict.mismatches.length > 0 ? (
          <>
            <div className="rw-hair" />
            {verdict.mismatches.map((mismatch) => (
              <KeyValue key={mismatch.field} label={mismatch.field}>
                authorized <span translate="no">{mismatch.authorized || "—"}</span> · signed{" "}
                <span translate="no">{mismatch.signed || "—"}</span>
              </KeyValue>
            ))}
          </>
        ) : null}
      </Panel>

      <Panel
        id="authorize-outcome"
        title="What the ledger did"
        w={12}
        /* Explicit, because `grid-auto-rows` is one 80px row: a panel with no
           height token is 80px tall however much is inside it, and with
           `scroll` on it clips silently. The sibling Receipts panel was
           measured at 219px of content inside a 36px scrollport before this
           was understood. */
        h={receipt ? 8 : 4}
        essential
        scroll
        badge={receipt ? receipt.reconciliation.status : submission ? submission.kind : "NOT SUBMITTED"}
        tone={receipt ? (receipt.reconciliation.status === "MATCHED" ? "verified" : "caution") : submission ? "evidence" : "muted"}
        headerExtra={
          <InfoControl label="How this is checked">
            <p>
              The ledger is read back from Horizon independently of the submission — the credits and debits it
              recorded, the fee it charged, and whether it applied the transaction at all. Those are compared against
              what you authorized, movement by movement, with amounts compared in stroops so the same amount written
              two ways is one amount.
            </p>
            <p>
              A fee lower than the ceiling you authorized is normal and is not a deviation. Anything the comparison
              cannot model is reported as unchecked rather than counted as agreement.
            </p>
          </InfoControl>
        }
        actions={
          receiptFile ? (
            <a className="rw-btn" href={receiptFile} download={`ryntra-stellar-receipt-${receipt?.execution.transactionHash.slice(0, 12)}.json`}>
              Download the receipt
            </a>
          ) : null
        }
      >
        {submission ? (
          <>
            <KeyValue label="Transaction">
              <a href={transactionExplorerUrl(NETWORK, submission.transactionHash)} target="_blank" rel="noreferrer">
                <span className="rw-mono" translate="no">{submission.transactionHash}</span>
              </a>
            </KeyValue>
            {submission.kind === "SUBMITTED" && submission.note ? <KeyValue label="Note">{submission.note}</KeyValue> : null}
            {submission.kind !== "SUBMITTED" ? (
              <AlertStrip tone={submission.kind === "UNKNOWN" ? "warn" : "danger"}>{submission.reason}</AlertStrip>
            ) : null}
            {ledgerNote ? <AlertStrip tone="warn">{ledgerNote}</AlertStrip> : null}
          </>
        ) : (
          <EmptyState title="Nothing submitted">
            Build a transaction, authorize it, and sign it. Only bytes that matched what you authorized can be
            submitted from here.
          </EmptyState>
        )}

        {receipt ? (
          <>
            <div className="rw-hair" />
            <KeyValue label="Ledger"><span translate="no">{receipt.execution.ledger}</span></KeyValue>
            <KeyValue label="Closed at"><span translate="no">{receipt.execution.closedAt}</span></KeyValue>
            <KeyValue label="Applied">{receipt.actual.successful ? "yes" : "no"}</KeyValue>
            {/* The network's own words for what it decided. Without this the
                surface can only report that something did not happen, which is
                true and tells nobody what to do next. */}
            <KeyValue label="Network result">
              <span className="rw-mono" translate="no">
                {[receipt.actual.outcome.code, ...receipt.actual.outcome.operations]
                  .filter((code, index, all) => code && code !== "opInner" && all.indexOf(code) === index)
                  .join(" · ")}
              </span>
            </KeyValue>
            {receipt.actual.outcome.explanation ? (
              <AlertStrip tone={receipt.actual.successful ? "warn" : "danger"}>
                {receipt.actual.outcome.explanation}
              </AlertStrip>
            ) : null}
            <KeyValue label="Fee charged, stroops">
              <span translate="no">{receipt.actual.feeChargedStroops}</span> of at most{" "}
              <span translate="no">{receipt.expected.maxFeeStroops}</span>
            </KeyValue>

            <div className="rw-tablewrap">
              <table className="rw-table">
                <thead>
                  <tr>
                    <th scope="col">Check</th>
                    <th scope="col">Authorized</th>
                    <th scope="col">Ledger</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.reconciliation.checks.map((check) => (
                    <tr key={check.id}>
                      <th scope="row">{check.label}</th>
                      <td><span translate="no">{check.expected}</span></td>
                      <td><span translate="no">{check.actual}</span></td>
                      <td><span className="st-tag">{check.outcome}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rw-hair" />
            <KeyValue label="Intent hash"><span className="rw-mono" translate="no">{receipt.intent.hash}</span></KeyValue>
            <KeyValue label="Authorization hash"><span className="rw-mono" translate="no">{receipt.authorization.hash}</span></KeyValue>
            <KeyValue label="Actual effects hash"><span className="rw-mono" translate="no">{receipt.actualEffectsHash}</span></KeyValue>
            <KeyValue label="Receipt hash"><span className="rw-mono" translate="no">{receipt.receiptHash}</span></KeyValue>
            <KeyValue label="Check it yourself">
              <Link href="/stellar/workspace/receipts">Recompute every hash and re-read the ledger</Link>
            </KeyValue>
          </>
        ) : null}
      </Panel>
    </PanelGrid>
  );
}
