/**
 * Fail-closed semantic firewall for provider-built Jupiter swap bytes.
 *
 * A program-id allowlist cannot prove what a transaction will do: an allowed
 * router can invoke other programs and the byte stream can name arbitrary
 * accounts. `simulateTransaction` exposes the complete pre/post lamport and
 * token-balance vectors for the exact v0 message. This module reduces that
 * metadata to the taker's net asset effects and accepts only the two reviewed
 * swap legs plus the exact simulated network fee.
 *
 * Rent is accepted only where the account it funds is PROVEN to be the
 * taker's own. Three shapes qualify and nothing else does: the temporary wSOL
 * account created, funded, synced and closed back to the taker inside this
 * same transaction; a durable associated token account whose payer and
 * wallet are both the taker and whose mint is one of the two reviewed legs;
 * and the same durable account for a mint the reviewed route passes through
 * between the legs, which must end the transaction empty and hold exactly the
 * network's rent-exempt minimum for its size — nothing kept, nothing but rent.
 * Buying a token you do not yet hold needs the second shape — refusing it
 * refused every first purchase of every asset — and the Associated Token
 * program itself derives the address from (wallet, token program, mint), so
 * an account created this way cannot belong to anyone but the signer. The
 * third is what a route through a Token-2022 hop needs: the venue passes the
 * hop through the signer's own account for that mint and leaves it open, and
 * refusing it refused every purchase whose only liquidity runs through
 * another token — every SpaceX xStock route the venue offered, the Owner's
 * $10 on 2026-09-24.
 */

import { getBase58Encoder } from "@solana/kit";
import { z } from "zod";

import { rentExemptMinimumLamports, type RentParameters, type SimulatedAccountState } from "./rent.ts";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, WRAPPED_SOL_MINT } from "./send-kinds.ts";

const RAW_AMOUNT = /^(0|[1-9][0-9]{0,39})$/;
const SIGNED_RAW_AMOUNT = /^(0|-?[1-9][0-9]{0,39})$/;
/* Both token programs, by the ids the rest of the kernel uses. The second was
   a mistyped Token-2022 id (`…PHn5qbeANZtY2g` for `…PHnBqCXEpPxuEb`), so no
   Token-2022 account ever counted as opened for the taker: every purchase of
   a tokenized stock — xStocks, PreStocks, the Backpack tokens are all
   Token-2022 — was refused as `RENT_UNSUPPORTED` the moment the ticket
   offered one (the Owner, NVDAx, 2026-09-12). */
const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const ALLOWED_PARSED_TOKEN_INSTRUCTIONS = new Set([
  "transfer",
  "transferChecked",
  "initializeAccount",
  "initializeAccount2",
  "initializeAccount3",
  "initializeImmutableOwner",
  "syncNative",
  "getAccountDataSize",
]);
const ALLOWED_BINARY_TOKEN_DISCRIMINANTS = new Set([1, 3, 12, 16, 17, 18, 21, 22]);
const CREATED_ACCOUNT_PARSED_INSTRUCTIONS = new Set([
  "initializeAccount",
  "initializeAccount2",
  "initializeAccount3",
  "initializeImmutableOwner",
  "syncNative",
]);
const ATA_CREATE_TYPES = new Set(["create", "createIdempotent"]);
const CREATED_ACCOUNT_BINARY_DISCRIMINANTS = new Set([1, 16, 17, 18, 22]);

export const SwapOwnerEffectProofSchema = z
  .object({
    status: z.literal("VERIFIED"),
    method: z.literal("SIMULATION_OWNER_DELTAS_V1"),
    tokenInstructionAudit: z.literal("NO_UNSAFE_MUTATIONS"),
    nativeWrapRoundTrip: z.boolean(),
    programs: z.array(z.string().min(32).max(44)).min(1).max(64),
    taker: z.string().min(32).max(44),
    inputMint: z.string().min(32).max(44),
    outputMint: z.string().min(32).max(44),
    inputAmountRaw: z.string().regex(RAW_AMOUNT),
    outputAmountRaw: z.string().regex(RAW_AMOUNT),
    minimumOutputRaw: z.string().regex(RAW_AMOUNT),
    inputRepresentation: z.enum(["TOKEN", "NATIVE_SOL"]),
    outputRepresentation: z.enum(["TOKEN", "NATIVE_SOL"]),
    feeLamports: z.string().regex(RAW_AMOUNT),
    takerLamportDelta: z.string().regex(SIGNED_RAW_AMOUNT),
    ownerTokenDeltas: z
      .array(
        z
          .object({
            mint: z.string().min(32).max(44),
            rawDelta: z.string().regex(SIGNED_RAW_AMOUNT),
          })
          .strict(),
      )
      .max(32),
    accountVectorCount: z.number().int().min(1).max(256),
    /**
     * The rent that stays in accounts this transaction opened for the taker,
     * measured from the balance vectors, and how it was proved: `EXACT_MINIMUM`
     * when every such account was shown to hold precisely the network's
     * rent-exempt minimum for its size; `REVIEWED_CEILING` when the venue's
     * estimate bounded it instead; `NONE` when nothing durable was opened.
     * Optional so a Review issued a minute before this field existed still
     * parses.
     */
    durableRentLamports: z.string().regex(RAW_AMOUNT).optional(),
    rentProof: z.enum(["EXACT_MINIMUM", "REVIEWED_CEILING", "NONE"]).optional(),
  })
  .strict();

export type SwapOwnerEffectProof = z.output<typeof SwapOwnerEffectProofSchema>;

type TokenBalanceEntry = Readonly<{
  accountIndex: number | bigint;
  mint: string;
  owner?: string;
  uiTokenAmount?: Readonly<{ amount?: string }>;
}>;

type SwapSimulationMeta = Readonly<{
  fee: bigint | number | null;
  loadedAddresses: Readonly<{
    writable: readonly unknown[];
    readonly: readonly unknown[];
  }> | null;
  preBalances: readonly (bigint | number)[] | null;
  postBalances: readonly (bigint | number)[] | null;
  preTokenBalances: readonly TokenBalanceEntry[] | null;
  postTokenBalances: readonly TokenBalanceEntry[] | null;
  innerInstructions: readonly unknown[] | null;
}>;

