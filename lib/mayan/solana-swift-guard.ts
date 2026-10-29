/**
 * What Mayan may put in a Solana wallet's transaction — checked, not trusted.
 *
 * FIX-XSWAP-1 (SEC-1, P1). The Swift order a person signs from Solana is
 * assembled by Mayan's SDK, and on any pair whose input is not the token Swift
 * locks (SOL into Base USDC locks USDC) the SDK asks Mayan's HTTP API for the
 * swap leg and places its instructions in the bytes. Until this module the
 * server checked only that the wallet was the one signer: a broken or
 * substituted API could have added a `Transfer` or an `Approve` from the
 * person's accounts, or quoted another token, and the Review would still have
 * shown the person's own figures. The loss was not bounded by the swap.
 *
 * Three checks, each one refusing with the reason and never signing:
 *
 * 1. **The quote is the one asked for** (`mayanQuoteMatchesRequest`, in
 *    `price-api.ts` so the quote route can use it without this module's
 *    imports): both networks, both tokens and an input no larger than the
 *    person's amount.
 * 2. **Only the programs this order needs** (`checkMayanSwiftInstructions`),
 *    read from SDK 15.2.2's `createSwiftFromSolanaInstructions`, the only path
 *    `build.server.ts` takes (Swift V2, no custom payload, no separate swap
 *    transaction). The SDK wraps its own instructions in Mayan's CPI proxy, so
 *    a proxied instruction is judged by the program it forwards to — its first
 *    account.
 * 3. **The simulation moves only what the person agreed to**
 *    (`assessCrossSwapOwnerEffects`): from the exact bytes' pre/post balance
 *    vectors, the wallet loses the input token up to the amount, SOL up to the
 *    network fee plus the rent of the order's own accounts, and nothing else;
 *    no delegate, no authority and no close of the person's accounts goes
 *    anywhere but back to the person; the wallet stays a plain System account.
 *
 * An allowlist alone proves little — Jupiter is on it and Jupiter invokes any
 * venue — which is why the third check is the one that bounds the loss. It
 * does not need to know which venue ran: it reads what the chain says changed.
 */

import { getBase58Encoder } from "@solana/kit";

import { rentExemptMinimumLamports, type RentParameters, type SimulatedAccountState } from "../solana/rent.ts";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, WRAPPED_SOL_MINT } from "../solana/send-kinds.ts";

/* Pinned rather than read from the SDK, so this module stays free of the SDK's
   bundle and a release that moved an address fails a test instead of moving
   what a wallet signs. `build.server.test.mjs` asserts they match 15.2.2. */
export const MAYAN_SWIFT_V2_PROGRAM_ID = "mayan34VedncxdK2XobtvWFDXQASUTBXhUVzt2kKgny";
export const MAYAN_CPI_PROXY_PROGRAM_ID = "D8C8iW6zmoKg5TRr8nQ7h14TMWqQX8FiBdj2ju5MF3wa";
export const JUPITER_V6_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

/**
 * Programs a Swift order from Solana may invoke at the top level, and why.
 *
 * - CPI proxy — the SDK wraps every instruction it writes itself (ATA, SOL
 *   transfer, sync, the order's `init_order`, the swap leg's setup and
 *   cleanup); what it forwards to is checked against the second list.
 * - Compute Budget — the unit price from the quote and the swap leg's limits.
 * - Jupiter v6 — the swap leg when the input is not Swift's locked token. The
 *   SDK also accepts Titan and DFlow from the API; this lane accepts neither,
 *   so such a route is refused rather than signed.
 * - Swift V2 — `init_order` itself, should the SDK ever place it unwrapped.
 *
 * Absent on purpose: Memo (the SDK writes none), Swift V1 (refused at the
 * quote), the payload writer (only with a custom payload, never passed here)
 * and SPL utils (only with a separate swap transaction, never asked for).
 */
export const MAYAN_SWIFT_TOP_LEVEL_PROGRAMS: ReadonlySet<string> = new Set([
  MAYAN_CPI_PROXY_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  JUPITER_V6_PROGRAM_ID,
  MAYAN_SWIFT_V2_PROGRAM_ID,
]);

/**
 * Programs the CPI proxy may forward to: Swift V2 (`init_order`), System (the
 * SOL deposit and account creation), Associated Token (the order's token
 * account and the swap leg's wSOL account), Token and Token-2022 (sync,
 * transfer and close; the locked token may be either).
 */
