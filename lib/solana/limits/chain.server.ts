/**
 * The chain as the limits lane reads it: one web3.js connection per process on
 * the configured mainnet endpoint (the DLMM SDK speaks web3.js), and the proof
 * that Ryntra's Trigger referral can take a fee in a given token.
 */

import { Connection, PublicKey } from "@solana/web3.js";

import { resolveEndpoint } from "../rpc.ts";
import { JUPITER_REFERRAL_PROGRAM_ID, TRIGGER_V1_REFERRAL_PROJECT } from "./model.ts";

let cached: { url: string; connection: Connection } | null = null;

export function limitsConnection(): Connection {
  const url = resolveEndpoint("mainnet");
  if (!cached || cached.url !== url) cached = { url, connection: new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true }) };
  return cached.connection;
}

/**
 * The referral account under Jupiter's «Limit Order» project that Trigger fees
 * are paid to. A public address, set in the environment; the partner who can
 * claim from it is the operator's wallet. Not the Ultra referral the swap lane
 * uses: the Trigger program refuses that project's token accounts.
 */
export const TRIGGER_REFERRAL_ENV = "RYNTRA_JUPITER_TRIGGER_REFERRAL_ACCOUNT";

export function configuredTriggerReferral(): string | null {
  const value = process.env[TRIGGER_REFERRAL_ENV]?.trim();
  return value ? value : null;
}

/** `["referral_ata", referral, mint]` under the referral program — found on chain for live referrals of the project. */
export function referralTokenAccountAddress(referral: string, mint: string): string {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("referral_ata"), new PublicKey(referral).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey(JUPITER_REFERRAL_PROGRAM_ID),
  );
  return address.toBase58();
}

export type ReferralFeeAccount =
  | Readonly<{ ok: true; account: string }>
  | Readonly<{ ok: false; code: "NOT_CONFIGURED" | "REFERRAL_INVALID" | "NO_TOKEN_ACCOUNT" | "UNREADABLE"; reason: string }>;

let referralVerdict: Readonly<{ referral: string; ok: boolean; reason: string }> | null = null;
const tokenAccounts = new Map<string, Readonly<{ at: number; verdict: ReferralFeeAccount }>>();
/** A token account, once created, stays; a missing one is re-asked after a minute so the operator's creation shows up without a deploy. */
const POSITIVE_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;

export function resetTriggerReferralCache(): void {
  referralVerdict = null;
  tokenAccounts.clear();
}

async function verifyReferral(connection: Connection, referral: string): Promise<Readonly<{ ok: boolean; reason: string }>> {
  if (referralVerdict && referralVerdict.referral === referral) return referralVerdict;
  let key: PublicKey;
  try {
    key = new PublicKey(referral);
  } catch {
    referralVerdict = { referral, ok: false, reason: "The configured Trigger referral is not an address." };
    return referralVerdict;
  }
  const info = await connection.getAccountInfo(key, { commitment: "confirmed", dataSlice: { offset: 40, length: 32 } });
  if (!info) {
    referralVerdict = { referral, ok: false, reason: "The configured Trigger referral does not exist on mainnet." };
  } else if (!info.owner.equals(new PublicKey(JUPITER_REFERRAL_PROGRAM_ID))) {
    referralVerdict = { referral, ok: false, reason: "The configured Trigger referral is not a referral-program account." };
  } else if (info.data.length !== 32 || new PublicKey(info.data).toBase58() !== TRIGGER_V1_REFERRAL_PROJECT) {
    referralVerdict = { referral, ok: false, reason: "The configured Trigger referral belongs to another project than «Limit Order»." };
  } else {
    referralVerdict = { referral, ok: true, reason: "" };
  }
  return referralVerdict;
}

/**
 * The referral token account Ryntra's fee in `mint` would be paid into, proved:
 * the referral is under «Limit Order», and the token account exists, holds
 * `mint` and has the project as its authority — exactly what the program's
 * `ConstraintTokenOwner` checks. Anything else answers no account, and the
 * order then carries Jupiter's own fee only.
 */
export async function triggerReferralFeeAccount(
  mint: string,
  deps: Readonly<{ connection?: Connection; referral?: string | null; now?: number }> = {},
): Promise<ReferralFeeAccount> {
  const referral = deps.referral === undefined ? configuredTriggerReferral() : deps.referral;
  if (!referral) return { ok: false, code: "NOT_CONFIGURED", reason: `${TRIGGER_REFERRAL_ENV} is not set.` };
  const now = deps.now ?? Date.now();
  const known = tokenAccounts.get(`${referral}:${mint}`);
  if (known && now - known.at < (known.verdict.ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS)) return known.verdict;
  const connection = deps.connection ?? limitsConnection();
  let verdict: ReferralFeeAccount;
  try {
    const proved = await verifyReferral(connection, referral);
    if (!proved.ok) {
      verdict = { ok: false, code: "REFERRAL_INVALID", reason: proved.reason };
    } else {
      const account = referralTokenAccountAddress(referral, mint);
      const parsed = await connection.getParsedAccountInfo(new PublicKey(account), "confirmed");
      const data = parsed.value?.data;
      const info = data && typeof data === "object" && "parsed" in data ? (data.parsed as { info?: { mint?: string; owner?: string } }).info : undefined;
      verdict = info && info.mint === mint && info.owner === TRIGGER_V1_REFERRAL_PROJECT
        ? { ok: true, account }
        : { ok: false, code: "NO_TOKEN_ACCOUNT", reason: `No referral token account for ${mint} yet.` };
    }
  } catch (failure) {
    /* Not knowing is answered as no fee: never an account a keeper might not be able to pay into. */
    return { ok: false, code: "UNREADABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  tokenAccounts.set(`${referral}:${mint}`, { at: now, verdict });
  return verdict;
}
