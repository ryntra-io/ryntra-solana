/**
 * «Пресейл і ранній доступ» on Meteora — an honest Token-2022 mint, a DAMM v2 pool with an alpha vault and its
 * liquidity locked for ever, and the Meteora Alpha Vault people deposit into before trading opens (SOL-L5).
 *
 * The rules are `lib/core/launch/early-access.ts`; this adapter turns them into bytes a wallet signs and never signs
 * itself, except with the fresh keys it makes for the bytes — the new mint and the pool position's NFT —, handed back
 * with the build, as the DBC venue hands back its mint key (`../meteora-dbc/launch.server.ts`): the caller takes those
 * signatures off what the wallet sees and signs with the keys only after the wallet.
 *
 * The creation is three transactions, each sent after the one before it lands (they do not fit one):
 * 1. MINT — the token: the account, the metadata pointer to the mint itself with no authority, the mint with no freeze
 *    authority, the metadata, its update authority set to none, the creator's token account, the whole supply minted
 *    to it, the mint authority revoked.
 * 2. POOL — the DAMM v2 pool single-sided with the whole supply from the start price up, `hasAlphaVault`, opening at the
 *    schedule's activation, fees in USDC, and the creator's position permanently locked in the same transaction. The
 *    pool's program takes at least one raw unit of USDC from its creator to prove the mints: the creator holds one.
 * 3. VAULT — the alpha vault on that pool, FCFS or Pro Rata, permissionless, escrow fee zero. Its address is the
 *    program's from the pool's payer and the pool, and the pool names it: no other vault can buy before activation.
 *
 * Before the bytes are returned, `earlyAccessCreationProblems` reads them back instruction by instruction — the
 * authorities, the hook, the pool's flags and activation, the lock, the vault's terms, and that no instruction moves
 * lamports or tokens anywhere but into the new accounts: nothing pays Ryntra.
 *
 * After the creation: `buildEarlyAccessDeposit` (a person's deposit, their wallet the only signer), `buildEarlyAccessFill`
 * (the vault's purchase in the hour before activation — a crank anyone may send, Ryntra's executor or the stand's
 * script; Meteora's crank fee, if any, goes to Meteora's treasury), `buildEarlyAccessClaim`, `buildEarlyAccessWithdraw`
 * (Pro Rata, while deposits are open) and `buildEarlyAccessWithdrawRemaining`; and the readers — the vault and a
 * wallet's escrow (`readEarlyAccessVault`), the pool (`readEarlyAccessPool`), the mint (`readEarlyAccessMint`).
 *
 * Server-only: it reads the chain through the connection it is given.
 */

import { createHash } from "node:crypto";

import { createProgram, deriveAlphaVault, deriveCrankFeeWhitelist, deriveEscrow, ALPHA_VAULT_TREASURY_ID } from "@meteora-ag/alpha-vault";
import {
  CP_AMM_PROGRAM_ID,
  MAX_SQRT_PRICE,
  cpAmmCoder,
  deriveCustomizablePoolAddress,
  derivePoolAuthority,
  derivePositionAddress,
  derivePositionNftAccount,
  deriveTokenVaultAddress,
  getBaseFeeParams,
  getDynamicFeeParams,
  getSqrtPriceFromPrice,
} from "@meteora-ag/cp-amm-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AuthorityType,
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TYPE_SIZE,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createUpdateAuthorityInstruction,
  getAssociatedTokenAddressSync,
  getExtensionData,
  getExtensionTypes,
  getMetadataPointerState,
  getMintLen,
  getTransferHook,
  unpackMint,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

import type { Address, UnsignedTx } from "../../contracts.ts";
import {
  EARLY_ACCESS_ESCROW_FEE_RAW,
  EARLY_ACCESS_POOL_FEE,
  EARLY_ACCESS_TOKEN,
  earlyAccessSchedule,
  startPriceUsd,
  supplyRawOf,
  type EarlyAccessMintFields,
  type EarlyAccessRules,
  type EarlyAccessSchedule,
} from "../../launch/early-access.ts";
import { cpAmmOf } from "../meteora-clients.server.ts";
import { mintMetadataOf } from "../meteora-dbc/mint-metadata.ts";

/* ------------------------------------------------------ the SDKs' numbers */

/** The Alpha Vault program — one address on devnet and mainnet. */
export const ALPHA_VAULT_PROGRAM = "vaU6kP7iNEGkbmPkLmZfGwiGxd4Mob24QQCie5R9kd2";
export const DAMM_V2_PROGRAM = CP_AMM_PROGRAM_ID.toBase58();
/** `VaultMode` */
export const ALPHA_VAULT_MODE = { PRORATA: 0, FCFS: 1 } as const;
/** `PoolType` — the vault buys from a DAMM v2 pool. */
export const ALPHA_VAULT_POOL_TYPE = { DLMM: 0, DAMM: 1, DAMM_V2: 2 } as const;
/** `WhitelistMode` — permissionless in this version. */
export const ALPHA_VAULT_WHITELIST = { PERMISSIONLESS: 0, MERKLE_PROOF: 1, AUTHORITY: 2 } as const;
/** DAMM v2's `ActivationType`, `CollectFeeMode` (fees in token B — USDC), `BaseFeeMode`. */
export const DAMM_V2_ACTIVATION = { SLOT: 0, TIMESTAMP: 1 } as const;
export const DAMM_V2_COLLECT = { BOTH: 0, ONLY_B: 1, COMPOUNDING: 2 } as const;
export const DAMM_V2_FEE_TIME_SCHEDULER_EXPONENTIAL = 1;

/**
 * Who may deposit. This version: anyone (`PERMISSIONLESS`). The Growth line's ranks will come as a merkle allowlist —
 * the vault's `PermissionWithMerkleProof` mode, each wallet's cap a leaf — by their own task; until then a build that
 * names one is refused, never quietly opened to everyone.
 */
export type EarlyAccessAllowlist =
  | Readonly<{ kind: "PERMISSIONLESS" }>
  | Readonly<{ kind: "MERKLE"; source: "growth-ranks"; root: string; version: number }>;

export class EarlyAccessRefusal extends Error {
  readonly code: "NOT_HONEST" | "ALLOWLIST_LATER" | "NO_VAULT" | "NO_POOL" | "NOT_NOW" | "ABOVE_CAP" | "NOTHING_TO_DO" | "NOT_YOURS";
  constructor(code: EarlyAccessRefusal["code"], message: string) {
    super(message);
    this.name = "EarlyAccessRefusal";
    this.code = code;
  }
}

/* ------------------------------------------------------------- helpers */

const TOKEN_2022 = TOKEN_2022_PROGRAM_ID;
const PROGRAMS = new WeakMap<Connection, ReturnType<typeof createProgram>>();
/** The Alpha Vault program client of this connection, made once (its coder is built from the IDL). */
export function alphaVaultProgramOf(connection: Connection): ReturnType<typeof createProgram> {
  let program = PROGRAMS.get(connection);
  if (!program) {
    program = createProgram(connection);
    PROGRAMS.set(connection, program);
  }
  return program;
}

