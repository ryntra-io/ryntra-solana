"use client";

import { useState } from "react";

import { storeSolanaReceipt, type StoredSendReceipt } from "@/lib/solana/send-receipt-vault.client";

import { useSolanaI18n } from "../i18n/provider";
import { useWalletProof } from "../wallet-proof";
import styles from "./receipts.module.css";

/**
 * The server copy of a wallet's receipts — history class B beyond this device.
 *
 * Three honest states: the wallet has not proven itself (nothing on the server
 * can be read or written), it has (receipts can be saved and read back), and
 * the archive holds receipts this browser does not (they can be imported,
 * without ever overwriting a receipt already here). Every step is the
 * person's own click; nothing syncs by itself.
 */
type ArchiveRow = Readonly<{ kind: string; contentHash: string; payload: Record<string, unknown>; occurredAt: string | null; createdAt: string }>;

function kindOf(receipt: Record<string, unknown>): "send" | "swap" | "bridge" | "other" {
  const kind = String(receipt.kind ?? receipt.receiptKind ?? "").toLowerCase();
  if (kind.includes("bridge")) return "bridge";
  if (kind.includes("swap")) return "swap";
  if (kind.includes("send") || kind.includes("transfer")) return "send";
  return "other";
}

export function ArchivePanel({ owner, localRows, onImported }: { owner: string; localRows: readonly StoredSendReceipt[]; onImported: () => void }) {
  const { text } = useSolanaI18n();
  const { state, prove } = useWalletProof();
  const [archived, setArchived] = useState<readonly ArchiveRow[] | null>(null);
  const [busy, setBusy] = useState<"save" | "load" | "import" | null>(null);
  const [line, setLine] = useState<string | null>(null);

  const proven = state.status === "proven" && state.address === owner;
  const localHashes = new Set(localRows.map((row) => String(row.receipt.contentHash)));
  const missingHere = (archived ?? []).filter((row) => !localHashes.has(row.contentHash));

  const save = async () => {
    setBusy("save");
    setLine(null);
    try {
      const rows = localRows
        .filter((row) => /^[0-9a-f]{64}$/.test(String(row.receipt.contentHash)))
        .map((row) => ({ kind: kindOf(row.receipt), contentHash: String(row.receipt.contentHash), payload: row.receipt, occurredAt: row.storedAt }));
      const r = await fetch("/api/solana/receipts/archive", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: owner, rows }) });
      const data = (await r.json().catch(() => ({}))) as { inserted?: number; offered?: number };
      setLine(r.ok ? `${text("Saved")} · ${data.inserted ?? 0} ${text("new")}, ${data.offered ?? rows.length} ${text("receipts")}` : text("Archive unavailable right now."));
    } catch {
      setLine(text("Archive unavailable right now."));
    } finally {
      setBusy(null);
    }
  };

  const load = async () => {
    setBusy("load");
    setLine(null);
    try {
      const r = await fetch(`/api/solana/receipts/archive?address=${encodeURIComponent(owner)}`);
      const data = (await r.json().catch(() => ({}))) as { rows?: ArchiveRow[] };
      if (!r.ok) {
        setLine(text("Archive unavailable right now."));
        return;
      }
      setArchived(data.rows ?? []);
    } catch {
      setLine(text("Archive unavailable right now."));
    } finally {
      setBusy(null);
    }
  };

  const importRows = () => {
    setBusy("import");
    let added = 0;
    for (const row of missingHere) {
      const result = storeSolanaReceipt(window.localStorage, owner, row.payload);
      if (result.ok && !result.duplicate) added += 1;
    }
    setLine(`${text("Imported")} · ${added} ${text("receipts")}`);
    setBusy(null);
    onImported();
    void load();
  };

  return (
    <section className={styles.archive} aria-labelledby="receipts-archive-title">
      <h3 id="receipts-archive-title" className={styles.archiveTitle}>{text("Archive on Ryntra")}</h3>
      {!proven ? (
        <>
          <p className={styles.boundary}>{text("Prove this wallet to keep receipts on Ryntra and read them from another device.")}</p>
          <div className={styles.actions}>
            <button className="rw-btn" data-variant="primary" type="button" onClick={() => void prove()} disabled={state.status === "signing" || state.status === "checking"}>
              {state.status === "signing" ? text("Signing…") : text("Prove wallet")}
            </button>
          </div>
          {state.status === "refused" ? <p className={styles.problem} role="alert">{text("The wallet refused.")}</p> : null}
          {state.status === "unsupported" ? <p className={styles.problem} role="alert">{text("This wallet cannot sign a message.")}</p> : null}
          {state.status === "failed" ? <p className={styles.problem} role="alert">{state.reason}</p> : null}
        </>
      ) : (
        <>
          <div className={styles.actions}>
            <button className="rw-btn" type="button" onClick={() => void save()} disabled={busy !== null || localRows.length === 0}>{busy === "save" ? text("Saving…") : text("Save receipts to Ryntra")}</button>
            <button className="rw-btn" type="button" onClick={() => void load()} disabled={busy !== null}>{busy === "load" ? text("Reading…") : text("Show archived receipts")}</button>
            {archived && missingHere.length > 0 ? (
              <button className="rw-btn" data-variant="primary" type="button" onClick={importRows} disabled={busy !== null}>{text("Import to this device")} · {missingHere.length}</button>
            ) : null}
          </div>
          {archived && archived.length === 0 ? <p className={styles.boundary}>{text("Nothing archived yet")}</p> : null}
          {archived && archived.length > 0 && missingHere.length === 0 ? <p className={styles.boundary}>{text("Everything archived is already on this device.")}</p> : null}
        </>
      )}
      {line ? <p className={styles.boundary} role="status">{line}</p> : null}
    </section>
  );
}
