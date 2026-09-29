/**
 * The address lookup table that keeps the Solana receive inside a packet.
 *
 * The first real Base → Solana transfer worked and Phantom blocked it in red on
 * the way through. That was not a reputation verdict and not a false positive:
 * the transaction was **1,226 bytes of Solana's 1,232-byte limit**, six bytes of
 * headroom, and Phantom's own developer documentation names this exact case —
 * *"If your transaction approaches Solana's size limit, split it into multiple
 * signing requests or use Address Lookup Tables."* A wallet that cannot safely
 * simulate what it is about to sign is right to say so.
 *
 * Six bytes is also a defect in its own right, independent of any wallet. A
 * third attester signature would add sixty-five bytes to the attestation and the
 * transaction would simply stop being constructible — a transfer that had
 * already burned on Base, with no way to receive it from this product.
 *
 * The live transfer this builder was derived from is 943 bytes with six static
 * accounts and two lookup tables. It was doing this all along and I did not.
 *
 * ## Fifteen of the twenty accounts never change
 *
 * A `receive_message` names twenty accounts. Only four vary between transfers:
 * the payer, the caller (the same wallet), the replay account derived from that
 * message's nonce, and the recipient's token account. Everything else — both
 * Circle programmes, their event authorities, the transmitter and messenger
 * state, the token minter, the local token, the custody account, the token pair
 * and remote messenger for the source domain, Circle's fee account, and the
 * system and token programmes — is a constant of the lane. Those are what go in
 * the table.
 *
 * ## A table cannot redirect anything, by construction
 *
 * This is the part worth being careful about. A lookup table is somebody's
 * account, and its contents decide which accounts an instruction resolves to. If
 * this module read addresses *out of* a table and trusted them, whoever controls
 * that table could substitute one — and on this lane substituting the recipient
 * or the custody account is substituting where the money goes.
 *
 * So it never does that. The addresses are derived here, from the registry and
 * the message, exactly as the uncompressed build derives them. The on-chain
 * table is then read only to answer one question per address: *does this table
 * hold this exact address, and at which index?* An address the table does not
 * hold is left in the message uncompressed. A table that has been tampered with
 * can therefore make a transfer larger, and can never make it go somewhere else.
 */

import { getAddressDecoder, type Address } from "@solana/kit";

import { SOLANA_CCTP_MAINNET_REGISTRY } from "./cctp-registry.ts";
import { SOLANA_ADDRESS_PATTERN } from "./cctp-direction.ts";
import { deriveCctpReceiveAccounts, SOLANA_SYSTEM_PROGRAM, SOLANA_TOKEN_PROGRAM } from "./cctp-receive.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "./rpc.ts";

/** The programme that owns every address lookup table. */
export const ADDRESS_LOOKUP_TABLE_PROGRAM = "AddressLookupTab1e1111111111111111111111111";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/**
 * Where the deployment's own table is named.
 *
 * A table this product publishes and controls, rather than one of the public
 * ones a live transfer happened to use. Those have authorities that are not
 * ours: an authority can deactivate and close its table, and a receive that
 * depended on it would stop being constructible on somebody else's schedule.
 * Absent, the build simply stays uncompressed — larger, and still correct.
 */
export const CCTP_LOOKUP_TABLE_ENV = "RYNTRA_SOLANA_CCTP_LOOKUP_TABLE";

/**
 * One table per source domain, because the constants are per source domain.
 *
 * The remote token messenger and the token pair are derived from the domain
 * the message comes *from* (§ `deriveCctpReceiveAccounts`), so the table built
 * for Base holds Base's pair and nothing that helps an Ethereum receive. The
 * Base variable keeps the name it has carried since the first table; Ethereum
 * gets its own, and a domain with no variable stays uncompressed and honest.
 */
export const CCTP_LOOKUP_TABLE_ENV_BY_DOMAIN: Readonly<Record<number, string>> = {
  [SOLANA_CCTP_MAINNET_REGISTRY.chains.base.domain]: CCTP_LOOKUP_TABLE_ENV,
  [SOLANA_CCTP_MAINNET_REGISTRY.chains.ethereum.domain]: "RYNTRA_SOLANA_CCTP_LOOKUP_TABLE_ETHEREUM",
};

