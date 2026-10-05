import assert from "node:assert/strict";
import test from "node:test";

import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import {
  compareWalletTransaction,
  LIGHTHOUSE_PROGRAM,
} from "./wallet-modification.ts";
import { adoptWalletTransactionPlan, MAX_WALLET_PRIORITY_FEE_LAMPORTS } from "./wallet-adoption.ts";

const FEE_PAYER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const BUSINESS_PROGRAM = "11111111111111111111111111111111";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const OTHER_BLOCKHASH = "11111111111111111111111111111111";
const TOKEN_ACCOUNT = "5XmJVGx1jLPPZd95WjtSni8fjQ6QKgmmZikAumxmwxXD";

const businessInstruction = (data = new Uint8Array([2, 7, 0, 0, 0]), accounts = []) => ({
  programAddress: BUSINESS_PROGRAM,
  data,
  accounts,
});

const computeLimit = (units = 300_000) => ({
  programAddress: COMPUTE_BUDGET,
  data: new Uint8Array([2, units & 0xff, (units >>> 8) & 0xff, (units >>> 16) & 0xff, (units >>> 24) & 0xff]),
});

const computePrice = (microLamports = 1_000n) => {
  const bytes = new Uint8Array(9);
  bytes[0] = 3;
  new DataView(bytes.buffer).setBigUint64(1, microLamports, true);
  return { programAddress: COMPUTE_BUDGET, data: bytes };
};

function wire(instructions, blockhash = BLOCKHASH) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => setTransactionMessageFeePayer(FEE_PAYER, draft),
    (draft) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash, lastValidBlockHeight: 350_000_000n },
        draft,
      ),
    (draft) => appendTransactionMessageInstructions(instructions, draft),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

test("a real wallet recompile may reorder accounts while adding only bounded ComputeBudget instructions", () => {
  const expectedWireBase64 = wire([businessInstruction()]);
  const actualWireBase64 = wire([computeLimit(), computePrice(), businessInstruction()]);

  const compared = compareWalletTransaction({ expectedWireBase64, actualWireBase64 });

  assert.equal(compared.verdict, "WALLET_GUARDS_ONLY");
  assert.deepEqual(compared.computeBudget, {
    unitLimit: 300_000,
    microLamportsPerUnit: "1000",
    maximumPriorityFeeLamports: "300",
  });
  assert.deepEqual(compared.addedPrograms, [COMPUTE_BUDGET]);
});

const lighthouseAssertion = (account, dataHex) => ({
  programAddress: LIGHTHOUSE_PROGRAM,
  accounts: [{ address: account, role: AccountRole.READONLY }],
  data: new Uint8Array(Buffer.from(dataHex, "hex")),
});

test("the exact Phantom M1B guard shape keeps the transfer immutable and prices the real priority request", async () => {
  const business = businessInstruction(
    undefined,
    [{ address: TOKEN_ACCOUNT, role: AccountRole.WRITABLE }],
  );
  const accountInfo = lighthouseAssertion(
    FEE_PAYER,
    "0604030053969c00000000000403000001000000000000000000",
  );
  const tokenInfo = lighthouseAssertion(
    TOKEN_ACCOUNT,
    "0a0404024523010000000000040300000600000000000000000508",
  );
  const compared = compareWalletTransaction({
    expectedWireBase64: wire([business]),
    actualWireBase64: wire([
      computeLimit(200_000),
      computePrice(375_000n),
      business,
      accountInfo,
      tokenInfo,
    ]),
  });

  assert.equal(compared.verdict, "WALLET_GUARDS_ONLY");
  assert.deepEqual(compared.addedPrograms, [COMPUTE_BUDGET, LIGHTHOUSE_PROGRAM]);
  assert.deepEqual(compared.computeBudget, {
    unitLimit: 200_000,
    microLamportsPerUnit: "375000",
    maximumPriorityFeeLamports: "75000",
  });
  assert.deepEqual(compared.lighthouseAssertions, [
    { kind: "ASSERT_ACCOUNT_INFO_MULTI", account: FEE_PAYER },
    { kind: "ASSERT_TOKEN_ACCOUNT_MULTI", account: TOKEN_ACCOUNT },
  ]);

  const adopted = await adoptWalletTransactionPlan({
    plan: plan(wire([business])),
    signedWireBase64: wire([
      computeLimit(200_000),
      computePrice(375_000n),
      business,
      accountInfo,
      tokenInfo,
    ]),
    totalFeeLamports: "80000",
  });
  assert.equal(adopted.ok, true);
  assert.equal(adopted.plan.priorityFeeLamports, "75000");
  assert.deepEqual(adopted.plan.programs, [COMPUTE_BUDGET, BUSINESS_PROGRAM, LIGHTHOUSE_PROGRAM]);
});

