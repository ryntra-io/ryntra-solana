// SOL-L1d: the partner's launch fees claimed through its Squads multisig — what a claim line may hold, the proposal the
// treasury builds, the proposals it reads back as claims, and the revenue journal the financial panel holds against
// the chain. Run from repo root: node --test lib/solana/treasury/launch-claims.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import * as multisig from "@sqds/multisig";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage } from "@solana/web3.js";
import BN from "bn.js";

import { readClaimLine } from "../../core/venues/meteora-dbc/partner-claim-lines.ts";
import { GUARD_COLLECTIONS, createMemoryGuardStore } from "../../guard/store.ts";
import { PARTNER_JOURNAL, partnerLedgerOf, readPartnerJournal, recordPartnerExecutions, recordPartnerProposal, splitOpenings } from "../../launch/partner-claims.server.ts";
import { CLAIM_LINES_PER_EXECUTION, MAX_CLAIM_LINES, buildExecute, buildLaunchClaims, claimsRemaining, readMultisig, readProposals, TX_BYTES_CAP, sizeOf } from "./squads.server.ts";

const offline = new Connection("http://127.0.0.1:1");
const dbc = new DynamicBondingCurveClient(offline, "confirmed").state.getProgram();
const damm = new CpAmm(offline)._program;
const key = () => Keypair.generate().publicKey;
const wallet = Keypair.generate().publicKey;

function multisigAccount(members = [wallet]) {
  const createKey = key();
  const [address] = multisig.getMultisigPda({ createKey });
  const [vault] = multisig.getVaultPda({ multisigPda: address, index: 0 });
  const [data] = multisig.accounts.Multisig.fromArgs({
    createKey,
    configAuthority: PublicKey.default,
    threshold: 2,
    timeLock: 86_400,
    transactionIndex: 3,
    staleTransactionIndex: 0,
    rentCollector: null,
    bump: 255,
    members: members.map((member) => ({ key: member, permissions: { mask: 7 } })),
  }).serialize();
  return { address, vault, data };
}

function mapNode(accounts) {
  const info = (address) => {
    const found = accounts.get(address.toBase58());
    return found ? { data: found.data, owner: found.owner ?? multisig.PROGRAM_ID, lamports: 1_000_000, executable: false, rentEpoch: 0 } : null;
  };
  return { getAccountInfo: async (address) => info(address), getMultipleAccountsInfo: async (keys) => keys.map(info) };
}

const stored = (vault, instructions) => {
  const message = new TransactionMessage({ payerKey: vault, recentBlockhash: PublicKey.default.toBase58(), instructions });
  return multisig.types.transactionMessageBeet.deserialize(Buffer.from(multisig.utils.transactionMessageToMultisigTransactionMessageBytes({ message, vaultPda: vault })))[0];
};

function lineAccount(vault, instructions) {
  const decoded = stored(vault, instructions);
  const message = { ...decoded, instructions: decoded.instructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accountIndexes: Uint8Array.from(ix.accountIndexes), data: Uint8Array.from(ix.data) })), addressTableLookups: [] };
  return multisig.accounts.VaultBatchTransaction.fromArgs({ bump: 255, ephemeralSignerBumps: Uint8Array.from([]), message }).serialize()[0];
}

/** One launch's accounts: its curve, config, mint (Token-2022) and pair (USDC), and its graduated pool. */
function launch() {
  return { token: key(), curve: key(), config: key(), pairMint: key(), baseVault: key(), quoteVault: key(), pool: key(), position: key(), nft: key(), tokenVaultA: key(), tokenVaultB: key() };
}