const toBase64 = (tx: Transaction) => Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
const camel = (name: string) => name.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
/** A decoded value with camelCase keys, keys to base58, numbers to decimal strings — one shape whatever the IDL's casing. */
function plain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof PublicKey) return value.toBase58();
  if (BN.isBN(value)) return (value as BN).toString(10);
  if (Array.isArray(value)) return value.map(plain);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [camel(key), plain(inner)]));
  return value;
}

export type SealedTx = UnsignedTx & Readonly<{ role: "MINT" | "POOL" | "VAULT" }>;

function seal(instructions: readonly TransactionInstruction[], feePayer: PublicKey, blockhash: Readonly<{ blockhash: string; lastValidBlockHeight: number }>, signers: readonly Keypair[]): UnsignedTx {
  const tx = new Transaction({ feePayer, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight });
  tx.add(...instructions);
  if (signers.length) tx.partialSign(...signers);
  return { network: "solana", wireBase64: toBase64(tx), validUntil: String(blockhash.lastValidBlockHeight) };
}

/** The bytes the token metadata takes in the mint: its TLV header and the interface's Borsh layout, no extra fields. */
export function metadataBytesOf(name: string, symbol: string, uri: string): number {
  const text = (value: string) => 4 + Buffer.byteLength(value, "utf8");
  return TYPE_SIZE + LENGTH_SIZE + 32 + 32 + text(name) + text(symbol) + text(uri) + 4;
}

/** The pool's start sqrt price, Q64: the start price in raw units (both tokens have six decimals). */
export function startSqrtPriceOf(rules: Pick<EarlyAccessRules, "startMarketCapUsd" | "supply">): BN {
  const price = startPriceUsd(rules);
  /* A decimal string the SDK's Decimal reads exactly — never an exponent a tiny price would print. */
  const text = price.toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
  return getSqrtPriceFromPrice(text, EARLY_ACCESS_TOKEN.decimals, 6);
}

/** The liquidity of the whole supply, single-sided, from the start price to the program's highest — the SDK's own `preparePoolCreationSingleSide`. */
export function singleSidedLiquidityOf(connection: Connection, rules: Pick<EarlyAccessRules, "startMarketCapUsd" | "supply">): BN {
  const sqrt = startSqrtPriceOf(rules);
  return cpAmmOf(connection).preparePoolCreationSingleSide({
    tokenAAmount: new BN(supplyRawOf(rules).toString()),
    minSqrtPrice: sqrt,
    maxSqrtPrice: MAX_SQRT_PRICE,
    initSqrtPrice: sqrt,
    collectFeeMode: DAMM_V2_COLLECT.ONLY_B,
  });
}

/** The pool's fees: the time scheduler from activation, falling exponentially, and the volatility fee on top. */
export function earlyAccessPoolFees() {
  return {
    baseFee: getBaseFeeParams({
      baseFeeMode: DAMM_V2_FEE_TIME_SCHEDULER_EXPONENTIAL,
      feeTimeSchedulerParam: {
        startingFeeBps: EARLY_ACCESS_POOL_FEE.startBps,
        endingFeeBps: EARLY_ACCESS_POOL_FEE.endBps,
        numberOfPeriod: EARLY_ACCESS_POOL_FEE.periods,
        totalDuration: EARLY_ACCESS_POOL_FEE.seconds,
      },
    }),
    compoundingFeeBps: 0,
    padding: 0,
    dynamicFee: EARLY_ACCESS_POOL_FEE.dynamicFee ? getDynamicFeeParams(EARLY_ACCESS_POOL_FEE.endBps) : null,
  };
}

/* ------------------------------------------------------------ creation */

export type EarlyAccessCreationArgs = Readonly<{
  connection: Connection;
  creator: Address;
  /** The pair's mint (USDC) and its token program — read from the chain when not given. */
  quoteMint: Address;
  quoteProgram?: Address;
  rules: EarlyAccessRules;
  name: string;
  symbol: string;
  uri: string;
  allowlist?: EarlyAccessAllowlist;
  /** The fresh keys, kept by the caller so a retried build keeps its addresses; absent, new ones. */
  mintKey?: Keypair;
  positionNftKey?: Keypair;
}>;

export type EarlyAccessCreation = Readonly<{
  /** In the order they are sent: MINT, POOL, VAULT. Each carries its fresh key's signature already. */
  txs: readonly SealedTx[];
  mint: Address;
  pool: Address;
  position: Address;
  positionNft: Address;
  vault: Address;
  quoteMint: Address;
  quoteProgram: Address;
  creatorTokenAccount: Address;
  liquidity: string;
  sqrtStartPrice: string;
  schedule: EarlyAccessSchedule;
  /** The fresh keys signed into MINT (the mint) and POOL (the position's NFT mint). */
  mintKey: Keypair;
  positionNftKey: Keypair;
}>;

/** The token's transaction: the honest mint and the whole supply in the creator's token account. */
export function mintInstructions(args: Readonly<{ creator: PublicKey; mint: PublicKey; rules: EarlyAccessRules; name: string; symbol: string; uri: string; rentLamports: number }>): TransactionInstruction[] {
  const { creator, mint } = args;
  const ata = getAssociatedTokenAddressSync(mint, creator, false, TOKEN_2022);
  return [
    SystemProgram.createAccount({ fromPubkey: creator, newAccountPubkey: mint, space: getMintLen([ExtensionType.MetadataPointer]), lamports: args.rentLamports, programId: TOKEN_2022 }),
    /* The pointer names the mint itself, and nobody may move it. */
    createInitializeMetadataPointerInstruction(mint, null, mint, TOKEN_2022),
    /* No freeze authority, ever; the mint authority is the creator only until the supply is minted, below. */
    createInitializeMintInstruction(mint, EARLY_ACCESS_TOKEN.decimals, creator, null, TOKEN_2022),
    createInitializeInstruction({ programId: TOKEN_2022, metadata: mint, updateAuthority: creator, mint, mintAuthority: creator, name: args.name, symbol: args.symbol, uri: args.uri }),
    /* Nobody may change the metadata from here on. */
    createUpdateAuthorityInstruction({ programId: TOKEN_2022, metadata: mint, oldAuthority: creator, newAuthority: null }),
    createAssociatedTokenAccountIdempotentInstruction(creator, ata, creator, mint, TOKEN_2022),
    createMintToInstruction(mint, ata, creator, supplyRawOf(args.rules), [], TOKEN_2022),
    /* The supply is fixed: nobody can mint again. */
    createSetAuthorityInstruction(mint, creator, AuthorityType.MintTokens, null, [], TOKEN_2022),
  ];
}