test("every log level Lighthouse defines is accepted, and only those", () => {
  /* The Seeker Wallet signs the same two read-only assertions as Phantom but
     at log level 5 (`FailedEncodedMessage`), and the guard refused every
     transfer it signed because it stopped at 4. Lighthouse's `LogLevel` runs
     0 (`Silent`) to 6 (`FailedEncodedNoop`) and only chooses what is logged
     when an assertion fails; it changes nothing about what moves. A byte past
     6 is not a level Lighthouse knows, and stays refused. */
  const business = businessInstruction(
    undefined,
    [{ address: TOKEN_ACCOUNT, role: AccountRole.WRITABLE }],
  );
  const signedAt = (level) =>
    compareWalletTransaction({
      expectedWireBase64: wire([business]),
      actualWireBase64: wire([
        computeLimit(200_000),
        computePrice(375_000n),
        business,
        lighthouseAssertion(FEE_PAYER, `06${level}030053969c00000000000403000001000000000000000000`),
        lighthouseAssertion(TOKEN_ACCOUNT, `0a${level}04024523010000000000040300000600000000000000000508`),
      ]),
    });

  for (const level of ["00", "04", "05", "06"]) {
    const compared = signedAt(level);
    assert.equal(compared.verdict, "WALLET_GUARDS_ONLY", `log level ${level}: ${compared.detail}`);
    assert.equal(compared.lighthouseAssertions.length, 2);
  }

  const unknown = signedAt("07");
  assert.equal(unknown.verdict, "CHANGED");
  assert.equal(unknown.reasonCode, "WALLET_GUARD_INVALID");
  assert.match(unknown.detail, /its log level is 7, above the 6 Lighthouse defines/);
});

test("a non-assertion Lighthouse variant is never adopted as a wallet guard", () => {
  const business = businessInstruction(
    undefined,
    [{ address: TOKEN_ACCOUNT, role: AccountRole.WRITABLE }],
  );
  const compared = compareWalletTransaction({
    expectedWireBase64: wire([business]),
    actualWireBase64: wire([
      computeLimit(),
      lighthouseAssertion(FEE_PAYER, "00000000"),
      business,
    ]),
  });

  assert.equal(compared.verdict, "CHANGED");
  assert.equal(compared.reasonCode, "WALLET_GUARD_INVALID");
});

