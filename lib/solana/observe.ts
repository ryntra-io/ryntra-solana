/**
 * Reading the chain back, as if we had not been the one who submitted.
 *
 * This module never looks at the plan. It takes a transaction signature and
 * asks the cluster what happened, and the only thing it knows about the
 * transfer is what the ledger says — which is the whole point: an observation
 * that consulted the intent would be the product grading its own homework.
 *
 * Balance movement comes from the transaction's own pre/post token balances
 * rather than from a later `getTokenAccountBalance`, because a balance read
 * afterwards includes everything else that happened in between. The deltas
 * here belong to this transaction and nothing else.
 *
 * Outside the public evidence kit — the kit reads mints and receipts, not the
 * effects of writes this product performed.
 */

import {
  NATIVE_SOL_TRANSFER_ACTION_REF,
  SOLANA_CAIP2,
  SPL_TRANSFER_ACTION_REF,
  SplTransferObservationSchema,
  type SplTransferObservation,
} from "../agent-control/adapters/solana-token-2022.ts";
import { describeChainError } from "./chain-error.ts";
import { withRpcDiscipline, type SolanaNetwork, type SolanaRpcHandle } from "./rpc.ts";

export type ObservationFailure = Readonly<{
  ok: false;
  code: "NOT_FOUND" | "UNREADABLE" | "RPC_FAILED";
  reason: string;
}>;

export type TransferObservation = Readonly<{
  ok: true;
  observation: SplTransferObservation;
  /** The ledger's own verdict on the transaction, kept apart from the deltas. */
  transactionSucceeded: boolean;
  transactionError: string | null;
  /** Program ids read from the transaction message and inner instructions. */
  invokedPrograms: readonly string[];
  /** Post-transaction token-account identity facts from this transaction. */
  postTokenAccounts: readonly Readonly<{
    account: string;
    mint: string;
    owner: string | null;
    tokenProgram: string | null;
    amountRaw: string;
    decimals: number;
  }>[];
  /** Human sentences a reconciliation compares against expectations. */
  observedEffects: readonly Readonly<{ description: string; sourceRef: string; observedAt: string }>[];
}>;

export type ObserveResult = TransferObservation | ObservationFailure;

type TokenBalanceEntry = Readonly<{
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string; decimals: number };
}>;

type CompiledInstruction = Readonly<{
  programIdIndex?: bigint | number;
  programId?: unknown;
}>;

function accountKey(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "pubkey" in value) {
    return String((value as { pubkey: unknown }).pubkey);
  }
  return String(value);
}

function invokedProgramsFrom(args: {
  accountKeys: readonly string[];
  instructions: readonly CompiledInstruction[];
  innerInstructions: readonly Readonly<{ instructions?: readonly CompiledInstruction[] }>[];
}): string[] {
  const programs: string[] = [];
  const add = (instruction: CompiledInstruction) => {
    let program: string | null = null;
    if (instruction.programId !== undefined) {
      program = accountKey(instruction.programId);
    } else if (instruction.programIdIndex !== undefined) {
      const index = Number(instruction.programIdIndex);
      if (Number.isSafeInteger(index) && index >= 0) program = args.accountKeys[index] ?? null;
    }
    if (program && !programs.includes(program)) programs.push(program);
  };
  for (const instruction of args.instructions) add(instruction);
  for (const group of args.innerInstructions) {
    for (const instruction of group.instructions ?? []) add(instruction);
  }
  return programs;
}

function postTokenAccountsFrom(
  post: readonly TokenBalanceEntry[],
  accountKeys: readonly string[],
): TransferObservation["postTokenAccounts"] {
  return post
    .map((entry) => ({
      account: accountKeys[entry.accountIndex] ?? `index:${entry.accountIndex}`,
      mint: entry.mint,
      owner: entry.owner ?? null,
      tokenProgram: entry.programId ?? null,
      amountRaw: entry.uiTokenAmount.amount,
      decimals: entry.uiTokenAmount.decimals,
    }))
    .sort((left, right) =>
      left.account < right.account ? -1 : left.account > right.account ? 1 : 0,
    );
}