/** The vault's creation instruction for a pool — the SDK's `createCustomizable{Fcfs,Prorata}Vault`, the creator its base and funder. */
export async function vaultInstruction(
  connection: Connection,
  args: Readonly<{ creator: PublicKey; pool: PublicKey; mint: PublicKey; quoteMint: PublicKey; rules: EarlyAccessRules; schedule: EarlyAccessSchedule }>,
): Promise<{ instruction: TransactionInstruction; vault: PublicKey }> {
  const program = alphaVaultProgramOf(connection);
  const [vault] = deriveAlphaVault(args.creator, args.pool, program.programId);
  const common = {
    poolType: ALPHA_VAULT_POOL_TYPE.DAMM_V2,
    baseMint: args.mint,
    quoteMint: args.quoteMint,
    depositingPoint: new BN(args.schedule.depositStartsAt),
    startVestingPoint: new BN(args.schedule.vestingStartsAt),
    endVestingPoint: new BN(args.schedule.vestingEndsAt),
    escrowFee: new BN(EARLY_ACCESS_ESCROW_FEE_RAW),
    whitelistMode: ALPHA_VAULT_WHITELIST.PERMISSIONLESS,
  };
  const accounts = { base: args.creator, vault, pool: args.pool, funder: args.creator, program: program.programId, systemProgram: SystemProgram.programId };
  const instruction =
    args.rules.mode === "FCFS"
      ? await program.methods
          .initializeFcfsVault({ ...common, maxDepositingCap: new BN(args.rules.maxCapRaw), individualDepositingCap: new BN(args.rules.individualCapRaw ?? "0") })
          .accountsPartial(accounts)
          .instruction()
      : await program.methods.initializeProrataVault({ ...common, maxBuyingCap: new BN(args.rules.maxCapRaw) }).accountsPartial(accounts).instruction();
  return { instruction, vault };
}

/**
 * The three transactions of an early-access launch, sealed with one blockhash, the creator their fee payer; refused when
 * they do not read back as the rules (`earlyAccessCreationProblems`).
 */
export async function buildEarlyAccessCreation(args: EarlyAccessCreationArgs): Promise<EarlyAccessCreation> {
  if (args.allowlist && args.allowlist.kind !== "PERMISSIONLESS") {
    throw new EarlyAccessRefusal("ALLOWLIST_LATER", "An allowlisted vault comes with the Growth line's ranks; this version opens deposits to everyone.");
  }
  const { connection, rules } = args;
  const creator = new PublicKey(args.creator);
  const quoteMint = new PublicKey(args.quoteMint);
  const quoteProgram = args.quoteProgram ? new PublicKey(args.quoteProgram) : (await connection.getAccountInfo(quoteMint, "confirmed"))?.owner;
  if (!quoteProgram || !(quoteProgram.equals(TOKEN_PROGRAM_ID) || quoteProgram.equals(TOKEN_2022))) throw new EarlyAccessRefusal("NO_POOL", "The pair's mint could not be read.");
  const mintKey = args.mintKey ?? Keypair.generate();
  const positionNftKey = args.positionNftKey ?? Keypair.generate();
  const mint = mintKey.publicKey;
  const schedule = earlyAccessSchedule(rules);

  const rentLamports = await connection.getMinimumBalanceForRentExemption(getMintLen([ExtensionType.MetadataPointer]) + metadataBytesOf(args.name, args.symbol, args.uri));
  const mintIxs = mintInstructions({ creator, mint, rules, name: args.name, symbol: args.symbol, uri: args.uri, rentLamports });

  const sqrtStart = startSqrtPriceOf(rules);
  const liquidity = singleSidedLiquidityOf(connection, rules);
  const supply = new BN(supplyRawOf(rules).toString());
  const built = await cpAmmOf(connection).createCustomPool({
    payer: creator,
    creator,
    positionNft: positionNftKey.publicKey,
    tokenAMint: mint,
    tokenBMint: quoteMint,
    tokenAAmount: supply,
    tokenBAmount: new BN(0),
    sqrtMinPrice: sqrtStart,
    sqrtMaxPrice: MAX_SQRT_PRICE,
    liquidityDelta: liquidity,
    initSqrtPrice: sqrtStart,
    poolFees: earlyAccessPoolFees(),
    hasAlphaVault: true,
    activationType: DAMM_V2_ACTIVATION.TIMESTAMP,
    collectFeeMode: DAMM_V2_COLLECT.ONLY_B,
    activationPoint: new BN(schedule.activatesAt),
    tokenAProgram: TOKEN_2022,
    tokenBProgram: quoteProgram,
    isLockLiquidity: true,
  });
  /* The creator's token accounts exist by then — the token's from MINT, the pair's holding the unit the pool takes —: the
     SDK's own idempotent creations of them only cost bytes, and the pool's transaction has few to spare. */
  const ataProgram = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
  const poolIxs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...built.tx.instructions.filter((ix) => ix.programId.toBase58() !== ataProgram)];

  const { instruction: vaultIx, vault } = await vaultInstruction(connection, { creator, pool: built.pool, mint, quoteMint, rules, schedule });

  const blockhash = await connection.getLatestBlockhash("confirmed");
  const txs: SealedTx[] = [
    { ...seal(mintIxs, creator, blockhash, [mintKey]), role: "MINT" },
    { ...seal(poolIxs, creator, blockhash, [positionNftKey]), role: "POOL" },
    { ...seal([vaultIx], creator, blockhash, []), role: "VAULT" },
  ];
  const creation: EarlyAccessCreation = {
    txs,
    mint: mint.toBase58(),
    pool: built.pool.toBase58(),
    position: built.position.toBase58(),
    positionNft: positionNftKey.publicKey.toBase58(),
    vault: vault.toBase58(),
    quoteMint: quoteMint.toBase58(),
    quoteProgram: quoteProgram.toBase58(),
    creatorTokenAccount: getAssociatedTokenAddressSync(mint, creator, false, TOKEN_2022).toBase58(),
    liquidity: liquidity.toString(),
    sqrtStartPrice: sqrtStart.toString(),
    schedule,
    mintKey,
    positionNftKey,
  };
  const problems = earlyAccessCreationProblems(creation, { creator: args.creator, rules });
  if (problems.length) throw new EarlyAccessRefusal("NOT_HONEST", problems.join("; "));
  return creation;
}

/* ---------------------------------------- reading the creation back */

const SYSTEM = SystemProgram.programId.toBase58();
const COMPUTE_BUDGET = ComputeBudgetProgram.programId.toBase58();
const ATA = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const T22 = TOKEN_2022.toBase58();
/** Token instruction tags (`TokenInstruction`) the mint transaction uses. */
const TOKEN_IX = { INITIALIZE_MINT: 0, SET_AUTHORITY: 6, MINT_TO: 7, INITIALIZE_MINT_2: 20, TRANSFER_HOOK_EXTENSION: 36, METADATA_POINTER_EXTENSION: 39 } as const;
const interfaceDiscriminator = (name: string) => createHash("sha256").update(`spl_token_metadata_interface:${name}`).digest().subarray(0, 8);
const METADATA_INITIALIZE = interfaceDiscriminator("initialize_account");
const METADATA_UPDATE_AUTHORITY = interfaceDiscriminator("update_the_authority");
const zeros = (bytes: Uint8Array) => bytes.every((byte) => byte === 0);