type SwapOrderEffectContract = Readonly<{
  taker: string;
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  minReceivedRaw: string;
  signatureFeeLamports: string;
  signatureFeePayer: string | null;
  priorityFeeLamports: string;
  priorityFeePayer: string | null;
  rentFeeLamports: string;
  rentFeePayer: string | null;
  gasless: boolean;
  /**
   * The reviewed route's hops. A mint a hop names, other than the two legs,
   * is the only other mint an account opened for the taker may be for — and
   * only as the third rent shape in the module note. Absent, nothing but the
   * two legs is accepted.
   */
  route?: readonly Readonly<{ inputMint: string; outputMint: string }>[];
}>;

export type SwapEffectRefusalCode =
  | "CONTRACT_UNREADABLE"
  | "PAIR_UNSUPPORTED"
  | "GASLESS_UNSUPPORTED"
  | "FEE_PAYER_MISMATCH"
  | "FEE_MISMATCH"
  | "RENT_UNSUPPORTED"
  | "SIMULATION_METADATA_UNAVAILABLE"
  | "ACCOUNT_VECTOR_MISMATCH"
  | "TOKEN_METADATA_UNAVAILABLE"
  | "TOKEN_METADATA_INVALID"
  | "TOKEN_OWNER_UNRESOLVED"
  | "UNSAFE_TOKEN_MUTATION"
  | "UNSAFE_ACCOUNT_MUTATION"
  | "UNRESOLVED_INNER_PROGRAM"
  | "UNRELATED_TOKEN_DELTA"
  | "INPUT_DELTA_MISMATCH"
  | "OUTPUT_DELTA_MISMATCH"
  | "NATIVE_DELTA_MISMATCH";

export type SwapEffectAssessment =
  | Readonly<{ ok: true; proof: SwapOwnerEffectProof }>
  | Readonly<{ ok: false; code: SwapEffectRefusalCode; reason: string }>;

function refusal(code: SwapEffectRefusalCode, reason: string): SwapEffectAssessment {
  return { ok: false, code, reason };
}

function raw(value: string): bigint | null {
  return RAW_AMOUNT.test(value) ? BigInt(value) : null;
}

function chainInteger(value: bigint | number): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
}

function safeIndex(value: number | bigint, upperBound: number): number | null {
  const index = typeof value === "bigint" ? Number(value) : value;
  return Number.isSafeInteger(index) && index >= 0 && index < upperBound ? index : null;
}

type NormalizedTokenBalance = Readonly<{
  accountIndex: number;
  mint: string;
  owner: string | null;
  amount: bigint;
}>;

function normalizeTokenBalances(
  entries: readonly TokenBalanceEntry[],
  accountCount: number,
): Readonly<{ ok: true; entries: Map<string, NormalizedTokenBalance> }> | Readonly<{ ok: false; reason: string }> {
  const normalized = new Map<string, NormalizedTokenBalance>();
  for (const entry of entries) {
    const accountIndex = safeIndex(entry.accountIndex, accountCount);
    const amount = typeof entry.uiTokenAmount?.amount === "string" ? raw(entry.uiTokenAmount.amount) : null;
    if (accountIndex === null || amount === null || typeof entry.mint !== "string" || entry.mint.length < 32) {
      return { ok: false, reason: "A token-balance row is malformed or names an account outside the transaction vector." };
    }
    const key = `${accountIndex}:${entry.mint}`;
    if (normalized.has(key)) {
      return { ok: false, reason: "The simulation returned duplicate token-balance rows for one account and mint." };
    }
    normalized.set(key, {
      accountIndex,
      mint: entry.mint,
      owner: typeof entry.owner === "string" && entry.owner.length > 0 ? entry.owner : null,
      amount,
    });
  }
  return { ok: true, entries: normalized };
}

function ownerTokenDeltas(args: {
  pre: readonly TokenBalanceEntry[];
  post: readonly TokenBalanceEntry[];
  accountCount: number;
  taker: string;
}):
  | Readonly<{ ok: true; deltas: Map<string, bigint> }>
  | Readonly<{ ok: false; code: "TOKEN_METADATA_INVALID" | "TOKEN_OWNER_UNRESOLVED"; reason: string }> {
  const before = normalizeTokenBalances(args.pre, args.accountCount);
  if (!before.ok) return { ok: false, code: "TOKEN_METADATA_INVALID", reason: before.reason };
  const after = normalizeTokenBalances(args.post, args.accountCount);
  if (!after.ok) return { ok: false, code: "TOKEN_METADATA_INVALID", reason: after.reason };

  const deltas = new Map<string, bigint>();
  for (const key of new Set([...before.entries.keys(), ...after.entries.keys()])) {
    const pre = before.entries.get(key);
    const post = after.entries.get(key);
    const sample = post ?? pre;
    if (!sample) continue;
    const delta = (post?.amount ?? 0n) - (pre?.amount ?? 0n);
    if (delta === 0n) continue;

    if ((pre && !pre.owner) || (post && !post.owner)) {
      return {
        ok: false,
        code: "TOKEN_OWNER_UNRESOLVED",
        reason: `A changed ${sample.mint} balance omits its owner on one side of the simulation.`,
      };
    }
    if (pre?.owner && post?.owner && pre.owner !== post.owner) {
      return {
        ok: false,
        code: "TOKEN_OWNER_UNRESOLVED",
        reason: `Token account ${sample.accountIndex} changed owner during simulation; its effect cannot be attributed safely.`,
      };
    }
    const owner = post?.owner ?? pre?.owner ?? null;
    if (!owner) {
      return {
        ok: false,
        code: "TOKEN_OWNER_UNRESOLVED",
        reason: `A changed ${sample.mint} balance has no owner in simulation metadata.`,
      };
    }
    if (owner !== args.taker) continue;
    deltas.set(sample.mint, (deltas.get(sample.mint) ?? 0n) + delta);
  }
  return { ok: true, deltas };
}

function tokenAccountOwners(args: {
  pre: readonly TokenBalanceEntry[];
  post: readonly TokenBalanceEntry[];
  accountAddresses: readonly string[];
}): Map<string, string> {
  const owners = new Map<string, string>();
  const conflicted = new Set<string>();
  for (const entry of [...args.pre, ...args.post]) {
    const index = safeIndex(entry.accountIndex, args.accountAddresses.length);
    const address = index === null ? null : args.accountAddresses[index] ?? null;
    if (!address || typeof entry.owner !== "string" || entry.owner.length === 0) continue;
    const existing = owners.get(address);
    if (existing && existing !== entry.owner) {
      owners.delete(address);
      conflicted.add(address);
    } else if (!conflicted.has(address)) {
      owners.set(address, entry.owner);
    }
  }
  return owners;
}

