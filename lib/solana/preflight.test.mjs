/**
 * The transfer preview, pinned by golden tests over real fixture mints and
 * fabricated decoded mints for the branches no real fixture carries yet.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decodeRawMintAccount } from "./mint.ts";
import { buildPassport } from "./passport.ts";
import { buildTransferPreflight, computeTransferFee } from "./preflight.ts";
import { SplTransferPreflightSchema } from "./contracts.ts";

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

const readOf = (name) => {
  const read = decodeRawMintAccount(fixture(name));
  assert.equal(read.ok, true);
  return read;
};

const passportOf = (read) => {
  const built = buildPassport(read.raw);
  assert.equal(built.ok, true);
  return built.passport;
};

const inputFor = (read, amountRaw) => ({
  schemaVersion: "1.0.0",
  actionRef: "action:solana-token-2022/spl-transfer@1",
  network: "mainnet",
  mint: read.raw.mint,
  sender: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG",
  recipient: "7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar",
  amountRaw,
});

/** A minimal decoded-mint shape for branches no real fixture carries. */
const fabricated = (extensions) => ({
  ok: true,
  raw: {
    mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    network: "mainnet",
    owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    dataBase64: "",
    observedAt: "2026-08-17T12:00:00.000Z",
    slot: "1",
    endpointHost: "test",
  },
  programKind: "TOKEN_2022",
  decoded: {
    mintAuthority: { __option: "None" },
    supply: 0n,
    decimals: 6,
    isInitialized: true,
    freezeAuthority: { __option: "None" },
    extensions: { __option: "Some", value: extensions },
  },
});

const fabricatedPassport = {
  schema: "ryntra.solana.asset-passport",
  schemaVersion: "0.1.0",
  network: "mainnet",
  identity: {
    mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    programKind: "TOKEN_2022",
    programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    decimals: { value: 6, provenance: "ONCHAIN_VERIFIED", meaning: "6 decimals" },
    supply: { value: "0", provenance: "ONCHAIN_VERIFIED", meaning: "supply" },
    mintAuthority: { value: null, provenance: "ONCHAIN_VERIFIED", meaning: "none" },
    freezeAuthority: { value: null, provenance: "ONCHAIN_VERIFIED", meaning: "none" },
    isInitialized: { value: true, provenance: "ONCHAIN_VERIFIED", meaning: "initialized" },
  },
  extensions: [],
  unsupportedKinds: [],
  observedAt: "2026-08-17T12:00:00.000Z",
  source: { ref: "solana:mainnet:rpc:test", label: "test" },
};

/* ── fee math, pinned ────────────────────────────────────────────────── */

test("transfer-fee math: basis points, the maximum-fee cap, and epoch selection are exact", () => {
  const config = {
    __kind: "TransferFeeConfig",
    transferFeeConfigAuthority: { __option: "None" },
    withdrawWithheldAuthority: { __option: "None" },
    withheldAmount: 0n,
    olderTransferFee: { epoch: 100n, maximumFee: 1_000n, transferFeeBasisPoints: 100 },
    newerTransferFee: { epoch: 200n, maximumFee: 5_000n, transferFeeBasisPoints: 300 },
  };

  /* 300 bps of 100_000 = 3_000, under the 5_000 cap. */
  const newer = computeTransferFee([config], 100_000n, 250n);
  assert.deepEqual(newer, {
    feeRaw: "3000",
    basisPoints: 300,
    maximumFeeRaw: "5000",
    capApplied: false,
    configUsed: "NEWER",
    epochBasis: "250",
  });

  /* 300 bps of 10_000_000 = 300_000 — the cap bites at 5_000. */
  const capped = computeTransferFee([config], 10_000_000n, 250n);
  assert.equal(capped.feeRaw, "5000");
  assert.equal(capped.capApplied, true);

  /* An epoch before the newer config's epoch selects the older config. */
  const older = computeTransferFee([config], 100_000n, 150n);
  assert.equal(older.configUsed, "OLDER");
  assert.equal(older.basisPoints, 100);
  assert.equal(older.feeRaw, "1000", "100 bps of 100_000, exactly the older cap");

  /* The program rounds a non-integral basis-point fee up. Rounding down makes
     the reviewed expected fee disagree with the instruction and the chain. */
  const roundedUp = computeTransferFee([config], 1n, 1_000n);
  assert.equal(roundedUp.feeRaw, "1", "300 bps of one base unit rounds up to one base unit");

  /* No epoch supplied: the newer config, recorded as data, never hidden. */
  const assumed = computeTransferFee([config], 100_000n, null);
  assert.equal(assumed.configUsed, "NEWER");
  assert.equal(assumed.epochBasis, null);

  /* No fee config at all: zero, stated as NONE. */
  const none = computeTransferFee([], 100_000n, null);
  assert.equal(none.feeRaw, "0");
  assert.equal(none.configUsed, "NONE");
});