type Decoded = Readonly<{ name: string; data: Record<string, unknown> }>;
type InstructionDecoder = { decode(data: Buffer): { name: string; data: unknown } | null };
function decodeWith(coder: Readonly<{ instruction: unknown }>, ix: TransactionInstruction): Decoded | null {
  try {
    const decoded = (coder.instruction as InstructionDecoder).decode(Buffer.from(ix.data));
    return decoded ? { name: camel(decoded.name), data: plain(decoded.data) as Record<string, unknown> } : null;
  } catch {
    return null;
  }
}

/**
 * What the built creation does that the rules do not say — each in a plain line; empty: the bytes are the launch.
 * Read from the bytes themselves, so a change in an SDK that alters an authority, the pool's flags or the vault's terms
 * fails here, before a wallet sees it.
 */
export function earlyAccessCreationProblems(creation: Pick<EarlyAccessCreation, "txs" | "mint" | "pool" | "vault" | "liquidity" | "sqrtStartPrice" | "quoteMint" | "schedule" | "creatorTokenAccount">, expected: Readonly<{ creator: Address; rules: EarlyAccessRules }>): readonly string[] {
  const problems: string[] = [];
  const { rules } = expected;
  const supply = supplyRawOf(rules).toString();
  if (creation.txs.map((tx) => tx.role).join(",") !== "MINT,POOL,VAULT") return ["the creation is not the three transactions MINT, POOL, VAULT"];
  const txOf = (index: number) => Transaction.from(Buffer.from(creation.txs[index]!.wireBase64, "base64"));
  const [mintTx, poolTx, vaultTx] = [txOf(0), txOf(1), txOf(2)];
  for (const tx of [mintTx, poolTx, vaultTx]) if (tx.feePayer?.toBase58() !== expected.creator) problems.push("a transaction is not paid by the creator");
  const programsIn = (tx: Transaction) => tx.instructions.map((ix) => ix.programId.toBase58());

  /* MINT */
  const seen = { pointer: false, mint: false, metadata: false, metadataLocked: false, minted: false, revoked: false };
  for (const ix of mintTx.instructions) {
    const program = ix.programId.toBase58();
    const data = Buffer.from(ix.data);
    if (program === COMPUTE_BUDGET || program === ATA) continue;
    if (program === SYSTEM) {
      /* `CreateAccount` (0) of the mint itself, owned by Token-2022; any other system instruction moves lamports elsewhere. */
      const isCreate = data.readUInt32LE(0) === 0 && ix.keys[1]?.pubkey.toBase58() === creation.mint && new PublicKey(data.subarray(data.length - 32)).toBase58() === T22;
      if (!isCreate) problems.push("the token's transaction moves lamports other than into the new mint");
      continue;
    }
    if (program !== T22) {
      problems.push(`the token's transaction calls ${program}`);
      continue;
    }
    if (data.subarray(0, 8).equals(METADATA_INITIALIZE)) {
      seen.metadata = true;
      continue;
    }
    if (data.subarray(0, 8).equals(METADATA_UPDATE_AUTHORITY)) {
      if (!zeros(data.subarray(8, 40))) problems.push("the metadata's update authority is handed to someone");
      else seen.metadataLocked = true;
      continue;
    }
    const tag = data[0];
    if (tag === TOKEN_IX.METADATA_POINTER_EXTENSION) {
      /* [39, 0 = Initialize, authority (32, zero for none), metadata address (32)] */
      if (data[1] !== 0 || !zeros(data.subarray(2, 34))) problems.push("someone can move the metadata pointer");
      else if (new PublicKey(data.subarray(34, 66)).toBase58() !== creation.mint) problems.push("the metadata does not live in the mint");
      else seen.pointer = true;
    } else if (tag === TOKEN_IX.INITIALIZE_MINT || tag === TOKEN_IX.INITIALIZE_MINT_2) {
      /* [tag, decimals, mint authority (32), freeze option (1), freeze authority (32)] */
      if (data[1] !== EARLY_ACCESS_TOKEN.decimals) problems.push("the token's decimals are not six");
      if (data[34] !== 0) problems.push("the token has a freeze authority");
      else seen.mint = true;
    } else if (tag === TOKEN_IX.MINT_TO) {
      if (data.readBigUInt64LE(1).toString() !== supply) problems.push("the minted supply is not the launch's");
      else if (ix.keys[1]?.pubkey.toBase58() !== creation.creatorTokenAccount) problems.push("the supply is minted to another account");
      else seen.minted = true;
    } else if (tag === TOKEN_IX.SET_AUTHORITY) {
      /* [6, authority type (0 = MintTokens), option (0 = none)] */
      if (data[1] === AuthorityType.MintTokens && data[2] === 0) seen.revoked = true;
      else problems.push("an authority is handed to someone");
    } else if (tag === TOKEN_IX.TRANSFER_HOOK_EXTENSION) problems.push("the token has a transfer hook");
    else problems.push(`the token's transaction carries token instruction ${tag}`);
  }
  if (!seen.pointer) problems.push("the metadata pointer is not set to the mint without an authority");
  if (!seen.mint) problems.push("the mint is not initialized without a freeze authority");
  if (!seen.metadata) problems.push("the metadata is not written in the mint");
  if (!seen.metadataLocked) problems.push("the metadata stays changeable");
  if (!seen.minted) problems.push("the supply is not minted to the creator");
  if (!seen.revoked) problems.push("the mint authority is not revoked");

  /* POOL */
  const poolSeen = { created: false, locked: false };
  for (const ix of poolTx.instructions) {
    const program = ix.programId.toBase58();
    if (program === COMPUTE_BUDGET || program === ATA) continue;
    if (program !== DAMM_V2_PROGRAM) {
      problems.push(`the pool's transaction calls ${program}`);
      continue;
    }
    const decoded = decodeWith(cpAmmCoder, ix);
    if (decoded?.name === "initializeCustomizablePool") {
      const params = decoded.data.params as Record<string, unknown>;
      if (params.hasAlphaVault !== true) problems.push("the pool has no alpha vault");
      if (params.activationType !== DAMM_V2_ACTIVATION.TIMESTAMP) problems.push("the pool does not open by time");
      if (params.activationPoint !== String(creation.schedule.activatesAt)) problems.push("the pool does not open when the deposit window's fill hour ends");
      if (params.collectFeeMode !== DAMM_V2_COLLECT.ONLY_B) problems.push("the pool's fees are not collected in USDC");
      if (params.liquidity !== creation.liquidity) problems.push("the pool's liquidity is not the whole supply's");
      if (params.sqrtPrice !== creation.sqrtStartPrice || params.sqrtMinPrice !== creation.sqrtStartPrice) problems.push("the pool does not start at the start price");
      if (params.sqrtMaxPrice !== MAX_SQRT_PRICE.toString()) problems.push("the pool's range does not reach the program's highest price");
      const keys = ix.keys.map((key) => key.pubkey.toBase58());
      if (!keys.includes(creation.mint) || !keys.includes(creation.quoteMint) || !keys.includes(creation.pool)) problems.push("the pool is not the token's and USDC's");
      if (ix.keys[0]?.pubkey.toBase58() !== expected.creator) problems.push("the pool's creator is not the creator");
      poolSeen.created = true;
    } else if (decoded?.name === "permanentLockPosition") {
      if (decoded.data.permanentLockLiquidity !== creation.liquidity) problems.push("not all of the position's liquidity is locked");
      else poolSeen.locked = true;
    } else problems.push(`the pool's transaction carries ${decoded?.name ?? "an unknown pool instruction"}`);
  }
  if (!poolSeen.created) problems.push("the pool is not created");
  if (!poolSeen.locked) problems.push("the creator's position is not locked for ever");

  /* VAULT */
  const vaultIxs = vaultTx.instructions.filter((ix) => ix.programId.toBase58() !== COMPUTE_BUDGET);
  if (vaultIxs.length !== 1 || vaultIxs[0]!.programId.toBase58() !== ALPHA_VAULT_PROGRAM) problems.push("the vault's transaction is not the vault's creation alone");
  else {
    const decoded = decodeWith(alphaVaultCoder(), vaultIxs[0]!);
    const params = (decoded?.data.params ?? {}) as Record<string, unknown>;
    const wanted = rules.mode === "FCFS" ? "initializeFcfsVault" : "initializeProrataVault";
    if (decoded?.name !== wanted) problems.push(`the vault is not ${rules.mode === "FCFS" ? "first-come" : "pro rata"}`);
    if (params.poolType !== ALPHA_VAULT_POOL_TYPE.DAMM_V2) problems.push("the vault does not buy from a DAMM v2 pool");
    if (params.baseMint !== creation.mint || params.quoteMint !== creation.quoteMint) problems.push("the vault is not the token's and USDC's");
    if (params.depositingPoint !== String(creation.schedule.depositStartsAt)) problems.push("the vault's deposits do not open at the window's start");
    if (params.startVestingPoint !== String(creation.schedule.vestingStartsAt) || params.endVestingPoint !== String(creation.schedule.vestingEndsAt)) problems.push("the vault's vesting is not the rules'");
    if (params.escrowFee !== "0") problems.push("the vault charges an escrow fee");
    if (params.whitelistMode !== ALPHA_VAULT_WHITELIST.PERMISSIONLESS) problems.push("the vault is not open to every wallet");
    if (rules.mode === "FCFS") {
      if (params.maxDepositingCap !== rules.maxCapRaw) problems.push("the vault's cap is not the rules'");
      if (params.individualDepositingCap !== rules.individualCapRaw) problems.push("the vault's cap per wallet is not the rules'");
    } else if (params.maxBuyingCap !== rules.maxCapRaw) problems.push("the vault's cap is not the rules'");
    const keys = vaultIxs[0]!.keys.map((key) => key.pubkey.toBase58());
    if (keys[0] !== creation.vault || keys[1] !== creation.pool) problems.push("the vault is not the one the pool names");
  }

  /* Nothing pays anyone: no transfer instruction anywhere — the pool's own program moves the supply into its vaults. */
  for (const tx of [poolTx, vaultTx]) if (programsIn(tx).includes(SYSTEM)) problems.push("a transaction moves lamports directly");
  return problems;
}