/**
 * The offset at which an address lookup table's addresses begin.
 *
 * `discriminator u32 · deactivationSlot u64 · lastExtendedSlot u64 ·
 * lastExtendedStartIndex u8 · Option<Pubkey> authority (1 + 32) · padding u16`.
 */
export const LOOKUP_TABLE_HEADER_BYTES = 56;
/** `u64::MAX` in the deactivation slot means the table is live. */
const NEVER_DEACTIVATED = 18_446_744_073_709_551_615n;

const ADDRESS_DECODER = getAddressDecoder();

export type CctpLookupTableState =
  | Readonly<{ state: "ABSENT"; reason: string }>
  | Readonly<{ state: "UNUSABLE"; address: string; reason: string }>
  | Readonly<{
      state: "ACTIVE";
      address: string;
      /** Every address the table holds, in index order. */
      addresses: readonly string[];
      authority: string | null;
    }>;

/**
 * The constant accounts a Base → Solana receive names, derived rather than
 * listed.
 *
 * Deriving them is the point: a table filled from a hand-written list would
 * drift from the instruction the moment a seed or a programme moved, and the
 * failure would be a transfer that cannot be received.
 */
export async function cctpReceiveLookupAddresses(args: {
  sourceDomain: number;
  remoteTokenHex: string;
  /** Any nonce; the replay account it derives is deliberately not included. */
  sampleNonce?: string;
  feeRecipientTokenAccount: string;
}): Promise<readonly string[]> {
  const derived = await deriveCctpReceiveAccounts({
    sourceDomain: args.sourceDomain,
    remoteTokenHex: args.remoteTokenHex,
    nonce: args.sampleNonce ?? `0x${"11".repeat(32)}`,
  });
  const solana = SOLANA_CCTP_MAINNET_REGISTRY.chains.solana;
  const component = (role: string) => {
    const found = solana.components.find((entry) => entry.role === role);
    if (!found) throw new Error(`The CCTP registry has no ${role} for Solana.`);
    return found.address;
  };
  /* `usedNonce` is absent on purpose: it is derived per message and a table
     entry for one transfer's replay account would be dead weight in every
     other. The recipient's own token account is absent for the same reason. */
  return Object.freeze([
    component("MESSAGE_TRANSMITTER_V2"),
    component("TOKEN_MESSENGER_MINTER_V2"),
    derived.authorityPda,
    derived.messageTransmitter,
    derived.messageTransmitterEventAuthority,
    derived.tokenMessenger,
    derived.remoteTokenMessenger,
    derived.tokenMinter,
    derived.localToken,
    derived.tokenPair,
    derived.custodyTokenAccount,
    derived.tokenMessengerEventAuthority,
    args.feeRecipientTokenAccount,
    solana.asset.address,
    SOLANA_SYSTEM_PROGRAM,
    SOLANA_TOKEN_PROGRAM,
    ASSOCIATED_TOKEN_PROGRAM,
  ]);
}

/**
 * The table this deployment is configured with for one source domain, if it is
 * configured with one. Base's domain when unsaid, as every earlier caller meant.
 */
export function resolveCctpLookupTableAddress(
  environment: Record<string, string | undefined> = process.env,
  sourceDomain: number = SOLANA_CCTP_MAINNET_REGISTRY.chains.base.domain,
): string | null {
  const variable = CCTP_LOOKUP_TABLE_ENV_BY_DOMAIN[sourceDomain];
  if (!variable) return null;
  const raw = environment[variable]?.trim();
  if (!raw) return null;
  return SOLANA_ADDRESS_PATTERN.test(raw) ? raw : null;
}

/** Decode a lookup table account exactly as the runtime does. */
export function decodeLookupTable(
  accountData: Uint8Array,
): Readonly<{ ok: true; addresses: readonly string[]; deactivationSlot: bigint; authority: string | null }> | Readonly<{ ok: false; reason: string }> {
  if (accountData.length < LOOKUP_TABLE_HEADER_BYTES) {
    return { ok: false, reason: "The account is too short to be an address lookup table." };
  }
  const view = new DataView(accountData.buffer, accountData.byteOffset, accountData.byteLength);
  const deactivationSlot = view.getBigUint64(4, true);
  const hasAuthority = accountData[21] === 1;
  const authority = hasAuthority
    ? ADDRESS_DECODER.decode(accountData.subarray(22, 54))
    : null;
  const body = accountData.length - LOOKUP_TABLE_HEADER_BYTES;
  if (body % 32 !== 0) {
    return { ok: false, reason: "The table's address list is not a whole number of addresses." };
  }
  const addresses: string[] = [];
  for (let offset = LOOKUP_TABLE_HEADER_BYTES; offset + 32 <= accountData.length; offset += 32) {
    addresses.push(String(ADDRESS_DECODER.decode(accountData.subarray(offset, offset + 32))));
  }
  return { ok: true, addresses, deactivationSlot, authority: authority === null ? null : String(authority) };
}