function deltasFrom(
  pre: readonly TokenBalanceEntry[],
  post: readonly TokenBalanceEntry[],
  accountKeys: readonly string[],
): Array<{ account: string; mint: string; rawDelta: string; owner: string | null; decimals: number }> {
  const key = (entry: TokenBalanceEntry) => `${entry.accountIndex}:${entry.mint}`;
  const before = new Map(pre.map((entry) => [key(entry), entry]));
  const after = new Map(post.map((entry) => [key(entry), entry]));

  const deltas = [];
  for (const identifier of new Set([...before.keys(), ...after.keys()])) {
    const start = before.get(identifier);
    const end = after.get(identifier);
    const sample = end ?? start;
    if (!sample) continue;
    const moved = BigInt(end?.uiTokenAmount.amount ?? "0") - BigInt(start?.uiTokenAmount.amount ?? "0");
    /* A zero delta is an account the transaction touched without moving its
       balance. It is dropped rather than reported, because an observation
       listing "nothing changed here" as an effect invites a reconciliation to
       match an expectation against it. */
    if (moved === 0n) continue;
    deltas.push({
      account: accountKeys[sample.accountIndex] ?? `index:${sample.accountIndex}`,
      mint: sample.mint,
      rawDelta: moved.toString(),
      owner: sample.owner ?? null,
      decimals: sample.uiTokenAmount.decimals,
    });
  }
  return deltas.sort((left, right) => (left.account < right.account ? -1 : left.account > right.account ? 1 : 0));
}

function lamportDeltasFrom(
  pre: readonly (bigint | number)[],
  post: readonly (bigint | number)[],
  accountKeys: readonly string[],
): Array<{ account: string; rawDelta: string }> {
  const count = Math.max(pre.length, post.length, accountKeys.length);
  const deltas: Array<{ account: string; rawDelta: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const before = BigInt(pre[index] ?? 0);
    const after = BigInt(post[index] ?? 0);
    const moved = after - before;
    if (moved === 0n) continue;
    deltas.push({ account: accountKeys[index] ?? `index:${index}`, rawDelta: moved.toString() });
  }
  return deltas;
}

function chainRefFor(network: SolanaNetwork): string {
  return network === "mainnet" ? SOLANA_CAIP2.mainnet : SOLANA_CAIP2.devnet;
}

/**
 * Observe one transaction by signature. Never throws.
 *
 * A transaction the cluster has never heard of is `NOT_FOUND` rather than an
 * error: on a cluster that prunes history, "I cannot see it" and "it does not
 * exist" are the same read and neither is a failure of this code.
 */
