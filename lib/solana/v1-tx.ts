/**
 * Solana transaction v1 (SIMD-0385, on mainnet since 15.09.2026) for the bytes a person's wallet signs — Phoenix's
 * collateral (B6) and the treasury (SOL-4): the format Phantom asks a dApp to use, with the compute unit limit, the
 * loaded accounts data limit and the priority fee in the message's own config instead of Compute Budget instructions
 * («Use Solana v1 transactions… set compute unit and loaded account data limits explicitly in the message
 * configuration», docs.phantom.com, domain and transaction warnings). Built with Kit 8 (`@solana/kit-v8`, an alias: the
 * rest of the repository stays on Kit 7); a wallet that does not sign v1 gets the legacy bytes as before.
 *
 * Its jobs: build the unsigned wire from instructions; read a wire back — v1 or legacy — into one view the checks
 * share: the payer, the lifetime, every instruction with its accounts' signer and writable flags, and for v1 the config;
 * hold what a wallet returned to the bytes it was given; write a co-signer's signature after the wallet's; and read a
 * landed transaction of any version from a node (`getTransactionAnyVersion`).
 *
 * Browser-safe: no `node:` module and no key — the treasury's page reads v1 replies with it before its seed key signs
 * (`treasury/create-key.client.ts`); signatures are verified by whoever holds a verifier (the routes).
 */

import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  decompileTransactionMessage,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionMessageComputeUnitLimit,
  getTransactionMessageLoadedAccountsDataSizeLimit,
  getTransactionMessageHeapSize,
  getTransactionMessagePriorityFeeLamports,
  getTransactionEncoder,
  lamports,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessagePriorityFeeLamports,
  TRANSACTION_CONFIG_COMPUTE_UNIT_LIMIT_BIT_MASK,
  TRANSACTION_CONFIG_HEAP_SIZE_BIT_MASK,
  TRANSACTION_CONFIG_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_BIT_MASK,
  TRANSACTION_CONFIG_PRIORITY_FEE_LAMPORTS_BIT_MASK,
  type Blockhash,
  type Instruction,
} from "@solana/kit-v8";
import {
  ComputeBudgetProgram,
  Message,
  MessageV0,
  PublicKey,
  SolanaJSONRPCError,
  Transaction,
  TransactionInstruction,
  type Connection,
  type VersionedTransactionResponse,
} from "@solana/web3.js";

import { COMPUTE_BUDGET_PROGRAM, LIGHTHOUSE_PROGRAM } from "./wallet-modification.ts";

/** Lighthouse's first assertion instruction, and the priority a relay carries at most — `limits/trigger-tx.ts`'s, which imports `node:crypto`. */
export const LIGHTHOUSE_FIRST_ASSERTION = 2;
export const MAX_PRIORITY_LAMPORTS = 5_000_000n;

/** The first byte of a serialized v1 transaction: the version, before the message (signatures sit at the tail). */
export const V1_PREFIX = 0x81;

export type ViewInstruction = Readonly<{ programId: string; keys: readonly Readonly<{ pubkey: string; isSigner: boolean; isWritable: boolean }>[]; data: Buffer }>;

/** What a transaction does, whatever its format; `config` only for v1. */
export type TxView = Readonly<{
  format: "legacy" | "v1";
  payer: string | null;
  lifetime: string;
  instructions: readonly ViewInstruction[];
  config: Readonly<{ computeUnitLimit: number | null; loadedAccountsDataSizeLimit: number | null; priorityFeeLamports: bigint | null; heapSize: number | null }> | null;
}>;

export type V1Limits = Readonly<{ computeUnitLimit: number; loadedAccountsDataSizeLimit: number; priorityFeeLamports: bigint }>;