/* The claims as the SDK's programs build them, the vault the fee claimer and the owner of the partner's exit position. */
async function curveClaim(vault, l, to = vault) {
  return dbc.methods
    .claimTradingFee(new BN("18446744073709551615"), new BN("18446744073709551615"))
    .accountsPartial({
      config: l.config,
      pool: l.curve,
      tokenAAccount: getAssociatedTokenAddressSync(l.token, to, true, TOKEN_2022_PROGRAM_ID),
      tokenBAccount: getAssociatedTokenAddressSync(l.pairMint, to, true, TOKEN_PROGRAM_ID),
      baseVault: l.baseVault,
      quoteVault: l.quoteVault,
      baseMint: l.token,
      quoteMint: l.pairMint,
      feeClaimer: vault,
      tokenBaseProgram: TOKEN_2022_PROGRAM_ID,
      tokenQuoteProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}
async function migrationClaim(vault, l, flag = 0) {
  return dbc.methods
    .withdrawMigrationFee(flag)
    .accountsPartial({ config: l.config, virtualPool: l.curve, tokenQuoteAccount: getAssociatedTokenAddressSync(l.pairMint, vault, true), quoteVault: l.quoteVault, quoteMint: l.pairMint, sender: vault, tokenQuoteProgram: TOKEN_PROGRAM_ID })
    .instruction();
}
async function surplusClaim(vault, l) {
  return dbc.methods
    .partnerWithdrawSurplus()
    .accountsPartial({ config: l.config, virtualPool: l.curve, tokenQuoteAccount: getAssociatedTokenAddressSync(l.pairMint, vault, true), quoteVault: l.quoteVault, quoteMint: l.pairMint, feeClaimer: vault, tokenQuoteProgram: TOKEN_PROGRAM_ID })
    .instruction();
}
async function lpClaim(vault, l) {
  return damm.methods
    .claimPositionFee()
    .accountsPartial({
      pool: l.pool,
      position: l.position,
      tokenAAccount: getAssociatedTokenAddressSync(l.token, vault, true, TOKEN_2022_PROGRAM_ID),
      tokenBAccount: getAssociatedTokenAddressSync(l.pairMint, vault, true, TOKEN_PROGRAM_ID),
      tokenAVault: l.tokenVaultA,
      tokenBVault: l.tokenVaultB,
      tokenAMint: l.token,
      tokenBMint: l.pairMint,
      positionNftAccount: l.nft,
      signer: vault,
      tokenAProgram: TOKEN_2022_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

test("the journal's collection is the store's own", () => {
  assert.ok(GUARD_COLLECTIONS.includes(PARTNER_JOURNAL));
});

test("a claim line is the partner's claims into the vault alone: the curve's fee, the DEX launch fee, the surplus, the locked LP's fees", async () => {
  const { vault } = multisigAccount();
  const l = launch();
  const line = readClaimLine(stored(vault, [await curveClaim(vault, l), await migrationClaim(vault, l), await surplusClaim(vault, l), await lpClaim(vault, l)]), vault);
  assert.equal(line.foreign, false);
  assert.deepEqual(
    line.claims.map((claim) => [claim.name, claim.source, claim.pool]),
    [
      ["claim_trading_fee", "curve", l.curve.toBase58()],
      ["withdraw_migration_fee", "migration", l.curve.toBase58()],
      ["partner_withdraw_surplus", "surplus", l.curve.toBase58()],
      ["claim_position_fee", "lp", l.pool.toBase58()],
    ],
  );
});

test("anything else in a line makes it foreign: a payment elsewhere, the creator's migration fee, another signer, another instruction", async () => {
  const { vault } = multisigAccount();
  const l = launch();
  const stranger = key();
  /* The vault's fee paid into a stranger's account: the program would allow it; this page never approves it. */
  assert.equal(readClaimLine(stored(vault, [await curveClaim(vault, l, stranger)]), vault).foreign, true);
  assert.equal(readClaimLine(stored(vault, [await migrationClaim(vault, l, 1)]), vault).foreign, true, "flag 1 is the creator's");
  assert.equal(readClaimLine(stored(vault, [await curveClaim(vault, l), SystemProgram.transfer({ fromPubkey: vault, toPubkey: stranger, lamports: 1 })]), vault).foreign, true);
  /* Another signer beside the vault — whoever it is — is not the vault's claim alone. */
  const other = await surplusClaim(stranger, l);
  assert.equal(readClaimLine(stored(vault, [other]), vault).foreign, true);
  const opening = createAssociatedTokenAccountIdempotentInstruction(vault, getAssociatedTokenAddressSync(l.pairMint, vault, true), vault, l.pairMint);
  assert.equal(readClaimLine(stored(vault, [opening, await surplusClaim(vault, l)]), vault).foreign, true, "an opening paid by the vault's SOL is not in a line");
  assert.equal(readClaimLine({ ...stored(vault, [await surplusClaim(vault, l)]), addressTableLookups: [{}] }, vault).foreign, true, "an account from a lookup table is never shown");
  assert.equal(readClaimLine(stored(vault, []), vault).foreign, true, "an empty line claims nothing");
});

test("the SDK's openings of the vault's accounts are taken out of a claim and opened by the proposer; any other opening refuses the part", async () => {
  const { vault } = multisigAccount();
  const l = launch();
  const ata = getAssociatedTokenAddressSync(l.pairMint, vault, true);
  const sdkStyle = [createAssociatedTokenAccountIdempotentInstruction(vault, ata, vault, l.pairMint), await surplusClaim(vault, l)];
  const split = splitOpenings(sdkStyle, vault);
  assert.ok(split);
  assert.equal(split.claim.length, 1);
  assert.deepEqual(split.opens, [{ account: ata.toBase58(), mint: l.pairMint.toBase58(), program: TOKEN_PROGRAM_ID.toBase58() }]);
  assert.ok(split.claim.every((ix) => !ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)));
  const someoneElse = key();
  assert.equal(splitOpenings([createAssociatedTokenAccountIdempotentInstruction(vault, getAssociatedTokenAddressSync(l.pairMint, someoneElse), someoneElse, l.pairMint), await surplusClaim(vault, l)], vault), null);
});

test("one proposal: the vault's accounts opened by the proposer, a draft batch, a launch's claims in one line while they fit, opened for votes with the proposer's own", async () => {
  const treasury = multisigAccount();
  const read = await readMultisig(mapNode(new Map([[treasury.address.toBase58(), { data: treasury.data }]])), treasury.address.toBase58());
  const [a, b] = [launch(), launch()];
  const parts = [
    { token: a.token.toBase58(), instructions: [await curveClaim(read.vault, a)] },
    { token: a.token.toBase58(), instructions: [await migrationClaim(read.vault, a)] },
    { token: a.token.toBase58(), instructions: [await lpClaim(read.vault, a)] },
    { token: b.token.toBase58(), instructions: [await curveClaim(read.vault, b)] },
  ];
  const opens = [{ account: getAssociatedTokenAddressSync(a.token, read.vault, true, TOKEN_2022_PROGRAM_ID).toBase58(), mint: a.token.toBase58(), program: TOKEN_2022_PROGRAM_ID.toBase58() }];
  const built = buildLaunchClaims({ read, wallet: wallet.toBase58(), parts, opens, alsoApprove: true });
  assert.equal(built.index, 4n);
  /* A launch's lines hold its own claims only; the other launch starts a line of its own. */
  assert.ok(built.lines.every((line) => new Set(line.map((at) => parts[at].token)).size === 1));
  assert.deepEqual(built.lines.flat(), [0, 1, 2, 3], "every claim, in order");
  const ixs = built.groups.flatMap((group) => group.instructions);
  assert.ok(ixs[0].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID), "the opening first, paid by the proposer");
  assert.ok(ixs[0].keys[0].pubkey.equals(wallet) && ixs[0].keys[2].pubkey.equals(read.vault));
  const squads = ixs.filter((ix) => ix.programId.equals(multisig.PROGRAM_ID));
  const name = (ix) => Object.entries(multisig.generated).find(([field, value]) => field.endsWith("InstructionDiscriminator") && Buffer.from(value).equals(ix.data.subarray(0, 8)))?.[0].replace("InstructionDiscriminator", "");
  assert.deepEqual(squads.map(name), ["batchCreate", "proposalCreate", ...built.lines.map(() => "batchAddTransaction"), "proposalActivate", "proposalApprove"]);
  /* Every group fits a transaction a wallet may still add its own instructions to. */
  for (const group of built.groups) assert.ok(sizeOf([group], wallet) <= TX_BYTES_CAP);
  assert.ok(built.rentLamports > 0n);
  /* Without a vote of the proposer's, no approval rides along. */
  const quiet = buildLaunchClaims({ read, wallet: wallet.toBase58(), parts, opens: [], alsoApprove: false });
  assert.notEqual(name(quiet.groups.at(-1).instructions.at(-1)), "proposalApprove");
  assert.throws(() => buildLaunchClaims({ read, wallet: wallet.toBase58(), parts: [], opens: [], alsoApprove: true }), /No launch fee waits/);
});

test("a batch of claims is read back as claims, approvable and runnable here; claims mixed with a payment are neither", async () => {
  const treasury = multisigAccount();
  const accounts = new Map([[treasury.address.toBase58(), { data: treasury.data }]]);
  const read = await readMultisig(mapNode(accounts), treasury.address.toBase58());
  const index = 3n;
  const [batchPda] = multisig.getTransactionPda({ multisigPda: treasury.address, index });
  accounts.set(batchPda.toBase58(), { data: multisig.accounts.Batch.fromArgs({ multisig: treasury.address, creator: wallet, index, bump: 255, vaultIndex: 0, vaultBump: 255, size: 2, executedTransactionIndex: 0 }).serialize()[0] });
  const setLine = (item, instructions) => accounts.set(multisig.getBatchTransactionPda({ multisigPda: treasury.address, batchIndex: index, transactionIndex: item })[0].toBase58(), { data: lineAccount(treasury.vault, instructions) });
  const [a, b] = [launch(), launch()];
  setLine(1, [await curveClaim(treasury.vault, a), await migrationClaim(treasury.vault, a)]);
  setLine(2, [await lpClaim(treasury.vault, b)]);
  const [row] = await readProposals(mapNode(accounts), read, "devnet");
  assert.equal(row.type, "claims");
  assert.equal(row.readable, true);
  assert.deepEqual(row.claims, { count: 3, launches: 2, done: 0, items: 2 });
  assert.equal(row.payouts, null);
  const remaining = await claimsRemaining(mapNode(accounts), read, index);
  assert.equal(remaining.foreign, false);
  assert.deepEqual(remaining.claims.map((claim) => claim.source), ["curve", "migration", "lp"]);
  /* A line that pays someone: the batch is no longer the vault's claims — no «for», no «execute» here. */
  setLine(2, [SystemProgram.transfer({ fromPubkey: treasury.vault, toPubkey: key(), lamports: 1_000 })]);
  const [mixed] = await readProposals(mapNode(accounts), read, "devnet");
  assert.equal(mixed.readable, false);
  assert.equal((await claimsRemaining(mapNode(accounts), read, index)).foreign, true);
});

test("the revenue journal: a proposal with its claims, each line run once by its transaction — and the ledger the financial panel holds against the chain", async () => {
  const store = createMemoryGuardStore();
  const vault = key().toBase58();
  const [tokenA, tokenB] = [key().toBase58(), key().toBase58()];
  await recordPartnerProposal(store, {
    cluster: "devnet",
    multisig: "M1",
    vault,
    index: "4",
    proposedBy: wallet.toBase58(),
    proposedAt: "2026-10-24T10:00:00.000Z",
    signatures: ["s1", "s2"],
    complete: true,
    lines: [
      { item: 1, token: tokenA, pool: "P1", pairMint: "U", claims: [{ source: "curve", pairRaw: "100", tokenRaw: "0" }, { source: "migration", pairRaw: "50", tokenRaw: "0" }] },
      { item: 2, token: tokenB, pool: "P2", pairMint: "U", claims: [{ source: "lp", pairRaw: "7", tokenRaw: "1" }] },
    ],
  });
  assert.equal(await recordPartnerExecutions(store, { cluster: "devnet", multisig: "M1", index: "4", runs: [{ item: 1, signature: "x1" }], at: "2026-10-25T10:00:00.000Z", by: wallet.toBase58() }), true);
  /* The same item again — a second press, another signature — keeps the first run. */
  await recordPartnerExecutions(store, { cluster: "devnet", multisig: "M1", index: "4", runs: [{ item: 1, signature: "x9" }, { item: 2, signature: "x2" }], at: "2026-10-25T10:05:00.000Z", by: wallet.toBase58() });
  /* A proposal not made through Ryntra is not Ryntra's to record. */
  assert.equal(await recordPartnerExecutions(store, { cluster: "devnet", multisig: "M1", index: "5", runs: [{ item: 1, signature: "y" }], at: "2026-10-25T10:00:00.000Z", by: wallet.toBase58() }), false);
  const journal = await readPartnerJournal(store, "devnet");
  assert.equal(journal.length, 1);
  assert.deepEqual(journal[0].executions.map((run) => [run.item, run.signature]), [[1, "x1"], [2, "x2"]]);
  assert.deepEqual(partnerLedgerOf(journal, tokenA, vault), [
    { signature: "x1", source: "curve", pairRaw: null },
    { signature: "x1", source: "migration", pairRaw: null },
  ]);
  assert.deepEqual(partnerLedgerOf(journal, tokenB, vault), [{ signature: "x2", source: "lp", pairRaw: null }]);
  assert.deepEqual(partnerLedgerOf(journal, tokenA, key().toBase58()), [], "another vault's journal is not this one's");
  assert.deepEqual(await readPartnerJournal(store, "mainnet"), []);
});

test("a long batch of claims runs a few lines a signature, from the line where it stopped; a proposal longer than a route's minute is never built", async () => {
  const treasury = multisigAccount();
  const accounts = new Map([[treasury.address.toBase58(), { data: treasury.data }]]);
  const read = await readMultisig(mapNode(accounts), treasury.address.toBase58());
  const index = 3n;
  const [batchPda] = multisig.getTransactionPda({ multisigPda: treasury.address, index });
  accounts.set(batchPda.toBase58(), { data: multisig.accounts.Batch.fromArgs({ multisig: treasury.address, creator: wallet, index, bump: 255, vaultIndex: 0, vaultBump: 255, size: 7, executedTransactionIndex: 2 }).serialize()[0] });
  for (let item = 1; item <= 7; item += 1) {
    const l = launch();
    accounts.set(multisig.getBatchTransactionPda({ multisigPda: treasury.address, batchIndex: index, transactionIndex: item })[0].toBase58(), { data: lineAccount(treasury.vault, [await surplusClaim(treasury.vault, l)]) });
  }
  const built = await buildExecute(mapNode(accounts), { read, wallet: wallet.toBase58(), index });
  assert.equal(built.firstItem, 3, "items 1 and 2 have run: the first group runs item 3");
  assert.equal(built.groups.length, 5);
  assert.ok(CLAIM_LINES_PER_EXECUTION < built.groups.length, "the service sends a few of them a signature");
  const many = Array.from({ length: MAX_CLAIM_LINES + 1 }, () => launch());
  const parts = [];
  for (const l of many) parts.push({ token: l.token.toBase58(), instructions: [await surplusClaim(read.vault, l)] });
  assert.throws(() => buildLaunchClaims({ read, wallet: wallet.toBase58(), parts, opens: [], alsoApprove: true }), /Too many claims/);
});

test("a line's claims are one launch's: the DEX launch fee and the surplus name no token, the curve's fee beside them does", async () => {
  const { vault } = multisigAccount();
  const l = launch();
  const line = readClaimLine(stored(vault, [await curveClaim(vault, l), await migrationClaim(vault, l), await surplusClaim(vault, l)]), vault);
  assert.deepEqual([...new Set(line.claims.map((claim) => claim.launch))], [l.token.toBase58()]);
  assert.equal(readClaimLine(stored(vault, [await lpClaim(vault, l)]), vault).claims[0].launch, l.token.toBase58(), "the pool's token A is the launch's");
});

test("one launch over two lines — the curve's claims and its LP's — is one launch in the proposal's count", async () => {
  const treasury = multisigAccount();
  const accounts = new Map([[treasury.address.toBase58(), { data: treasury.data }]]);
  const read = await readMultisig(mapNode(accounts), treasury.address.toBase58());
  const index = 3n;
  accounts.set(multisig.getTransactionPda({ multisigPda: treasury.address, index })[0].toBase58(), { data: multisig.accounts.Batch.fromArgs({ multisig: treasury.address, creator: wallet, index, bump: 255, vaultIndex: 0, vaultBump: 255, size: 2, executedTransactionIndex: 0 }).serialize()[0] });
  const l = launch();
  const setLine = (item, data) => accounts.set(multisig.getBatchTransactionPda({ multisigPda: treasury.address, batchIndex: index, transactionIndex: item })[0].toBase58(), { data });
  setLine(1, lineAccount(treasury.vault, [await curveClaim(treasury.vault, l), await migrationClaim(treasury.vault, l)]));
  setLine(2, lineAccount(treasury.vault, [await lpClaim(treasury.vault, l)]));
  const [row] = await readProposals(mapNode(accounts), read, "devnet");
  assert.deepEqual(row.claims, { count: 3, launches: 1, done: 0, items: 2 });
  const remaining = await claimsRemaining(mapNode(accounts), read, index);
  assert.equal(new Set(remaining.claims.map((claim) => claim.launch)).size, 1);
});

test("a run still pending when written gives way to a later run of the same line; a confirmed one stays", async () => {
  const store = createMemoryGuardStore();
  const vault = key().toBase58();
  const token = key().toBase58();
  await recordPartnerProposal(store, { cluster: "devnet", multisig: "M2", vault, index: "9", proposedBy: wallet.toBase58(), proposedAt: "2026-10-24T10:00:00.000Z", signatures: ["p"], complete: true, lines: [{ item: 1, token, pool: "P", pairMint: "U", claims: [{ source: "lp", pairRaw: "1", tokenRaw: "0" }] }] });
  await recordPartnerExecutions(store, { cluster: "devnet", multisig: "M2", index: "9", runs: [{ item: 1, signature: "expired", pending: true }], at: "2026-10-25T10:00:00.000Z", by: wallet.toBase58() });
  await recordPartnerExecutions(store, { cluster: "devnet", multisig: "M2", index: "9", runs: [{ item: 1, signature: "landed" }], at: "2026-10-25T10:02:00.000Z", by: wallet.toBase58() });
  await recordPartnerExecutions(store, { cluster: "devnet", multisig: "M2", index: "9", runs: [{ item: 1, signature: "again" }], at: "2026-10-25T10:03:00.000Z", by: wallet.toBase58() });
  assert.deepEqual(partnerLedgerOf(await readPartnerJournal(store, "devnet"), token, vault), [{ signature: "landed", source: "lp", pairRaw: null }]);
});