/**
 * Read the configured table and say whether it may be used.
 *
 * Never throws and never blocks a transfer: every refusal is a state the caller
 * turns into an uncompressed build. A table that cannot be read is a bigger
 * transaction, not a failed one.
 */
export async function readCctpLookupTable(
  handle: SolanaRpcHandle,
  address: string | null,
): Promise<CctpLookupTableState> {
  if (!address) {
    return { state: "ABSENT", reason: "This deployment has no address lookup table configured for the CCTP receive." };
  }
  let raw: Uint8Array | null;
  let owner: string | null;
  try {
    const read = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getAccountInfo(address as never, { commitment: "confirmed", encoding: "base64" }).send({ abortSignal }),
    );
    const encoded = read.value?.data;
    raw = Array.isArray(encoded) ? Uint8Array.from(Buffer.from(String(encoded[0]), "base64")) : null;
    owner = read.value?.owner ? String(read.value.owner) : null;
  } catch (cause) {
    return {
      state: "UNUSABLE",
      address,
      reason: `The lookup table could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  if (!raw || !owner) {
    return { state: "UNUSABLE", address, reason: "The configured lookup table does not exist on this cluster." };
  }
  if (owner !== ADDRESS_LOOKUP_TABLE_PROGRAM) {
    return { state: "UNUSABLE", address, reason: "The configured account is not an address lookup table." };
  }
  const decoded = decodeLookupTable(raw);
  if (!decoded.ok) return { state: "UNUSABLE", address, reason: decoded.reason };
  if (decoded.deactivationSlot !== NEVER_DEACTIVATED) {
    /* A deactivating table still resolves for a while and then stops. Using one
       would work until it silently did not, which is the worst schedule for a
       failure on a transfer that has already burned. */
    return { state: "UNUSABLE", address, reason: "The configured lookup table is being deactivated." };
  }
  return { state: "ACTIVE", address, addresses: decoded.addresses, authority: decoded.authority };
}

/**
 * The compression map to hand the transaction builder.
 *
 * The list is the table's own, **in its on-chain order and complete**, because
 * what ends up in the message is an *index* and the builder takes the index from
 * this array's position. A filtered or reordered list would compress an account
 * to an index that resolves, on chain, to a different account entirely — which
 * on this lane means a different place for the money to go.
 *
 * That is also why passing the whole list is safe rather than permissive. The
 * builder can only compress accounts the message already names; it cannot add
 * one. And an address lookup table is append-only — `extend` appends and no
 * instruction rewrites an existing entry — so an index that resolved to a given
 * address when it was read resolves to that same address when the transaction
 * lands. A table can therefore be useless to us, and can never be a redirection.
 *
 * `derived` is what this build expects the table to be for. It decides nothing;
 * it is compared, and a table that holds none of it is reported as no table at
 * all rather than quietly used for something else.
 */
export function cctpLookupCompressionMap(args: {
  table: CctpLookupTableState;
  /** The addresses this build derived for itself. */
  derived: readonly string[];
}): Readonly<Record<Address, Address[]>> {
  if (args.table.state !== "ACTIVE") return {};
  const held = new Set(args.table.addresses);
  if (!args.derived.some((address) => held.has(address))) return {};
  return { [args.table.address as Address]: [...args.table.addresses] as Address[] };
}

/** How much of what this build needs the configured table actually covers. */
export function cctpLookupCoverage(args: {
  table: CctpLookupTableState;
  derived: readonly string[];
}): Readonly<{ covered: number; total: number; missing: readonly string[] }> {
  const held = args.table.state === "ACTIVE" ? new Set(args.table.addresses) : new Set<string>();
  const missing = args.derived.filter((address) => !held.has(address));
  return { covered: args.derived.length - missing.length, total: args.derived.length, missing };
}