test("an assertion placed before the transfer is recorded, not refused, and cannot launder a change", () => {
  /* Phantom put a Lighthouse assertion before the last business instruction on
     the CCTP burn, and the guard refused it, so the transfer could not be
     signed at all. Position is not what protects the money here: the business
     instructions are compared byte-for-byte with the guard programs filtered
     out, and no program besides ComputeBudget and Lighthouse may appear. A
     Lighthouse instruction reads and aborts; it moves nothing from anywhere in
     the list. What position changes is what the assertion proves, so it is
     stated in the detail instead of being treated as an attack. */
  const business = businessInstruction(undefined, [{ address: TOKEN_ACCOUNT, role: AccountRole.WRITABLE }]);
  const assertion = lighthouseAssertion(FEE_PAYER, "0601010000");

  const interleaved = compareWalletTransaction({
    expectedWireBase64: wire([business, business]),
    actualWireBase64: wire([computeLimit(), business, assertion, business]),
    guardPolicy: "BOUNDED",
  });
  assert.equal(interleaved.verdict, "WALLET_GUARDS_ONLY", interleaved.detail);
  assert.equal(interleaved.lighthouseAssertions.length, 1);
  assert.match(interleaved.detail, /before the transfer completes/, "the weaker proof must be stated, not hidden");

  /* The same shape must still refuse when the transfer itself is not the one
     that was reviewed — an assertion's position may not become a way in. */
  const laundered = compareWalletTransaction({
    expectedWireBase64: wire([business, business]),
    actualWireBase64: wire([
      computeLimit(),
      business,
      assertion,
      businessInstruction(new Uint8Array([2, 8, 0, 0, 0]), [{ address: TOKEN_ACCOUNT, role: AccountRole.WRITABLE }]),
    ]),
    guardPolicy: "BOUNDED",
  });
  assert.equal(laundered.verdict, "CHANGED");
  assert.equal(laundered.reasonCode, "INSTRUCTION_CHANGED");

  /* And an assertion after the whole transfer still reads as the stronger claim. */
  const after = compareWalletTransaction({
    expectedWireBase64: wire([business, business]),
    actualWireBase64: wire([computeLimit(), business, business, assertion]),
    guardPolicy: "BOUNDED",
  });
  assert.equal(after.verdict, "WALLET_GUARDS_ONLY", after.detail);
  assert.match(after.detail, /all placed after the transfer/);
});

test("a wallet-added compute budget cannot launder a changed transfer instruction", () => {
  const compared = compareWalletTransaction({
    expectedWireBase64: wire([businessInstruction()]),
    actualWireBase64: wire([computeLimit(), businessInstruction(new Uint8Array([2, 8, 0, 0, 0]))]),
  });

  assert.equal(compared.verdict, "CHANGED");
  assert.equal(compared.reasonCode, "INSTRUCTION_CHANGED");
});

test("a refreshed blockhash remains a new candidate even when the business instructions match", () => {
  const compared = compareWalletTransaction({
    expectedWireBase64: wire([businessInstruction()]),
    actualWireBase64: wire([computeLimit(), businessInstruction()], OTHER_BLOCKHASH),
  });

  assert.equal(compared.verdict, "CHANGED");
  assert.equal(compared.reasonCode, "BLOCKHASH_CHANGED");
});

test("unrecognised or duplicate ComputeBudget requests fail closed", () => {
  const malformed = { programAddress: COMPUTE_BUDGET, data: new Uint8Array([1, 0, 0, 0, 0]) };
  const expectedWireBase64 = wire([businessInstruction()]);

  for (const actualWireBase64 of [
    wire([malformed, businessInstruction()]),
    wire([computeLimit(), computeLimit(400_000), businessInstruction()]),
    wire([computePrice(), computePrice(2_000n), businessInstruction()]),
  ]) {
    const compared = compareWalletTransaction({ expectedWireBase64, actualWireBase64 });
    assert.equal(compared.verdict, "CHANGED");
    assert.equal(compared.reasonCode, "COMPUTE_BUDGET_INVALID");
  }
});

