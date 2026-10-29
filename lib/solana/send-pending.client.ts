/**
 * The one fact a reload must not destroy: a transfer is already signed.
 *
 * Everything else on the Send card can be rebuilt. A plan can be planned again,
 * a balance re-read, a quote re-quoted. A signature cannot: the moment a wallet
 * returns one, bytes exist that may already be on the network, and the only
 * safe thing to do with them is *read* them. Send used to hold that signature
 * in React state alone, so a person who approved a mainnet transfer and then
 * reloaded — or whose phone discarded the tab — had an application that no
 * longer knew a transfer was in flight. `sendFailureCopy` already promised the
 * right sentence, *an earlier transfer is still being confirmed, do not send it
 * again*, and after a reload the card could not say it, because it did not
 * remember.
 *
 * So this is written the instant the signature is knowable — before `../settle`
 * is called, not after it answers — and cleared only when the transfer reaches
 * a state that cannot change. The window it closes is exactly the dangerous
 * one: signed, submitted, outcome unknown.
 *
 * Wallet-scoped, because history follows the wallet rather than the browser. A
 * signature belongs to whoever signed it, and a second wallet on the same
 * device must never inherit the first one's unfinished transfer.
 *
 * Never throws. A private window, blocked site data or a full quota must
 * degrade to *no pending transfer known*, never to a page that fails to render
 * — the same rule the receipt vault keeps, and for the same reason.
 */

export const SOLANA_SEND_PENDING_KEY = "ryntra.solana.send-pending.v1";

/** How many wallets keep a pending record on one device. */
export const SOLANA_SEND_PENDING_LIMIT = 8;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type PendingSend = Readonly<{
  /** The sending wallet, so a second account cannot inherit this. */
  wallet: string;
  /** Base58, as the wallet returned it and the server will verify it. */
  signature: string;
  network: "mainnet" | "devnet";
  /** When this tab learned the signature, not when the network saw it. */
  signedAt: string;
}>;

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Validate on the way out, not only on the way in.
 *
 * Storage is shared with every other script on the origin and survives version
 * changes, so a record read back is untrusted input. A malformed entry must
 * read as *nothing pending* rather than propagate a bad signature into a
 * recovery request.
 */
function validate(value: unknown): PendingSend | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { wallet, signature, network, signedAt } = record;
  if (typeof wallet !== "string" || !WALLET.test(wallet)) return null;
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) return null;
  if (network !== "mainnet" && network !== "devnet") return null;
  if (typeof signedAt !== "string" || Number.isNaN(Date.parse(signedAt))) return null;
  return { wallet, signature, network, signedAt };
}