/** The SDK's instructions (Kit 8 shape) in an unsigned v1 transaction paid by the wallet, as base64 wire bytes. */
export function buildV1Wire(input: Readonly<{ owner: string; instructions: readonly unknown[]; blockhash: string; lastValidBlockHeight: number; limits: V1Limits }>): string {
  const base = setTransactionMessageLifetimeUsingBlockhash(
    { blockhash: input.blockhash as Blockhash, lastValidBlockHeight: BigInt(input.lastValidBlockHeight) },
    setTransactionMessageFeePayer(address(input.owner), createTransactionMessage({ version: 1 })),
  );
  const withInstructions = appendTransactionMessageInstructions(input.instructions as readonly Instruction[], base);
  const limited = setTransactionMessagePriorityFeeLamports(
    lamports(input.limits.priorityFeeLamports),
    setTransactionMessageLoadedAccountsDataSizeLimit(input.limits.loadedAccountsDataSizeLimit, setTransactionMessageComputeUnitLimit(input.limits.computeUnitLimit, withInstructions)),
  );
  return getBase64EncodedWireTransaction(compileTransaction(limited));
}

export const isV1Wire = (bytes: Uint8Array): boolean => bytes.length > 0 && bytes[0] === V1_PREFIX;

export type V1Read = Readonly<{ view: TxView; messageBytes: Uint8Array; accounts: readonly string[]; signers: readonly string[]; signatures: readonly (Uint8Array | null)[] }>;

/** The config fields this reader knows: a mask with any other bit is a message it does not understand, and refuses. */
const KNOWN_CONFIG_BITS =
  TRANSACTION_CONFIG_PRIORITY_FEE_LAMPORTS_BIT_MASK | TRANSACTION_CONFIG_COMPUTE_UNIT_LIMIT_BIT_MASK | TRANSACTION_CONFIG_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_BIT_MASK | TRANSACTION_CONFIG_HEAP_SIZE_BIT_MASK;

/**
 * A v1 wire read back: the view, the exact message bytes every signature covers, and each signer's signature in order.
 * Strict: the message must end where the signatures begin, the config may carry only known fields, and the bytes must be
 * the canonical encoding of what was read — no slack between the parsers that check and the network that runs.
 */
export function readV1(bytes: Uint8Array): V1Read {
  const transaction = getTransactionDecoder().decode(bytes);
  const [compiled, end] = getCompiledTransactionMessageDecoder().read(transaction.messageBytes, 0);
  if (compiled.version !== 1) throw new Error("Not a v1 transaction.");
  if (end !== transaction.messageBytes.length) throw new Error("Bytes after the message.");
  if ((Number((compiled as { configMask?: number }).configMask ?? 0) & ~KNOWN_CONFIG_BITS) !== 0) throw new Error("An unknown config field.");
  if (!Buffer.from(getTransactionEncoder().encode(transaction)).equals(Buffer.from(bytes))) throw new Error("Not the canonical encoding.");
  const accounts = compiled.staticAccounts.map(String);
  const signerCount = compiled.header.numSignerAccounts;
  const message = decompileTransactionMessage(compiled);
  /* Roles are the message's, by account: 1 and 3 write, 2 and 3 sign. */
  const instructions: ViewInstruction[] = message.instructions.map((instruction) => ({
    programId: String(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((account) => ({
      pubkey: String(account.address),
      isSigner: accounts.indexOf(String(account.address)) < signerCount && accounts.indexOf(String(account.address)) >= 0,
      isWritable: (Number(account.role) & 1) === 1,
    })),
    data: Buffer.from(instruction.data ?? new Uint8Array()),
  }));
  const signers = accounts.slice(0, signerCount);
  const priority = getTransactionMessagePriorityFeeLamports(message);
  return {
    view: {
      format: "v1",
      payer: accounts[0] ?? null,
      lifetime: String(compiled.lifetimeToken),
      instructions,
      config: {
        computeUnitLimit: getTransactionMessageComputeUnitLimit(message) ?? null,
        loadedAccountsDataSizeLimit: getTransactionMessageLoadedAccountsDataSizeLimit(message) ?? null,
        priorityFeeLamports: priority === undefined ? null : BigInt(priority),
        heapSize: getTransactionMessageHeapSize(message) ?? null,
      },
    },
    messageBytes: Uint8Array.from(transaction.messageBytes),
    accounts,
    signers,
    signatures: signers.map((signer) => {
      const signature = (transaction.signatures as Record<string, Uint8Array | null>)[signer];
      return signature && signature.some((byte) => byte !== 0) ? Uint8Array.from(signature) : null;
    }),
  };
}

/**
 * A legacy transaction as its bytes carry it: read back from the wire, because a compiled message marks the wallet a
 * signer wherever it appears and a built object in memory does not.
 */
export function legacyView(transaction: Transaction): TxView {
  const exact = Transaction.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }));
  return {
    format: "legacy",
    payer: exact.feePayer?.toBase58() ?? null,
    lifetime: exact.recentBlockhash ?? "",
    instructions: exact.instructions.map((instruction) => ({
      programId: instruction.programId.toBase58(),
      keys: instruction.keys.map((key) => ({ pubkey: key.pubkey.toBase58(), isSigner: key.isSigner, isWritable: key.isWritable })),
      data: Buffer.from(instruction.data),
    })),
    config: null,
  };
}