/* ------------------------------------------------------------- readers */

/** A vault account, plain: keys base58, amounts decimal strings. */
export type VaultFields = Readonly<{
  address: Address;
  pool: Address;
  tokenVault: Address;
  tokenOutVault: Address;
  quoteMint: Address;
  baseMint: Address;
  base: Address;
  maxBuyingCap: string;
  totalDeposit: string;
  totalEscrow: string;
  swappedAmount: string;
  boughtToken: string;
  totalRefund: string;
  totalClaimedToken: string;
  startVestingPoint: string;
  endVestingPoint: string;
  poolType: number;
  vaultMode: number;
  maxDepositingCap: string;
  individualDepositingCap: string;
  depositingPoint: string;
  escrowFee: string;
  whitelistMode: number;
  activationType: number;
}>;

export type EscrowFields = Readonly<{
  address: Address;
  vault: Address;
  owner: Address;
  totalDeposit: string;
  claimedToken: string;
  lastClaimedPoint: string;
  refunded: boolean;
  withdrawnDepositOverflow: string;
}>;

let CODER: ReturnType<typeof createProgram>["coder"] | null = null;
/** The Alpha Vault coder, independent of any connection. */
function alphaVaultCoder(): ReturnType<typeof createProgram>["coder"] {
  if (!CODER) CODER = createProgram({ rpcEndpoint: "http://127.0.0.1" } as unknown as Connection).coder;
  return CODER;
}

/** A vault's fields from its account bytes. */
export function decodeVault(address: Address, data: Buffer): VaultFields {
  const decoded = plain(alphaVaultCoder().accounts.decode("vault", data)) as Record<string, string | number>;
  const text = (key: string) => String(decoded[key]);
  const number = (key: string) => Number(decoded[key]);
  return {
    address,
    pool: text("pool"),
    tokenVault: text("tokenVault"),
    tokenOutVault: text("tokenOutVault"),
    quoteMint: text("quoteMint"),
    baseMint: text("baseMint"),
    base: text("base"),
    maxBuyingCap: text("maxBuyingCap"),
    totalDeposit: text("totalDeposit"),
    totalEscrow: text("totalEscrow"),
    swappedAmount: text("swappedAmount"),
    boughtToken: text("boughtToken"),
    totalRefund: text("totalRefund"),
    totalClaimedToken: text("totalClaimedToken"),
    startVestingPoint: text("startVestingPoint"),
    endVestingPoint: text("endVestingPoint"),
    poolType: number("poolType"),
    vaultMode: number("vaultMode"),
    maxDepositingCap: text("maxDepositingCap"),
    individualDepositingCap: text("individualDepositingCap"),
    depositingPoint: text("depositingPoint"),
    escrowFee: text("escrowFee"),
    whitelistMode: number("whitelistMode"),
    activationType: number("activationType"),
  };
}

export function decodeEscrow(address: Address, data: Buffer): EscrowFields {
  const decoded = plain(alphaVaultCoder().accounts.decode("escrow", data)) as Record<string, string | number>;
  return {
    address,
    vault: String(decoded.vault),
    owner: String(decoded.owner),
    totalDeposit: String(decoded.totalDeposit),
    claimedToken: String(decoded.claimedToken),
    lastClaimedPoint: String(decoded.lastClaimedPoint),
    refunded: Number(decoded.refunded) === 1,
    withdrawnDepositOverflow: String(decoded.withdrawnDepositOverflow),
  };
}

/** The account bytes a vault (or an escrow) is encoded to — for fixtures and a stub connection's answers. */
export async function encodeAlphaVaultAccount(name: "vault" | "escrow", value: Record<string, unknown>): Promise<Buffer> {
  return alphaVaultCoder().accounts.encode(name, value);
}

/** The Clock sysvar's unix time from its bytes (slot, epoch start, epoch, leader schedule epoch, unix timestamp — all 8 bytes). */
export const clockUnixOf = (data: Buffer) => Number(data.readBigInt64LE(32));

