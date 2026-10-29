import assert from "node:assert/strict";
import test from "node:test";

import * as alphaVault from "@meteora-ag/alpha-vault";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  CpAmm,
  MAX_SQRT_PRICE,
  Rounding,
  cpAmmCoder,
  getAmountAFromLiquidityDeltaForConcentratedLiquidity,
  getNextSqrtPriceFromInput,
  getPriceFromSqrtPrice,
} from "@meteora-ag/cp-amm-sdk";
import {
  AuthorityType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  decodeInitializeMintInstructionUnchecked,
  decodeMintToInstruction,
  decodeSetAuthorityInstruction,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import BN from "bn.js";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { DEVNET_EARLY_ACCESS_BOUNDS, earlyAccessFill, earlyAccessSchedule, supplyRawOf } from "../core/launch/early-access.ts";
import {
  ALPHA_VAULT_MODE,
  ALPHA_VAULT_POOL_TYPE,
  ALPHA_VAULT_PROGRAM,
  ALPHA_VAULT_WHITELIST,
  DAMM_V2_ACTIVATION,
  DAMM_V2_COLLECT,
  DAMM_V2_FEE_TIME_SCHEDULER_EXPONENTIAL,
  DAMM_V2_PROGRAM,
  EarlyAccessRefusal,
  buildEarlyAccessClaim,
  buildEarlyAccessCreation,
  buildEarlyAccessDeposit,
  buildEarlyAccessWithdraw,
  buildEarlyAccessWithdrawRemaining,
  claimInfoOf,
  decodeVault,
  depositRoomOf,
  earlyAccessCreationProblems,
  encodeAlphaVaultAccount,
  escrowAddressOf,
  mintInstructions,
  readEarlyAccessVault,
  remainingQuoteOf,
  vaultAddressOf,
} from "../core/venues/meteora-alpha-vault/early-access.server.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { launchNetwork } from "./config.server.ts";
import {
  EARLY_ACCESS_BOUNDS_ENV,
  EARLY_ACCESS_OWNER_WORD,
  earlyAccessBoundsFor,
  earlyAccessOpenFor,
  actionWindowProblem,
  earlyAccessView,
  parseEarlyAccessBounds,
  prepareEarlyAccess,
  prepareEarlyAccessAction,
  prepareEarlyAccessDeposit,
  readEarlyAccessRecord,
  submitEarlyAccess,
  submitEarlyAccessAction,
  submitEarlyAccessDeposit,
} from "./early-access.server.ts";
import { storeLaunchMetadata } from "./metadata.server.ts";

const NOW = 1_800_000_000;
const QUOTE = "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB"; // the devnet stand's test USDC
const URI = "https://stand.example/api/launch/metadata/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const FCFS = Object.freeze({
  mode: "FCFS",
  depositStartsAt: NOW + 600,
  depositEndsAt: NOW + 600 + 3_600,
  maxCapRaw: "10000000000",
  individualCapRaw: "500000000",
  vestingHours: 24,
  startMarketCapUsd: 50_000,
  supply: 1_000_000_000,
});
const PRO_RATA = Object.freeze({ ...FCFS, mode: "PRO_RATA", individualCapRaw: null });

/** A connection that answers from a map of accounts and records what it is sent; no network. */
function stubConnection(accounts = new Map()) {
  const sent = [];
  return {
    rpcEndpoint: "stub://early-access",
    sent,
    accounts,
    getMinimumBalanceForRentExemption: async (bytes) => 890_880 + bytes * 6_960,
    getLatestBlockhash: async () => ({ blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1_000 }),
    getAccountInfo: async (key) => accounts.get(key.toBase58()) ?? null,
    getMultipleAccountsInfo: async (keys) => keys.map((key) => accounts.get(key.toBase58()) ?? null),
    getTokenAccountBalance: async () => ({ value: { amount: "5", decimals: 6, uiAmount: 0.000005 } }),
    sendRawTransaction: async (bytes) => {
      sent.push(Transaction.from(bytes));
      return "sig";
    },
    confirmTransaction: async () => ({ context: { slot: 1 }, value: { err: null } }),
  };
}
const ownedBy = (owner, data = Buffer.alloc(0)) => ({ owner: new PublicKey(owner), data, lamports: 1_000_000, executable: false });
const clockAt = (unix) => {
  const data = Buffer.alloc(40);
  data.writeBigInt64LE(BigInt(unix), 32);
  return ownedBy("Sysvar1111111111111111111111111111111111111", data);
};

async function creation(rules = FCFS, creator = Keypair.generate()) {
  const connection = stubConnection(new Map([[QUOTE, ownedBy(TOKEN_PROGRAM_ID)]]));
  const built = await buildEarlyAccessCreation({ connection, creator: creator.publicKey.toBase58(), quoteMint: QUOTE, rules, name: "Early Owl", symbol: "EOWL", uri: URI });
  return { built, creator, connection, txs: built.txs.map((tx) => Transaction.from(Buffer.from(tx.wireBase64, "base64"))) };
}

const camelDecode = (coder, ix) => coder.instruction.decode(Buffer.from(ix.data));

