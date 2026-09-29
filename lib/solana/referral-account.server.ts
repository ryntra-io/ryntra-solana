/**
 * Proving Ryntra's Jupiter referral account is real before ever naming it.
 *
 * ## The defect this exists to prevent
 *
 * A referral account that is well-formed base58 but **not initialised under
 * Jupiter's referral program** does not make `/order` return a smaller fee. It
 * makes `/order` return **HTTP 400** with
 *
 * > Please check that referralAccount is initialized under
 * > `REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3` for project
 * > `DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc`
 *
 * Measured live on 2026-09-10 against two well-formed addresses — an ordinary
 * wallet and the System Program. Our own boundary maps a 400 to `REFUSED`, so a
 * single wrong environment variable would have taken **every Solana swap** off
 * the product and reported it to people as the market being unavailable. A fee is
 * never worth that, and a shape check cannot catch it: both of those addresses
 * pass every shape check there is.
 *
 * So the account is verified against the chain, once per process, before the
 * parameter is ever sent. Two facts are checked and both are load-bearing:
 *
 * 1. the account is **owned by the referral program**, which is what "initialised
 *    under" means; and
 * 2. the 32 bytes at offset 40 are Jupiter's **Ultra referral project**, because
 *    an account under a different project is refused by the same 400.
 *
 * Offset 40 is the layout read off mainnet on 2026-09-10, not from a header: the
 * program's accounts are an 8-byte discriminator, a 32-byte partner and then the
 * project, and filtering `getProgramAccounts` at offset 40 for the Ultra project
 * returns 1,774 accounts while offsets 8 and 72 return none.
 *
 * A failed verification is not an error anybody sees. It means no fee parameter
 * is sent, the swap works exactly as it did before monetization, and
 * `ryntraFee` says `UNCONFIGURED` with the reason attached — which is a state the
 * surface already knows how to tell the truth about.
 */

import { serviceFeeRateFor, type ServiceFeeConfig } from "../swap/service-fee.ts";
import type { JupiterReferral } from "./quotes.ts";
import { createSolanaRpcHandle, withRpcDiscipline, type SolanaRpcHandle } from "./rpc.ts";

export const JUPITER_REFERRAL_PROGRAM = "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3";
export const JUPITER_ULTRA_REFERRAL_PROJECT = "DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc";
/** 8-byte discriminator + 32-byte partner. See the module note. */
export const REFERRAL_PROJECT_OFFSET = 40;

export type ReferralVerdict =
  | Readonly<{ ok: true; account: string }>
  | Readonly<{
      ok: false;
      code: "NOT_CONFIGURED" | "ACCOUNT_MISSING" | "WRONG_PROGRAM" | "WRONG_PROJECT" | "UNREADABLE";
      reason: string;
    }>;

type AccountRead = Readonly<{ owner: string; projectBase58: string | null }> | null;

/**
 * One `getAccountInfo`, sliced to the project field.
 *
 * `dataSlice` rather than the whole account because the only bytes that decide
 * this are 32 of them, and a boundary that reads less can promise less went
 * wrong.
 */
async function readReferralAccount(handle: SolanaRpcHandle, account: string): Promise<AccountRead> {
  const response = await withRpcDiscipline(handle, (abortSignal) =>
    handle.rpc
      .getAccountInfo(account as never, {
        encoding: "base64",
        dataSlice: { offset: REFERRAL_PROJECT_OFFSET, length: 32 },
        commitment: "confirmed",
      })
      .send({ abortSignal }),
  );
  const value = (response as { value: { owner?: unknown; data?: unknown } | null }).value;
  if (!value) return null;
  const owner = typeof value.owner === "string" ? value.owner : String(value.owner ?? "");
  const encoded = Array.isArray(value.data) ? value.data[0] : null;
  const bytes = typeof encoded === "string" ? Buffer.from(encoded, "base64") : null;
  return { owner, projectBase58: bytes && bytes.length === 32 ? base58(bytes) : null };
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Base58 of exactly 32 bytes, written out rather than imported.
 *
 * The alternative is pulling a Solana keypair library into a path whose only job
 * is to compare two pubkeys, and this comparison is twelve lines. Leading zero
 * bytes become leading `1`s, which is the part a hand-rolled encoder usually
 * gets wrong.
 */
function base58(bytes: Buffer): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let text = "";
  while (value > 0n) {
    text = BASE58[Number(value % 58n)] + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text === "" ? "1" : text;
}

export async function verifyJupiterReferralAccount(
  account: string | null,
  deps: Readonly<{ handle?: SolanaRpcHandle; read?: typeof readReferralAccount }> = {},
): Promise<ReferralVerdict> {
  if (!account) return { ok: false, code: "NOT_CONFIGURED", reason: "No Jupiter referral account is configured." };
  const handle = deps.handle ?? createSolanaRpcHandle({ network: "mainnet" });
  const read = deps.read ?? readReferralAccount;
  let info: AccountRead;
  try {
    info = await read(handle, account);
  } catch (failure) {
    /* An RPC that did not answer says nothing about the account. Not sending the
       fee is the safe read of "we do not know", because the alternative risks the
       400 that takes the whole lane down. */
    return {
      ok: false,
      code: "UNREADABLE",
      reason: `The referral account could not be read from the chain: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
  if (!info) return { ok: false, code: "ACCOUNT_MISSING", reason: "The configured referral account does not exist on mainnet." };
  if (info.owner !== JUPITER_REFERRAL_PROGRAM) {
    return { ok: false, code: "WRONG_PROGRAM", reason: `The configured account is owned by ${info.owner}, not by Jupiter's referral program.` };
  }
  if (info.projectBase58 !== JUPITER_ULTRA_REFERRAL_PROJECT) {
    return { ok: false, code: "WRONG_PROJECT", reason: "The referral account belongs to another project, which Jupiter refuses the same way it refuses an uninitialised one." };
  }
  return { ok: true, account };
}

/**
 * The verdict, computed once per process and kept.
 *
 * A referral account does not stop being one, so re-reading the chain on every
 * quote would buy nothing and spend a request from the same budget the quote
 * needs. A failure is cached too, deliberately: a misconfigured deployment should
 * cost one RPC read, not one per swap. Restarting the process — which is what a
 * deployment does — is the way to re-ask.
 */
let cached: Readonly<{ account: string | null; verdict: ReferralVerdict }> | null = null;

export function resetJupiterReferralCache(): void {
  cached = null;
}

export async function verifiedJupiterReferral(
  config: ServiceFeeConfig,
  deps: Readonly<{ handle?: SolanaRpcHandle; read?: typeof readReferralAccount }> = {},
): Promise<Readonly<{ referral: JupiterReferral | null; verdict: ReferralVerdict }>> {
  const account = config.jupiterReferralAccount;
  if (cached && cached.account === account) {
    return { referral: cached.verdict.ok ? { account: cached.verdict.account, feeBps: serviceFeeRateFor("JUPITER_REFERRAL") } : null, verdict: cached.verdict };
  }
  const verdict = await verifyJupiterReferralAccount(account, deps);
  cached = { account, verdict };
  return { referral: verdict.ok ? { account: verdict.account, feeBps: serviceFeeRateFor("JUPITER_REFERRAL") } : null, verdict };
}