function plan(unsignedWireBase64, overrides = {}) {
  return {
    actionKind: "TOKEN_ATA_CREATE",
    network: "mainnet",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    decimals: 6,
    sender: FEE_PAYER,
    recipient: "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM",
    senderTokenAccount: FEE_PAYER,
    recipientTokenAccount: "2tmJTzMgC7rV9Ndy7zhcsrxLCmoWVGA8D8zoBzmZfVxG",
    createsRecipientAccount: true,
    ataRentLamports: "2039280",
    amountRaw: "500000",
    senderBalanceRaw: "1574590",
    baseFeeLamports: "5000",
    priorityFeeLamports: "0",
    programs: [BUSINESS_PROGRAM],
    blockhash: BLOCKHASH,
    lastValidBlockHeight: "350000000",
    unsignedWireBase64,
    fingerprint: {
      messageHash: `0x${"1".repeat(64)}`,
      feePayer: FEE_PAYER,
      blockhash: BLOCKHASH,
      instructionCount: 1,
      transfer: {
        programAddress: BUSINESS_PROGRAM,
        source: FEE_PAYER,
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        destination: "2tmJTzMgC7rV9Ndy7zhcsrxLCmoWVGA8D8zoBzmZfVxG",
        authority: FEE_PAYER,
        amountRaw: "500000",
        decimals: 6,
      },
    },
    builtAt: "2026-08-28T05:00:00.000Z",
    ...overrides,
  };
}

test("a native SOL transfer is guarded by one assertion, because it has no token account", async () => {
  /* Phantom writes one Lighthouse assertion per thing it can check. A token
     transfer gets the fee payer's account info and the destination token
     account; native SOL gets only the first, because there is no token account
     in the message at all.

     Requiring the pair unconditionally was correct for the single M1B case it
     was written against and rejected every signed SOL transfer with "the
     wallet's Lighthouse guard pair is incomplete" — after the founder had
     already approved the transfer in Phantom. */
  const business = businessInstruction();
  const accountInfo = lighthouseAssertion(
    FEE_PAYER,
    "0604030053969c00000000000403000001000000000000000000",
  );
  const signed = wire([computeLimit(200_000), computePrice(375_000n), business, accountInfo]);

  const compared = compareWalletTransaction({
    expectedWireBase64: wire([business]),
    actualWireBase64: signed,
    expectsTokenGuard: false,
  });
  assert.equal(compared.verdict, "WALLET_GUARDS_ONLY");
  assert.deepEqual(compared.lighthouseAssertions, [
    { kind: "ASSERT_ACCOUNT_INFO_MULTI", account: FEE_PAYER },
  ]);

  const adopted = await adoptWalletTransactionPlan({
    plan: plan(wire([business]), { actionKind: "NATIVE_SOL" }),
    signedWireBase64: signed,
    totalFeeLamports: "80000",
  });
  assert.equal(adopted.ok, true);

  /* Still strict in the other direction: a token transfer that comes back
     with only the account-info assertion is refused, and so is any transfer
     that comes back with no account-info assertion at all. */
  const tokenBusiness = businessInstruction(undefined, [
    { address: TOKEN_ACCOUNT, role: AccountRole.WRITABLE },
  ]);
  const missingTokenGuard = compareWalletTransaction({
    expectedWireBase64: wire([tokenBusiness]),
    actualWireBase64: wire([computeLimit(), tokenBusiness, lighthouseAssertion(
      FEE_PAYER,
      "0604030053969c00000000000403000001000000000000000000",
    )]),
    expectsTokenGuard: true,
  });
  assert.equal(missingTokenGuard.verdict, "CHANGED");
  assert.match(missingTokenGuard.detail, /guard pair is incomplete/i);

  const missingAccountInfo = compareWalletTransaction({
    expectedWireBase64: wire([tokenBusiness]),
    actualWireBase64: wire([computeLimit(), tokenBusiness, lighthouseAssertion(
      TOKEN_ACCOUNT,
      "0a0404024523010000000000040300000600000000000000000508",
    )]),
    expectsTokenGuard: false,
  });
  assert.equal(missingAccountInfo.verdict, "CHANGED");
  assert.match(missingAccountInfo.detail, /account-info assertion is missing/i);
});