test("the mirrored numbers are the SDKs' own", () => {
  assert.equal(ALPHA_VAULT_PROGRAM, alphaVault.PROGRAM_ID["mainnet-beta"]);
  assert.equal(ALPHA_VAULT_PROGRAM, alphaVault.PROGRAM_ID.devnet);
  assert.equal(ALPHA_VAULT_MODE.FCFS, alphaVault.VaultMode.FCFS);
  assert.equal(ALPHA_VAULT_MODE.PRORATA, alphaVault.VaultMode.PRORATA);
  assert.equal(ALPHA_VAULT_POOL_TYPE.DAMM_V2, alphaVault.PoolType.DAMMV2);
  assert.equal(ALPHA_VAULT_WHITELIST.PERMISSIONLESS, alphaVault.WhitelistMode.Permissionless);
  assert.equal(DAMM_V2_ACTIVATION.TIMESTAMP, ActivationType.Timestamp);
  assert.equal(DAMM_V2_COLLECT.ONLY_B, CollectFeeMode.OnlyB);
  assert.equal(DAMM_V2_FEE_TIME_SCHEDULER_EXPONENTIAL, BaseFeeMode.FeeTimeSchedulerExponential);
  assert.equal(DAMM_V2_PROGRAM, "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
});

test("the creation is three transactions the creator pays for, the fresh keys signed in", async () => {
  const { built, creator, txs } = await creation();
  assert.deepEqual(built.txs.map((tx) => tx.role), ["MINT", "POOL", "VAULT"]);
  for (const tx of txs) {
    assert.equal(tx.feePayer.toBase58(), creator.publicKey.toBase58());
    assert.ok(tx.serialize({ requireAllSignatures: false }).length <= 1_232);
  }
  const signed = (tx, key) => tx.signatures.find((entry) => entry.publicKey.equals(key))?.signature !== null;
  assert.ok(signed(txs[0], built.mintKey.publicKey), "the new mint signed its creation");
  assert.ok(signed(txs[1], built.positionNftKey.publicKey), "the position NFT signed the pool");
  assert.ok(!signed(txs[0], creator.publicKey), "the creator has not signed yet");
  assert.deepEqual(earlyAccessCreationProblems(built, { creator: creator.publicKey.toBase58(), rules: FCFS }), []);
});

test("the mint is honest: no freeze, the mint authority revoked after the supply, metadata in the mint and nobody may change it, no hook", async () => {
  const { built, creator, txs } = await creation();
  const ixs = txs[0].instructions;
  const programs = ixs.map((ix) => ix.programId.toBase58());
  assert.ok(programs.every((program) => [SystemProgram.programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58(), "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"].includes(program)));
  /* The account is the mint's, owned by Token-2022. */
  assert.equal(ixs[0].keys[1].pubkey.toBase58(), built.mint);
  assert.equal(new PublicKey(Buffer.from(ixs[0].data).subarray(20)).toBase58(), TOKEN_2022_PROGRAM_ID.toBase58());
  /* The metadata pointer: no authority, the mint itself. */
  const pointer = Buffer.from(ixs[1].data);
  assert.deepEqual([pointer[0], pointer[1]], [39, 0]);
  assert.ok(pointer.subarray(2, 34).every((byte) => byte === 0));
  assert.equal(new PublicKey(pointer.subarray(34, 66)).toBase58(), built.mint);
  /* The mint: six decimals, no freeze authority. */
  const init = decodeInitializeMintInstructionUnchecked(ixs[2]);
  assert.equal(init.data.decimals, 6);
  assert.equal(init.data.freezeAuthority, null);
  assert.equal(init.data.mintAuthority.toBase58(), creator.publicKey.toBase58());
  /* The metadata, then its update authority handed to nobody. */
  const update = Buffer.from(ixs[4].data);
  assert.ok(update.subarray(8, 40).every((byte) => byte === 0));
  assert.ok(Buffer.from(ixs[3].data).includes(Buffer.from("Early Owl")));
  /* The whole supply to the creator's token account, then the mint authority revoked. */
  const minted = decodeMintToInstruction(ixs[6], TOKEN_2022_PROGRAM_ID);
  assert.equal(minted.data.amount.toString(), supplyRawOf(FCFS).toString());
  assert.equal(minted.keys.destination.pubkey.toBase58(), built.creatorTokenAccount);
  const revoke = decodeSetAuthorityInstruction(ixs[7], TOKEN_2022_PROGRAM_ID);
  assert.equal(revoke.data.authorityType, AuthorityType.MintTokens);
  assert.equal(revoke.data.newAuthority, null);
  /* No transfer hook, no other extension: tag 36 is the hook's. */
  assert.ok(!ixs.some((ix) => ix.programId.equals(TOKEN_2022_PROGRAM_ID) && ix.data[0] === 36));
});

test("the pool: an alpha vault, opening 65 minutes after the last deposit, the whole supply single-sided, the position locked in the same transaction", async () => {
  const { built, creator, txs } = await creation();
  const decoded = txs[1].instructions.filter((ix) => ix.programId.toBase58() === DAMM_V2_PROGRAM).map((ix) => cpAmmCoder.instruction.decode(Buffer.from(ix.data)));
  assert.deepEqual(decoded.map((ix) => ix.name), ["initialize_customizable_pool", "permanent_lock_position"]);
  const params = decoded[0].data.params;
  assert.equal(params.has_alpha_vault, true);
  assert.equal(params.activation_type, ActivationType.Timestamp);
  assert.equal(params.activation_point.toString(), String(FCFS.depositEndsAt + 3_900));
  assert.equal(params.activation_point.toString(), String(earlyAccessSchedule(FCFS).activatesAt));
  assert.equal(params.collect_fee_mode, CollectFeeMode.OnlyB);
  assert.equal(params.sqrt_price.toString(), params.sqrt_min_price.toString());
  assert.equal(params.sqrt_max_price.toString(), MAX_SQRT_PRICE.toString());
  assert.equal(params.liquidity.toString(), built.liquidity);
  assert.equal(decoded[1].data.permanent_lock_liquidity.toString(), built.liquidity, "every unit of the position's liquidity is locked");
  /* The start price is the market cap over the supply. */
  assert.ok(Math.abs(Number(getPriceFromSqrtPrice(new BN(built.sqrtStartPrice), 6, 6)) - 0.00005) < 1e-12);
  /* The liquidity needs no more than the supply the creator holds. */
  const needed = getAmountAFromLiquidityDeltaForConcentratedLiquidity(new BN(built.sqrtStartPrice), MAX_SQRT_PRICE, new BN(built.liquidity), Rounding.Up);
  assert.ok(BigInt(needed.toString()) <= supplyRawOf(FCFS));
  assert.ok(supplyRawOf(FCFS) - BigInt(needed.toString()) < 10n);
  /* The pool's own vault is the one derived from its payer, the creator: no other vault can buy before activation. */
  assert.equal(built.vault, vaultAddressOf(creator.publicKey.toBase58(), built.pool));
});

test("the price math is the SDK's concentrated-liquidity swap", async () => {
  const { built } = await creation();
  for (const deposited of [1_000_000n, 10_000_000_000n, 3_333_000_000n]) {
    const fill = earlyAccessFill(FCFS, deposited);
    const net = new BN((BigInt(fill.spentRaw) - BigInt(fill.feeRaw)).toString());
    const sqrt = new BN(built.sqrtStartPrice);
    const next = getNextSqrtPriceFromInput(sqrt, new BN(built.liquidity), net, false);
    const out = BigInt(getAmountAFromLiquidityDeltaForConcentratedLiquidity(sqrt, next, new BN(built.liquidity), Rounding.Down).toString());
    const ours = BigInt(fill.tokensOutRaw);
    const diff = out > ours ? out - ours : ours - out;
    assert.ok(diff * 1_000_000n <= out, `within a millionth at ${deposited}: ${ours} vs ${out}`);
    const priceAfter = Number(getPriceFromSqrtPrice(next, 6, 6));
    assert.ok(Math.abs(priceAfter - fill.priceAfterUsd) / priceAfter < 1e-6);
  }
});

test("the vault: the rules' mode, caps and vesting, permissionless, no escrow fee", async () => {
  for (const rules of [FCFS, PRO_RATA]) {
    const { built, creator, txs } = await creation(rules);
    const program = alphaVault.createProgram(stubConnection());
    assert.equal(txs[2].instructions.length, 1);
    const ix = txs[2].instructions[0];
    assert.equal(ix.programId.toBase58(), ALPHA_VAULT_PROGRAM);
    const decoded = camelDecode(program.coder, ix);
    assert.equal(decoded.name, rules.mode === "FCFS" ? "initializeFcfsVault" : "initializeProrataVault");
    const p = decoded.data.params;
    const schedule = earlyAccessSchedule(rules);
    assert.equal(p.poolType, alphaVault.PoolType.DAMMV2);
    assert.equal(p.baseMint.toBase58(), built.mint);
    assert.equal(p.quoteMint.toBase58(), QUOTE);
    assert.equal(p.depositingPoint.toString(), String(rules.depositStartsAt));
    assert.equal(p.startVestingPoint.toString(), String(schedule.vestingStartsAt));
    assert.equal(p.endVestingPoint.toString(), String(schedule.vestingStartsAt + 24 * 3_600));
    assert.equal(p.escrowFee.toString(), "0");
    assert.equal(p.whitelistMode, alphaVault.WhitelistMode.Permissionless);
    if (rules.mode === "FCFS") {
      assert.equal(p.maxDepositingCap.toString(), rules.maxCapRaw);
      assert.equal(p.individualDepositingCap.toString(), rules.individualCapRaw);
    } else assert.equal(p.maxBuyingCap.toString(), rules.maxCapRaw);
    /* Base and funder: the creator, whose signature the vault's address needs. */
    assert.deepEqual(ix.keys.map((key) => key.pubkey.toBase58()).slice(0, 4), [built.vault, built.pool, creator.publicKey.toBase58(), creator.publicKey.toBase58()]);
  }
});

test("nothing pays Ryntra: no transfer anywhere, no Ryntra address in any transaction", async () => {
  const { txs } = await creation();
  const ryntra = new Set(ATTRIBUTION_REGISTRY.filter((row) => row.address).map((row) => row.address));
  for (const tx of txs) {
    for (const ix of tx.instructions) {
      for (const key of ix.keys) assert.ok(!ryntra.has(key.pubkey.toBase58()), `no Ryntra account in ${ix.programId.toBase58()}`);
      if (ix.programId.equals(SystemProgram.programId)) assert.equal(Buffer.from(ix.data).readUInt32LE(0), 0, "the only system call creates the mint");
      /* Token Transfer (3) and TransferChecked (12): never issued by the creation itself. */
      if (ix.programId.equals(TOKEN_2022_PROGRAM_ID) || ix.programId.equals(TOKEN_PROGRAM_ID)) assert.ok(![3, 12].includes(ix.data[0]));
    }
  }
});

test("a creation that breaks a rule is caught before any wallet sees it", async () => {
  const { built, creator, txs } = await creation();
  const expected = { creator: creator.publicKey.toBase58(), rules: FCFS };
  const reseal = (index, instructions) => {
    const tx = new Transaction({ feePayer: creator.publicKey, blockhash: txs[index].recentBlockhash, lastValidBlockHeight: 1_000 }).add(...instructions);
    const copy = [...built.txs];
    copy[index] = { ...copy[index], wireBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64") };
    return { ...built, txs: copy };
  };
  /* A freeze authority. */
  const frozen = txs[0].instructions.map((ix, at) => (at === 2 ? createInitializeMintInstruction(new PublicKey(built.mint), 6, creator.publicKey, creator.publicKey, TOKEN_2022_PROGRAM_ID) : ix));
  assert.match(earlyAccessCreationProblems(reseal(0, frozen), expected).join(), /freeze authority/);
  /* The mint authority kept. */
  assert.match(earlyAccessCreationProblems(reseal(0, txs[0].instructions.slice(0, 7)), expected).join(), /not revoked/);
  /* A lamport transfer slipped in. */
  const paying = [...txs[0].instructions, SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })];
  assert.match(earlyAccessCreationProblems(reseal(0, paying), expected).join(), /moves lamports/);
  /* The lock dropped. */
  const unlocked = txs[1].instructions.filter((ix) => !(ix.programId.toBase58() === DAMM_V2_PROGRAM && cpAmmCoder.instruction.decode(Buffer.from(ix.data))?.name === "permanent_lock_position"));
  assert.match(earlyAccessCreationProblems(reseal(1, unlocked), expected).join(), /not locked for ever/);
  /* A pool without an alpha vault. */
  const cpAmm = new CpAmm(stubConnection());
  const plain = await cpAmm.createCustomPool({
    payer: creator.publicKey,
    creator: creator.publicKey,
    positionNft: built.positionNftKey.publicKey,
    tokenAMint: new PublicKey(built.mint),
    tokenBMint: new PublicKey(QUOTE),
    tokenAAmount: new BN(supplyRawOf(FCFS).toString()),
    tokenBAmount: new BN(0),
    sqrtMinPrice: new BN(built.sqrtStartPrice),
    sqrtMaxPrice: MAX_SQRT_PRICE,
    liquidityDelta: new BN(built.liquidity),
    initSqrtPrice: new BN(built.sqrtStartPrice),
    poolFees: (await import("../core/venues/meteora-alpha-vault/early-access.server.ts")).earlyAccessPoolFees(),
    hasAlphaVault: false,
    activationType: 1,
    collectFeeMode: 1,
    activationPoint: null,
    tokenAProgram: TOKEN_2022_PROGRAM_ID,
    tokenBProgram: TOKEN_PROGRAM_ID,
    isLockLiquidity: true,
  });
  const problems = earlyAccessCreationProblems(reseal(1, plain.tx.instructions), expected).join();
  assert.match(problems, /no alpha vault/);
  assert.match(problems, /does not open/);
  /* The vault's terms changed: another vault mode. */
  const prorata = await creation(PRO_RATA, creator);
  assert.match(earlyAccessCreationProblems({ ...built, txs: [built.txs[0], built.txs[1], prorata.built.txs[2]] }, expected).join(), /not first-come/);
});