export async function observeTransfer(
  handle: SolanaRpcHandle,
  transactionSignature: string,
  options: Readonly<{
    now?: Date;
    actionRef?: typeof SPL_TRANSFER_ACTION_REF | typeof NATIVE_SOL_TRANSFER_ACTION_REF;
  }> = {},
): Promise<ObserveResult> {
  let response: unknown;
  try {
    response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .getTransaction(transactionSignature as never, {
          encoding: "json",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        })
        .send({ abortSignal }),
    );
  } catch (failure) {
    return {
      ok: false,
      code: "RPC_FAILED",
      reason: failure instanceof Error ? failure.message : String(failure),
    };
  }

  if (response === null || response === undefined) {
    return {
      ok: false,
      code: "NOT_FOUND",
      reason: `${handle.network} has no record of ${transactionSignature} at confirmed commitment. It may not have landed, or this endpoint may not keep that far back.`,
    };
  }

  const observedAt = (options.now ?? new Date()).toISOString();
  try {
    const value = response as {
      slot: bigint | number;
      blockTime: bigint | number | null;
      meta: {
        err: unknown;
        fee: bigint | number;
        preTokenBalances?: readonly TokenBalanceEntry[];
        postTokenBalances?: readonly TokenBalanceEntry[];
        preBalances?: readonly (bigint | number)[];
        postBalances?: readonly (bigint | number)[];
        loadedAddresses?: {
          writable?: readonly unknown[];
          readonly?: readonly unknown[];
        };
        innerInstructions?: readonly Readonly<{
          instructions?: readonly CompiledInstruction[];
        }>[];
      } | null;
      transaction: {
        message: {
          accountKeys: readonly unknown[];
          instructions?: readonly CompiledInstruction[];
        };
      };
    };
    if (!value.meta) {
      return {
        ok: false,
        code: "UNREADABLE",
        reason: `${transactionSignature} was returned without transaction metadata, so no balance movement can be read from it.`,
      };
    }

    const accountKeys = [
      ...value.transaction.message.accountKeys,
      ...(value.meta.loadedAddresses?.writable ?? []),
      ...(value.meta.loadedAddresses?.readonly ?? []),
    ].map(accountKey);
    const deltas = deltasFrom(
      value.meta.preTokenBalances ?? [],
      value.meta.postTokenBalances ?? [],
      accountKeys,
    );
    const lamportDeltas = lamportDeltasFrom(
      value.meta.preBalances ?? [],
      value.meta.postBalances ?? [],
      accountKeys,
    );
    const invokedPrograms = invokedProgramsFrom({
      accountKeys,
      instructions: value.transaction.message.instructions ?? [],
      innerInstructions: value.meta.innerInstructions ?? [],
    });
    const postTokenAccounts = postTokenAccountsFrom(
      value.meta.postTokenBalances ?? [],
      accountKeys,
    );
    const succeeded = value.meta.err === null || value.meta.err === undefined;
    const sourceRef = `solana:${handle.network}:rpc:getTransaction/${transactionSignature}`;

    const observation = SplTransferObservationSchema.parse({
      schemaVersion: "1.0.0",
      actionRef: options.actionRef ?? SPL_TRANSFER_ACTION_REF,
      network: handle.network,
      signature: transactionSignature,
      slot: String(value.slot),
      blockTime:
        value.blockTime === null || value.blockTime === undefined
          ? null
          : new Date(Number(value.blockTime) * 1_000).toISOString(),
      feeLamports: String(value.meta.fee),
      balanceDeltas: deltas.map((delta) => ({
        account: delta.account,
        mint: delta.mint,
        rawDelta: delta.rawDelta,
      })),
      lamportBalanceDeltas: lamportDeltas,
      sources: [
        { ref: sourceRef, label: `Solana ${handle.network} JSON-RPC (${handle.host()})` },
      ],
      observedAt,
    });

    /* One sentence per thing that actually happened, in the vocabulary a
       reconciliation compares against — the chain's verdict first, because an
       expectation about a balance is meaningless if the transaction failed. */
    const movementEffects =
      options.actionRef === NATIVE_SOL_TRANSFER_ACTION_REF
        ? lamportDeltas.map((delta, index) => {
            const raw = BigInt(delta.rawDelta);
            /* The fee payer is account zero. Its raw lamport delta includes
               the base fee, while the transfer expectation records the asset
               movement and the receipt records the fee separately. */
            const transferDelta = index === 0 && raw < 0n ? raw + BigInt(value.meta?.fee ?? 0) : raw;
            return {
              description:
                transferDelta > 0n
                  ? `Account ${delta.account} received ${transferDelta.toString()} lamports.`
                  : `Account ${delta.account} sent ${(-transferDelta).toString()} lamports.`,
              sourceRef,
              observedAt,
            };
          })
        : deltas.map((delta) => ({
            description:
              BigInt(delta.rawDelta) > 0n
                ? `Account ${delta.account} received ${delta.rawDelta} base units of ${delta.mint}.`
                : `Account ${delta.account} sent ${delta.rawDelta.replace("-", "")} base units of ${delta.mint}.`,
            sourceRef,
            observedAt,
          }));
    const observedEffects = [
      {
        description: succeeded
          ? `The transaction succeeded on ${handle.network}.`
          : `The transaction failed on ${handle.network}: ${describeChainError(value.meta.err)}.`,
        sourceRef,
        observedAt,
      },
      ...movementEffects,
    ];

    return {
      ok: true,
      observation,
      transactionSucceeded: succeeded,
      transactionError: succeeded ? null : describeChainError(value.meta.err),
      invokedPrograms,
      postTokenAccounts,
      observedEffects,
    };
  } catch (failure) {
    return {
      ok: false,
      code: "UNREADABLE",
      reason: `The transaction was returned but did not normalise into an observation: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
}

/** The CAIP-2 chain reference an observation on this network belongs to. */
export function observationChainRef(network: SolanaNetwork): string {
  return chainRefFor(network);
}