/* ── real fixtures ───────────────────────────────────────────────────── */

test("USDC preview carries the exact built-message fee and simulation into Review", () => {
  const read = readOf("usdc-spl");
  const passport = passportOf(read);
  const result = buildTransferPreflight({
    read,
    passport,
    input: inputFor(read, "1000000"),
    networkFeeLamports: "5000",
    simulation: { status: "PRESENT", succeeded: true, error: null, unitsConsumed: "700" },
  });
  assert.equal(result.ok, true);
  const p = result.preflight;
  assert.equal(p.transferFee.feeRaw, "0");
  assert.equal(p.estimatedReceivedRaw, "1000000");
  assert.deepEqual(
    p.expectedBalanceDeltas.map((delta) => delta.rawDelta),
    ["-1000000", "1000000"],
  );
  assert.equal(p.structuralBlockers.length, 0);
  assert.equal(p.hookProgramId, null);
  assert.equal(p.networkFeeLamports, "5000");
  assert.equal(p.computeBudget, "700");
  assert.equal(p.simulation.status, "PRESENT");
  SplTransferPreflightSchema.parse(p);
});

test("PYUSD preview: zero-bps fee config computes zero, and the hook is surfaced when configured", () => {
  const read = readOf("pyusd-t22");
  const passport = passportOf(read);
  const result = buildTransferPreflight({ read, passport, input: inputFor(read, "500000000") });
  assert.equal(result.ok, true);
  const p = result.preflight;
  /* PYUSD's fee config is real and set to 0 bps — the config is used, the fee is zero. */
  assert.equal(p.transferFee.configUsed, "NEWER");
  assert.equal(p.transferFee.feeRaw, "0");
  assert.equal(p.estimatedReceivedRaw, "500000000");
  /* Its TransferHook extension exists with no program configured. */
  assert.equal(p.hookProgramId, null);
  SplTransferPreflightSchema.parse(p);
});

test("BERN preview: a real non-zero fee reduces what the recipient receives", () => {
  const read = readOf("bern-t22");
  const passport = passportOf(read);
  const result = buildTransferPreflight({ read, passport, input: inputFor(read, "1000000000") });
  assert.equal(result.ok, true);
  const p = result.preflight;
  assert.ok(p.transferFee.basisPoints > 0, "BERN charges a real fee");
  const fee = BigInt(p.transferFee.feeRaw);
  assert.ok(fee > 0n);
  assert.equal(BigInt(p.estimatedReceivedRaw) + fee, 1000000000n);
  assert.equal(p.feeWithheldRaw, p.transferFee.feeRaw);
  SplTransferPreflightSchema.parse(p);
});

/* ── structural blockers over fabricated mints ───────────────────────── */

test("non-transferable, paused and default-frozen mints surface their structural blockers", () => {
  const cases = [
    [{ __kind: "NonTransferable" }, "NON_TRANSFERABLE"],
    [
      { __kind: "PausableConfig", authority: { __option: "None" }, paused: true },
      "PAUSED",
    ],
    [{ __kind: "DefaultAccountState", state: 2 }, "DEFAULT_ACCOUNT_STATE_FROZEN"],
  ];
  for (const [extension, blocker] of cases) {
    const read = fabricated([extension]);
    const result = buildTransferPreflight({
      read,
      passport: fabricatedPassport,
      input: inputFor(read, "1000"),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.preflight.structuralBlockers, [blocker]);
  }

  /* A pausable mint that is not paused is not a blocker. */
  const running = fabricated([{ __kind: "PausableConfig", authority: { __option: "None" }, paused: false }]);
  const result = buildTransferPreflight({
    read: running,
    passport: fabricatedPassport,
    input: inputFor(running, "1000"),
  });
  assert.deepEqual(result.preflight.structuralBlockers, []);
});

/* ── refusals ────────────────────────────────────────────────────────── */

test("a proposal over the wrong mint is refused before any preview exists", () => {
  const read = readOf("usdc-spl");
  const passport = passportOf(read);
  const wrong = { ...inputFor(read, "1000"), mint: "So11111111111111111111111111111111111111112" };
  const result = buildTransferPreflight({ read, passport, input: wrong });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INPUT_MINT_MISMATCH");
  assert.match(result.reason, /exact about the wrong thing/);
});

test("a zero-value or self-directed proposal is refused before it can become a preview", () => {
  const read = readOf("usdc-spl");
  const passport = passportOf(read);

  const zero = buildTransferPreflight({ read, passport, input: inputFor(read, "0") });
  assert.equal(zero.ok, false);
  assert.equal(zero.code, "ZERO_AMOUNT");

  const self = buildTransferPreflight({
    read,
    passport,
    input: { ...inputFor(read, "1"), recipient: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG" },
  });
  assert.equal(self.ok, false);
  assert.equal(self.code, "SENDER_RECIPIENT_SAME");
});