test("an allowlisted vault waits for the Growth line's ranks", async () => {
  const connection = stubConnection(new Map([[QUOTE, ownedBy(TOKEN_PROGRAM_ID)]]));
  await assert.rejects(
    buildEarlyAccessCreation({ connection, creator: Keypair.generate().publicKey.toBase58(), quoteMint: QUOTE, rules: FCFS, name: "A", symbol: "A", uri: URI, allowlist: { kind: "MERKLE", source: "growth-ranks", root: "00", version: 0 } }),
    (error) => error instanceof EarlyAccessRefusal && error.code === "ALLOWLIST_LATER",
  );
});

test("mintInstructions alone never names Ryntra and moves nothing but the mint's rent", () => {
  const creator = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const ixs = mintInstructions({ creator, mint, rules: FCFS, name: "N", symbol: "S", uri: URI, rentLamports: 5_000_000 });
  assert.equal(ixs.filter((ix) => ix.programId.equals(SystemProgram.programId)).length, 1);
});

/* ------------------------------------------------- the vault read back */

const ZERO = new PublicKey(new Uint8Array(32));
async function vaultAccount(fields) {
  const value = {
    pool: Keypair.generate().publicKey,
    tokenVault: Keypair.generate().publicKey,
    tokenOutVault: Keypair.generate().publicKey,
    quoteMint: new PublicKey(QUOTE),
    baseMint: Keypair.generate().publicKey,
    base: Keypair.generate().publicKey,
    owner: ZERO,
    maxBuyingCap: new BN(0),
    totalDeposit: new BN(0),
    totalEscrow: new BN(0),
    swappedAmount: new BN(0),
    boughtToken: new BN(0),
    totalRefund: new BN(0),
    totalClaimedToken: new BN(0),
    startVestingPoint: new BN(NOW + 5_000),
    endVestingPoint: new BN(NOW + 5_000 + 86_400),
    bump: 255,
    poolType: 2,
    vaultMode: 1,
    padding0: [0, 0, 0, 0, 0],
    maxDepositingCap: new BN(FCFS.maxCapRaw),
    individualDepositingCap: new BN(FCFS.individualCapRaw),
    depositingPoint: new BN(FCFS.depositStartsAt),
    escrowFee: new BN(0),
    totalEscrowFee: new BN(0),
    whitelistMode: 0,
    activationType: 1,
    padding1: [0, 0, 0, 0, 0, 0],
    vaultAuthority: ZERO,
    padding: [new BN(0), new BN(0), new BN(0), new BN(0), new BN(0)],
    ...fields,
  };
  return { value, data: await encodeAlphaVaultAccount("vault", value) };
}
async function escrowAccount(vault, owner, fields) {
  const value = { vault, owner, totalDeposit: new BN(0), claimedToken: new BN(0), lastClaimedPoint: new BN(0), refunded: 0, padding1: [0, 0, 0, 0, 0, 0, 0], maxCap: new BN(0), withdrawnDepositOverflow: new BN(0), padding: [new BN(0)], ...fields };
  return encodeAlphaVaultAccount("escrow", value);
}