test("a bounded wallet modification becomes a new exact reviewed plan before Submit", async () => {
  const expectedWireBase64 = wire([businessInstruction()]);
  const signedWireBase64 = wire([computeLimit(), computePrice(), businessInstruction()]);

  const adopted = await adoptWalletTransactionPlan({
    plan: plan(expectedWireBase64),
    signedWireBase64,
    totalFeeLamports: "5300",
    now: new Date("2026-08-28T05:00:10.000Z"),
  });

  assert.equal(adopted.ok, true);
  assert.equal(adopted.plan.priorityFeeLamports, "300");
  assert.deepEqual(adopted.plan.programs, [COMPUTE_BUDGET, BUSINESS_PROGRAM]);
  assert.deepEqual(adopted.plan.walletAugmentation, {
    computeUnitLimit: 300000,
    microLamportsPerUnit: "1000",
    maximumPriorityFeeLamports: "300",
    lighthouseAssertions: [],
  });
  assert.equal(adopted.plan.fingerprint.instructionCount, 3);
  assert.equal(adopted.plan.builtAt, "2026-08-28T05:00:10.000Z");
  assert.equal(adopted.comparison.verdict, "WALLET_GUARDS_ONLY");

  const adoptedMessage = getTransactionDecoder().decode(
    Buffer.from(adopted.plan.unsignedWireBase64, "base64"),
  ).messageBytes;
  const signedMessage = getTransactionDecoder().decode(Buffer.from(signedWireBase64, "base64")).messageBytes;
  assert.deepEqual(adoptedMessage, signedMessage);
});

test("wallet priority cost above the bounded M1B cap is never adopted", async () => {
  const expectedWireBase64 = wire([businessInstruction()]);
  const signedWireBase64 = wire([computeLimit(), computePrice(), businessInstruction()]);
  const tooHigh = (BigInt(MAX_WALLET_PRIORITY_FEE_LAMPORTS) + 1n).toString();

  const adopted = await adoptWalletTransactionPlan({
    plan: plan(expectedWireBase64),
    signedWireBase64,
    totalFeeLamports: (5_000n + BigInt(tooHigh)).toString(),
  });

  assert.equal(adopted.ok, false);
  assert.equal(adopted.code, "WALLET_PRIORITY_FEE_TOO_HIGH");
});

test("a provider transaction that already carries a compute budget can still be adopted", () => {
  /*
   * Every transaction Ryntra builds itself arrives with no compute budget, so
   * the comparator used to filter the guard programs out of the wallet's reply
   * and compare the remainder against the WHOLE reviewed message. A
   * provider-built swap always carries its own budget, so the reviewed side had
   * two instructions the wallet's side had been stripped of — and every such
   * transaction came back INSTRUCTION_CHANGED however honest the wallet was.
   * That is the shape this asserts: same business instruction, a re-priced
   * budget, adopted.
   */
  const reviewed = wire([computeLimit(200_000), computePrice(1_000n), businessInstruction()]);
  const repriced = wire([computeLimit(200_000), computePrice(375_000n), businessInstruction()]);
  const comparison = compareWalletTransaction({
    expectedWireBase64: reviewed,
    actualWireBase64: repriced,
    expectsTokenGuard: false,
  });
  assert.equal(comparison.verdict, "WALLET_GUARDS_ONLY", comparison.detail);
  assert.equal(comparison.computeBudget.unitLimit, 200_000);
  assert.equal(comparison.computeBudget.microLamportsPerUnit, "375000");
  assert.equal(comparison.computeBudget.maximumPriorityFeeLamports, "75000");

  /* The business instruction is still immutable underneath the new budget. */
  const tampered = wire([
    computeLimit(200_000),
    computePrice(375_000n),
    businessInstruction(new Uint8Array([2, 9, 0, 0, 0])),
  ]);
  assert.equal(
    compareWalletTransaction({ expectedWireBase64: reviewed, actualWireBase64: tampered, expectsTokenGuard: false })
      .verdict,
    "CHANGED",
  );
});
