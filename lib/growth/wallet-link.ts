import { verifyAsync } from "@noble/ed25519";
import { getAddressEncoder, isAddress } from "@solana/kit";
import { getAddress, verifyMessage } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import { z } from "zod";

/**
 * One partner, two wallets: a Solana wallet and an EVM wallet linked by a
 * signature from each.
 *
 * A partner's code belongs to a Solana wallet (`referralCodes`), and a launch
 * on the EVM network pays in that network — so the partner needs an EVM
 * address the program may treat as theirs, and the self-referral check needs
 * to know that a creator's EVM wallet and a partner's Solana wallet are one
 * person. Neither may rest on a claim: both wallets sign the same message,
 * which names both addresses, the site, a server-issued nonce and a short
 * expiry. This is the minimum the common profile asks for — Solana address
 * plus EVM address, proven by signatures from both — kept in the Growth
 * line's own collection until the shared profile carries it.
 *
 * Who may link: the Solana wallet's owner, proven in this browser (the sign-in
 * that wallets bind to the site) — a signature alone, collected by another
 * page, links nothing. The EVM side signs an EIP-4361 message, which EVM
 * wallets check against the page asking.
 *
 * A link is one-to-one. A repeat of the same pair changes nothing; a newer
 * link both wallets signed replaces the older one on either side, so a person
 * can always put their own wallets back together. Every link written is kept
 * in the history, never changed. Freezing a link once a payout has used it is
 * the payout's rule (Ріст GR-09), not this one's.
 */

export const WALLET_LINK_COLLECTION = "growthWalletLinks" as const;
export const WALLET_LINK_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
/** The EVM wallet signs on Ethereum mainnet's id: the message proves an address, the chain moves nothing. */
export const WALLET_LINK_CHAIN_ID = 1;

/** The statement both wallets sign, naming the Solana wallet the EVM one is linked to. One line: EIP-4361 allows no break in it. */
export function walletLinkStatement(solana: string): string {
  return `Link this wallet to the Solana wallet ${solana} as one partner of Ryntra. This authorizes no transaction and moves no funds.`;
}

const EVM = /^0x[0-9a-f]{40}$/;
const NONCE = /^[A-Za-z0-9]{24}$/;

export type WalletLinkFields = Readonly<{
  domain: string;
  uri: string;
  solana: string;
  /** Lower-case. */
  evm: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}>;

/** The nonce context: a nonce minted for one pair cannot be spent on another. */
export function walletLinkNonceContext(solana: string, evm: string): string {
  return `growth-link:${solana}:${evm.toLowerCase()}`;
}

/**
 * The exact text both wallets sign — an EIP-4361 (Sign-In with Ethereum)
 * message for the EVM address, whose statement names the Solana address.
 * EVM wallets recognise the format and warn when the page asking is not the
 * domain the message names, which a phishing page cannot fake. The server
 * builds it; a client never chooses its words.
 */
export function walletLinkMessage(fields: WalletLinkFields): string {
  return createSiweMessage({
    domain: fields.domain,
    address: getAddress(fields.evm),
    statement: walletLinkStatement(fields.solana),
    uri: fields.uri,
    version: "1",
    chainId: WALLET_LINK_CHAIN_ID,
    nonce: fields.nonce,
    issuedAt: new Date(fields.issuedAt),
    expirationTime: new Date(fields.expiresAt),
  });
}

export function buildWalletLinkFields(args: Readonly<{ domain: string; uri: string; solana: string; evm: string; nonce: string; now: number }>): WalletLinkFields {
  return {
    domain: args.domain,
    uri: args.uri,
    solana: args.solana,
    evm: args.evm.toLowerCase(),
    nonce: args.nonce,
    issuedAt: new Date(args.now).toISOString(),
    expiresAt: new Date(args.now + WALLET_LINK_TTL_MS).toISOString(),
  };
}

/** Read the fields back — and only accept text that is exactly what `walletLinkMessage` would have built from them. */
export function parseWalletLinkMessage(text: string): WalletLinkFields | null {
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(text);
  } catch {
    return null;
  }
  const solana = /^Link this wallet to the Solana wallet (\S+) as one partner of Ryntra\./.exec(parsed.statement ?? "")?.[1];
  if (!solana || !parsed.domain || !parsed.address || !parsed.uri || !parsed.nonce || !parsed.issuedAt || !parsed.expirationTime) return null;
  if (parsed.chainId !== WALLET_LINK_CHAIN_ID || parsed.version !== "1") return null;
  const fields: WalletLinkFields = {
    domain: parsed.domain,
    uri: parsed.uri,
    solana,
    evm: parsed.address.toLowerCase(),
    nonce: parsed.nonce,
    issuedAt: parsed.issuedAt.toISOString(),
    expiresAt: parsed.expirationTime.toISOString(),
  };
  try {
    return walletLinkMessage(fields) === text ? fields : null;
  } catch {
    return null;
  }
}