test("a vault and an escrow read back, and what a wallet may claim, take back and still deposit", async () => {
  const vaultKey = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const { value, data } = await vaultAccount({ totalDeposit: new BN(8_000_000_000), totalEscrow: new BN(2), swappedAmount: new BN(7_000_000_000), boughtToken: new BN(1_000_000_000_000) });
  const escrow = escrowAddressOf(vaultKey.toBase58(), owner.toBase58());
  const connection = stubConnection(
    new Map([
      [vaultKey.toBase58(), ownedBy(ALPHA_VAULT_PROGRAM, data)],
      ["SysvarC1ock11111111111111111111111111111111", clockAt(NOW + 5_000 + 43_200)],
      [escrow, ownedBy(ALPHA_VAULT_PROGRAM, await escrowAccount(vaultKey, owner, { totalDeposit: new BN(2_000_000_000), claimedToken: new BN(100) }))],
    ]),
  );
  const read = await readEarlyAccessVault(connection, vaultKey.toBase58(), owner.toBase58());
  assert.equal(read.vault.pool, value.pool.toBase58());
  assert.equal(read.vault.totalDeposit, "8000000000");
  assert.equal(read.vault.vaultMode, ALPHA_VAULT_MODE.FCFS);
  assert.equal(read.escrow.totalDeposit, "2000000000");
  assert.equal(read.clockUnix, NOW + 5_000 + 43_200);
  /* A quarter of the deposits: a quarter of the tokens, half of them vested halfway through. */
  const claim = claimInfoOf(read.vault, read.escrow, read.clockUnix);
  assert.equal(claim.allocatedRaw, "250000000000");
  const half = (1_000_000_000_000n * 43_201n) / 86_401n;
  assert.equal(claim.claimableRaw, ((half * 2_000_000_000n) / 8_000_000_000n - 100n).toString());
  assert.equal(claimInfoOf(read.vault, read.escrow, NOW).claimableRaw, "0", "nothing before vesting starts");
  assert.equal(claimInfoOf(read.vault, read.escrow, NOW + 10_000_000).claimableRaw, (250_000_000_000n - 100n).toString(), "all of it after the end");
  /* A quarter of the 1 000 USDC not spent comes back. */
  assert.equal(remainingQuoteOf(read.vault, read.escrow), "250000000");
  assert.equal(remainingQuoteOf(read.vault, { ...read.escrow, refunded: true }), "0");
  /* FCFS room: 500 USDC per wallet, this wallet already put 2 000 in — none left; a fresh wallet gets its 500. */
  assert.equal(depositRoomOf(read.vault, read.escrow), 0n);
  assert.equal(depositRoomOf(read.vault, null), 500_000_000n);
  assert.equal(depositRoomOf({ ...read.vault, vaultMode: ALPHA_VAULT_MODE.PRORATA }, null), null);
  /* Not the program's account: no vault. */
  assert.equal(await readEarlyAccessVault(stubConnection(), vaultKey.toBase58()), null);
  assert.deepEqual(decodeVault(vaultKey.toBase58(), data).depositingPoint, String(FCFS.depositStartsAt));
});

test("a deposit opens the escrow first, refuses above the wallet's room; a first-come deposit cannot be withdrawn", async () => {
  const vaultKey = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const { data } = await vaultAccount({});
  const accounts = new Map([
    [vaultKey.toBase58(), ownedBy(ALPHA_VAULT_PROGRAM, data)],
    ["SysvarC1ock11111111111111111111111111111111", clockAt(NOW + 700)],
    [QUOTE, ownedBy(TOKEN_PROGRAM_ID)],
  ]);
  const connection = stubConnection(accounts);
  const program = alphaVault.createProgram(connection);
  const built = await buildEarlyAccessDeposit({ connection, vault: vaultKey.toBase58(), owner: owner.toBase58(), amountRaw: "100000000" });
  const tx = Transaction.from(Buffer.from(built.wireBase64, "base64"));
  assert.equal(tx.feePayer.toBase58(), owner.toBase58());
  assert.equal(tx.signatures.length, 1, "the wallet is the only signer");
  const names = tx.instructions.filter((ix) => ix.programId.toBase58() === ALPHA_VAULT_PROGRAM).map((ix) => program.coder.instruction.decode(Buffer.from(ix.data)).name);
  assert.deepEqual(names, ["createNewEscrow", "deposit"]);
  assert.equal(built.opensEscrow, true);
  await assert.rejects(buildEarlyAccessDeposit({ connection, vault: vaultKey.toBase58(), owner: owner.toBase58(), amountRaw: "500000001" }), (error) => error.code === "ABOVE_CAP");
  await assert.rejects(buildEarlyAccessDeposit({ connection, vault: vaultKey.toBase58(), owner: owner.toBase58(), amountRaw: "0" }), (error) => error.code === "NOTHING_TO_DO");
  /* With an escrow, no second one is opened. */
  accounts.set(escrowAddressOf(vaultKey.toBase58(), owner.toBase58()), ownedBy(ALPHA_VAULT_PROGRAM, await escrowAccount(vaultKey, owner, { totalDeposit: new BN(100_000_000) })));
  const again = await buildEarlyAccessDeposit({ connection, vault: vaultKey.toBase58(), owner: owner.toBase58(), amountRaw: "100000000" });
  assert.equal(again.opensEscrow, false);
  await assert.rejects(buildEarlyAccessWithdraw({ connection, vault: vaultKey.toBase58(), owner: owner.toBase58(), amountRaw: "1" }), (error) => error.code === "NOT_NOW");
  /* Nothing bought, nothing vested: nothing to claim. */
  await assert.rejects(buildEarlyAccessClaim({ connection, vault: vaultKey.toBase58(), owner: owner.toBase58() }), (error) => error.code === "NOTHING_TO_DO");
  /* After a purchase that spent 400 of 500 USDC deposited, this wallet's fifth of the 100 left comes back, and its tokens vest. */
  const after = await vaultAccount({ totalDeposit: new BN(500_000_000), swappedAmount: new BN(400_000_000), boughtToken: new BN(1_000_000), startVestingPoint: new BN(NOW), endVestingPoint: new BN(NOW + 10) });
  accounts.set(vaultKey.toBase58(), ownedBy(ALPHA_VAULT_PROGRAM, after.data));
  accounts.set("SysvarC1ock11111111111111111111111111111111", clockAt(NOW + 100));
  const back = await buildEarlyAccessWithdrawRemaining({ connection, vault: vaultKey.toBase58(), owner: owner.toBase58() });
  assert.equal(back.amountRaw, "20000000");
  const names2 = (wire) => Transaction.from(Buffer.from(wire, "base64")).instructions.filter((ix) => ix.programId.toBase58() === ALPHA_VAULT_PROGRAM).map((ix) => program.coder.instruction.decode(Buffer.from(ix.data)).name);
  assert.deepEqual(names2(back.wireBase64), ["withdrawRemainingQuote"]);
  accounts.set(after.value.baseMint.toBase58(), ownedBy(TOKEN_2022_PROGRAM_ID));
  const claim = await buildEarlyAccessClaim({ connection, vault: vaultKey.toBase58(), owner: owner.toBase58() });
  assert.equal(claim.amountRaw, "200000");
  assert.deepEqual(names2(claim.wireBase64), ["claimToken"]);
});

/* -------------------------------------------------------------- gating */

test("gating: the devnet stand is open;", () => {
  const bounds = JSON.stringify(DEVNET_EARLY_ACCESS_BOUNDS);
  assert.equal(EARLY_ACCESS_OWNER_WORD, false);
  assert.equal(earlyAccessOpenFor("devnet", {}), true);
  assert.equal(earlyAccessBoundsFor("devnet", {}), DEVNET_EARLY_ACCESS_BOUNDS);
  assert.equal(earlyAccessOpenFor("mainnet", {}), false);
  assert.equal(earlyAccessOpenFor("mainnet", { [EARLY_ACCESS_BOUNDS_ENV]: bounds }), false, "bounds alone do not open it");
  assert.equal(earlyAccessOpenFor({ cluster: "mainnet" }, { [EARLY_ACCESS_BOUNDS_ENV]: bounds }, true), true, "bounds and the word do");
  assert.equal(earlyAccessOpenFor("mainnet", {}, true), false, "the word without bounds does not");
  assert.equal(earlyAccessOpenFor("mainnet", { [EARLY_ACCESS_BOUNDS_ENV]: "{not json" }, true), false);
  assert.equal(earlyAccessOpenFor("mainnet", { [EARLY_ACCESS_BOUNDS_ENV]: JSON.stringify({ ...DEVNET_EARLY_ACCESS_BOUNDS, maxPresaleBps: 0 }) }, true), false);
  assert.deepEqual(parseEarlyAccessBounds(bounds), JSON.parse(bounds));
  assert.equal(parseEarlyAccessBounds(undefined), null);
});

