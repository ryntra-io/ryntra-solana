/**
 * The destination replay on Solana, built by hand.
 *
 * `cctp-mint.ts` does this job for Base, where it is two dynamic `bytes`
 * arguments and one contract. On Solana it is twenty accounts in an order
 * nothing documents, a nine-byte replay account the caller pays rent for, and a
 * recipient that must be a token account rather than a wallet. So this file was
 * written the way `cctp-burn.ts` was: from a live mainnet `receive_message`,
 * not from a field list.
 *
 * The reference transaction is
 * `2yFd9zR5JSfPJFvMFhKDVjPt3tZamgDgsDm2XWLCfzAeq1m6Du64uxTAHsNnaTWE6qRJZ1twiaspbFyzpapvKRsE`
 * — an Ethereum-to-Solana transfer — and every PDA below was derived and then
 * matched against the account it occupies there. `cctp-receive.test.mjs` pins
 * the whole layout against it, so a Circle redeploy fails on the exact field
 * that moved rather than somewhere downstream.
 *
 * ## Three facts that are easy to get wrong and expensive to get wrong late
 *
 * **The recipient is a token account.** The message's thirty-two-byte
 * `mintRecipient` is the recipient's associated USDC account, and the program
 * transfers into it. It creates nothing. A message naming a wallet address can
 * never be received, and by then the money has already been burned on the other
 * chain. That is why the account is derived, checked, and — when it is missing —
 * created in the same transaction as the replay.
 *
 * **The replay guard costs money.** `used_nonce` is a nine-byte account the
 * transmitter creates during `receive_message`, and whoever submits pays its
 * rent: 953,520 lamports at the current rent rate, and not reclaimable, because
 * the account existing is what makes a second replay impossible. It is a real
 * cost and the card states it before the wallet opens.
 *
 * **Nothing here holds a key.** The transaction is compiled unsigned, the
 * connected Solana wallet signs it, and one route submits it once.
 */

