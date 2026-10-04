import { createHash } from "node:crypto";

import { AccountRole, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from "@solana/kit";

import { SOLANA_CCTP_MAINNET_REGISTRY } from "./cctp-registry.ts";

/**
 * The `depositForBurn` instruction, encoded by hand.
 *
 * There is no generated client for Circle's Solana CCTP V2 programs in this
 * repository and no IDL shipped with them, so every byte here is derived rather
 * than borrowed — and every derivation below was checked against a real mainnet
 * burn before this file existed, not against documentation. The reference
 * transaction is pinned in `cctp-burn.test.mjs`; if Circle ever redeploys, that
 * test fails on the exact field that moved.
 *
 * **Nothing here signs anything.** The instruction names a `MessageSent`
 * account that the program requires to be a signer, and the keypair for it is
 * generated in the browser for one transaction and never reaches this process.
 * The server builds bytes, the browser adds the ephemeral signature, the
 * owner's wallet adds theirs. That split is deliberate: the ephemeral key
 * authorizes the creation of an event account and can move nothing, and the
 * server that could be breached never holds it.
 *
 * The seed that hides in plain sight: `remote_token_messenger` takes the
 * destination domain as an **ASCII string**, not a `u32`. Domain 6 seeds the
 * byte `0x36`, not `06 00 00 00`. Getting that wrong derives a valid-looking
 * address that the program rejects, and no amount of reading the argument list
 * would reveal it — the live transaction did.
 */

/** Anchor's `sha256("global:deposit_for_burn")[0..8]`, confirmed on mainnet. */
export const DEPOSIT_FOR_BURN_DISCRIMINATOR = "d73c3d2e723780b0";

/**
 * Circle's two finality thresholds.
 *
 * `STANDARD` waits for hard finality and is quoted at 0 bps on every route this
 * product uses. `FAST` is Circle signing earlier against its own allowance —
 * it is not a time promise and the product never calls it instant.
 */
export const CCTP_FINALITY_THRESHOLD = Object.freeze({ FAST: 1000, STANDARD: 2000 });

const ADDRESS = getAddressEncoder();
const seed = (value: string) => new TextEncoder().encode(value);

export type CctpBurnIntent = Readonly<{
  /** The wallet that owns the USDC and authorizes the burn. */
  owner: string;
  /** The account that pays the fee and the `MessageSent` rent. Usually the owner. */
  rentPayer: string;
  /** The token account the USDC is burned from. */
  burnTokenAccount: string;
  /** The ephemeral `MessageSent` account, generated in the browser. */
  messageSentAccount: string;
  /** Base units. USDC has six decimals. */
  amountRaw: string;
  /** Circle's numeric domain for the destination chain. Base is 6. */
  destinationDomain: number;
  /** The destination recipient, already 32 bytes: an EVM address is left-padded. */
  mintRecipient: Uint8Array;
  /**
   * The only address permitted to complete the mint, or 32 zero bytes for
   * anyone. Zeroes are the safer choice for a canary: a burn whose caller is
   * pinned to an address that later cannot transact is a burn nobody can
   * finish, and the mint is idempotent either way.
   */
  destinationCaller: Uint8Array;
  /** The most Circle may take. A fee above this reverts on the source chain. */
  maxFeeRaw: string;
  minFinalityThreshold: number;
}>;

export type CctpBurnAccounts = Readonly<{
  senderAuthority: string;
  denylistAccount: string;
  messageTransmitter: string;
  tokenMessenger: string;
  remoteTokenMessenger: string;
  tokenMinter: string;
  localToken: string;
  eventAuthority: string;
}>;

function programs() {
  const solana = SOLANA_CCTP_MAINNET_REGISTRY.chains.solana;
  const find = (role: string) => {
    const component = solana.components.find((entry) => entry.role === role);
    if (!component) throw new Error(`The CCTP registry has no ${role} for Solana.`);
    return component.address;
  };
  return {
    tokenMessengerMinter: find("TOKEN_MESSENGER_MINTER_V2"),
    messageTransmitter: find("MESSAGE_TRANSMITTER_V2"),
    usdc: solana.asset.address,
  };
}

/**
 * Every program-derived address `depositForBurn` needs.
 *
 * Derived, never configured. A PDA in an environment variable is an address
 * somebody can change without changing the program it belongs to.
 */
export async function deriveCctpBurnAccounts(args: {
  owner: string;
  destinationDomain: number;
}): Promise<CctpBurnAccounts> {
  const { tokenMessengerMinter, messageTransmitter, usdc } = programs();
  const tmm = tokenMessengerMinter as Address;
  const mt = messageTransmitter as Address;

  const derive = async (programAddress: Address, seeds: Uint8Array[]) => {
    const [value] = await getProgramDerivedAddress({ programAddress, seeds });
    return String(value);
  };
  /* Kit's address encoder returns a read-only view; the PDA seed list wants a
     plain one. Copying is the honest conversion — casting would hide a real
     difference between the two types. */
  const encoded = (value: string) => Uint8Array.from(ADDRESS.encode(value as Address));

  return Object.freeze({
    senderAuthority: await derive(tmm, [seed("sender_authority")]),
    denylistAccount: await derive(tmm, [seed("denylist_account"), encoded(args.owner)]),
    messageTransmitter: await derive(mt, [seed("message_transmitter")]),
    tokenMessenger: await derive(tmm, [seed("token_messenger")]),
    /* ASCII, not a little-endian u32. See the header. */
    remoteTokenMessenger: await derive(tmm, [
      seed("remote_token_messenger"),
      seed(String(args.destinationDomain)),
    ]),
    tokenMinter: await derive(tmm, [seed("token_minter")]),
    localToken: await derive(tmm, [seed("local_token"), encoded(usdc)]),
    eventAuthority: await derive(tmm, [seed("__event_authority")]),
  });
}

/**
 * The 96 instruction bytes.
 *
 * Every integer is little-endian and every address field is exactly 32 bytes.
 * `mintRecipient` and `destinationCaller` arrive already padded, because the
 * padding rule belongs to the destination chain rather than to this encoder:
 * an EVM address is 20 bytes left-padded with twelve zeroes, and a Solana
 * address is already 32.
 */
export function encodeDepositForBurnData(intent: CctpBurnIntent): Uint8Array {
  if (intent.mintRecipient.length !== 32) {
    throw new Error(`mintRecipient must be 32 bytes; received ${intent.mintRecipient.length}.`);
  }
  if (intent.destinationCaller.length !== 32) {
    throw new Error(`destinationCaller must be 32 bytes; received ${intent.destinationCaller.length}.`);
  }
  const data = Buffer.alloc(96);
  Buffer.from(DEPOSIT_FOR_BURN_DISCRIMINATOR, "hex").copy(data, 0);
  data.writeBigUInt64LE(BigInt(intent.amountRaw), 8);
  data.writeUInt32LE(intent.destinationDomain, 16);
  Buffer.from(intent.mintRecipient).copy(data, 20);
  Buffer.from(intent.destinationCaller).copy(data, 52);
  data.writeBigUInt64LE(BigInt(intent.maxFeeRaw), 84);
  data.writeUInt32LE(intent.minFinalityThreshold, 92);
  return new Uint8Array(data);
}

/** An EVM address as CCTP's 32-byte recipient: twelve zero bytes, then the address. */
export function evmMintRecipient(address: string): Uint8Array {
  const match = /^0x([0-9a-fA-F]{40})$/.exec(address.trim());
  if (!match) throw new Error(`Not a 20-byte EVM address: ${address}`);
  const out = new Uint8Array(32);
  out.set(Buffer.from(match[1], "hex"), 12);
  return out;
}

/** Anyone may complete the mint. */
export function anyDestinationCaller(): Uint8Array {
  return new Uint8Array(32);
}

/**
 * The instruction, with its accounts in the exact order the program expects.
 *
 * The order is not alphabetical, not grouped and not documented anywhere this
 * repository could cite — it is the order a live mainnet burn used, and the
 * test pins all eighteen positions against that transaction.
 */
export async function buildCctpBurnInstruction(intent: CctpBurnIntent): Promise<Instruction> {
  const { tokenMessengerMinter, messageTransmitter, usdc } = programs();
  const accounts = await deriveCctpBurnAccounts({
    owner: intent.owner,
    destinationDomain: intent.destinationDomain,
  });

  const readonlyAccount = (address: string) => ({ address: address as Address, role: AccountRole.READONLY });
  const writable = (address: string) => ({ address: address as Address, role: AccountRole.WRITABLE });

  return {
    programAddress: tokenMessengerMinter as Address,
    accounts: [
      { address: intent.owner as Address, role: AccountRole.READONLY_SIGNER },
      { address: intent.rentPayer as Address, role: AccountRole.WRITABLE_SIGNER },
      readonlyAccount(accounts.senderAuthority),
      writable(intent.burnTokenAccount),
      readonlyAccount(accounts.denylistAccount),
      writable(accounts.messageTransmitter),
      readonlyAccount(accounts.tokenMessenger),
      readonlyAccount(accounts.remoteTokenMessenger),
      readonlyAccount(accounts.tokenMinter),
      writable(accounts.localToken),
      writable(usdc),
      { address: intent.messageSentAccount as Address, role: AccountRole.WRITABLE_SIGNER },
      readonlyAccount(messageTransmitter),
      readonlyAccount(tokenMessengerMinter),
      readonlyAccount(SOLANA_TOKEN_PROGRAM),
      readonlyAccount(SOLANA_SYSTEM_PROGRAM),
      readonlyAccount(accounts.eventAuthority),
      readonlyAccount(tokenMessengerMinter),
    ],
    data: encodeDepositForBurnData(intent),
  };
}

const SOLANA_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SOLANA_SYSTEM_PROGRAM = "11111111111111111111111111111111";

/**
 * A stable name for one burn intent, for the duplicate-burn boundary.
 *
 * The Send path keys its submit boundary on a signature, which proves only that
 * exact bytes were broadcast once — it is blind to a second, freshly built burn
 * of the same intent, which is the failure the bridge actually forbids. This
 * digest covers what makes a burn *the same burn* regardless of blockhash,
 * ephemeral account or fee: who is sending what, to whom, on which domain.
 *
 * ## Why the direction is in here, and why the version moved
 *
 * The first version named the destination domain and nothing about the source.
 * With one lane that was complete by accident. With two it is not: the same
 * amount, from the same person, to the same recipient, is a *different transfer*
 * depending on which way it goes, and a digest that cannot tell them apart would
 * let a Base-source transfer collide in the durable store with a Solana-source
 * one and be refused as a duplicate of something it has nothing to do with.
 *
 * So the direction and the source domain are part of the name, and the domain
 * string carries `.v2` because that is what a changed name is. Every claim
 * written under the v1 name stays exactly where it is and stays readable; it is
 * simply no longer the name this lane computes. Every one of them is terminal,
 * so nothing in flight is orphaned by the change — and the one thing it does
 * permit is a deliberate fresh transfer, months later, of a shape that was
 * completed and receipted under the old name. That needs a new wallet signature
 * and is not a duplicate under failure, which is the property this boundary
 * exists to hold.
 */
export function cctpBurnIntentDigest(intent: Pick<CctpBurnIntent,
  "owner" | "burnTokenAccount" | "amountRaw" | "destinationDomain" | "mintRecipient" | "minFinalityThreshold"> &
  Readonly<{ direction: string; sourceDomain: number }>): string {
  const parts = [
    "ryntra.solana.cctp-burn-intent.v2",
    intent.direction,
    String(intent.sourceDomain),
    intent.owner,
    intent.burnTokenAccount,
    intent.amountRaw,
    String(intent.destinationDomain),
    Buffer.from(intent.mintRecipient).toString("hex"),
    String(intent.minFinalityThreshold),
  /* A separator that cannot occur inside any field: every part is base58,
     decimal or hex. A NUL would do the same job and is a control character in
     source, which this repository refuses on sight. */
  ].join("|");
  return `0x${createHash("sha256").update(parts).digest("hex")}`;
}