/* ------------------------------------------------- the flow, on a stand */

const ENV = { BETA_TOKEN_SECRET: "a-server-key-long-enough" };

async function standDeps(overrides = {}) {
  const network = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" });
  const store = createMemoryGuardStore();
  const clock = { now: NOW };
  const connection = stubConnection(new Map([[QUOTE, ownedBy(TOKEN_PROGRAM_ID)]]));
  const stored = await storeLaunchMetadata(store, { name: "Early Owl", symbol: "EOWL", description: "", image: "https://ryntra.io/api/launch/image/x", createdOn: "https://ryntra.io" }, "t");
  return {
    deps: { network, connection, store, now: () => new Date(clock.now * 1_000), env: ENV, origin: "https://ryntra.io", second: null, ...overrides },
    clock,
    connection,
    metadataUri: `https://ryntra.io/api/launch/metadata/${stored.sha256}`,
  };
}
const signAll = (wires, ...keys) =>
  wires.map((wire) => {
    const tx = Transaction.from(Buffer.from(wire, "base64"));
    tx.partialSign(...keys);
    return tx.serialize({ requireAllSignatures: false }).toString("base64");
  });

test("on mainnet nothing is built", async () => {
  const { deps, metadataUri } = await standDeps();
  const mainnet = { ...deps, network: { ...deps.network, cluster: "mainnet" }, env: { ...ENV, [EARLY_ACCESS_BOUNDS_ENV]: JSON.stringify(DEVNET_EARLY_ACCESS_BOUNDS) } };
  const refused = await prepareEarlyAccess(mainnet, { creator: Keypair.generate().publicKey.toBase58(), metadataUri, rules: FCFS });
  assert.equal(refused.code, "LAUNCH_PAUSED");
  const deposit = await prepareEarlyAccessDeposit(mainnet, Keypair.generate().publicKey.toBase58(), { wallet: Keypair.generate().publicKey.toBase58(), amountRaw: "1" });
  assert.equal(deposit.code, "LAUNCH_PAUSED");
});

test("build → the creator signs → submit: the exact messages, the fresh keys after the creator, sent in order, recorded", async () => {
  const { deps, connection, metadataUri } = await standDeps();
  const creator = Keypair.generate();
  const bad = await prepareEarlyAccess(deps, { creator: creator.publicKey.toBase58(), metadataUri, rules: { ...FCFS, individualCapRaw: null } });
  assert.equal(bad.code, "VALIDATION_ERROR");
  const missing = await prepareEarlyAccess(deps, { creator: creator.publicKey.toBase58(), metadataUri: URI, rules: FCFS });
  assert.equal(missing.code, "LAUNCH_NOT_FOUND");
  const noKey = await prepareEarlyAccess({ ...deps, env: {} }, { creator: creator.publicKey.toBase58(), metadataUri, rules: FCFS });
  assert.equal(noKey.code, "LAUNCH_PAUSED");

  const built = await prepareEarlyAccess(deps, { creator: creator.publicKey.toBase58(), metadataUri, rules: FCFS });
  assert.equal(built.ok, true, built.message);
  assert.equal(built.unsignedWireBase64.length, 3);
  assert.equal(built.schedule.activatesAt, FCFS.depositEndsAt + 3_900);
  assert.ok(built.lines.uk.length > 5 && built.lines.en.length === built.lines.uk.length);
  /* The wallet sees bytes nobody has signed. */
  for (const wire of built.unsignedWireBase64) assert.ok(Transaction.from(Buffer.from(wire, "base64")).signatures.every((entry) => entry.signature === null || entry.signature.every((byte) => byte === 0)));

  /* Other bytes are refused, nothing sent. */
  const other = await prepareEarlyAccess(deps, { creator: creator.publicKey.toBase58(), metadataUri, rules: FCFS });
  const mixed = await submitEarlyAccess(deps, { buildId: built.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: signAll([other.unsignedWireBase64[0], ...built.unsignedWireBase64.slice(1)], creator) });
  assert.equal(mixed.code, "LAUNCH_SIGNED_OTHER_BYTES");
  const unsigned = await submitEarlyAccess(deps, { buildId: built.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: built.unsignedWireBase64 });
  assert.equal(unsigned.code, "LAUNCH_SIGNED_OTHER_BYTES");
  const wrong = await submitEarlyAccess(deps, { buildId: built.buildId, creator: Keypair.generate().publicKey.toBase58(), signedWireBase64: signAll(built.unsignedWireBase64, creator) });
  assert.equal(wrong.code, "WALLET_MISMATCH");
  assert.equal(connection.sent.length, 0);

  const sent = await submitEarlyAccess(deps, { buildId: built.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: signAll(built.unsignedWireBase64, creator) });
  assert.equal(sent.ok, true, sent.message);
  assert.equal(sent.state, "OPEN");
  assert.deepEqual(Object.values(sent.steps).map((step) => step.state), ["CONFIRMED", "CONFIRMED", "CONFIRMED"]);
  assert.equal(connection.sent.length, 3);
  for (const tx of connection.sent) assert.ok(tx.verifySignatures(true), "every signature real, the fresh keys' after the creator's");
  assert.equal(connection.sent[0].signatures.length, 2);
  assert.equal(connection.sent[2].signatures.length, 1);

  const record = await readEarlyAccessRecord(deps.store, "devnet", built.mint);
  assert.equal(record.state, "OPEN");
  assert.equal(record.ryntraShareBps, 0);
  assert.equal(record.vault, built.vault);
  assert.deepEqual(record.rules, FCFS);
  const twice = await submitEarlyAccess(deps, { buildId: built.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: signAll(built.unsignedWireBase64, creator) });
  assert.equal(twice.code, "LAUNCH_BUILD_USED");
});

test("the creator must hold a unit of USDC; a third launch in a day is refused", async () => {
  const { deps, metadataUri, connection } = await standDeps();
  connection.getTokenAccountBalance = async () => ({ value: { amount: "0", decimals: 6, uiAmount: 0 } });
  const creator = Keypair.generate().publicKey.toBase58();
  assert.equal((await prepareEarlyAccess(deps, { creator, metadataUri, rules: FCFS })).code, "LAUNCH_BALANCE_LOW");
  connection.getTokenAccountBalance = async () => ({ value: { amount: "1", decimals: 6, uiAmount: 0.000001 } });
  const signer = Keypair.generate();
  for (let launched = 0; launched < 3; launched += 1) {
    const built = await prepareEarlyAccess(deps, { creator: signer.publicKey.toBase58(), metadataUri, rules: FCFS });
    assert.equal((await submitEarlyAccess(deps, { buildId: built.buildId, creator: signer.publicKey.toBase58(), signedWireBase64: signAll(built.unsignedWireBase64, signer) })).ok, true);
  }
  assert.equal((await prepareEarlyAccess(deps, { creator: signer.publicKey.toBase58(), metadataUri, rules: FCFS })).code, "LAUNCH_LIMIT");
});