export const WalletLinkRequestSchema = z
  .object({
    message: z.string().min(1).max(2_000),
    /** The Solana wallet's Ed25519 signature over the message bytes, base64. */
    solanaSignature: z.string().min(1).max(200),
    /** The EVM wallet's `personal_sign` signature, hex. */
    evmSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  })
  .strict();

export type WalletLinkVerification =
  | Readonly<{ ok: true; solana: string; evm: string; issuedAt: string }>
  | Readonly<{
      ok: false;
      reason: "unparseable" | "domain" | "uri" | "address" | "nonce" | "issued_at" | "expired" | "solana_signature" | "evm_signature";
    }>;

function base64Bytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  return bytes.length === 64 ? bytes : null;
}

/**
 * Check a signed link against every bound the server controls, then both
 * signatures. `nonceIssuedHere` answers whether this server minted the nonce
 * for this pair (`walletNonceIssuedHere` with `walletLinkNonceContext`).
 * Spending it is not needed: a replay can only write the same link again.
 */
export async function verifyWalletLink(
  input: Readonly<{
    message: string;
    solanaSignature: string;
    evmSignature: `0x${string}`;
    expected: Readonly<{ domain: string; uri: string }>;
    nonceIssuedHere: (nonce: string, context: string) => boolean;
    now: number;
  }>,
): Promise<WalletLinkVerification> {
  const fields = parseWalletLinkMessage(input.message);
  if (!fields) return { ok: false, reason: "unparseable" };
  if (fields.domain !== input.expected.domain) return { ok: false, reason: "domain" };
  if (fields.uri !== input.expected.uri) return { ok: false, reason: "uri" };
  if (!isAddress(fields.solana) || !EVM.test(fields.evm)) return { ok: false, reason: "address" };
  if (!NONCE.test(fields.nonce) || !input.nonceIssuedHere(fields.nonce, walletLinkNonceContext(fields.solana, fields.evm))) {
    return { ok: false, reason: "nonce" };
  }
  const issuedAt = Date.parse(fields.issuedAt);
  const expiresAt = Date.parse(fields.expiresAt);
  if (!Number.isFinite(issuedAt) || issuedAt > input.now + CLOCK_SKEW_MS) return { ok: false, reason: "issued_at" };
  if (!Number.isFinite(expiresAt) || expiresAt <= input.now || expiresAt - issuedAt > WALLET_LINK_TTL_MS) return { ok: false, reason: "expired" };

  const bytes = new TextEncoder().encode(input.message);
  const solanaSignature = base64Bytes(input.solanaSignature);
  let solanaValid = false;
  if (solanaSignature) {
    try {
      const publicKey = new Uint8Array(getAddressEncoder().encode(fields.solana as Parameters<ReturnType<typeof getAddressEncoder>["encode"]>[0]));
      solanaValid = await verifyAsync(solanaSignature, bytes, publicKey);
    } catch {
      solanaValid = false;
    }
  }
  if (!solanaValid) return { ok: false, reason: "solana_signature" };

  /* An EOA is settled by recovery, which touches no network. A smart account
     would need an on-chain call and is not accepted here — it fails closed. */
  const evmValid = await verifyMessage({ address: fields.evm as `0x${string}`, message: input.message, signature: input.evmSignature }).catch(() => false);
  if (!evmValid) return { ok: false, reason: "evm_signature" };
  return { ok: true, solana: fields.solana, evm: fields.evm, issuedAt: fields.issuedAt };
}

export const WalletLinkRecordSchema = z
  .object({
    schema: z.literal(1),
    solana: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    evm: z.string().regex(EVM),
    linkedAt: z.string().datetime({ offset: true }),
    /** When the message both wallets signed was issued — the proof's own moment. */
    signedAt: z.string().datetime({ offset: true }),
    /** Store bookkeeping: a newer link both wallets signed replaces this one under compare-and-set. */
    version: z.number().int().min(1),
  })
  .strict();

export type WalletLinkRecord = z.output<typeof WalletLinkRecordSchema>;

export function walletLinkKey(family: "solana" | "evm", address: string): string {
  return family === "solana" ? `solana:${address}` : `evm:${address.toLowerCase()}`;
}

/** Every link ever written, never changed, under both wallets: `history:<solana>:<linkedAt>:<evm>` and `historyEvm:<evm>:<linkedAt>:<solana>`. */
export function walletLinkHistoryKey(record: Pick<WalletLinkRecord, "solana" | "evm" | "linkedAt">, side: "solana" | "evm" = "solana"): string {
  return side === "solana" ? `history:${record.solana}:${record.linkedAt}:${record.evm}` : `historyEvm:${record.evm}:${record.linkedAt}:${record.solana}`;
}

export function walletLinkHistoryPrefix(family: "solana" | "evm", address: string): string {
  return family === "solana" ? `history:${address}:` : `historyEvm:${address.toLowerCase()}:`;
}