function readAll(storage: StorageLike): PendingSend[] {
  try {
    const raw = storage.getItem(SOLANA_SEND_PENDING_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const records: PendingSend[] = [];
    for (const entry of parsed) {
      const record = validate(entry);
      if (record) records.push(record);
    }
    return records;
  } catch {
    return [];
  }
}

function writeAll(storage: StorageLike, records: readonly PendingSend[]): boolean {
  try {
    storage.setItem(SOLANA_SEND_PENDING_KEY, JSON.stringify(records.slice(0, SOLANA_SEND_PENDING_LIMIT)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Record that this wallet has a signed transfer whose outcome is not known.
 *
 * Newest first, one per wallet: a second signature from the same wallet
 * replaces the first rather than queueing behind it, because the card admits
 * one signing at a time and two live records for one account would make
 * "which transfer is still open" unanswerable.
 */
export function rememberPendingSend(storage: StorageLike, pending: PendingSend): boolean {
  const record = validate(pending);
  if (!record) return false;
  const rest = readAll(storage).filter((entry) => entry.wallet !== record.wallet);
  return writeAll(storage, [record, ...rest]);
}

/** What this wallet left unfinished, if anything. */
export function readPendingSend(storage: StorageLike, wallet: string): PendingSend | null {
  return readAll(storage).find((entry) => entry.wallet === wallet) ?? null;
}

/**
 * The newest unfinished transfer on this device, whoever signed it.
 *
 * Needed because of how the failure actually looks. Reloading the page drops
 * the wallet connection — the card comes back showing its connect tiles — so a
 * resume path that asks "what did *the connected wallet* leave unfinished"
 * asks a question with no answer at exactly the moment it matters. The first
 * version of this feature did that, and a person's reload produced a card
 * that had forgotten a transfer it had just written down.
 *
 * A record is device-local and was written by whoever was sitting here. Telling
 * them a transfer is still open needs no connection, and neither does resolving
 * it: the recovery route is addressed by signature, not by owner.
 */
export function readLatestPendingSend(storage: StorageLike): PendingSend | null {
  return readAll(storage)[0] ?? null;
}

/**
 * Forget one wallet's pending transfer.
 *
 * Called only from a terminal answer — a receipt, a confirmed failure, an
 * expiry the server has established. Never on a network error, a closed tab or
 * a refused request: those are exactly the states where the record is the only
 * thing standing between a person and sending the same money twice.
 */
export function forgetPendingSend(storage: StorageLike, wallet: string): boolean {
  const remaining = readAll(storage).filter((entry) => entry.wallet !== wallet);
  return writeAll(storage, remaining);
}

/**
 * How long signed bytes can still reach the network.
 *
 * A Solana blockhash is valid for 150 blocks — about thirty seconds since
 * mainnet slots became 200 ms (AG-1, 2026-10-17; `blockhash-life.ts`). Two
 * minutes stays anyway: this is a fallback, never the verdict. "The chain
 * never will" is the chain's word — the block height past
 * `lastValidBlockHeight` — and shortening this clock would let live bytes be
 * forgotten and sent a second time.
 */
export const BLOCKHASH_WINDOW_MS = 120_000;

export type ResumeDecision = Readonly<{
  /** What the person is told. `null` means there is nothing to tell them. */
  show: "CHECKING" | "LANDED" | "FAILED" | "UNKNOWN" | null;
  /** Whether the record may be dropped. Never true while an outcome is open. */
  forget: boolean;
  /** Whether to ask again after the poll interval. */
  keepPolling: boolean;
}>;

/**
 * What a recovery answer means for a signed transfer nobody has an outcome for.
 *
 * Extracted from the card deliberately. This is the decision that can cost a
 * person real money — drop the record for a transfer still in flight and the
 * warning that stops a second send goes with it — and inside a React effect it
 * was reachable only by connecting a wallet and signing something. Here every
 * branch is a test.
 *
 * Pure and total: no clock of its own, no storage, no network. The caller
 * supplies the age, so "long enough that it can never land" is an input rather
 * than a hidden dependency.
 */
export function decideResume(answer: {
  /** `null` when the recovery route did not answer at all. */
  read: Readonly<{ seen: boolean; err: string | null; hasAttempt: boolean }> | null;
  /** Milliseconds since this device learned the signature. */
  ageMs: number;
}): ResumeDecision {
  const { read, ageMs } = answer;

  /* No answer is not an outcome. The record stays and the warning stays with
     it: this is the one state where being wrong costs a duplicate transfer. */
  if (!read) return { show: "UNKNOWN", forget: false, keepPolling: true };

  if (read.seen) {
    return {
      show: read.err !== null ? "FAILED" : "LANDED",
      forget: true,
      keepPolling: false,
    };
  }

  /* Unseen and unclaimed, past the window in which it could still land. Bytes
     like these went nowhere and never will. */
  if (!read.hasAttempt && Number.isFinite(ageMs) && ageMs > BLOCKHASH_WINDOW_MS) {
    return { show: null, forget: true, keepPolling: false };
  }

  /* Unseen but still live, or unseen and claimed by the submit boundary — which
     means bytes crossed and only the outcome is missing. Keep asking. */
  return { show: "UNKNOWN", forget: false, keepPolling: true };
}

/**
 * Whether an earlier transfer in this state must hold back a new signature.
 *
 * The card was warning *do not send it again* while leaving its button live —
 * advice the product did not follow itself. It is worse than inconsistent:
 * storing a new signature replaces this wallet's record, so signing during an
 * open outcome would drop the very transfer the warning was about.
 *
 * Written as an exhaustive switch rather than a two-way comparison so that
 * adding a state to `ResumeDecision["show"]` forces a decision here instead of
 * silently defaulting to "sending is fine".
 */
export function blocksNewSend(show: ResumeDecision["show"]): boolean {
  switch (show) {
    case "CHECKING":
    case "UNKNOWN":
      return true;
    case "LANDED":
    case "FAILED":
    case null:
      /* Answers, not open questions. Nothing is waiting on them. */
      return false;
    default: {
      /* A state nobody classified is treated as open, because the failure that
         costs money is letting a second transfer through, not withholding one. */
      const unreachable: never = show;
      void unreachable;
      return true;
    }
  }
}