const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

type ParsedInnerRow = Readonly<{
  program: unknown;
  programId: unknown;
  type: unknown;
  info: Record<string, unknown>;
}>;

function parsedInnerRows(groups: readonly unknown[]): readonly ParsedInnerRow[] {
  const rows: ParsedInnerRow[] = [];
  for (const group of groups) {
    if (typeof group !== "object" || group === null) continue;
    const instructions = (group as { instructions?: unknown }).instructions;
    if (!Array.isArray(instructions)) continue;
    for (const candidate of instructions) {
      if (typeof candidate !== "object" || candidate === null) continue;
      const instruction = candidate as Record<string, unknown>;
      const parsed = instruction.parsed;
      if (typeof parsed !== "object" || parsed === null) continue;
      const info = (parsed as { info?: unknown }).info;
      if (typeof info !== "object" || info === null) continue;
      rows.push({
        program: instruction.program,
        programId: instruction.programId,
        type: (parsed as { type?: unknown }).type,
        info: info as Record<string, unknown>,
      });
    }
  }
  return rows;
}

function isTokenRow(row: ParsedInnerRow): boolean {
  return row.program === "spl-token" || row.program === "spl-token-2022" || TOKEN_PROGRAMS.has(String(row.programId));
}

const INITIALIZE_ACCOUNT_TYPES = new Set(["initializeAccount", "initializeAccount2", "initializeAccount3"]);

/**
 * Every token account this transaction PROVES it creates for the taker.
 *
 * Two independent shapes are accepted, and each one names the taker twice.
 * The Associated Token shape carries `source` (who pays) and `wallet` (who
 * owns), and the program derives the address from the wallet, the token
 * program and the mint — so a row naming the taker in both fields cannot
 * describe anyone else's account. The raw shape is System `createAccount`
 * from the taker into a token program followed by an `initializeAccount*`
 * naming the taker as owner. Either way the mint must be one of the two legs
 * under review, so a router cannot open the taker an account in a third asset.
 *
 * An account that is also closed back to the taker in the same transaction is
 * `temporary` — its rent returns. One that is not is `durable`: the signer
 * keeps both the account and its rent, which is what buying an asset for the
 * first time actually costs.
 */
function findInnerTakerAccountLifecycles(args: {
  groups: readonly unknown[];
  taker: string;
  mints: ReadonlySet<string>;
  /** An account the message itself closes back to the taker, if any. */
  closedByMessage?: string | null;
}): Readonly<{
  temporary: ReadonlySet<string>;
  durable: ReadonlyMap<string, string>;
  wsolAccount: string | null;
}> {
  const rows = parsedInnerRows(args.groups);
  const initializerFor = (account: string): ParsedInnerRow | undefined =>
    rows.find(
      (row) =>
        isTokenRow(row) &&
        typeof row.type === "string" &&
        INITIALIZE_ACCOUNT_TYPES.has(row.type) &&
        row.info.account === account &&
        row.info.owner === args.taker,
    );

  const created = new Map<string, string>();
  for (const row of rows) {
    const isAta = row.program === "spl-associated-token-account" || row.programId === ASSOCIATED_TOKEN_PROGRAM;
    if (!isAta || typeof row.type !== "string" || !ATA_CREATE_TYPES.has(row.type)) continue;
    const account = typeof row.info.account === "string" ? row.info.account : null;
    if (
      !account ||
      row.info.source !== args.taker ||
      row.info.wallet !== args.taker ||
      row.info.systemProgram !== SYSTEM_PROGRAM ||
      !TOKEN_PROGRAMS.has(String(row.info.tokenProgram))
    ) {
      continue;
    }
    const initialized = initializerFor(account);
    const mint =
      typeof row.info.mint === "string"
        ? row.info.mint
        : typeof initialized?.info.mint === "string"
          ? initialized.info.mint
          : null;
    if (!initialized || !mint || !args.mints.has(mint)) continue;
    created.set(account, mint);
  }
  for (const row of rows) {
    const isSystem = row.program === "system" || row.programId === SYSTEM_PROGRAM;
    if (!isSystem || row.type !== "createAccount") continue;
    const account = typeof row.info.newAccount === "string" ? row.info.newAccount : null;
    if (!account || row.info.source !== args.taker || !TOKEN_PROGRAMS.has(String(row.info.owner))) continue;
    const initialized = initializerFor(account);
    const mint = typeof initialized?.info.mint === "string" ? initialized.info.mint : null;
    if (!initialized || !mint || !args.mints.has(mint)) continue;
    created.set(account, mint);
  }

  const temporary = new Set<string>();
  if (args.closedByMessage && created.has(args.closedByMessage)) temporary.add(args.closedByMessage);
  for (const row of rows) {
    if (!isTokenRow(row) || row.type !== "closeAccount") continue;
    const account = typeof row.info.account === "string" ? row.info.account : null;
    if (!account || !created.has(account) || row.info.destination !== args.taker || row.info.owner !== args.taker) continue;
    temporary.add(account);
  }
  const durable = new Map([...created].filter(([account]) => !temporary.has(account)));

  let wsolAccount: string | null = null;
  let ambiguous = false;
  for (const account of temporary) {
    if (created.get(account) !== WRAPPED_SOL_MINT) continue;
    const synced = rows.some((row) => isTokenRow(row) && row.type === "syncNative" && row.info.account === account);
    if (!synced) continue;
    if (wsolAccount !== null) ambiguous = true;
    wsolAccount = account;
  }
  return { temporary, durable, wsolAccount: ambiguous ? null : wsolAccount };
}