export const escrowAddressOf = (vault: Address, owner: Address) => deriveEscrow(new PublicKey(vault), new PublicKey(owner), new PublicKey(ALPHA_VAULT_PROGRAM))[0].toBase58();
export const vaultAddressOf = (creator: Address, pool: Address) => deriveAlphaVault(new PublicKey(creator), new PublicKey(pool), new PublicKey(ALPHA_VAULT_PROGRAM))[0].toBase58();
export const poolAddressOf = (mint: Address, quoteMint: Address) => deriveCustomizablePoolAddress(new PublicKey(mint), new PublicKey(quoteMint)).toBase58();

export type VaultRead = Readonly<{ vault: VaultFields; escrow: EscrowFields | null; clockUnix: number }>;

/** A vault, a wallet's escrow in it and the chain's clock, in one read. Null when the vault is not on chain. */
export async function readEarlyAccessVault(connection: Connection, vault: Address, owner?: Address | null): Promise<VaultRead | null> {
  const escrow = owner ? escrowAddressOf(vault, owner) : null;
  const keys = [new PublicKey(vault), SYSVAR_CLOCK_PUBKEY, ...(escrow ? [new PublicKey(escrow)] : [])];
  const [vaultInfo, clockInfo, escrowInfo] = await connection.getMultipleAccountsInfo(keys, "confirmed");
  if (!vaultInfo || vaultInfo.owner.toBase58() !== ALPHA_VAULT_PROGRAM) return null;
  if (!clockInfo) throw new Error("The clock was not read.");
  return {
    vault: decodeVault(vault, Buffer.from(vaultInfo.data)),
    escrow: escrow && escrowInfo && escrowInfo.owner.toBase58() === ALPHA_VAULT_PROGRAM ? decodeEscrow(escrow, Buffer.from(escrowInfo.data)) : null,
    clockUnix: clockUnixOf(Buffer.from(clockInfo.data)),
  };
}

/** What an escrow may claim at `point`: the vault's bought tokens dripped over the vesting, the escrow's share of them, less what it claimed (the SDK's `getClaimInfo`). */
export function claimInfoOf(vault: VaultFields, escrow: EscrowFields | null, point: number): Readonly<{ allocatedRaw: string; claimedRaw: string; claimableRaw: string }> {
  if (!escrow || BigInt(vault.totalDeposit) === 0n) return { allocatedRaw: "0", claimedRaw: escrow?.claimedToken ?? "0", claimableRaw: "0" };
  const bought = BigInt(vault.boughtToken);
  const deposit = BigInt(escrow.totalDeposit);
  const total = BigInt(vault.totalDeposit);
  const allocated = (bought * deposit) / total;
  const start = BigInt(vault.startVestingPoint);
  const end = BigInt(vault.endVestingPoint);
  const now = BigInt(point);
  let claimable = 0n;
  if (now >= start) {
    const until = now < end ? now : end;
    const dripped = (bought * (until + 1n - start)) / (end + 1n - start);
    claimable = (dripped * deposit) / total - BigInt(escrow.claimedToken);
    if (claimable < 0n) claimable = 0n;
  }
  return { allocatedRaw: allocated.toString(), claimedRaw: escrow.claimedToken, claimableRaw: claimable.toString() };
}

/** The USDC an escrow takes back once the vault has bought: its share of what the vault did not spend; zero once refunded. */
export function remainingQuoteOf(vault: VaultFields, escrow: EscrowFields | null): string {
  if (!escrow || escrow.refunded || BigInt(vault.totalDeposit) === 0n) return "0";
  const left = BigInt(vault.totalDeposit) - BigInt(vault.swappedAmount);
  return left > 0n ? ((left * BigInt(escrow.totalDeposit)) / BigInt(vault.totalDeposit)).toString() : "0";
}

/** How much more a wallet may deposit now: FCFS — under its cap and the vault's; Pro Rata — no limit but its balance. */
export function depositRoomOf(vault: VaultFields, escrow: EscrowFields | null): bigint | null {
  if (vault.vaultMode !== ALPHA_VAULT_MODE.FCFS) return null;
  const mine = BigInt(vault.individualDepositingCap) - BigInt(escrow?.totalDeposit ?? "0");
  const left = BigInt(vault.maxDepositingCap) - BigInt(vault.totalDeposit);
  const room = mine < left ? mine : left;
  return room > 0n ? room : 0n;
}

export type PoolFields = Readonly<{
  pool: Address;
  tokenAMint: Address;
  tokenBMint: Address;
  tokenAVault: Address;
  tokenBVault: Address;
  tokenAProgram: Address;
  tokenBProgram: Address;
  whitelistedVault: Address;
  activationPoint: string;
  activationType: number;
  collectFeeMode: number;
  liquidity: string;
  permanentLockLiquidity: string;
  sqrtPrice: string;
  sqrtMinPrice: string;
  sqrtMaxPrice: string;
  creator: Address;
}>;

/** The pool as the chain stores it; null when it is not there. */
export async function readEarlyAccessPool(connection: Connection, pool: Address): Promise<PoolFields | null> {
  const info = await connection.getAccountInfo(new PublicKey(pool), "confirmed");
  if (!info || info.owner.toBase58() !== DAMM_V2_PROGRAM) return null;
  return poolFieldsOf(pool, Buffer.from(info.data));
}

export function poolFieldsOf(pool: Address, data: Buffer): PoolFields {
  const state = plain(cpAmmCoder.accounts.decode("Pool", data)) as Record<string, unknown>;
  const flag = (value: unknown) => (Number(value) === 0 ? TOKEN_PROGRAM_ID.toBase58() : T22);
  return {
    pool,
    tokenAMint: String(state.tokenAMint),
    tokenBMint: String(state.tokenBMint),
    tokenAVault: String(state.tokenAVault),
    tokenBVault: String(state.tokenBVault),
    tokenAProgram: flag(state.tokenAFlag),
    tokenBProgram: flag(state.tokenBFlag),
    whitelistedVault: String(state.whitelistedVault),
    activationPoint: String(state.activationPoint),
    activationType: Number(state.activationType),
    collectFeeMode: Number(state.collectFeeMode),
    liquidity: String(state.liquidity),
    permanentLockLiquidity: String(state.permanentLockLiquidity),
    sqrtPrice: String(state.sqrtPrice),
    sqrtMinPrice: String(state.sqrtMinPrice),
    sqrtMaxPrice: String(state.sqrtMaxPrice),
    creator: String(state.creator),
  };
}

/** A mint as the chain stores it, for «Чесний лаунч» (`earlyAccessMintProblems`); null when it is not there. */
export async function readEarlyAccessMint(connection: Connection, mint: Address): Promise<EarlyAccessMintFields | null> {
  const key = new PublicKey(mint);
  const info = await connection.getAccountInfo(key, "confirmed");
  if (!info) return null;
  return mintFieldsOf(mint, info);
}

