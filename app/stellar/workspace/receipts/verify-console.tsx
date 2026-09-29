"use client";

import { useState } from "react";

import { InfoControl } from "@/app/shell/info-control";
import { AlertStrip, EmptyState, KeyValue, Panel, PanelGrid } from "@/app/shell/panel";
import { isResolved } from "@/lib/stellar/evidence";
import { STELLAR_TESTNET, transactionExplorerUrl } from "@/lib/stellar/network";
import { expectedFromFingerprint, observeActualEffects, type ActualEffects } from "@/lib/stellar/transactions/effects";
import { fingerprintXdr } from "@/lib/stellar/transactions/fingerprint";
import { reconcile, type Reconciliation } from "@/lib/stellar/transactions/reconcile";
import { parseReceipt, verifyReceipt, type ReceiptVerification } from "@/lib/stellar/transactions/receipt";

/**
 * Checking a receipt, without trusting the thing that wrote it.
 *
 * Two modes, and the difference between them is the point.
 *
 * **A receipt** is checked twice over: every hash in it is recomputed from its
 * own contents, and then the ledger is read again and compared with what the
 * receipt says the ledger did. A document can be internally perfect and still
 * describe a transaction that never happened, so the second check is asked of
 * Horizon rather than of the document.
 *
 * **A transaction hash** needs no receipt at all. The expectation is taken from
 * the envelope the ledger itself stores — what the transaction said it would
 * do — and compared against the effects it produced. That is a weaker claim
 * than a Ryntra authorization, because it proves the transaction did what it
 * announced rather than what a person agreed to, and the surface says so
 * instead of blurring them. It also means this page works on any Stellar
 * Testnet transaction, including ones nothing here produced.
 */

const NETWORK = STELLAR_TESTNET;

type LedgerCheck = Readonly<{
  transactionHash: string;
  actual: ActualEffects;
  reconciliation: Reconciliation;
}>;