import {
  AccountRole,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";

import { SOLANA_CCTP_MAINNET_REGISTRY } from "./cctp-registry.ts";

/** Anchor's `sha256("global:receive_message")[0..8]`, confirmed on mainnet. */
export const RECEIVE_MESSAGE_DISCRIMINATOR = "26907fe11fe1ee19";

/**
 * The rent-exempt size of the replay account, in bytes.
 *
 * Read from the live account rather than from a struct: it is nine bytes, and
 * `(128 + 9) × 6960` is exactly the 953,520 lamports the reference transaction
 * paid. The plan still asks the cluster for the current minimum at this size,
 * so a rent change moves the number instead of making the plan wrong.
 */
export const CCTP_USED_NONCE_ACCOUNT_BYTES = 9;

/** An associated token account's fixed size, for pricing the one this may create. */
export const SPL_TOKEN_ACCOUNT_BYTES = 165;

/**
 * Where `fee_recipient` sits inside Circle's `TokenMessenger` account.
 *
 * The struct is `discriminator(8) · owner(32) · pending_owner(32) ·
 * local_message_transmitter(32) · message_body_version(4) · authority_bump(1) ·
 * fee_recipient(32) · min_fee_controller(32) · min_fee(4)`, which is the 177
 * bytes the account actually holds. The offset is read rather than the address
 * hard-coded so that a fee recipient Circle rotates is followed rather than
 * silently wrong — and a wrong fee account makes the whole replay revert.
 */
export const TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET = 109;
export const TOKEN_MESSENGER_ACCOUNT_BYTES = 177;

const ADDRESS = getAddressEncoder();
const seed = (value: string) => new TextEncoder().encode(value);
const encoded = (value: string) => Uint8Array.from(ADDRESS.encode(value as Address));

export const SOLANA_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SOLANA_SYSTEM_PROGRAM = "11111111111111111111111111111111";

function programs() {
  const solana = SOLANA_CCTP_MAINNET_REGISTRY.chains.solana;
  const find = (role: string) => {
    const component = solana.components.find((entry) => entry.role === role);
    if (!component) throw new Error(`The CCTP registry has no ${role} for Solana.`);
    return component.address;
  };
  return {
    messageTransmitter: find("MESSAGE_TRANSMITTER_V2"),
    tokenMessengerMinter: find("TOKEN_MESSENGER_MINTER_V2"),
    usdc: solana.asset.address,
  };
}

export type CctpReceiveAccounts = Readonly<{
  authorityPda: string;
  messageTransmitter: string;
  usedNonce: string;
  messageTransmitterEventAuthority: string;
  tokenMessenger: string;
  remoteTokenMessenger: string;
  tokenMinter: string;
  localToken: string;
  tokenPair: string;
  custodyTokenAccount: string;
  tokenMessengerEventAuthority: string;
}>;

/**
 * Every program-derived address `receive_message` needs, derived not configured.
 *
 * Two seeds are worth naming because both are the kind of thing that produces a
 * plausible wrong address rather than an error. `remote_token_messenger` takes
 * the **source** domain as an ASCII string — domain 6 is the byte `0x36` — the
 * same trap the burn side documents, read from the other end. And `token_pair`
 * takes that same ASCII domain followed by the remote token as thirty-two
 * bytes, not as twenty and not as a hex string.
 */
export async function deriveCctpReceiveAccounts(args: {
  sourceDomain: number;
  /** The source chain's USDC, left-padded to thirty-two bytes. */
  remoteTokenHex: string;
  nonce: string;
}): Promise<CctpReceiveAccounts> {
  const { messageTransmitter, tokenMessengerMinter, usdc } = programs();
  const mt = messageTransmitter as Address;
  const tmm = tokenMessengerMinter as Address;
  const derive = async (programAddress: Address, seeds: Uint8Array[]) => {
    const [value] = await getProgramDerivedAddress({ programAddress, seeds });
    return String(value);
  };
  const nonceBody = args.nonce.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(nonceBody)) {
    throw new Error("A CCTP V2 nonce is thirty-two bytes of hexadecimal.");
  }
  const remoteToken = args.remoteTokenHex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(remoteToken)) {
    throw new Error("The remote token must be thirty-two bytes of hexadecimal.");
  }
  const domain = seed(String(args.sourceDomain));

  return Object.freeze({
    authorityPda: await derive(mt, [seed("message_transmitter_authority"), encoded(tokenMessengerMinter)]),
    messageTransmitter: await derive(mt, [seed("message_transmitter")]),
    usedNonce: await derive(mt, [seed("used_nonce"), Uint8Array.from(Buffer.from(nonceBody, "hex"))]),
    messageTransmitterEventAuthority: await derive(mt, [seed("__event_authority")]),
    tokenMessenger: await derive(tmm, [seed("token_messenger")]),
    remoteTokenMessenger: await derive(tmm, [seed("remote_token_messenger"), domain]),
    tokenMinter: await derive(tmm, [seed("token_minter")]),
    localToken: await derive(tmm, [seed("local_token"), encoded(usdc)]),
    tokenPair: await derive(tmm, [seed("token_pair"), domain, Uint8Array.from(Buffer.from(remoteToken, "hex"))]),
    custodyTokenAccount: await derive(tmm, [seed("custody"), encoded(usdc)]),
    tokenMessengerEventAuthority: await derive(tmm, [seed("__event_authority")]),
  });
}

/**
 * The instruction data: the discriminator, then two length-prefixed byte
 * vectors in Anchor's own encoding — a little-endian `u32` length before each.
 */
export function encodeReceiveMessageData(messageHex: string, attestationHex: string): Uint8Array {
  const message = messageHex.trim().toLowerCase().replace(/^0x/, "");
  const attestation = attestationHex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^([0-9a-f]{2})+$/.test(message)) throw new Error("The CCTP message must be whole-byte hexadecimal.");
  if (!/^([0-9a-f]{2})+$/.test(attestation)) throw new Error("The attestation must be whole-byte hexadecimal.");
  const messageBytes = Buffer.from(message, "hex");
  const attestationBytes = Buffer.from(attestation, "hex");
  const data = Buffer.alloc(8 + 4 + messageBytes.length + 4 + attestationBytes.length);
  Buffer.from(RECEIVE_MESSAGE_DISCRIMINATOR, "hex").copy(data, 0);
  data.writeUInt32LE(messageBytes.length, 8);
  messageBytes.copy(data, 12);
  data.writeUInt32LE(attestationBytes.length, 12 + messageBytes.length);
  attestationBytes.copy(data, 16 + messageBytes.length);
  return new Uint8Array(data);
}