export function mintFieldsOf(mint: Address, info: Readonly<{ owner: PublicKey; data: Buffer; lamports: number; executable: boolean }>): EarlyAccessMintFields {
  const key = new PublicKey(mint);
  const program = info.owner.equals(TOKEN_2022) ? "token-2022" : info.owner.toBase58();
  const state = unpackMint(key, { ...info, data: Buffer.from(info.data) }, info.owner);
  const types = info.owner.equals(TOKEN_2022) ? getExtensionTypes(state.tlvData) : [];
  const pointer = info.owner.equals(TOKEN_2022) ? getMetadataPointerState(state) : null;
  const hook = info.owner.equals(TOKEN_2022) ? getTransferHook(state) : null;
  const metadataBytes = info.owner.equals(TOKEN_2022) ? getExtensionData(ExtensionType.TokenMetadata, state.tlvData) : null;
  let updateAuthority: string | null | undefined;
  try {
    updateAuthority = metadataBytes ? mintMetadataOf(metadataBytes).updateAuthority : undefined;
  } catch {
    updateAuthority = undefined;
  }
  return {
    mint,
    program,
    supplyRaw: state.supply.toString(),
    decimals: state.decimals,
    mintAuthority: state.mintAuthority?.toBase58() ?? null,
    freezeAuthority: state.freezeAuthority?.toBase58() ?? null,
    extensions: types.map((type) => ExtensionType[type] ?? String(type)),
    transferHookProgram: hook && !hook.programId.equals(PublicKey.default) ? hook.programId.toBase58() : null,
    metadataPointerAuthority: pointer?.authority?.toBase58() ?? null,
    metadataPointerAddress: pointer?.metadataAddress?.toBase58() ?? null,
    metadataUpdateAuthority: updateAuthority,
  };
}

/* ------------------------------------------------------ after creation */

type ProgramFor = ReturnType<typeof alphaVaultProgramOf>;

async function sealOne(connection: Connection, instructions: readonly TransactionInstruction[], feePayer: PublicKey): Promise<UnsignedTx> {
  return seal(instructions, feePayer, await connection.getLatestBlockhash("confirmed"), []);
}

async function vaultFor(connection: Connection, vault: Address, owner: Address | null): Promise<VaultRead> {
  const read = await readEarlyAccessVault(connection, vault, owner);
  if (!read) throw new EarlyAccessRefusal("NO_VAULT", "No alpha vault at this address.");
  return read;
}

/** The quote mint's token program, read once per build. */
async function programOfMint(connection: Connection, mint: Address): Promise<PublicKey> {
  const owner = (await connection.getAccountInfo(new PublicKey(mint), "confirmed"))?.owner;
  if (!owner) throw new EarlyAccessRefusal("NO_VAULT", "The vault's mint could not be read.");
  return owner;
}

const accountsOf = (program: ProgramFor, vault: VaultFields) => ({ program: program.programId, vault: new PublicKey(vault.address), pool: new PublicKey(vault.pool) });

/**
 * A deposit into the vault, the wallet its fee payer and only signer: its escrow opened first when it has none
 * (permissionless, no fee), the vault's own USDC account opened if no one has yet. Refused above what the wallet may
 * still deposit (FCFS) — the program refuses the rest, and the person should not pay a fee to learn it.
 */
export async function buildEarlyAccessDeposit(args: Readonly<{ connection: Connection; vault: Address; owner: Address; amountRaw: string }>): Promise<UnsignedTx & Readonly<{ escrow: Address; opensEscrow: boolean }>> {
  const { connection } = args;
  const amount = BigInt(args.amountRaw);
  if (amount <= 0n) throw new EarlyAccessRefusal("NOTHING_TO_DO", "A deposit is more than zero.");
  const read = await vaultFor(connection, args.vault, args.owner);
  const room = depositRoomOf(read.vault, read.escrow);
  if (room !== null && amount > room) throw new EarlyAccessRefusal("ABOVE_CAP", `This wallet may deposit at most ${room} more.`);
  const program = alphaVaultProgramOf(connection);
  const owner = new PublicKey(args.owner);
  const quoteMint = new PublicKey(read.vault.quoteMint);
  const quoteProgram = await programOfMint(connection, read.vault.quoteMint);
  const escrow = new PublicKey(escrowAddressOf(args.vault, args.owner));
  const base = accountsOf(program, read.vault);
  const instructions: TransactionInstruction[] = [];
  if (!read.escrow) {
    instructions.push(
      await program.methods.createNewEscrow().accountsPartial({ ...base, escrow, owner, payer: owner, systemProgram: SystemProgram.programId, escrowFeeReceiver: ALPHA_VAULT_TREASURY_ID }).instruction(),
    );
  }
  /* The vault's USDC account is its associated account (the SDK opens it on the first deposit); the deposit itself names
     the account the vault stores. */
  instructions.push(createAssociatedTokenAccountIdempotentInstruction(owner, getAssociatedTokenAddressSync(quoteMint, base.vault, true, quoteProgram), base.vault, quoteMint, quoteProgram));
  instructions.push(
    await program.methods
      .deposit(new BN(amount.toString()))
      .accountsPartial({ ...base, escrow, sourceToken: getAssociatedTokenAddressSync(quoteMint, owner, true, quoteProgram), tokenVault: new PublicKey(read.vault.tokenVault), tokenMint: quoteMint, owner, tokenProgram: quoteProgram })
      .instruction(),
  );
  return { ...(await sealOne(connection, instructions, owner)), escrow: escrow.toBase58(), opensEscrow: !read.escrow };
}

/** Pro Rata only, while deposits are open: part or all of a deposit back. */
export async function buildEarlyAccessWithdraw(args: Readonly<{ connection: Connection; vault: Address; owner: Address; amountRaw: string }>): Promise<UnsignedTx> {
  const { connection } = args;
  const read = await vaultFor(connection, args.vault, args.owner);
  if (read.vault.vaultMode !== ALPHA_VAULT_MODE.PRORATA) throw new EarlyAccessRefusal("NOT_NOW", "A first-come deposit cannot be taken back.");
  if (!read.escrow || BigInt(args.amountRaw) <= 0n || BigInt(args.amountRaw) > BigInt(read.escrow.totalDeposit)) throw new EarlyAccessRefusal("NOTHING_TO_DO", "Nothing of this size to take back.");
  const program = alphaVaultProgramOf(connection);
  const owner = new PublicKey(args.owner);
  const quoteMint = new PublicKey(read.vault.quoteMint);
  const quoteProgram = await programOfMint(connection, read.vault.quoteMint);
  const destinationToken = getAssociatedTokenAddressSync(quoteMint, owner, true, quoteProgram);
  return sealOne(connection, [
    createAssociatedTokenAccountIdempotentInstruction(owner, destinationToken, owner, quoteMint, quoteProgram),
    await program.methods
      .withdraw(new BN(args.amountRaw))
      .accountsPartial({ ...accountsOf(program, read.vault), escrow: new PublicKey(read.escrow.address), destinationToken, owner, tokenVault: new PublicKey(read.vault.tokenVault), tokenMint: quoteMint, tokenProgram: quoteProgram })
      .instruction(),
  ], owner);
}

