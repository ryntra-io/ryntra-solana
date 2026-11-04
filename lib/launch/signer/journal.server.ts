/**
 * CITY-162 — the journal of Launch's signatures: one row for every signature the pool payer or the executor made, and
 * for every request it refused — the role, the address, the adapter (`env` or `kms`) and the KMS key version, what the
 * message does (read from its bytes), what it acts on, the message's sha256, the signature and when.
 *
 * Public data only: a row never holds a key, a token or a credential; a signature and a message hash are what the chain
 * shows anyway once the transaction lands. Rows are written once, keyed
 * `solana:<cluster>:<role>:<time>:<message hash>`, in the Guard store's `launchSignatures` (a value in the same column;
 * no DDL); a line of the same row goes to the function's log, where Vercel keeps it beside KMS's own audit log.
 */

import type { GuardStore } from "../../guard/store.ts";
import type { LaunchSignerRole, SignatureRow, SignJournal } from "./signer.server.ts";

export const SIGNATURES = "launchSignatures";

const keyOf = (row: SignatureRow) => `solana:${row.cluster}:${row.role}:${row.at}:${row.messageSha256.slice(0, 16)}:${row.outcome}`;

/** The journal in the Guard store; a row that cannot be written throws — and the signature is not given back. */
export function storeJournal(store: () => GuardStore, log: (line: string) => void = (line) => console.info(line)): SignJournal {
  return async (row) => {
    const written = await store().collection<SignatureRow>(SIGNATURES).insertIfAbsent(keyOf(row), row);
    if (!written) throw new Error("the signing journal already has this row");
    try {
      log(JSON.stringify({ event: "launch.signature", ...row }));
    } catch {
      /* The store holds the row; a log that fails takes nothing from it. */
    }
  };
}

/** The journal's rows on a network — of one role, when given — oldest first. */
export async function readSignatures(store: GuardStore, cluster: string, role?: LaunchSignerRole): Promise<readonly SignatureRow[]> {
  const rows = await store.collection<SignatureRow>(SIGNATURES).valuesWithPrefix(`solana:${cluster}:${role ? `${role}:` : ""}`);
  return [...rows].sort((a, b) => a.at.localeCompare(b.at));
}