export const MAYAN_SWIFT_PROXIED_PROGRAMS: ReadonlySet<string> = new Set([
  MAYAN_SWIFT_V2_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
]);

/** Programs that may own an account this transaction opens: the order's state and its token account, and ATAs. */
const CREATED_ACCOUNT_OWNERS: ReadonlySet<string> = new Set([MAYAN_SWIFT_V2_PROGRAM_ID, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);
const TOKEN_PROGRAMS: ReadonlySet<string> = new Set([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);

/**
 * The most rent the order's own accounts may take: Mayan quotes 3,000,000
 * lamports (`rentCost`) for the state account and its token account; the cap
 * leaves room for a Token-2022 account with extensions and the swap leg's
 * wSOL account, and no room to park a large account on the person's SOL.
 */
export const MAYAN_SWIFT_MAX_RENT_LAMPORTS = 20_000_000n;
/** The most network fee (signature plus priority) a Review may carry: 0.01 SOL, far above any fee Mayan suggests. */
export const MAYAN_SWIFT_MAX_NETWORK_FEE_LAMPORTS = 10_000_000n;

export type MayanSwiftRefusalCode =
  | "UNEXPECTED_PROGRAM"
  | "SIMULATION_METADATA_UNAVAILABLE"
  | "ACCOUNT_VECTOR_MISMATCH"
  | "FEE_TOO_HIGH"
  | "TOKEN_METADATA_INVALID"
  | "UNRELATED_TOKEN_LOSS"
  | "INPUT_OVERSPENT"
  | "SOL_OVERSPENT"
  | "UNEXPECTED_ACCOUNT_CREATED"
  | "RENT_UNPROVEN"
  | "WALLET_MUTATED"
  | "UNSAFE_TOKEN_MUTATION";

export type MayanSwiftCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; code: MayanSwiftRefusalCode; reason: string }>;

function refuse(code: MayanSwiftRefusalCode, reason: string): Readonly<{ ok: false; code: MayanSwiftRefusalCode; reason: string }> {
  return { ok: false, code, reason };
}

/* ── 2. The programs ──────────────────────────────────────────────────────── */

export type InstructionShape = Readonly<{ programId: string; keys: readonly Readonly<{ pubkey: string }>[] }>;

/** Every instruction the SDK returned, top level and through the proxy, against the two lists above. */
export function checkMayanSwiftInstructions(instructions: readonly InstructionShape[]): MayanSwiftCheck {
  if (instructions.length === 0) return refuse("UNEXPECTED_PROGRAM", "Mayan's SDK returned no instructions.");
  for (const instruction of instructions) {
    if (!MAYAN_SWIFT_TOP_LEVEL_PROGRAMS.has(instruction.programId)) {
      return refuse("UNEXPECTED_PROGRAM", `The order invokes ${instruction.programId}, which a Swift order from Solana does not need; nothing was signed.`);
    }
    if (instruction.programId === MAYAN_CPI_PROXY_PROGRAM_ID) {
      const forwarded = instruction.keys[0]?.pubkey;
      if (!forwarded || !MAYAN_SWIFT_PROXIED_PROGRAMS.has(forwarded)) {
        return refuse("UNEXPECTED_PROGRAM", `Mayan's proxy forwards to ${forwarded ?? "nothing"}, which a Swift order from Solana does not need; nothing was signed.`);
      }
    }
  }
  return { ok: true };
}

/* ── 3. The simulation ────────────────────────────────────────────────────── */

type TokenBalanceRow = Readonly<{ accountIndex: number | bigint; mint: string; owner?: string; uiTokenAmount?: Readonly<{ amount?: string }> }>;

/** The fields of `simulateTransaction`'s answer this check reads; anything absent is a refusal. */
export type CrossSwapSimulationMeta = Readonly<{
  fee?: bigint | number | null;
  loadedAddresses?: Readonly<{ writable: readonly unknown[]; readonly: readonly unknown[] }> | null;
  preBalances?: readonly (bigint | number)[] | null;
  postBalances?: readonly (bigint | number)[] | null;
  preTokenBalances?: readonly TokenBalanceRow[] | null;
  postTokenBalances?: readonly TokenBalanceRow[] | null;
  innerInstructions?: readonly unknown[] | null;
}>;

export type CrossSwapOwnerEffects = Readonly<{
  /** Lamports the wallet loses, wSOL in its own token accounts counted as SOL. */
  solLossLamports: string;
  /** The input token the wallet loses; for a native input, the same as `solLossLamports` less fee and rent. */
  inputLossRaw: string;
  feeLamports: string;
  rentLamports: string;
  createdAccounts: number;
}>;

export type CrossSwapEffectAssessment =
  | Readonly<{ ok: true; effects: CrossSwapOwnerEffects }>
  | Readonly<{ ok: false; code: MayanSwiftRefusalCode; reason: string }>;

function lamports(value: bigint | number | undefined): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

function rowIndex(value: number | bigint, bound: number): number | null {
  const index = typeof value === "bigint" ? Number(value) : value;
  return Number.isSafeInteger(index) && index >= 0 && index < bound ? index : null;
}

type ParsedRow = Readonly<{ programId: string | null; type: string | null; info: Record<string, unknown> | null; accounts: readonly string[]; data: string | null }>;

/** Inner instructions as plain rows, the program and accounts resolved against the vector, parsed or not. */
function innerRows(groups: readonly unknown[], vector: readonly string[]): readonly ParsedRow[] | null {
  const labelled: Record<string, string> = { "spl-token": TOKEN_PROGRAM_ID, "spl-token-2022": TOKEN_2022_PROGRAM_ID, system: SYSTEM_PROGRAM_ID };
  const rows: ParsedRow[] = [];
  for (const group of groups) {
    const list = typeof group === "object" && group !== null ? (group as { instructions?: unknown }).instructions : null;
    if (!Array.isArray(list)) return null;
    for (const candidate of list) {
      if (typeof candidate !== "object" || candidate === null) return null;
      const entry = candidate as Record<string, unknown>;
      const index = typeof entry.programIdIndex === "bigint" ? Number(entry.programIdIndex) : typeof entry.programIdIndex === "number" ? entry.programIdIndex : null;
      const programId =
        typeof entry.programId === "string"
          ? entry.programId
          : index !== null && Number.isSafeInteger(index)
            ? (vector[index] ?? null)
            : typeof entry.program === "string"
              ? (labelled[entry.program] ?? null)
              : null;
      const parsed = typeof entry.parsed === "object" && entry.parsed !== null ? (entry.parsed as { type?: unknown; info?: unknown }) : null;
      const accounts = Array.isArray(entry.accounts)
        ? entry.accounts.map((account) => (typeof account === "string" ? account : typeof account === "number" || typeof account === "bigint" ? (vector[Number(account)] ?? "") : ""))
        : [];
      rows.push({
        programId,
        type: typeof parsed?.type === "string" ? parsed.type : null,
        info: typeof parsed?.info === "object" && parsed.info !== null ? (parsed.info as Record<string, unknown>) : null,
        accounts,
        data: typeof entry.data === "string" ? entry.data : null,
      });
    }
  }
  return rows;
}

/**
 * Whether a token instruction could hand someone else power over the person's
 * tokens without moving a balance — the one kind of theft a balance check
 * cannot see. `ownedBy` maps a token account to its owner from the simulation.
 */
function unsafeTokenRow(row: ParsedRow, owner: string, ownedBy: ReadonlyMap<string, string>): string | null {
  const mine = (account: unknown) => typeof account === "string" && (account === owner || ownedBy.get(account) === owner);
  if (row.type !== null && row.info) {
    const info = row.info;
    if (row.type === "approve" || row.type === "approveChecked") {
      if (mine(info.owner) || mine(info.multisigOwner) || mine(info.source)) return "approves a delegate over your tokens";
      return null;
    }
    if (row.type === "setAuthority") {
      if (mine(info.authority) || mine(info.multisigAuthority) || mine(info.account)) return "changes an authority over your tokens";
      return null;
    }
    if (row.type === "closeAccount") {
      if ((mine(info.owner) || mine(info.account)) && info.destination !== owner) return "closes your token account to someone else";
      return null;
    }
    return null;
  }
  /* Unparsed: read the discriminant and the accounts in the token program's own order. */
  if (!row.data) return "runs a token instruction this check cannot read";
  let discriminant: number | undefined;
  try {
    discriminant = getBase58Encoder().encode(row.data)[0];
  } catch {
    return "runs a token instruction this check cannot read";
  }
  const [first, second, third, fourth] = row.accounts;
  if (discriminant === 4 && (mine(first) || mine(third))) return "approves a delegate over your tokens";
  if (discriminant === 13 && (mine(first) || mine(fourth))) return "approves a delegate over your tokens";
  if (discriminant === 6 && (mine(first) || mine(second))) return "changes an authority over your tokens";
  if (discriminant === 9 && (mine(first) || mine(third)) && second !== owner) return "closes your token account to someone else";
  return null;
}

/**
 * Prove from the simulation of the exact bytes that the wallet loses only
 * what the Review states. `vector` is the transaction's full account list in
 * message order (static keys, then the lookup tables' writable and readonly
 * addresses); `accountStates` are the post-execution states of its writable
 * accounts, which must include the owner.
 */
export function assessCrossSwapOwnerEffects(args: Readonly<{
  owner: string;
  /** The input as a Solana mint; the native coin is `nativeInput: true`. */
  inputMint: string;
  nativeInput: boolean;
  amountInRaw: string;
  staticAccounts: readonly string[];
  simulation: CrossSwapSimulationMeta;
  accountStates: ReadonlyMap<string, SimulatedAccountState>;
  rent: RentParameters;
}>): CrossSwapEffectAssessment {
  const sim = args.simulation;
  if (!/^[1-9][0-9]*$/.test(args.amountInRaw)) return refuse("SIMULATION_METADATA_UNAVAILABLE", "The order's amount is unreadable.");
  const amountIn = BigInt(args.amountInRaw);
  if (!sim.loadedAddresses || !Array.isArray(sim.preBalances) || !Array.isArray(sim.postBalances) || !Array.isArray(sim.preTokenBalances) || !Array.isArray(sim.postTokenBalances) || !Array.isArray(sim.innerInstructions)) {
    return refuse("SIMULATION_METADATA_UNAVAILABLE", "The simulation did not report the balances and inner instructions this check needs, so the order is not offered.");
  }
  const fee = lamports(sim.fee ?? undefined);
  if (fee === null) return refuse("SIMULATION_METADATA_UNAVAILABLE", "The simulation did not report its network fee.");
  if (fee > MAYAN_SWIFT_MAX_NETWORK_FEE_LAMPORTS) return refuse("FEE_TOO_HIGH", `The order would pay ${fee} lamports in network fees, above the ${MAYAN_SWIFT_MAX_NETWORK_FEE_LAMPORTS} this lane accepts.`);

  const vector = [...args.staticAccounts, ...sim.loadedAddresses.writable.map(String), ...sim.loadedAddresses.readonly.map(String)];
  if (vector[0] !== args.owner || sim.preBalances.length !== vector.length || sim.postBalances.length !== vector.length) {
    return refuse("ACCOUNT_VECTOR_MISMATCH", "The simulation's account list does not match the transaction's, so its balances cannot be attributed.");
  }

  /* Token balances: who owns which account, and what the wallet's own accounts gained or lost per mint. */
  const ownedBy = new Map<string, string>();
  const deltas = new Map<string, bigint>();
  const seen = new Set<string>();
  for (const [rows, sign] of [[sim.preTokenBalances, -1n], [sim.postTokenBalances, 1n]] as const) {
    for (const row of rows) {
      const index = rowIndex(row.accountIndex, vector.length);
      const amount = row.uiTokenAmount?.amount;
      if (index === null || typeof row.mint !== "string" || typeof amount !== "string" || !/^[0-9]+$/.test(amount) || typeof row.owner !== "string" || row.owner.length === 0) {
        return refuse("TOKEN_METADATA_INVALID", "A token balance in the simulation is malformed or names no owner.");
      }
      const key = `${sign}:${index}`;
      if (seen.has(key)) return refuse("TOKEN_METADATA_INVALID", "The simulation reported one token account twice.");
      seen.add(key);
      const account = vector[index] as string;
      const known = ownedBy.get(account);
      if (known !== undefined && known !== row.owner) return refuse("TOKEN_METADATA_INVALID", "A token account changed owner during the simulation.");
      ownedBy.set(account, row.owner);
      if (row.owner === args.owner) deltas.set(row.mint, (deltas.get(row.mint) ?? 0n) + sign * BigInt(amount));
    }
  }
  for (const [mint, delta] of deltas) {
    if (delta >= 0n || mint === WRAPPED_SOL_MINT) continue;
    if (args.nativeInput || mint !== args.inputMint) return refuse("UNRELATED_TOKEN_LOSS", `The order would take ${mint} from your wallet, which this swap does not spend.`);
    if (-delta > amountIn) return refuse("INPUT_OVERSPENT", "The order would take more of the input token than the amount you entered.");
  }

  /* Accounts this transaction opens: only the order's own and ATAs, each at exactly the rent its size needs. */
  let rent = 0n;
  let created = 0;
  for (let index = 1; index < vector.length; index += 1) {
    const before = lamports(sim.preBalances[index]);
    const after = lamports(sim.postBalances[index]);
    if (before === null || after === null) return refuse("SIMULATION_METADATA_UNAVAILABLE", "A lamport balance in the simulation is unreadable.");
    if (before !== 0n || after === 0n) continue;
    const state = args.accountStates.get(vector[index] as string);
    if (!state) return refuse("RENT_UNPROVEN", "The order opens an account whose size the simulation did not report, so its rent cannot be proved.");
    if (!state.owner || !CREATED_ACCOUNT_OWNERS.has(state.owner)) {
      return refuse("UNEXPECTED_ACCOUNT_CREATED", `The order funds a new account owned by ${state.owner ?? "nobody"}, which is not part of a Swift order.`);
    }
    rent += rentExemptMinimumLamports(args.rent, state.space);
    created += 1;
  }
  if (rent > MAYAN_SWIFT_MAX_RENT_LAMPORTS) return refuse("RENT_UNPROVEN", `The order would lock ${rent} lamports in rent, above the ${MAYAN_SWIFT_MAX_RENT_LAMPORTS} a Swift order needs.`);

  /* SOL: the wallet's lamports plus the wSOL in its own token accounts, so a wrap and unwrap nets to nothing. */
  const ownerBefore = lamports(sim.preBalances[0]);
  const ownerAfter = lamports(sim.postBalances[0]);
  if (ownerBefore === null || ownerAfter === null) return refuse("SIMULATION_METADATA_UNAVAILABLE", "Your wallet's balance in the simulation is unreadable.");
  const solChange = ownerAfter - ownerBefore + (deltas.get(WRAPPED_SOL_MINT) ?? 0n);
  const solLoss = solChange < 0n ? -solChange : 0n;
  const allowed = fee + rent + (args.nativeInput ? amountIn : 0n);
  if (solLoss > allowed) {
    return refuse("SOL_OVERSPENT", `The order would take ${solLoss} lamports from your wallet; the amount, the network fee and the order's rent come to ${allowed}.`);
  }

  /* The wallet itself stays a plain System account: an `assign` or `allocate` moves no balance and hands over everything. */
  const wallet = args.accountStates.get(args.owner);
  if (!wallet) return refuse("SIMULATION_METADATA_UNAVAILABLE", "The simulation did not report your wallet's state after the order.");
  if (wallet.owner !== SYSTEM_PROGRAM_ID || wallet.space !== 0) return refuse("WALLET_MUTATED", "The order would change who controls your wallet; nothing was signed.");

  const rows = innerRows(sim.innerInstructions, vector);
  if (!rows) return refuse("SIMULATION_METADATA_UNAVAILABLE", "The simulation's inner instructions are malformed.");
  for (const row of rows) {
    if (!row.programId || !TOKEN_PROGRAMS.has(row.programId)) continue;
    const unsafe = unsafeTokenRow(row, args.owner, ownedBy);
    if (unsafe) return refuse("UNSAFE_TOKEN_MUTATION", `The order ${unsafe}; nothing was signed.`);
  }

  const inputLoss = args.nativeInput ? (solLoss > fee + rent ? solLoss - fee - rent : 0n) : -(deltas.get(args.inputMint) ?? 0n);
  return {
    ok: true,
    effects: {
      solLossLamports: solLoss.toString(),
      inputLossRaw: (inputLoss > 0n ? inputLoss : 0n).toString(),
      feeLamports: fee.toString(),
      rentLamports: rent.toString(),
      createdAccounts: created,
    },
  };
}