/** After the purchase: the USDC the vault did not spend, the wallet's share of it. */
export async function buildEarlyAccessWithdrawRemaining(args: Readonly<{ connection: Connection; vault: Address; owner: Address }>): Promise<UnsignedTx & Readonly<{ amountRaw: string }>> {
  const { connection } = args;
  const read = await vaultFor(connection, args.vault, args.owner);
  const amountRaw = remainingQuoteOf(read.vault, read.escrow);
  if (!read.escrow || amountRaw === "0") throw new EarlyAccessRefusal("NOTHING_TO_DO", "Nothing to take back.");
  const program = alphaVaultProgramOf(connection);
  const owner = new PublicKey(args.owner);
  const quoteMint = new PublicKey(read.vault.quoteMint);
  const quoteProgram = await programOfMint(connection, read.vault.quoteMint);
  const destinationToken = getAssociatedTokenAddressSync(quoteMint, owner, true, quoteProgram);
  const tx = await sealOne(connection, [
    createAssociatedTokenAccountIdempotentInstruction(owner, destinationToken, owner, quoteMint, quoteProgram),
    await program.methods
      .withdrawRemainingQuote()
      .accountsPartial({ ...accountsOf(program, read.vault), escrow: new PublicKey(read.escrow.address), owner, destinationToken, tokenVault: new PublicKey(read.vault.tokenVault), tokenMint: quoteMint, tokenProgram: quoteProgram })
      .instruction(),
  ], owner);
  return { ...tx, amountRaw };
}

/** The tokens vested so far, into the wallet's Token-2022 account (opened if it has none). */
export async function buildEarlyAccessClaim(args: Readonly<{ connection: Connection; vault: Address; owner: Address }>): Promise<UnsignedTx & Readonly<{ amountRaw: string }>> {
  const { connection } = args;
  const read = await vaultFor(connection, args.vault, args.owner);
  if (!read.escrow) throw new EarlyAccessRefusal("NOT_YOURS", "This wallet has no deposit in the vault.");
  const amountRaw = claimInfoOf(read.vault, read.escrow, read.clockUnix).claimableRaw;
  if (amountRaw === "0") throw new EarlyAccessRefusal("NOTHING_TO_DO", "Nothing has vested to claim yet.");
  const program = alphaVaultProgramOf(connection);
  const owner = new PublicKey(args.owner);
  const baseMint = new PublicKey(read.vault.baseMint);
  const baseProgram = await programOfMint(connection, read.vault.baseMint);
  const destinationToken = getAssociatedTokenAddressSync(baseMint, owner, true, baseProgram);
  const tx = await sealOne(connection, [
    createAssociatedTokenAccountIdempotentInstruction(owner, destinationToken, owner, baseMint, baseProgram),
    await program.methods
      .claimToken()
      .accountsPartial({ vault: new PublicKey(read.vault.address), escrow: new PublicKey(read.escrow.address), owner, destinationToken, tokenOutVault: new PublicKey(read.vault.tokenOutVault), tokenMint: baseMint, tokenProgram: baseProgram, program: program.programId })
      .instruction(),
  ], owner);
  return { ...tx, amountRaw };
}

/**
 * The vault's purchase — permissionless: any wallet may send it in the hour before activation, and pays its fee. It
 * buys with everything deposited up to the cap (the program takes the cap itself on Pro Rata). Meteora's crank fee, when
 * the cranker is not on Meteora's list, goes to Meteora's treasury — never to Ryntra.
 */
export async function buildEarlyAccessFill(args: Readonly<{ connection: Connection; vault: Address; cranker: Address }>): Promise<UnsignedTx> {
  const { connection } = args;
  const read = await vaultFor(connection, args.vault, null);
  if (BigInt(read.vault.totalDeposit) === 0n) throw new EarlyAccessRefusal("NOTHING_TO_DO", "Nobody deposited: the vault has nothing to buy with.");
  if (BigInt(read.vault.swappedAmount) > 0n) throw new EarlyAccessRefusal("NOTHING_TO_DO", "The vault has bought already.");
  const pool = await readEarlyAccessPool(connection, read.vault.pool);
  if (!pool) throw new EarlyAccessRefusal("NO_POOL", "The vault's pool could not be read.");
  const program = alphaVaultProgramOf(connection);
  const cranker = new PublicKey(args.cranker);
  const vaultKey = new PublicKey(read.vault.address);
  const [crankFeeWhitelist] = deriveCrankFeeWhitelist(cranker, program.programId);
  const whitelisted = (await connection.getAccountInfo(crankFeeWhitelist, "confirmed")) !== null;
  const tokenOutVault = getAssociatedTokenAddressSync(new PublicKey(read.vault.baseMint), vaultKey, true, new PublicKey(pool.tokenAProgram));
  const ammProgram = CP_AMM_PROGRAM_ID;
  const [dammEventAuthority] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], ammProgram);
  const fill = await program.methods
    .fillDammV2(new BN(read.vault.totalDeposit))
    .accountsPartial({
      vault: vaultKey,
      tokenVault: new PublicKey(read.vault.tokenVault),
      tokenOutVault,
      ammProgram,
      pool: new PublicKey(read.vault.pool),
      poolAuthority: derivePoolAuthority(),
      tokenAMint: new PublicKey(pool.tokenAMint),
      tokenBMint: new PublicKey(pool.tokenBMint),
      tokenAVault: new PublicKey(pool.tokenAVault),
      tokenBVault: new PublicKey(pool.tokenBVault),
      tokenAProgram: new PublicKey(pool.tokenAProgram),
      tokenBProgram: new PublicKey(pool.tokenBProgram),
      cranker,
      crankFeeReceiver: whitelisted ? program.programId : ALPHA_VAULT_TREASURY_ID,
      crankFeeWhitelist: whitelisted ? crankFeeWhitelist : program.programId,
      dammEventAuthority,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return sealOne(connection, [
    createAssociatedTokenAccountIdempotentInstruction(cranker, tokenOutVault, vaultKey, new PublicKey(read.vault.baseMint), new PublicKey(pool.tokenAProgram)),
    fill,
  ], cranker);
}

/** The pool's vaults, for a check that a build names the accounts it should (the SDK derives them the same way). */
export function poolVaultsOf(mint: Address, quoteMint: Address): Readonly<{ pool: Address; tokenAVault: Address; tokenBVault: Address; position: (nft: Address) => Address; positionNftAccount: (nft: Address) => Address }> {
  const pool = deriveCustomizablePoolAddress(new PublicKey(mint), new PublicKey(quoteMint));
  return {
    pool: pool.toBase58(),
    tokenAVault: deriveTokenVaultAddress(new PublicKey(mint), pool).toBase58(),
    tokenBVault: deriveTokenVaultAddress(new PublicKey(quoteMint), pool).toBase58(),
    position: (nft) => derivePositionAddress(new PublicKey(nft)).toBase58(),
    positionNftAccount: (nft) => derivePositionNftAccount(new PublicKey(nft)).toBase58(),
  };
}
