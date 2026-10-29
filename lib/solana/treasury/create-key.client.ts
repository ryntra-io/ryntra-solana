/**
 * A new treasury's one-time seed key, made in the person's browser and nowhere else (SOL-4).
 *
 * Squads derives a new multisig's address from a `createKey` that must sign its creation. It controls nothing: it
 * seeds an address once and is never used again. Signed by a server before the wallet, it put another key's signature
 * on the bytes the wallet was asked to sign — and Phantom blocks such a request as «This dApp could be malicious».
 * So the key is made here, like the CCTP message account (`cctp-ephemeral.client.ts`), and the order is fixed:
 *
 * 1. the server builds with the key's public half only — the wallet gets bytes nobody has signed;
 * 2. the wallet signs first;
 * 3. what it returned is compared with what was reviewed (`compareWalletTransaction`: only the wallet's own fee and
 *    guard instructions may be added; v1 bytes by `v1MatchesBuilt`), and only then is the key's empty slot filled, over
 *    the message the wallet signed.
 *
 * Browser-safe: Web Crypto and `@noble/ed25519` through `createEphemeralMessageAccount`; no `node:` anything.
 */

import { getTransactionDecoder, getTransactionEncoder } from "@solana/kit";

import { createEphemeralMessageAccount, type EphemeralMessageAccount } from "../cctp-ephemeral.client.ts";
import { isV1Wire, v1MatchesBuilt, withV1Signature } from "../v1-tx.ts";
import { compareWalletTransaction } from "../wallet-modification.ts";

export type TreasuryCreateKey = EphemeralMessageAccount;

/** The one-time key: its address goes to the server, its private half stays in this tab. */
export const createTreasuryKey = (): Promise<TreasuryCreateKey> => createEphemeralMessageAccount();

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);

export type AfterWallet = Readonly<{ ok: true; signedWireBase64: string }> | Readonly<{ ok: false; reason: string }>;

/**
 * The key's signature, after the wallet's, over the message the wallet signed. A transaction that does not name the key
 * comes back as it was. Anything unexpected — other bytes, no wallet signature, a slot already filled — is refused,
 * never repaired: nothing is signed here then.
 */
export async function signAfterWallet(args: Readonly<{ expectedWireBase64: string; signedWireBase64: string; wallet: string; key: TreasuryCreateKey }>): Promise<AfterWallet> {
  if (isV1Wire(base64Decode(args.signedWireBase64))) return signV1AfterWallet(args);
  let decoded: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
  try {
    decoded = getTransactionDecoder().decode(base64Decode(args.signedWireBase64));
  } catch {
    return { ok: false, reason: "The wallet's reply could not be read." };
  }
  const signatures = decoded.signatures as unknown as Record<string, Uint8Array | null>;
  if (!(args.key.address in signatures)) return { ok: true, signedWireBase64: args.signedWireBase64 };
  const comparison = compareWalletTransaction({ expectedWireBase64: args.expectedWireBase64, actualWireBase64: args.signedWireBase64, expectsTokenGuard: false, guardPolicy: "BOUNDED" });
  if (comparison.verdict !== "EXACT" && comparison.verdict !== "WALLET_GUARDS_ONLY") return { ok: false, reason: "The wallet signed something other than what was reviewed; nothing was signed here." };
  const wallet = signatures[args.wallet];
  if (!wallet || wallet.every((byte) => byte === 0)) return { ok: false, reason: "The wallet returned the transaction without signing it." };
  const slot = signatures[args.key.address];
  if (slot && !slot.every((byte) => byte === 0)) return { ok: false, reason: "The new treasury's key has already signed this transaction." };
  const message = decoded.messageBytes as unknown as Uint8Array;
  const signature = await args.key.sign(message);
  const wire = getTransactionEncoder().encode({ ...decoded, signatures: { ...signatures, [args.key.address]: signature } } as typeof decoded) as unknown as Uint8Array;
  /* Encoding must not move a byte of the message: the wallet's signature covers exactly it. */
  try {
    if (!equalBytes(getTransactionDecoder().decode(wire).messageBytes as unknown as Uint8Array, message)) return { ok: false, reason: "Completing the transaction changed its message; nothing was sent." };
  } catch {
    return { ok: false, reason: "The completed transaction could not be read again; nothing was sent." };
  }
  return { ok: true, signedWireBase64: base64Encode(wire) };
}

/**
 * The same for v1 bytes (a wallet that signs v1, `lib/solana/v1-tx.ts`): the wallet's reply held to the built bytes by
 * v1's rules (`v1MatchesBuilt`), the wallet's slot filled, the key's empty — then the key signs the exact message.
 */
async function signV1AfterWallet(args: Readonly<{ expectedWireBase64: string; signedWireBase64: string; wallet: string; key: TreasuryCreateKey }>): Promise<AfterWallet> {
  const checked = v1MatchesBuilt(args.expectedWireBase64, args.signedWireBase64, args.wallet);
  if (!checked.ok) return { ok: false, reason: "The wallet signed something other than what was reviewed; nothing was signed here." };
  const { read } = checked;
  const at = read.signers.indexOf(args.key.address);
  if (at < 0) return { ok: true, signedWireBase64: args.signedWireBase64 };
  if (!read.signatures[read.signers.indexOf(args.wallet)]) return { ok: false, reason: "The wallet returned the transaction without signing it." };
  if (read.signatures[at]) return { ok: false, reason: "The new treasury's key has already signed this transaction." };
  const signature = await args.key.sign(read.messageBytes);
  try {
    return { ok: true, signedWireBase64: base64Encode(withV1Signature(base64Decode(args.signedWireBase64), args.key.address, signature)) };
  } catch {
    return { ok: false, reason: "Completing the transaction changed its message; nothing was sent." };
  }
}
