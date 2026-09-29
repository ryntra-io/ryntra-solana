/**
 * One bridge transfer, remembered across a closed tab.
 *
 * A cross-chain transfer is the only action in this workspace that spans
 * minutes rather than seconds: money leaves Solana, an attester signs for it,
 * and it arrives on Base some fifteen to nineteen minutes later. Anything can
 * happen in that window — a refresh, a closed laptop, a browser crash.
 *
 * The durable claim on the server survives all of that and knows exactly where
 * the money is. What did **not** survive was the issuer-signed Review bundle,
 * which lived in React state and nowhere else. The receipt route needs it,
 * because a receipt is bound to what was authorized rather than to whatever a
 * caller later claims was authorized. So a burn followed by a closed tab left a
 * transfer that completed on both chains and could never be receipted.
 *
 * This keeps that bundle in the browser that made it, under the transfer's own
 * intent digest, so a reopened tab can pick the transfer back up.
 *
 * **What is kept and what is not.** The reviewed *unsigned* bytes, the issuer
 * proof and the burn signature — all public, all already on the wire or on the
 * chain. Never a signed transaction, never a key: the one-transaction message
 * key is discarded the moment the burn is submitted and is not recoverable by
 * design, which is fine, because after the burn it can do nothing at all.
 */

const KEY = "ryntra.solana.bridge-run.v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type BridgeRun = Readonly<{
  intentDigest: string;
  /**
   * Which way this transfer goes.
   *
   * Optional so a run written before the lane had two directions still resumes;
   * every one of those was Solana to Base, which is what an absent value means.
   */
  direction?: "SOLANA_TO_BASE" | "BASE_TO_SOLANA" | "SOLANA_TO_ETHEREUM" | "ETHEREUM_TO_SOLANA";
  /** The exact bundle the issuer signed. Unsigned bytes only. */
  bundle: unknown;
  reviewProof: unknown;
  burnSignature: string | null;
  mintTransactionHash: string | null;
  usdcBeforeRaw: string | null;
  savedAt: string;
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isRun(value: unknown): value is BridgeRun {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.intentDigest === "string" &&
    /^0x[0-9a-f]{64}$/.test(record.intentDigest) &&
    typeof record.savedAt === "string" &&
    record.bundle !== undefined &&
    record.reviewProof !== undefined
  );
}

/**
 * Nothing signable is ever written here, whatever a caller passes.
 *
 * Anchored on purpose. An unanchored `signedwire` also matches
 * **un**signedWireBase64 — the reviewed, unsigned, entirely public bytes the
 * receipt is bound to — and stripping those turns a safety rule into data loss
 * that only shows up when somebody tries to resume a live transfer.
 */
const FORBIDDEN = /^signed|secretkey|privatekey|mnemonic|seedphrase/;

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN.test(key.replace(/[^a-z]/gi, "").toLowerCase())) continue;
    out[key] = scrub(entry);
  }
  return out;
}

/**
 * Remember this transfer. Storage failures are swallowed on purpose.
 *
 * A browser with site data blocked is a browser that can still bridge; it just
 * cannot resume a closed tab, and losing the transfer would be a worse answer
 * than losing the convenience.
 */
export function saveBridgeRun(storage: StorageLike, run: Omit<BridgeRun, "savedAt">, now: Date = new Date()): boolean {
  try {
    const record = { ...run, bundle: scrub(run.bundle), savedAt: now.toISOString() };
    storage.setItem(KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** The remembered transfer, if there is one and it is not stale. */
export function readBridgeRun(storage: StorageLike, now: Date = new Date()): BridgeRun | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRun(parsed)) return null;
    /* A week. Long enough for any recovery this lane can need — a Fast message
       expires in a day and a Standard one settles in minutes — and short
       enough that a run nobody finished stops resurfacing forever. */
    if (now.getTime() - Date.parse(parsed.savedAt) > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Forget it. Called once the receipt exists, and never before. */
export function clearBridgeRun(storage: StorageLike): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* Nothing to do and nothing worth telling anyone. */
  }
}
