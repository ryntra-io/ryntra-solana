/**
 * Builders for the pre-sign check's tests: real wire transactions compiled by `@solana/kit`, real account layouts (a
 * token account's 165 bytes, a mint through the official Token-2022 encoder), and a chain that answers what it was
 * told — the accounts before, and what the simulation of the exact bytes reports after. Nothing here touches a
 * network.
 */

import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getMintEncoder } from "@solana-program/token-2022";

export const SYSTEM = "11111111111111111111111111111111";
export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const RECENT_BLOCKHASHES = "SysvarRecentB1ockHashes11111111111111111111";
export const BLOCKHASH = "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn";
const base58 = getBase58Encoder();

/** A fresh on-curve address — a wallet someone holds the key to. */
export async function wallet() {
  return (await generateKeyPairSigner()).address;
}

/** `address` with its middle rewritten: the first and last characters kept — an address ground to look alike. */
export function lookalike(address) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const middle = Array.from({ length: address.length - 8 }, (_, at) => alphabet[(at * 7 + attempt * 13 + 5) % alphabet.length]).join("");
    const candidate = address.slice(0, 4) + middle + address.slice(-4);
    if (candidate !== address && base58.encode(candidate).length === 32) return candidate;
  }
  throw new Error("no look-alike found");
}

const u32 = (value) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
};
const u64 = (value) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
};
const key = (address) => Uint8Array.from(base58.encode(address));
const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/* ---------------------------------------------------------------- instructions */

const ix = (programAddress, accounts, data) => ({ programAddress, accounts: accounts.map(([address, role]) => ({ address, role })), data });
const { READONLY, WRITABLE, READONLY_SIGNER, WRITABLE_SIGNER } = AccountRole;

export const systemTransfer = (from, to, lamports) => ix(SYSTEM, [[from, WRITABLE_SIGNER], [to, WRITABLE]], join(u32(2), u64(lamports)));
export const assign = (account, program) => ix(SYSTEM, [[account, WRITABLE_SIGNER]], join(u32(1), key(program)));
export const advanceNonce = (nonce, authority) => ix(SYSTEM, [[nonce, WRITABLE], [RECENT_BLOCKHASHES, READONLY], [authority, READONLY_SIGNER]], u32(4));
export const transferChecked = (source, mint, destination, owner, amount, decimals, program = TOKEN) =>
  ix(program, [[source, WRITABLE], [mint, READONLY], [destination, WRITABLE], [owner, READONLY_SIGNER]], join(Uint8Array.of(12), u64(amount), Uint8Array.of(decimals)));
export const approve = (source, delegate, owner, amount) => ix(TOKEN, [[source, WRITABLE], [delegate, READONLY], [owner, READONLY_SIGNER]], join(Uint8Array.of(4), u64(amount)));
export const setAuthority = (account, current, type, to) => ix(TOKEN, [[account, WRITABLE], [current, READONLY_SIGNER]], join(Uint8Array.of(6, type, 1), key(to)));
export const closeAccount = (account, destination, owner) => ix(TOKEN, [[account, WRITABLE], [destination, WRITABLE], [owner, READONLY_SIGNER]], Uint8Array.of(9));
/** A call into a program the check does not name, touching the accounts given. */
export const opaque = (program, accounts) => ix(program, accounts.map((address, at) => [address, at === 0 ? WRITABLE_SIGNER : WRITABLE]), Uint8Array.of(1, 2, 3));

/** A real unsigned wire transaction, base64. */
export function wire(feePayer, instructions, version = 0) {
  const message = pipe(
    createTransactionMessage({ version }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

/* ---------------------------------------------------------------- accounts */

export const walletState = (lamports) => ({ lamports: BigInt(lamports), owner: SYSTEM, data: new Uint8Array(0) });

export function tokenState({ mint, owner, amount, delegate = null, delegatedAmount = 0n, closeAuthority = null, frozen = false, program = TOKEN, lamports = 2_039_280n }) {
  const option = (value) => (value ? join(u32(1), key(value)) : new Uint8Array(36));
  const data = join(key(mint), key(owner), u64(amount), option(delegate), Uint8Array.of(frozen ? 2 : 1), new Uint8Array(12), u64(delegatedAmount), option(closeAuthority));
  return { lamports: BigInt(lamports), owner: program, data };
}

const some = (value) => ({ __option: "Some", value });
const none = { __option: "None" };

export function mintState({ decimals = 6, supply = 1_000_000_000n, mintAuthority = null, freezeAuthority = null, extensions = null, program = extensions ? TOKEN_2022 : TOKEN } = {}) {
  const data = getMintEncoder().encode({
    mintAuthority: mintAuthority ? some(mintAuthority) : none,
    supply: BigInt(supply),
    decimals,
    isInitialized: true,
    freezeAuthority: freezeAuthority ? some(freezeAuthority) : none,
    extensions: extensions ? some(extensions) : none,
  });
  return { lamports: 1_461_600n, owner: program, data: new Uint8Array(data) };
}

/* ---------------------------------------------------------------- the chain */

/**
 * A chain that answers from `before`, and a simulation that reports `after` (an address not in `after` is reported
 * unchanged). `simulation: "unavailable"` or `{ err }` model a silent or failing simulation.
 */
export function chain({ before = {}, after = {}, simulation = "ran", err = null, logs = [], inner = [], history = {}, security = {}, tokenFacts = null, recipient = null, threats = undefined } = {}) {
  const calls = { accounts: [], simulate: [], history: [], security: [] };
  const read = (address) => (address in before ? before[address] : null);
  const reads = {
    accounts: async (addresses) => {
      calls.accounts.push([...addresses]);
      return new Map(addresses.map((address) => [address, read(address)]));
    },
    simulate: async ({ wireBase64, addresses }) => {
      calls.simulate.push({ wireBase64, addresses: [...addresses] });
      if (simulation === "unavailable") return { state: "unavailable", why: "the RPC timed out" };
      return { state: "ran", err, logs, inner, after: new Map(addresses.map((address) => [address, address in after ? after[address] : read(address)])) };
    },
    history: async (address) => {
      calls.history.push(address);
      return history[address] ?? "some";
    },
    security: async (address) => {
      calls.security.push(address);
      return security[address] ?? { state: "answered", sanctioned: false, band: "low" };
    },
    tokenFacts: tokenFacts ?? (async (mint) => ({ state: "NOT_READ", mint, why: "MD_GATEWAY_URL is not set.", readAt: "2026-10-31T10:00:00.000Z" })),
    recipient: recipient ?? undefined,
    epoch: async () => 900n,
    now: () => new Date("2026-10-31T10:00:00.000Z"),
    ...(threats ? { threats } : {}),
  };
  return { reads, calls };
}