function unsafeTokenMutation(
  groups: readonly unknown[],
  tokenProgramIndices: ReadonlySet<number>,
  allowedCreatedAccounts: ReadonlySet<string>,
  allowedInnerWsolAccount: string | null,
  accountAddresses: readonly string[],
  tokenAccountOwners: ReadonlyMap<string, string>,
  taker: string,
  /** The two legs and the mints the reviewed route passes through. */
  accountMints: ReadonlySet<string>,
): string | null {
  for (const group of groups) {
    if (typeof group !== "object" || group === null) return "The inner-instruction group is malformed.";
    const instructions = (group as { instructions?: unknown }).instructions;
    if (!Array.isArray(instructions)) return "The inner-instruction group has no bounded instruction list.";
    for (const candidate of instructions) {
      if (typeof candidate !== "object" || candidate === null) return "An inner instruction is malformed.";
      const instruction = candidate as Record<string, unknown>;
      const programId = typeof instruction.programId === "string" ? instruction.programId : null;
      const program = typeof instruction.program === "string" ? instruction.program : null;
      const rawProgramIndex = instruction.programIdIndex;
      const programIndex =
        typeof rawProgramIndex === "bigint"
          ? Number(rawProgramIndex)
          : typeof rawProgramIndex === "number"
            ? rawProgramIndex
            : null;
      const resolvedProgramId =
        programId ??
        (programIndex !== null && Number.isSafeInteger(programIndex)
          ? accountAddresses[programIndex] ?? null
          : null);
      const isSystem = program === "system" || resolvedProgramId === SYSTEM_PROGRAM;
      const isAssociatedToken =
        program === "spl-associated-token-account" ||
        resolvedProgramId === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
      if (isSystem) {
        const parsed = instruction.parsed;
        const type = typeof parsed === "object" && parsed !== null ? (parsed as { type?: unknown }).type : null;
        const info = typeof parsed === "object" && parsed !== null ? (parsed as { info?: unknown }).info : null;
        const row = typeof info === "object" && info !== null ? (info as Record<string, unknown>) : null;
        if (
          type === "createAccount" &&
          typeof row?.newAccount === "string" &&
          allowedCreatedAccounts.has(row.newAccount) &&
          row?.source === taker &&
          TOKEN_PROGRAMS.has(String(row.owner))
        ) {
          continue;
        }
        if (
          type === "transfer" &&
          row?.source === taker &&
          typeof row.destination === "string" &&
          allowedCreatedAccounts.has(row.destination)
        ) {
          continue;
        }
        return `ACCOUNT:The exact simulation invokes disallowed inner System instruction ${typeof type === "string" ? type : "UNPARSED"}.`;
      }
      if (isAssociatedToken) {
        const parsed = instruction.parsed;
        const type = typeof parsed === "object" && parsed !== null ? (parsed as { type?: unknown }).type : null;
        const info = typeof parsed === "object" && parsed !== null ? (parsed as { info?: unknown }).info : null;
        const row = typeof info === "object" && info !== null ? (info as Record<string, unknown>) : null;
        if (
          typeof type === "string" &&
          ATA_CREATE_TYPES.has(type) &&
          typeof row?.account === "string" &&
          allowedCreatedAccounts.has(row.account) &&
          row.source === taker &&
          row.wallet === taker &&
          row.systemProgram === SYSTEM_PROGRAM &&
          TOKEN_PROGRAMS.has(String(row.tokenProgram))
        ) {
          continue;
        }
        return "ACCOUNT:The exact simulation invokes an inner Associated Token instruction outside a proved taker-owned account creation.";
      }
      const isToken =
        (resolvedProgramId !== null && TOKEN_PROGRAMS.has(resolvedProgramId)) ||
        program === "spl-token" ||
        program === "spl-token-2022" ||
        (programIndex !== null && Number.isSafeInteger(programIndex) && tokenProgramIndices.has(programIndex));
      if (!isToken) continue;

      const parsed = instruction.parsed;
      if (typeof parsed === "object" && parsed !== null) {
        const type = (parsed as { type?: unknown }).type;
        const info = (parsed as { info?: unknown }).info;
        const row = typeof info === "object" && info !== null ? (info as Record<string, unknown>) : null;
        if (type === "closeAccount") {
          /* Lamports out of a closed account go to its named destination, and
             the Token program only runs the close for the named authority. A
             close naming the taker as both cannot cost the taker anything,
             whether or not this transaction opened the account. */
          if (typeof row?.account === "string" && row.destination === taker && row.owner === taker) continue;
          return "The exact simulation closes a token account without returning it to the taker under the taker's own authority.";
        }
        if (typeof type === "string" && CREATED_ACCOUNT_PARSED_INSTRUCTIONS.has(type)) {
          const account = typeof row?.account === "string" ? row.account : null;
          const valid =
            account !== null &&
            (type === "syncNative"
              ? account === allowedInnerWsolAccount
              : allowedCreatedAccounts.has(account));
          if (valid) continue;
          return `The exact simulation invokes ${type} outside a proved taker-owned account created here.`;
        }
        if (type === "getAccountDataSize" && (typeof row?.mint !== "string" || !accountMints.has(row.mint))) {
          return "The exact simulation queries token account size for a mint outside the two reviewed legs and the reviewed route.";
        }
        if (typeof type === "string" && ALLOWED_PARSED_TOKEN_INSTRUCTIONS.has(type)) {
          continue;
        }
        const target =
          typeof row?.account === "string"
            ? row.account
            : typeof row?.source === "string"
              ? row.source
              : null;
        const owner = target ? tokenAccountOwners.get(target) : null;
        if (owner && owner !== taker) continue;
        return `The exact simulation invokes ${typeof type === "string" ? type : "UNKNOWN"} on ${owner === taker ? "a taker-owned" : "an unresolved"} token account.`;
      }

      const data = instruction.data;
      if (typeof data !== "string" || data.length === 0 || data.length > 2_048) {
        return "A token instruction has no readable bounded data payload.";
      }
      try {
        const decoded = getBase58Encoder().encode(data);
        const accounts = instruction.accounts;
        const first = Array.isArray(accounts) ? accounts[0] : null;
        const target =
          typeof first === "string"
            ? first
            : typeof first === "number" && Number.isSafeInteger(first)
              ? accountAddresses[first] ?? null
              : typeof first === "bigint" && first <= BigInt(Number.MAX_SAFE_INTEGER)
                ? accountAddresses[Number(first)] ?? null
                : null;
        if (decoded.length > 0 && CREATED_ACCOUNT_BINARY_DISCRIMINANTS.has(decoded[0])) {
          const valid =
            target !== null &&
            (decoded[0] === 17
              ? target === allowedInnerWsolAccount
              : allowedCreatedAccounts.has(target));
          if (valid) continue;
          return `The exact simulation invokes token discriminant ${decoded[0]} outside a proved taker-owned account created here.`;
        }
        if (decoded.length > 0 && ALLOWED_BINARY_TOKEN_DISCRIMINANTS.has(decoded[0])) continue;
        const owner = target ? tokenAccountOwners.get(target) : null;
        if (owner && owner !== taker) continue;
        return `The exact simulation invokes token discriminant ${decoded[0] ?? "UNKNOWN"} on ${owner === taker ? "a taker-owned" : "an unresolved"} token account.`;
      } catch {
        return "A token instruction payload is not canonical base58.";
      }
    }
  }
    return null;
}