/** Any wire, v1 or legacy, as a view. */
export function viewOfWire(wireBase64: string): TxView {
  const bytes = Buffer.from(wireBase64, "base64");
  return isV1Wire(bytes) ? readV1(bytes).view : legacyView(Transaction.from(bytes));
}

/** A web3.js instruction in Kit's shape for `buildV1Wire`: roles 0 read, 1 write, 2 read+sign, 3 write+sign. */
export function kitInstruction(instruction: TransactionInstruction): Readonly<{ programAddress: string; accounts: readonly Readonly<{ address: string; role: number }>[]; data: Uint8Array }> {
  return {
    programAddress: instruction.programId.toBase58(),
    accounts: instruction.keys.map((key) => ({ address: key.pubkey.toBase58(), role: (key.isSigner ? 2 : 0) + (key.isWritable ? 1 : 0) })),
    data: Uint8Array.from(instruction.data),
  };
}

/** A view's instructions as web3.js carries them: what reads a refusal against the instruction it names. */
export function instructionsOfView(view: TxView): Transaction {
  return new Transaction().add(
    ...view.instructions.map(
      (instruction) =>
        new TransactionInstruction({
          programId: new PublicKey(instruction.programId),
          keys: instruction.keys.map((key) => ({ pubkey: new PublicKey(key.pubkey), isSigner: key.isSigner, isWritable: key.isWritable })),
          data: instruction.data,
        }),
    ),
  );
}

/** Compute Budget `SetLoadedAccountsDataSizeLimit` (tag 4, u32 bytes): legacy bytes' counterpart of the v1 config's limit — web3.js 1.98 has no builder for it. */
export function setLoadedAccountsDataSizeLimit(bytes: number): TransactionInstruction {
  const data = Buffer.alloc(5);
  data.writeUInt8(4, 0);
  data.writeUInt32LE(bytes, 1);
  return new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [], data });
}

/**
 * A v1 wire with one signer's signature written into its slot — the others kept as they are, the message untouched. The
 * result is read back strictly and its message compared: a key that is not one of the message's signers, or an encoding
 * that moved a byte, is refused, not quietly repaired.
 */
export function withV1Signature(bytes: Uint8Array, signer: string, signature: Uint8Array): Uint8Array {
  const transaction = getTransactionDecoder().decode(bytes);
  const signatures: Record<string, Uint8Array | null> = { ...(transaction.signatures as Record<string, Uint8Array | null>) };
  if (!(signer in signatures)) throw new Error("Not a signer of this message.");
  if (signature.length !== 64) throw new Error("Not a signature.");
  signatures[signer] = Uint8Array.from(signature);
  const out = Uint8Array.from(getTransactionEncoder().encode({ ...transaction, signatures } as typeof transaction));
  if (!Buffer.from(readV1(out).messageBytes).equals(Buffer.from(transaction.messageBytes))) throw new Error("The message moved.");
  return out;
}

/** The most a v1 config may ask, whoever set it: the runtime's own ceilings. */
const V1_MAX_UNITS = 1_400_000;
const V1_MAX_LOADED = 64 * 1024 * 1024;
const MAX_GUARDS = 8;

export type V1Signed = Readonly<{ ok: true; read: V1Read }> | Readonly<{ ok: false; reason: string }>;