export function VerifyConsole() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [verification, setVerification] = useState<ReceiptVerification | null>(null);
  const [ledger, setLedger] = useState<LedgerCheck | null>(null);

  const trimmed = input.trim();
  const looksLikeHash = /^[0-9a-f]{64}$/i.test(trimmed);

  async function check() {
    setBusy(true);
    setProblem(null);
    setVerification(null);
    setLedger(null);
    try {
      if (looksLikeHash) await checkTransaction(trimmed.toLowerCase());
      else await checkReceipt(trimmed);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function checkReceipt(text: string) {
    const parsed = parseReceipt(text);
    if (!parsed.ok) {
      setProblem(parsed.reason);
      return;
    }
    setVerification(await verifyReceipt(parsed.receipt, NETWORK));
  }

  async function checkTransaction(hash: string) {
    const effects = await observeActualEffects(NETWORK, hash);
    if (!isResolved(effects)) {
      setProblem(effects.reason);
      return;
    }
    if (!effects.data.envelopeXdr) {
      setProblem("Horizon returned this transaction without its envelope, so there is nothing to compare the effects against.");
      return;
    }
    /* The ledger's own copy of what was signed, read back as an intent. */
    const announced = fingerprintXdr(effects.data.envelopeXdr, NETWORK.passphrase);
    setLedger({
      transactionHash: hash,
      actual: effects.data,
      reconciliation: reconcile(expectedFromFingerprint(announced), effects.data),
    });
  }

  const verdictTone = verification
    ? verification.verdict === "CONFIRMED"
      ? "verified"
      : verification.verdict === "ALTERED"
        ? "danger"
        : "caution"
    : "muted";

  /*
   * Heights follow content, because the grid does not.
   *
   * `grid-auto-rows` is one 80px row, so a panel with no height token is 80px
   * tall no matter what is inside it — and with `scroll` on, that silently
   * clips. Measured here before the fix: 219px of reconciliation result inside
   * a 36px scrollport, on the page whose entire purpose is that result. Nothing
   * caught it, because the audit sweep visits the page in its empty state.
   */
  const inputRows = verification ? 8 : 4;
  const ledgerRows = ledger ? 8 : 4;

  return (
    <PanelGrid label="Receipts">
      <Panel
        id="receipts-input"
        title="Check a receipt"
        w={4}
        h={inputRows}
        essential
        badge="TESTNET"
        tone="evidence"
        headerExtra={
          <InfoControl label="What is checked">
            <p>
              Paste a Ryntra Stellar receipt and every hash in it is recomputed from its own contents, then the ledger
              is read again and compared with what it claims. Paste a transaction hash instead and the expectation is
              taken from the envelope the ledger stores, so any Stellar Testnet transaction can be checked here.
            </p>
            <p>
              Nothing is uploaded. The receipt is read in this browser and the ledger is read straight from the public
              Horizon endpoint.
            </p>
          </InfoControl>
        }
        footer={
          <button className="rw-btn rw-btn--primary" type="button" onClick={() => void check()} disabled={busy || trimmed.length === 0}>
            {busy ? "Reading the ledger…" : looksLikeHash ? "Check this transaction" : "Check this receipt"}
          </button>
        }
      >
        <div className="rw-field">
          <label htmlFor="rv-input">Receipt JSON, or a transaction hash</label>
          <div className="rw-input">
            <textarea
              id="rv-input"
              rows={4}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Paste a receipt, or a 64-character transaction hash"
              spellCheck={false}
            />
          </div>
        </div>
        {problem ? <AlertStrip tone="warn">{problem}</AlertStrip> : null}
      </Panel>

      <Panel
        id="receipts-verdict"
        title="Checked against itself and the ledger"
        w={8}
        h={inputRows}
        essential
        scroll
        badge={verification ? verification.verdict : "NOT CHECKED"}
        tone={verdictTone}
      >
        {verification ? (
          <>
            {verification.verdict === "UNCONFIRMED" ? (
              <AlertStrip tone="warn">
                Nothing in this receipt contradicts itself, and the ledger could not be read to confirm it. That is not
                the same as confirmed.
              </AlertStrip>
            ) : null}
            <div className="rw-tablewrap">
              <table className="rw-table">
                <thead>
                  <tr>
                    <th scope="col">Check</th>
                    <th scope="col">Result</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {verification.findings.map((finding) => (
                    <tr key={finding.id}>
                      <th scope="row">{finding.label}</th>
                      <td><span className="st-tag">{finding.outcome}</span></td>
                      <td><span className="rw-mono" translate="no">{finding.detail}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState title="Nothing checked yet">
            A receipt is only a receipt if somebody who does not trust us can recompute it. Paste one and every hash is
            recomputed here, in your browser.
          </EmptyState>
        )}
      </Panel>

      <Panel
        id="receipts-ledger"
        title="A transaction, compared with what it announced"
        w={12}
        h={ledgerRows}
        essential
        scroll
        badge={ledger ? ledger.reconciliation.status : "NOT READ"}
        tone={ledger ? (ledger.reconciliation.status === "MATCHED" ? "verified" : "caution") : "muted"}
        headerExtra={
          <InfoControl label="What this proves, and what it does not">
            <p>
              The expectation here comes from the transaction envelope stored on the ledger — the operations the
              transaction itself declares. Comparing that against the effects proves the network did what the
              transaction said, which is worth checking and is not the same as proving somebody authorized it.
            </p>
            <p>
              Only a receipt carries that second fact, because only a receipt records the intent that was fingerprinted
              before a wallet ever saw it.
            </p>
          </InfoControl>
        }
      >
        {ledger ? (
          <>
            <KeyValue label="Transaction">
              <a href={transactionExplorerUrl(NETWORK, ledger.transactionHash)} target="_blank" rel="noreferrer">
                <span className="rw-mono" translate="no">{ledger.transactionHash}</span>
              </a>
            </KeyValue>
            <KeyValue label="Ledger"><span translate="no">{ledger.actual.ledger}</span></KeyValue>
            <KeyValue label="Closed at"><span translate="no">{ledger.actual.closedAt}</span></KeyValue>
            <KeyValue label="Applied">{ledger.actual.successful ? "yes" : "no"}</KeyValue>
            <div className="rw-tablewrap">
              <table className="rw-table">
                <thead>
                  <tr>
                    <th scope="col">Check</th>
                    <th scope="col">Announced</th>
                    <th scope="col">Ledger</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.reconciliation.checks.map((check) => (
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
          </>
        ) : (
          <EmptyState title="No transaction read">
            Paste any Stellar Testnet transaction hash to see its declared operations compared against the effects the
            ledger recorded. It does not have to be one this workspace produced.
          </EmptyState>
        )}
      </Panel>
    </PanelGrid>
  );
}