function resolveInnerPrograms(
  groups: readonly unknown[],
  accountAddresses: readonly string[],
): Readonly<{ ok: true; programs: readonly string[] }> | Readonly<{ ok: false; reason: string }> {
  const programs = new Set<string>();
  const labelled: Record<string, string> = {
    system: SYSTEM_PROGRAM,
    "spl-token": TOKEN_PROGRAM_ID,
    "spl-token-2022": TOKEN_2022_PROGRAM_ID,
    "spl-associated-token-account": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  };
  for (const group of groups) {
    if (typeof group !== "object" || group === null) return { ok: false, reason: "An inner-instruction group is malformed." };
    const instructions = (group as { instructions?: unknown }).instructions;
    if (!Array.isArray(instructions)) return { ok: false, reason: "An inner-instruction group has no instruction list." };
    for (const candidate of instructions) {
      if (typeof candidate !== "object" || candidate === null) return { ok: false, reason: "An inner instruction is malformed." };
      const instruction = candidate as Record<string, unknown>;
      const rawIndex = instruction.programIdIndex;
      const index =
        typeof rawIndex === "bigint"
          ? Number(rawIndex)
          : typeof rawIndex === "number"
            ? rawIndex
            : null;
      const program =
        typeof instruction.programId === "string"
          ? instruction.programId
          : index !== null && Number.isSafeInteger(index)
            ? accountAddresses[index] ?? null
            : typeof instruction.program === "string"
              ? labelled[instruction.program] ?? null
              : null;
      if (!program || program.length < 32 || program.length > 44) {
        return { ok: false, reason: "An inner instruction's program id cannot be resolved against the full account vector." };
      }
      programs.add(program);
    }
  }
  return { ok: true, programs: [...programs].sort() };
}

/**
 * Prove the exact taker-side effect set of a successful simulation.
 *
 * This function never infers effects from Jupiter prose or program ids. The
 * provider contract supplies the expected values; the RPC's pre/post vectors
 * must independently reproduce them exactly.
 */