/**
 * What a wallet returned against the v1 bytes it was given, before any other key signs: v1, the same payer, lifetime and
 * signers in the same order; every built instruction unchanged and in order — program, accounts with their signer and
 * writable flags, data; nothing added but Lighthouse assertions that name no signer but the wallet (Phantom guards the
 * fee payer's own account); a config within the runtime's ceilings — a limit the wallet left out is the runtime's
 * default, as Phoenix's check reads it — a priority fee under the relay's cap and no heap request. On v1 the budget
 * lives in the config: a Compute Budget instruction is refused. Signatures are not judged here: the caller verifies
 * every one it needs over `read.messageBytes`.
 */
export function v1MatchesBuilt(expectedWireBase64: string, actualWireBase64: string, wallet: string): V1Signed {
  let expected: V1Read;
  let actual: V1Read;
  try {
    expected = readV1(Buffer.from(expectedWireBase64, "base64"));
    const bytes = Buffer.from(actualWireBase64, "base64");
    if (!isV1Wire(bytes)) return { ok: false, reason: "Not a v1 transaction." };
    actual = readV1(bytes);
  } catch {
    return { ok: false, reason: "Not a transaction this build reads." };
  }
  if (actual.view.payer !== wallet || expected.view.payer !== wallet) return { ok: false, reason: "Another fee payer." };
  if (actual.view.lifetime !== expected.view.lifetime) return { ok: false, reason: "Another blockhash." };
  if (actual.signers.length !== expected.signers.length || actual.signers.some((signer, at) => signer !== expected.signers[at])) return { ok: false, reason: "Other signers." };
  const sameKeys = (a: ViewInstruction, b: ViewInstruction) =>
    a.keys.length === b.keys.length && a.keys.every((key, at) => key.pubkey === b.keys[at]!.pubkey && key.isSigner === b.keys[at]!.isSigner && key.isWritable === b.keys[at]!.isWritable);
  const business = actual.view.instructions.filter((instruction) => instruction.programId !== LIGHTHOUSE_PROGRAM);
  const guards = actual.view.instructions.filter((instruction) => instruction.programId === LIGHTHOUSE_PROGRAM);
  if (
    business.length !== expected.view.instructions.length ||
    business.some((instruction, at) => {
      const built = expected.view.instructions[at]!;
      return instruction.programId !== built.programId || !instruction.data.equals(built.data) || !sameKeys(instruction, built);
    })
  ) {
    return { ok: false, reason: "An instruction is not the one built." };
  }
  if (business.some((instruction) => instruction.programId === COMPUTE_BUDGET_PROGRAM)) return { ok: false, reason: "A Compute Budget instruction on v1." };
  if (guards.length > MAX_GUARDS || guards.some((guard) => guard.data.length === 0 || guard.data[0]! < LIGHTHOUSE_FIRST_ASSERTION || guard.keys.some((key) => key.isSigner && key.pubkey !== wallet))) return { ok: false, reason: "A wallet instruction that is not an assertion." };
  const config = actual.view.config;
  if (
    !config ||
    (config.computeUnitLimit !== null && config.computeUnitLimit > V1_MAX_UNITS) ||
    (config.loadedAccountsDataSizeLimit !== null && config.loadedAccountsDataSizeLimit > V1_MAX_LOADED) ||
    (config.priorityFeeLamports !== null && config.priorityFeeLamports > MAX_PRIORITY_LAMPORTS) ||
    config.heapSize !== null
  ) {
    return { ok: false, reason: "The wallet's budget is outside what the relay sends." };
  }
  return { ok: true, read: actual };
}

/* ------------------------------------------------------------------ landed transactions */

type RawRpc = (method: string, args: unknown[]) => Promise<Readonly<{ result?: unknown; error?: Readonly<{ code: unknown; message: string; data?: unknown }> }>>;

type JsonInstruction = Readonly<{ programIdIndex: number; accounts: readonly number[]; data: string }>;
type JsonLookup = Readonly<{ accountKey: string; writableIndexes: readonly number[]; readonlyIndexes: readonly number[] }>;
type JsonTransaction = Readonly<{
  slot: number;
  blockTime?: number | null;
  version?: "legacy" | number;
  meta: (Record<string, unknown> & { loadedAddresses?: Readonly<{ writable: readonly string[]; readonly: readonly string[] }> }) | null;
  transaction: Readonly<{
    signatures: readonly string[];
    message: Readonly<{
      header: Readonly<{ numRequiredSignatures: number; numReadonlySignedAccounts: number; numReadonlyUnsignedAccounts: number }>;
      accountKeys: readonly string[];
      recentBlockhash: string;
      instructions: readonly JsonInstruction[];
      addressTableLookups?: readonly JsonLookup[] | null;
    }>;
  }>;
}>;