test("a refused first step leaves no launch; a refused second step is said as a part", async () => {
  const { deps, metadataUri, connection, clock } = await standDeps();
  const creator = Keypair.generate();
  const built = await prepareEarlyAccess(deps, { creator: creator.publicKey.toBase58(), metadataUri, rules: FCFS });
  const original = connection.sendRawTransaction;
  connection.sendRawTransaction = async () => {
    const error = new Error("Transaction simulation failed: custom program error");
    error.logs = ["refused"];
    throw error;
  };
  const refused = await submitEarlyAccess(deps, { buildId: built.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: signAll(built.unsignedWireBase64, creator) });
  assert.equal(refused.code, "LAUNCH_SUBMIT_FAILED");
  assert.equal(await readEarlyAccessRecord(deps.store, "devnet", built.mint), null);

  let calls = 0;
  connection.sendRawTransaction = async (bytes) => {
    calls += 1;
    if (calls === 2) {
      const error = new Error("Transaction simulation failed: pool refused");
      error.logs = ["refused"];
      throw error;
    }
    return original(bytes);
  };
  const next = await prepareEarlyAccess(deps, { creator: creator.publicKey.toBase58(), metadataUri, rules: FCFS });
  const partial = await submitEarlyAccess(deps, { buildId: next.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: signAll(next.unsignedWireBase64, creator) });
  assert.equal(partial.state, "PARTIAL");
  assert.deepEqual([partial.steps.MINT.state, partial.steps.POOL.state, partial.steps.VAULT.state], ["CONFIRMED", "FAILED", "NOT_SENT"]);
  /* A launch not on the network whole takes no deposit, whatever the clock says. */
  clock.now = next.schedule.depositStartsAt + 60;
  const deposit = await prepareEarlyAccessDeposit(deps, next.mint, { wallet: Keypair.generate().publicKey.toBase58(), amountRaw: "100000000" });
  assert.equal(deposit.code, "LAUNCH_NOT_FOUND");
  assert.match(deposit.message, /not on the network whole/);
});