export function assessSwapSimulationEffects(args: Readonly<{
  order: SwapOrderEffectContract;
  staticAccountCount: number;
  staticAccounts: readonly string[];
  topLevelPrograms: readonly string[];
  /* `account` is null when the pre-sign firewall found the address only
     through a lookup table. It is named here from the simulation's own
     account vector, which resolves every loaded address in message order. */
  nativeWrapRoundTrip?: Readonly<{
    accountIndex: number;
    account: string | null;
    fundedLamportsRaw: string;
    closesToTaker: true;
  }> | null;
  nativeWrapCandidate?: Readonly<{
    accountIndex: number;
    account: string | null;
    fundedLamportsRaw: string;
  }> | null;
  tokenProgramIndices?: readonly number[];
  simulation: SwapSimulationMeta;
  /**
   * The simulation's own post-execution states for the accounts it was asked
   * about, keyed by address, with the live Rent parameters. Together they let
   * an account opened for the taker be proved to hold exactly its rent-exempt
   * minimum — the chain's figure for its actual size — instead of being
   * bounded by the venue's estimate, which is a plain 165-byte account's rent
   * and falls short of every Token-2022 account with extensions. Without
   * them the estimate stays the ceiling.
   */
  accountStates?: ReadonlyMap<string, SimulatedAccountState> | null;
  rent?: RentParameters | null;
}>): SwapEffectAssessment {
  const inputAmount = raw(args.order.inAmountRaw);
  const outputAmount = raw(args.order.outAmountRaw);
  const minimumOutput = raw(args.order.minReceivedRaw);
  const signatureFee = raw(args.order.signatureFeeLamports);
  const priorityFee = raw(args.order.priorityFeeLamports);
  const rentFee = raw(args.order.rentFeeLamports);
  if (
    inputAmount === null ||
    inputAmount <= 0n ||
    outputAmount === null ||
    outputAmount <= 0n ||
    minimumOutput === null ||
    minimumOutput <= 0n ||
    signatureFee === null ||
    priorityFee === null ||
    rentFee === null
  ) {
    return refusal("CONTRACT_UNREADABLE", "The reviewed order carries an unreadable amount or fee.");
  }
  if (!Array.isArray(args.simulation.innerInstructions)) {
    return refusal(
      "SIMULATION_METADATA_UNAVAILABLE",
      "The simulation omitted inner instructions, so zero-delta token authority mutations cannot be excluded.",
    );
  }
  const reviewedMints = new Set([args.order.inputMint, args.order.outputMint]);
  /* The mints the reviewed route passes through between the two legs. An
     account opened for one of them is the third rent shape and nothing more:
     it must end empty and hold exactly its rent-exempt minimum (below). */
  const hopMints = new Set<string>();
  for (const hop of args.order.route ?? []) {
    for (const mint of [hop.inputMint, hop.outputMint]) {
      if (!reviewedMints.has(mint)) hopMints.add(mint);
    }
  }
  const accountMints = new Set([...reviewedMints, ...hopMints]);
  const topLevelWrap = args.nativeWrapRoundTrip ?? null;
  /* The message may resolve the wrap account through a lookup table, so its
     address is named from the simulation's own vector: static keys first, then
     loaded writable, then loaded readonly — exactly how a v0 message indexes
     its accounts. The vector's own bounds are validated further down. */
  const resolvedAddresses = [
    ...args.staticAccounts,
    ...(args.simulation.loadedAddresses?.writable ?? []).map(String),
    ...(args.simulation.loadedAddresses?.readonly ?? []).map(String),
  ];
  const wrapAccount = topLevelWrap
    ? topLevelWrap.account ?? resolvedAddresses[topLevelWrap.accountIndex] ?? null
    : null;
  const lifecycles = findInnerTakerAccountLifecycles({
    groups: args.simulation.innerInstructions,
    taker: args.order.taker,
    mints: accountMints,
    /* The close is often a top-level instruction rather than a CPI. Without
       this, an account opened and closed in the same transaction looked
       permanent, and every purchase of native SOL was refused for rent it
       never actually paid. */
    closedByMessage: wrapAccount,
  });
  if (outputAmount < minimumOutput) {
    return refusal("OUTPUT_DELTA_MISMATCH", "The provider's quoted output is below its own minimum output constraint.");
  }

  if (reviewedMints.size !== 2) {
    return refusal("PAIR_UNSUPPORTED", "A swap needs two distinct mints; this order names one.");
  }
  if (args.order.gasless) {
    return refusal("GASLESS_UNSUPPORTED", "The owner-effect proof does not accept a gasless fee-payer path.");
  }
  for (const payer of [args.order.signatureFeePayer, args.order.priorityFeePayer]) {
    if (payer !== null && payer !== args.order.taker) {
      return refusal("FEE_PAYER_MISMATCH", "A provider fee names a payer other than the reviewed taker.");
    }
  }
  const topLevelCandidate = args.nativeWrapCandidate ?? null;
  const hasWrap = topLevelWrap !== null || lifecycles.wsolAccount !== null;
  /* Accounts this transaction OPENS for the taker, which is not the same set
     as the accounts it closes: Jupiter reuses a wallet's existing wSOL account
     when it has one, and that costs no rent because nothing was opened. */
  const openedForTaker = new Set<string>([...lifecycles.temporary, ...lifecycles.durable.keys()]);
  if (topLevelCandidate !== null) {
    return refusal(
      "RENT_UNSUPPORTED",
      "The transaction wraps SOL into an account it never closes back to the taker.",
    );
  }
  /* Whatever the rent says, wrapping funds exactly the input leg or nothing. */
  if (topLevelWrap !== null) {
    const funded = raw(topLevelWrap.fundedLamportsRaw);
    const expectedFunding = args.order.inputMint === WRAPPED_SOL_MINT ? inputAmount : 0n;
    if (!topLevelWrap.closesToTaker || funded !== expectedFunding) {
      return refusal(
        "RENT_UNSUPPORTED",
        "The temporary wSOL account was funded with something other than the reviewed input leg.",
      );
    }
  }
  if (rentFee > 0n) {
    if (openedForTaker.size === 0 || args.order.rentFeePayer !== args.order.taker) {
      return refusal(
        "RENT_UNSUPPORTED",
        "Rent does not open an account this transaction proves the taker both pays for and owns.",
      );
    }
  } else if (args.order.rentFeePayer !== null && args.order.rentFeePayer !== args.order.taker) {
    return refusal(
      "RENT_UNSUPPORTED",
      "The transaction names a foreign rent payer while quoting no rent at all.",
    );
  }
  /* An account opened and closed again inside the same transaction costs no
     rent — it is returned by the close — and the venue is right to quote
     zero for it. Buying native SOL is exactly that shape, and refusing it
     here refused every purchase of SOL. An account that STAYS open is a
     real, permanent cost; quoting zero for one is unexplained unless the
     chain itself proves below what the account holds, in which case the
     Review is corrected to the chain's figure rather than refused. */
  const unquotedDurable = rentFee === 0n && lifecycles.durable.size > 0;

  const fee = args.simulation.fee === null ? null : chainInteger(args.simulation.fee);
  if (fee === null) {
    return refusal("SIMULATION_METADATA_UNAVAILABLE", "The successful simulation returned no readable network fee.");
  }
  if (fee !== signatureFee + priorityFee) {
    return refusal(
      "FEE_MISMATCH",
      "The simulated network fee does not equal the reviewed signature and priority fee fields.",
    );
  }

  if (
    !Number.isSafeInteger(args.staticAccountCount) ||
    args.staticAccountCount < 1 ||
    args.staticAccounts.length !== args.staticAccountCount ||
    !args.simulation.loadedAddresses ||
    !args.simulation.preBalances ||
    !args.simulation.postBalances
  ) {
    return refusal(
      "SIMULATION_METADATA_UNAVAILABLE",
      "The simulation omitted its static/loaded account or lamport-balance metadata.",
    );
  }
  const accountCount =
    args.staticAccountCount +
    args.simulation.loadedAddresses.writable.length +
    args.simulation.loadedAddresses.readonly.length;
  if (
    accountCount > 256 ||
    args.simulation.preBalances.length !== accountCount ||
    args.simulation.postBalances.length !== accountCount
  ) {
    return refusal(
      "ACCOUNT_VECTOR_MISMATCH",
      "The simulation's pre/post lamport vectors do not cover every static and loaded transaction account.",
    );
  }
  const accountAddresses = [
    ...args.staticAccounts,
    ...args.simulation.loadedAddresses.writable.map(String),
    ...args.simulation.loadedAddresses.readonly.map(String),
  ];
  if (accountAddresses.length !== accountCount) {
    return refusal("ACCOUNT_VECTOR_MISMATCH", "The resolved transaction address vector does not match the balance vectors.");
  }
  const innerPrograms = resolveInnerPrograms(args.simulation.innerInstructions, accountAddresses);
  if (!innerPrograms.ok) return refusal("UNRESOLVED_INNER_PROGRAM", innerPrograms.reason);
  const allPrograms = [...new Set([...args.topLevelPrograms, ...innerPrograms.programs])].sort();
  if (allPrograms.length === 0 || allPrograms.length > 64) {
    return refusal("UNRESOLVED_INNER_PROGRAM", "The complete invoked-program set is empty or outside its bound.");
  }
  const takerPre = chainInteger(args.simulation.preBalances[0]);
  const takerPost = chainInteger(args.simulation.postBalances[0]);
  if (takerPre === null || takerPost === null) {
    return refusal("SIMULATION_METADATA_UNAVAILABLE", "The taker's simulated lamport balance is unreadable.");
  }
  /*
   * The closed account must end absent. It need not have BEGUN absent: a
   * wallet that already owns a wSOL account has rent sitting in it, and
   * demanding a zero opening balance refused every swap by such a wallet.
   * What the close returns is the taker's own money either way, and the
   * lamport floor below is what proves nothing left them.
   */
  if (topLevelWrap) {
    const post = args.simulation.postBalances[topLevelWrap.accountIndex];
    if (post === undefined || chainInteger(post) !== 0n) {
      return refusal(
        "RENT_UNSUPPORTED",
        "The closed wSOL account did not end absent in the exact simulation.",
      );
    }
  }
  const provenCreated = new Set<string>([...openedForTaker, ...(wrapAccount ? [wrapAccount] : [])]);

  if (!args.simulation.preTokenBalances || !args.simulation.postTokenBalances) {
    return refusal(
      "TOKEN_METADATA_UNAVAILABLE",
      "The simulation omitted pre/post token balances, so owner token effects cannot be proven.",
    );
  }
  const tokenEffects = ownerTokenDeltas({
    pre: args.simulation.preTokenBalances,
    post: args.simulation.postTokenBalances,
    accountCount,
    taker: args.order.taker,
  });
  if (!tokenEffects.ok) return refusal(tokenEffects.code, tokenEffects.reason);
  const unsafeMutation = unsafeTokenMutation(
    args.simulation.innerInstructions,
    new Set(args.tokenProgramIndices ?? []),
    provenCreated,
    lifecycles.wsolAccount ?? wrapAccount,
    accountAddresses,
    tokenAccountOwners({
      pre: args.simulation.preTokenBalances,
      post: args.simulation.postTokenBalances,
      accountAddresses,
    }),
    args.order.taker,
    accountMints,
  );
  if (unsafeMutation) {
    const accountMutation = unsafeMutation.startsWith("ACCOUNT:");
    return refusal(
      accountMutation ? "UNSAFE_ACCOUNT_MUTATION" : "UNSAFE_TOKEN_MUTATION",
      accountMutation ? unsafeMutation.slice("ACCOUNT:".length) : unsafeMutation,
    );
  }

  for (const [mint, delta] of tokenEffects.deltas) {
    if (delta !== 0n && mint !== args.order.inputMint && mint !== args.order.outputMint) {
      return refusal(
        "UNRELATED_TOKEN_DELTA",
        `The exact simulation changes the taker's unrelated ${mint} balance by ${delta.toString()} raw units.`,
      );
    }
  }

  const takerLamportDelta = takerPost - takerPre;

  /*
   * Rent the signer keeps.
   *
   * A durable associated token account is what buying an asset you do not yet
   * hold actually costs: the rent leaves the main balance and stays in an
   * account this transaction proved the signer both paid for and owns,
   * recoverable by closing it later. So it is subtracted from the expected
   * lamport floor rather than refused outright. A durable wSOL account would
   * also hold the wrapped output as lamports; that part is netted out here so
   * output can never be counted twice as rent.
   */
  const wrappedOwnerDelta = tokenEffects.deltas.get(WRAPPED_SOL_MINT) ?? 0n;
  let durableRentLamports = 0n;
  let provenExact = 0;
  for (const [account, mint] of lifecycles.durable) {
    const index = accountAddresses.indexOf(account);
    if (index < 0) continue;
    const before = chainInteger(args.simulation.preBalances[index] ?? 0);
    const after = chainInteger(args.simulation.postBalances[index] ?? 0);
    if (before === null || after === null) {
      return refusal(
        "SIMULATION_METADATA_UNAVAILABLE",
        "A proved taker-owned account has no readable lamport balance in the exact simulation.",
      );
    }
    const wrapped = mint === WRAPPED_SOL_MINT && wrappedOwnerDelta > 0n ? wrappedOwnerDelta : 0n;
    const rent = after - before - wrapped;
    if (rent > 0n) durableRentLamports += rent;
    /*
     * An account for a hop of the route is a corridor, not a holding.
     *
     * The route passes that mint through the signer's own account and the
     * account must end the transaction empty — whatever it kept would be a
     * third asset nobody reviewed. Its rent is accepted only on the chain's
     * own figure: the venue's estimate is no ceiling for an account the
     * person never asked to hold anything in.
     */
    const hop = hopMints.has(mint);
    if (hop) {
      const kept = args.simulation.postTokenBalances.find((entry) => safeIndex(entry.accountIndex, accountCount) === index);
      const keptAmount = kept?.uiTokenAmount?.amount;
      if (typeof keptAmount !== "string") {
        return refusal(
          "TOKEN_METADATA_UNAVAILABLE",
          `The account the transaction opens for the taker for the route's ${mint} has no readable closing token balance.`,
        );
      }
      if (keptAmount !== "0") {
        return refusal(
          "UNRELATED_TOKEN_DELTA",
          `The account the transaction opens for the taker for the route's ${mint} ends holding ${keptAmount} raw units; an account a hop passes through must end empty.`,
        );
      }
    }
    /*
     * Exact rent, from the chain.
     *
     * The simulation states the account's size after the transaction and the
     * network states what a byte costs; together they name the one figure a
     * newly opened account may hold and still be nothing but rent. Every
     * lamport above that minimum is a debit nobody approved, whichever account
     * it lands in — the 4 SOL pushed into a signer-owned account stays refused
     * here, because 4 SOL is not the rent-exempt minimum of any token account.
     * A lamport below it cannot happen (the account would not exist), so the
     * comparison is equality.
     */
    const state = args.accountStates?.get(account) ?? null;
    if (hop && !(state && args.rent)) {
      return refusal(
        "RENT_UNSUPPORTED",
        `The transaction opens the taker an account for the route's ${mint}, and without the chain's own state for it nothing proves that account holds only rent.`,
      );
    }
    if (state && args.rent) {
      if (state.lamports !== after) {
        return refusal(
          "SIMULATION_METADATA_UNAVAILABLE",
          "The simulation's account state for an opened taker account disagrees with its balance vector.",
        );
      }
      const minimum = rentExemptMinimumLamports(args.rent, state.space);
      if (rent !== minimum) {
        return refusal(
          "RENT_UNSUPPORTED",
          `The transaction moves ${rent.toString()} lamports into a ${state.space}-byte account it opens for the taker; the network's rent-exempt minimum for it is ${minimum.toString()}, and nothing above that is rent.`,
        );
      }
      provenExact += 1;
    }
  }
  const rentProvenExact = lifecycles.durable.size > 0 && provenExact === lifecycles.durable.size;
  if (unquotedDurable && !rentProvenExact) {
    return refusal(
      "RENT_UNSUPPORTED",
      "The transaction leaves an account open for the taker while quoting no rent at all.",
    );
  }
  /*
   * Without the chain's own figure, the relief may never exceed the rent the
   * review disclosed.
   *
   * Measuring rent from the balance vectors is right — provider prose is not
   * evidence — but using that measurement to LOWER the floor without bounding
   * it let the same lamports do both jobs. A transaction that pushed 4 SOL
   * into an account it opened for the signer raised `durableRentLamports` to
   * 4 SOL, lowered the floor by 4 SOL, and was VERIFIED while the card printed
   * 0.002 SOL of rent. When no account state was simulated, the reviewed
   * figure is the ceiling: anything above it is a debit nobody approved.
   * When every opened account was proved to hold exactly its minimum, the
   * estimate has nothing left to bound — the venue's figure for a plain
   * 165-byte account is short of every Token-2022 account with extensions,
   * and holding a Review to it refused every tokenized stock a wallet did
   * not already hold (the Owner, NVDAx, 2026-09-14).
   */
  if (!rentProvenExact && durableRentLamports > rentFee) {
    return refusal(
      "RENT_UNSUPPORTED",
      `The transaction moves ${durableRentLamports.toString()} lamports into accounts it opens for the taker, above the ${rentFee.toString()} lamports of rent the reviewed order disclosed.`,
    );
  }

  /*
   * A token leg is matched against the mint itself.
   *
   * What leaves is matched EXACTLY: more than the reviewed input leaving the
   * signer is the loss this firewall exists to refuse. What arrives is matched
   * against the stated minimum, not the quote — an AMM price moves between the
   * quote and the block, and refusing a signer who receives MORE than quoted is
   * not a safety property. It is a refusal to accept good news, and it blocked
   * a live canary over ten raw units in the signer's own favour.
   */
  if (args.order.inputMint !== WRAPPED_SOL_MINT) {
    const inputDelta = tokenEffects.deltas.get(args.order.inputMint) ?? 0n;
    if (inputDelta !== -inputAmount) {
      return refusal(
        "INPUT_DELTA_MISMATCH",
        `The taker's ${args.order.inputMint} input delta is ${inputDelta.toString()}, not ${(-inputAmount).toString()}.`,
      );
    }
  }
  if (args.order.outputMint !== WRAPPED_SOL_MINT) {
    const outputDelta = tokenEffects.deltas.get(args.order.outputMint) ?? 0n;
    if (outputDelta < minimumOutput) {
      return refusal(
        "OUTPUT_DELTA_MISMATCH",
        `The taker's ${args.order.outputMint} output delta is ${outputDelta.toString()}, below the stated minimum ${minimumOutput.toString()} (quoted ${outputAmount.toString()}).`,
      );
    }
  }

  /*
   * SOL is one asset in two representations, so it is checked as one number.
   *
   * Native lamports and wrapped SOL are the same value at 1:1 — wrapping and
   * unwrapping move a balance between them and cost nothing. Reading them as
   * two independent quantities forced a choice the chain does not make, and it
   * refused an ordinary wallet outright: one that already holds a wSOL account
   * has its balance unwrapped by the close, so the wrapped delta was neither
   * zero nor the input leg, and INPUT_DELTA_MISMATCH fired on a transaction
   * that took nothing from anyone.
   *
   * The signer's SOL POSITION — lamports plus wrapped — is what can actually
   * fall, and this is the floor it may not fall below: the reviewed input leg,
   * the simulated network fee, and the rent that stays in accounts this
   * transaction proved are the signer's own. Ending above the floor is the
   * same good news the output side already accepts: a cheaper fee, a better
   * fill, a rent refund. Nothing above it can be a loss.
   */
  const solPosition = takerLamportDelta + wrappedOwnerDelta;
  let solFloor = -fee - durableRentLamports;
  if (args.order.inputMint === WRAPPED_SOL_MINT) solFloor -= inputAmount;
  if (args.order.outputMint === WRAPPED_SOL_MINT) solFloor += minimumOutput;
  if (solPosition < solFloor) {
    /* One code for one number. When SOL is the output leg this reads as a
       short fill and when it is the input leg as an extra debit, and the
       simulation cannot tell those apart — they are the same lamports. */
    return refusal(
      "NATIVE_DELTA_MISMATCH",
      `The taker's SOL position moves ${solPosition.toString()} lamports, below the ${solFloor.toString()} allowed by the reviewed leg, its network fee and the rent it keeps.`,
    );
  }

  /* Which representation each leg actually used, for the Receipt to state. */
  const inputRepresentation: "TOKEN" | "NATIVE_SOL" =
    args.order.inputMint === WRAPPED_SOL_MINT && wrappedOwnerDelta > -inputAmount ? "NATIVE_SOL" : "TOKEN";
  const outputRepresentation: "TOKEN" | "NATIVE_SOL" =
    args.order.outputMint === WRAPPED_SOL_MINT && wrappedOwnerDelta < minimumOutput ? "NATIVE_SOL" : "TOKEN";

  const ownerTokenDeltaRows = [...tokenEffects.deltas]
    .filter(([, delta]) => delta !== 0n)
    .map(([mint, delta]) => ({ mint, rawDelta: delta.toString() }))
    .sort((left, right) => (left.mint < right.mint ? -1 : left.mint > right.mint ? 1 : 0));

  return {
    ok: true,
    proof: SwapOwnerEffectProofSchema.parse({
      status: "VERIFIED",
      method: "SIMULATION_OWNER_DELTAS_V1",
      tokenInstructionAudit: "NO_UNSAFE_MUTATIONS",
      nativeWrapRoundTrip: hasWrap,
      programs: allPrograms,
      taker: args.order.taker,
      inputMint: args.order.inputMint,
      outputMint: args.order.outputMint,
      inputAmountRaw: args.order.inAmountRaw,
      outputAmountRaw: args.order.outAmountRaw,
      minimumOutputRaw: args.order.minReceivedRaw,
      inputRepresentation,
      outputRepresentation,
      feeLamports: fee.toString(),
      takerLamportDelta: takerLamportDelta.toString(),
      ownerTokenDeltas: ownerTokenDeltaRows,
      accountVectorCount: accountCount,
      durableRentLamports: durableRentLamports.toString(),
      rentProof: lifecycles.durable.size === 0 ? "NONE" : rentProvenExact ? "EXACT_MINIMUM" : "REVIEWED_CEILING",
    }),
  };
}