export type CctpReceiveIntent = Readonly<{
  /** The wallet that submits and pays. It signs, and it is not the recipient. */
  payer: string;
  /**
   * The account the message pins as its only permitted caller, when it pins
   * one. Thirty-two zero bytes in the message mean anyone, and then this is the
   * payer.
   */
  caller: string;
  sourceDomain: number;
  remoteTokenHex: string;
  nonce: string;
  /** The recipient's associated USDC account. Written to. */
  mintRecipient: string;
  /** Circle's own fee account for this token, read from `token_messenger`. */
  feeRecipientTokenAccount: string;
  messageHex: string;
  attestationHex: string;
}>;

/**
 * The instruction, with its accounts in the exact order the program expects.
 *
 * Nine named accounts for the transmitter, then eleven the transmitter passes
 * straight through to the token program's `handle_receive_message`. The split
 * is invisible in the encoding — they are one flat list — and the order is the
 * order a live mainnet transfer used.
 */
export async function buildCctpReceiveInstruction(intent: CctpReceiveIntent): Promise<Instruction> {
  const { messageTransmitter, tokenMessengerMinter } = programs();
  const accounts = await deriveCctpReceiveAccounts({
    sourceDomain: intent.sourceDomain,
    remoteTokenHex: intent.remoteTokenHex,
    nonce: intent.nonce,
  });

  const readonlyAccount = (addr: string) => ({ address: addr as Address, role: AccountRole.READONLY });
  const writable = (addr: string) => ({ address: addr as Address, role: AccountRole.WRITABLE });

  return {
    programAddress: messageTransmitter as Address,
    accounts: [
      { address: intent.payer as Address, role: AccountRole.WRITABLE_SIGNER },
      /* The caller is a read-only signer in its own right. It is the same
         account as the payer whenever the message pins nobody, which is every
         transfer this product builds — but naming it separately is what keeps
         a pinned message buildable at all. */
      { address: intent.caller as Address, role: AccountRole.READONLY_SIGNER },
      readonlyAccount(accounts.authorityPda),
      readonlyAccount(accounts.messageTransmitter),
      writable(accounts.usedNonce),
      readonlyAccount(tokenMessengerMinter),
      readonlyAccount(SOLANA_SYSTEM_PROGRAM),
      readonlyAccount(accounts.messageTransmitterEventAuthority),
      readonlyAccount(messageTransmitter),
      readonlyAccount(accounts.tokenMessenger),
      readonlyAccount(accounts.remoteTokenMessenger),
      writable(accounts.tokenMinter),
      writable(accounts.localToken),
      readonlyAccount(accounts.tokenPair),
      writable(intent.feeRecipientTokenAccount),
      writable(intent.mintRecipient),
      writable(accounts.custodyTokenAccount),
      readonlyAccount(SOLANA_TOKEN_PROGRAM),
      readonlyAccount(accounts.tokenMessengerEventAuthority),
      readonlyAccount(tokenMessengerMinter),
    ],
    data: encodeReceiveMessageData(intent.messageHex, intent.attestationHex),
  };
}

/**
 * Circle's fee account, read from chain state rather than written down.
 *
 * Returns the owner of the fee account; the caller derives its associated USDC
 * account, which is what the instruction names. A hard-coded address here would
 * be correct until the day Circle rotated it, and the failure mode is a reverted
 * replay for a burn that has already happened.
 */
export function readTokenMessengerFeeRecipient(accountData: Uint8Array): string | null {
  if (accountData.length < TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET + 32) return null;
  const slice = accountData.subarray(
    TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET,
    TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET + 32,
  );
  return base58Encode(slice);
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Thirty-two bytes as a base58 address, for a value read out of account data. */
export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BASE58_ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = "1" + out;
  }
  return out === "" ? "1" : out;
}