test("a deposit while the window is open, the view of the launch, and a read that failed said as failed", async () => {
  const { deps, clock, connection, metadataUri } = await standDeps();
  const creator = Keypair.generate();
  const built = await prepareEarlyAccess(deps, { creator: creator.publicKey.toBase58(), metadataUri, rules: FCFS });
  await submitEarlyAccess(deps, { buildId: built.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: signAll(built.unsignedWireBase64, creator) });

  /* The vault as the chain would hold it after a first deposit. */
  const { data } = await vaultAccount({
    pool: new PublicKey(built.pool),
    baseMint: new PublicKey(built.mint),
    base: creator.publicKey,
    totalDeposit: new BN(300_000_000),
    totalEscrow: new BN(1),
    startVestingPoint: new BN(built.schedule.vestingStartsAt),
    endVestingPoint: new BN(built.schedule.vestingEndsAt),
  });
  connection.accounts.set(built.vault, ownedBy(ALPHA_VAULT_PROGRAM, data));
  connection.accounts.set("SysvarC1ock11111111111111111111111111111111", clockAt(NOW + 900));

  const buyer = Keypair.generate();
  assert.equal((await prepareEarlyAccessDeposit(deps, built.mint, { wallet: buyer.publicKey.toBase58(), amountRaw: "100000000" })).code, "VALIDATION_ERROR", "not open yet");
  clock.now = NOW + 900;
  /* Money goes in only once the pool on chain names this launch's vault as the one that buys first. */
  const depositOf = () => prepareEarlyAccessDeposit(deps, built.mint, { wallet: buyer.publicKey.toBase58(), amountRaw: "100000000" });
  assert.equal((await depositOf()).code, "LAUNCH_NOT_FOUND", "no pool on chain: nothing built");
  const poolNaming = (vault) => ownedBy(DAMM_V2_PROGRAM, poolAccount({ token_a_mint: new PublicKey(built.mint), token_b_mint: new PublicKey(QUOTE), whitelisted_vault: new PublicKey(vault) }));
  connection.accounts.set(built.pool, poolNaming(Keypair.generate().publicKey.toBase58()));
  assert.match((await depositOf()).message, /does not name the launch's vault/);
  connection.accounts.set(built.pool, poolNaming(built.vault));
  /* A vault on chain other than the launch's terms takes nothing. */
  connection.accounts.set(built.vault, ownedBy(ALPHA_VAULT_PROGRAM, (await vaultAccount({ pool: new PublicKey(built.pool), baseMint: new PublicKey(built.mint), base: creator.publicKey, escrowFee: new BN(5), startVestingPoint: new BN(built.schedule.vestingStartsAt), endVestingPoint: new BN(built.schedule.vestingEndsAt) })).data));
  assert.match((await depositOf()).message, /escrow fee/);
  connection.accounts.set(built.vault, ownedBy(ALPHA_VAULT_PROGRAM, data));
  const deposit = await depositOf();
  assert.equal(deposit.ok, true, deposit.message);
  assert.equal(deposit.opensEscrow, true);
  assert.equal((await submitEarlyAccessDeposit(deps, built.mint, { buildId: deposit.buildId, wallet: Keypair.generate().publicKey.toBase58(), signedWireBase64: signAll([deposit.unsignedWireBase64], buyer)[0] })).code, "WALLET_MISMATCH");
  const sent = await submitEarlyAccessDeposit(deps, built.mint, { buildId: deposit.buildId, wallet: buyer.publicKey.toBase58(), signedWireBase64: signAll([deposit.unsignedWireBase64], buyer)[0] });
  assert.equal(sent.ok, true, sent.message);
  assert.equal(sent.state, "CONFIRMED");
  assert.equal((await prepareEarlyAccessDeposit(deps, built.mint, { wallet: buyer.publicKey.toBase58(), amountRaw: "600000000" })).code, "VALIDATION_ERROR", "above the wallet's cap");

  const view = await earlyAccessView(deps, built.mint, buyer.publicKey.toBase58());
  assert.equal(view.read, "OK");
  assert.equal(view.state, "DEPOSITS");
  assert.equal(view.depositedRaw, "300000000");
  assert.equal(view.capRaw, FCFS.maxCapRaw);
  assert.equal(view.filled, false);
  assert.equal(view.terms.ryntraShareBps, 0);
  assert.equal(view.terms.presaleBps, 1652);
  assert.deepEqual(view.chainProblems, []);
  assert.equal(view.mine.depositedRaw, "0");
  assert.equal(view.mine.roomRaw, "500000000");
  assert.equal(view.creation.state, "OPEN");
  assert.ok(view.lines.uk.some((line) => line.includes("заблокована назавжди")));

  /* A vault on chain that says other than the record is said. */
  const other = await vaultAccount({ pool: new PublicKey(built.pool), baseMint: new PublicKey(built.mint), escrowFee: new BN(5), depositingPoint: new BN(1) });
  connection.accounts.set(built.vault, ownedBy(ALPHA_VAULT_PROGRAM, other.data));
  const differs = await earlyAccessView(deps, built.mint);
  assert.match(differs.chainProblems.join(), /escrow fee/);
  assert.match(differs.chainProblems.join(), /deposits open at another time/);

  /* A read that fails is FAILED, every figure null — never zero. */
  connection.getMultipleAccountsInfo = async () => {
    throw new Error("429");
  };
  const failed = await earlyAccessView(deps, built.mint, buyer.publicKey.toBase58());
  assert.equal(failed.read, "FAILED");
  assert.equal(failed.depositedRaw, null);
  assert.equal(failed.filled, null);
  assert.equal(failed.mine, null);
  assert.equal(await earlyAccessView(deps, Keypair.generate().publicKey.toBase58()), null);
});

/* ------------------------------------------------- after the deposits */

/** A DAMM v2 pool account as the chain would hold it: the program's layout, zeroed, with the fields a fill reads. */
function poolAccount(fields) {
  const size = cpAmmCoder.accounts.size("Pool");
  const zero = Buffer.concat([Buffer.from(cpAmmCoder.accounts.accountDiscriminator("Pool")), Buffer.alloc(size - 8)]);
  const decoded = cpAmmCoder.accounts.decode("Pool", zero);
  /* The coder's own `encode` writes into a 1 000-byte buffer, short of a pool's: its layout is used directly. */
  const body = Buffer.alloc(size - 8);
  const entry = cpAmmCoder.accounts.accountLayouts.get("Pool");
  (entry.layout ?? entry).encode({ ...decoded, ...fields }, body);
  return Buffer.concat([zero.subarray(0, 8), body]);
}

async function launchedOnStand(rules = FCFS) {
  const stand = await standDeps();
  const creator = Keypair.generate();
  const built = await prepareEarlyAccess(stand.deps, { creator: creator.publicKey.toBase58(), metadataUri: stand.metadataUri, rules });
  await submitEarlyAccess(stand.deps, { buildId: built.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: signAll(built.unsignedWireBase64, creator) });
  const setVault = async (fields) => {
    const { data } = await vaultAccount({
      pool: new PublicKey(built.pool),
      baseMint: new PublicKey(built.mint),
      base: creator.publicKey,
      vaultMode: rules.mode === "FCFS" ? 1 : 0,
      startVestingPoint: new BN(built.schedule.vestingStartsAt),
      endVestingPoint: new BN(built.schedule.vestingEndsAt),
      ...fields,
    });
    stand.connection.accounts.set(built.vault, ownedBy(ALPHA_VAULT_PROGRAM, data));
  };
  const setEscrow = async (owner, fields) =>
    stand.connection.accounts.set(escrowAddressOf(built.vault, owner.toBase58()), ownedBy(ALPHA_VAULT_PROGRAM, await escrowAccount(new PublicKey(built.vault), owner, fields)));
  const at = (unix) => {
    stand.clock.now = unix;
    stand.connection.accounts.set("SysvarC1ock11111111111111111111111111111111", clockAt(unix));
  };
  stand.connection.accounts.set(built.mint, ownedBy(TOKEN_2022_PROGRAM_ID));
  return { ...stand, built, creator, setVault, setEscrow, at };
}

test("the actions' windows: claim from vesting, the rest back from activation, a pro rata withdrawal while deposits are open, the purchase in the last hour", () => {
  const record = { rules: FCFS, schedule: earlyAccessSchedule(FCFS) };
  const s = record.schedule;
  assert.notEqual(actionWindowProblem(record, "CLAIM", s.vestingStartsAt - 1), null);
  assert.equal(actionWindowProblem(record, "CLAIM", s.vestingStartsAt), null);
  assert.notEqual(actionWindowProblem(record, "WITHDRAW_REMAINING", s.activatesAt - 1), null);
  assert.equal(actionWindowProblem(record, "WITHDRAW_REMAINING", s.activatesAt), null);
  assert.match(actionWindowProblem(record, "WITHDRAW", s.depositStartsAt), /first-come/);
  const prorata = { rules: PRO_RATA, schedule: earlyAccessSchedule(PRO_RATA) };
  assert.equal(actionWindowProblem(prorata, "WITHDRAW", s.depositStartsAt), null);
  assert.notEqual(actionWindowProblem(prorata, "WITHDRAW", s.depositEndsAt + 1), null);
  assert.notEqual(actionWindowProblem(record, "FILL", s.fillStartsAt - 1), null);
  assert.equal(actionWindowProblem(record, "FILL", s.fillStartsAt), null);
  assert.notEqual(actionWindowProblem(record, "FILL", s.activatesAt), null);
});

test("CLAIM: only once vesting starts, only what vested, only by the wallet it was built for, only the built bytes, once", async () => {
  const stand = await launchedOnStand();
  const { deps, built } = stand;
  const buyer = Keypair.generate();
  await stand.setVault({ totalDeposit: new BN(500_000_000), totalEscrow: new BN(1), swappedAmount: new BN(400_000_000), boughtToken: new BN(1_000_000_000) });
  await stand.setEscrow(buyer.publicKey, { totalDeposit: new BN(100_000_000) });
  stand.at(built.schedule.activatesAt - 10);
  assert.equal((await prepareEarlyAccessAction(deps, built.mint, { wallet: buyer.publicKey.toBase58(), action: "CLAIM" })).code, "VALIDATION_ERROR", "not before vesting");
  stand.at(built.schedule.vestingEndsAt + 1);
  const claim = await prepareEarlyAccessAction(deps, built.mint, { wallet: buyer.publicKey.toBase58(), action: "CLAIM" });
  assert.equal(claim.ok, true, claim.message);
  assert.equal(claim.action, "CLAIM");
  assert.equal(claim.amountRaw, "200000000", "a fifth of the tokens bought, all vested");
  const tx = Transaction.from(Buffer.from(claim.unsignedWireBase64, "base64"));
  assert.equal(tx.feePayer.toBase58(), buyer.publicKey.toBase58());
  assert.equal(tx.signatures.length, 1);

  /* Nothing to claim for a wallet with no deposit. */
  assert.equal((await prepareEarlyAccessAction(deps, built.mint, { wallet: Keypair.generate().publicKey.toBase58(), action: "CLAIM" })).code, "LAUNCH_NOTHING_TO_CLAIM");
  /* Another wallet, other bytes, no signature: refused, nothing sent. */
  const before = stand.connection.sent.length;
  const signed = signAll([claim.unsignedWireBase64], buyer)[0];
  assert.equal((await submitEarlyAccessAction(deps, built.mint, { buildId: claim.buildId, wallet: Keypair.generate().publicKey.toBase58(), signedWireBase64: signed })).code, "WALLET_MISMATCH");
  const other = await prepareEarlyAccessAction(deps, built.mint, { wallet: buyer.publicKey.toBase58(), action: "WITHDRAW_REMAINING" });
  assert.equal(other.ok, true, other.message);
  assert.equal((await submitEarlyAccessAction(deps, built.mint, { buildId: claim.buildId, wallet: buyer.publicKey.toBase58(), signedWireBase64: signAll([other.unsignedWireBase64], buyer)[0] })).code, "LAUNCH_SIGNED_OTHER_BYTES");
  assert.equal((await submitEarlyAccessAction(deps, built.mint, { buildId: claim.buildId, wallet: buyer.publicKey.toBase58(), signedWireBase64: claim.unsignedWireBase64 })).code, "LAUNCH_SIGNED_OTHER_BYTES", "unsigned");
  assert.equal(stand.connection.sent.length, before);
  const sent = await submitEarlyAccessAction(deps, built.mint, { buildId: claim.buildId, wallet: buyer.publicKey.toBase58(), signedWireBase64: signed });
  assert.equal(sent.ok, true, sent.message);
  assert.equal(sent.state, "CONFIRMED");
  assert.equal(stand.connection.sent.length, before + 1);
  assert.equal((await submitEarlyAccessAction(deps, built.mint, { buildId: claim.buildId, wallet: buyer.publicKey.toBase58(), signedWireBase64: signed })).code, "LAUNCH_BUILD_USED");
  /* An action's build is not a deposit's. */
  assert.equal((await submitEarlyAccessDeposit(deps, built.mint, { buildId: other.buildId, wallet: buyer.publicKey.toBase58(), signedWireBase64: signAll([other.unsignedWireBase64], buyer)[0] })).code, "LAUNCH_NOT_FOUND");
});

test("WITHDRAW_REMAINING: from activation, the wallet's share of what the vault did not spend", async () => {
  const stand = await launchedOnStand(PRO_RATA);
  const { deps, built } = stand;
  const buyer = Keypair.generate();
  /* 15 000 deposited against a 10 000 cap: 5 000 left, this wallet's third of it. */
  await stand.setVault({ totalDeposit: new BN(15_000_000_000), swappedAmount: new BN(10_000_000_000), boughtToken: new BN(1_000) });
  await stand.setEscrow(buyer.publicKey, { totalDeposit: new BN(5_000_000_000) });
  stand.at(built.schedule.activatesAt - 1);
  assert.equal((await prepareEarlyAccessAction(deps, built.mint, { wallet: buyer.publicKey.toBase58(), action: "WITHDRAW_REMAINING" })).code, "VALIDATION_ERROR");
  stand.at(built.schedule.activatesAt);
  const back = await prepareEarlyAccessAction(deps, built.mint, { wallet: buyer.publicKey.toBase58(), action: "WITHDRAW_REMAINING" });
  assert.equal(back.ok, true, back.message);
  assert.equal(back.amountRaw, "1666666666");
  const sent = await submitEarlyAccessAction(deps, built.mint, { buildId: back.buildId, wallet: buyer.publicKey.toBase58(), signedWireBase64: signAll([back.unsignedWireBase64], buyer)[0] });
  assert.equal(sent.state, "CONFIRMED");
  /* Refunded already: nothing left to take. */
  await stand.setEscrow(buyer.publicKey, { totalDeposit: new BN(5_000_000_000), refunded: 1 });
  assert.equal((await prepareEarlyAccessAction(deps, built.mint, { wallet: buyer.publicKey.toBase58(), action: "WITHDRAW_REMAINING" })).code, "LAUNCH_NOTHING_TO_CLAIM");
});

test("WITHDRAW: a pro rata deposit back while deposits are open; never on a first-come vault", async () => {
  const stand = await launchedOnStand(PRO_RATA);
  const { deps, built } = stand;
  const buyer = Keypair.generate();
  await stand.setVault({ totalDeposit: new BN(300_000_000) });
  await stand.setEscrow(buyer.publicKey, { totalDeposit: new BN(300_000_000) });
  stand.at(built.schedule.depositStartsAt + 10);
  const all = await prepareEarlyAccessAction(deps, built.mint, { wallet: buyer.publicKey.toBase58(), action: "WITHDRAW" });
  assert.equal(all.ok, true, all.message);
  assert.equal(all.amountRaw, "300000000", "all of it unless a part is named");
  const part = await prepareEarlyAccessAction(deps, built.mint, { wallet: buyer.publicKey.toBase58(), action: "WITHDRAW", amountRaw: "100000000" });
  assert.equal(part.amountRaw, "100000000");
  assert.equal((await prepareEarlyAccessAction(deps, built.mint, { wallet: buyer.publicKey.toBase58(), action: "WITHDRAW", amountRaw: "300000001" })).code, "LAUNCH_NOTHING_TO_CLAIM");
  assert.equal((await prepareEarlyAccessAction(deps, built.mint, { wallet: Keypair.generate().publicKey.toBase58(), action: "WITHDRAW" })).code, "LAUNCH_NOTHING_TO_CLAIM", "no deposit, nothing back");
  const sent = await submitEarlyAccessAction(deps, built.mint, { buildId: all.buildId, wallet: buyer.publicKey.toBase58(), signedWireBase64: signAll([all.unsignedWireBase64], buyer)[0] });
  assert.equal(sent.state, "CONFIRMED");
  stand.at(built.schedule.depositEndsAt + 1);
  assert.equal((await prepareEarlyAccessAction(deps, built.mint, { wallet: buyer.publicKey.toBase58(), action: "WITHDRAW" })).code, "VALIDATION_ERROR", "closed with the window");

  const fcfs = await launchedOnStand(FCFS);
  fcfs.at(fcfs.built.schedule.depositStartsAt + 10);
  assert.equal((await prepareEarlyAccessAction(fcfs.deps, fcfs.built.mint, { wallet: buyer.publicKey.toBase58(), action: "WITHDRAW" })).code, "VALIDATION_ERROR");
});

test("FILL: anyone may send the purchase, only in the hour before trading, only once", async () => {
  const stand = await launchedOnStand();
  const { deps, built } = stand;
  const cranker = Keypair.generate();
  await stand.setVault({ totalDeposit: new BN(800_000_000) });
  stand.connection.accounts.set(
    built.pool,
    ownedBy(
      DAMM_V2_PROGRAM,
      poolAccount({
        token_a_mint: new PublicKey(built.mint),
        token_b_mint: new PublicKey(QUOTE),
        token_a_vault: Keypair.generate().publicKey,
        token_b_vault: Keypair.generate().publicKey,
        token_a_flag: 1,
        token_b_flag: 0,
        activation_point: new BN(built.schedule.activatesAt),
      }),
    ),
  );
  stand.at(built.schedule.fillStartsAt - 1);
  assert.equal((await prepareEarlyAccessAction(deps, built.mint, { wallet: cranker.publicKey.toBase58(), action: "FILL" })).code, "VALIDATION_ERROR");
  stand.at(built.schedule.fillStartsAt + 5);
  const fill = await prepareEarlyAccessAction(deps, built.mint, { wallet: cranker.publicKey.toBase58(), action: "FILL" });
  assert.equal(fill.ok, true, fill.message);
  assert.equal(fill.amountRaw, null);
  const tx = Transaction.from(Buffer.from(fill.unsignedWireBase64, "base64"));
  assert.equal(tx.feePayer.toBase58(), cranker.publicKey.toBase58(), "the cranker pays, whoever it is");
  const program = alphaVault.createProgram(stubConnection());
  assert.deepEqual(tx.instructions.filter((ix) => ix.programId.toBase58() === ALPHA_VAULT_PROGRAM).map((ix) => program.coder.instruction.decode(Buffer.from(ix.data)).name), ["fillDammV2"]);
  const sent = await submitEarlyAccessAction(deps, built.mint, { buildId: fill.buildId, wallet: cranker.publicKey.toBase58(), signedWireBase64: signAll([fill.unsignedWireBase64], cranker)[0] });
  assert.equal(sent.state, "CONFIRMED");
  /* Bought already: nothing to do. */
  await stand.setVault({ totalDeposit: new BN(800_000_000), swappedAmount: new BN(800_000_000) });
  assert.equal((await prepareEarlyAccessAction(deps, built.mint, { wallet: cranker.publicKey.toBase58(), action: "FILL" })).code, "LAUNCH_NOTHING_TO_CLAIM");
  stand.at(built.schedule.activatesAt);
  assert.equal((await prepareEarlyAccessAction(deps, built.mint, { wallet: cranker.publicKey.toBase58(), action: "FILL" })).code, "VALIDATION_ERROR", "trading has opened");
  assert.equal((await prepareEarlyAccessAction(deps, Keypair.generate().publicKey.toBase58(), { wallet: cranker.publicKey.toBase58(), action: "FILL" })).code, "LAUNCH_NOT_FOUND");
});

test("an amount above a u64 is a validation error at the contract, never a build", async () => {
  const { LaunchEarlyAccessDepositBuildRequestSchema: schema } = await import("../api/v1/contract.ts");
  const wallet = Keypair.generate().publicKey.toBase58();
  assert.equal(schema.safeParse({ wallet, amountRaw: "18446744073709551615" }).success, true, "2^64 − 1 is the most");
  for (const amountRaw of ["18446744073709551616", "99999999999999999999", "01", "1.5"]) assert.equal(schema.safeParse({ wallet, amountRaw }).success, false, amountRaw);
});