/**
 * A node's `getTransaction` answer (`encoding: "json"`, asked for version 1) in the shape web3.js 1.x gives its own
 * reads — so the readers that used `connection.getTransaction` keep their code. A v1 message (SIMD-0385) has a v0
 * message's header, static keys and compiled instructions and no lookup tables, and its budget lives in a config the
 * readers do not need: it reads as a v0 message with none, and `version` stays 1. A version this build does not know,
 * or a v1 answer that names lookup tables, is refused — never read as something else.
 */
export function transactionResponseOf(answer: unknown): VersionedTransactionResponse {
  const tx = answer as JsonTransaction;
  const version = tx.version ?? "legacy";
  if (version !== "legacy" && version !== 0 && version !== 1) throw new Error(`Transaction version ${String(version)} is not one this build reads.`);
  const raw = tx.transaction.message;
  const lookups = raw.addressTableLookups ?? [];
  if (version === 1 && lookups.length > 0) throw new Error("A v1 transaction with lookup tables is not one this build reads.");
  const base58 = getBase58Encoder();
  const message =
    version === "legacy"
      ? new Message({ header: raw.header, accountKeys: [...raw.accountKeys], recentBlockhash: raw.recentBlockhash, instructions: raw.instructions.map((ix) => ({ ...ix, accounts: [...ix.accounts] })) })
      : new MessageV0({
          header: raw.header,
          staticAccountKeys: raw.accountKeys.map((key) => new PublicKey(key)),
          recentBlockhash: raw.recentBlockhash,
          compiledInstructions: raw.instructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accountKeyIndexes: [...ix.accounts], data: Uint8Array.from(base58.encode(ix.data)) })),
          addressTableLookups: lookups.map((lookup) => ({ accountKey: new PublicKey(lookup.accountKey), writableIndexes: [...lookup.writableIndexes], readonlyIndexes: [...lookup.readonlyIndexes] })),
        });
  const loaded = tx.meta?.loadedAddresses;
  const meta = tx.meta ? { ...tx.meta, loadedAddresses: loaded ? { writable: loaded.writable.map((key) => new PublicKey(key)), readonly: loaded.readonly.map((key) => new PublicKey(key)) } : undefined } : null;
  return {
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    meta,
    transaction: { signatures: [...tx.transaction.signatures], message },
    version,
  } as unknown as VersionedTransactionResponse;
}

/**
 * A landed transaction of any version — legacy, v0 or v1 — as `connection.getTransaction` reads it; null when the node
 * does not keep it, a throw when it refused. web3.js 1.98 asks for version 0 at most, and a node refuses a v1
 * transaction to such a client (-32015 «Transaction version (1) is not supported by the requesting client»), which a
 * reader took for «no transaction»: since epoch 1035 (≈ 15.09.2026) a quarter of mainnet's transactions are v1. The
 * node is asked over the connection's own JSON-RPC for version 1; a connection without that call (a test's fake) is
 * asked as before.
 */
export async function getTransactionAnyVersion(connection: Pick<Connection, "getTransaction">, signature: string, options: Readonly<{ commitment?: "confirmed" | "finalized" }> = {}): Promise<VersionedTransactionResponse | null> {
  const commitment = options.commitment ?? "confirmed";
  const raw = (connection as unknown as { _rpcRequest?: RawRpc })._rpcRequest;
  if (typeof raw !== "function") return connection.getTransaction(signature, { commitment, maxSupportedTransactionVersion: 0 });
  const answer = await raw.call(connection, "getTransaction", [signature, { commitment, encoding: "json", maxSupportedTransactionVersion: 1 }]);
  if (answer.error) throw new SolanaJSONRPCError(answer.error, "failed to get transaction");
  return answer.result ? transactionResponseOf(answer.result) : null;
}
