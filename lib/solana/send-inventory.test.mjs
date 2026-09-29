import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIVE_SOL_FEE_RESERVE_LAMPORTS,
  chooseSpendSources,
  groupSendInventory,
  nativeSendInventoryAsset,
} from "./send-inventory.ts";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./send-kinds.ts";

/**
 * One asset row can stand over several token accounts.
 *
 * The picker shows a person one line per asset because that is how they think
 * about what they own. The chain does not agree: an owner can hold the same
 * mint in a canonical associated account, in an auxiliary account somebody
 * else created for them, and in a frozen account they cannot spend from at
 * all. Collapsing those into one row is correct for reading and wrong for
 * planning, so the row carries both numbers — what is held and what can
 * actually move — and keeps every underlying account.
 */

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const OTHER_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const ATA = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const AUX = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const FROZEN = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";
const SMALL = "3EhwWmsMRFsJYYALaptw3ThE93bXPzTBRnFRcMhTuLTq";

function account(overrides) {
  return {
    address: ATA,
    mint: MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
    amountRaw: "0",
    decimals: 6,
    state: "INITIALIZED",
    canonical: false,
    ...overrides,
  };
}

test("inventory groups duplicate accounts without losing spendable sources", () => {
  const grouped = groupSendInventory([
    account({ address: ATA, amountRaw: "7", canonical: true }),
    account({ address: AUX, amountRaw: "5" }),
    account({ address: FROZEN, amountRaw: "9", state: "FROZEN" }),
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].amountRaw, "21");
  assert.equal(grouped[0].spendableRaw, "12");
  assert.equal(grouped[0].sourceAccounts.length, 3);
  assert.equal(grouped[0].canonicalAta, ATA);

  const chosen = chooseSpendSources(grouped[0], "10");
  assert.equal(chosen.ok, true);
  assert.deepEqual(chosen.sources.map((row) => row.address), [ATA, AUX]);
});

test("the same mint under two token programs is two assets, never one", () => {
  const grouped = groupSendInventory([
    account({ address: ATA, amountRaw: "4", tokenProgram: TOKEN_PROGRAM_ID }),
    account({ address: AUX, amountRaw: "6", tokenProgram: TOKEN_2022_PROGRAM_ID }),
  ]);

  assert.equal(grouped.length, 2);
  assert.deepEqual(
    grouped.map((row) => [row.tokenProgram, row.amountRaw]),
    [
      [TOKEN_PROGRAM_ID, "4"],
      [TOKEN_2022_PROGRAM_ID, "6"],
    ],
  );
});

test("the canonical associated account is preferred whenever it alone is enough", () => {
  const grouped = groupSendInventory([
    account({ address: ATA, amountRaw: "5", canonical: true }),
    account({ address: AUX, amountRaw: "9" }),
  ]);

  /* Not the largest account. The canonical one, because a single-source
     transfer from the address the recipient's own wallet would derive is the
     plainest thing that can happen, and it costs one instruction instead of
     two. */
  const chosen = chooseSpendSources(grouped[0], "4");
  assert.equal(chosen.ok, true);
  assert.deepEqual(chosen.sources.map((row) => row.address), [ATA]);
});

test("multi-source selection is deterministic by balance then address", () => {
  const grouped = groupSendInventory([
    account({ address: SMALL, amountRaw: "3" }),
    account({ address: AUX, amountRaw: "9" }),
    account({ address: ATA, amountRaw: "9" }),
  ]);

  const chosen = chooseSpendSources(grouped[0], "20");
  assert.equal(chosen.ok, true);
  /* Descending balance, then address ascending as the tie-break, so the same
     wallet state always produces the same instruction order and therefore the
     same plan fingerprint. `9WzDX…` sorts before `DiYBu…`. */
  assert.deepEqual(chosen.sources.map((row) => row.address), [ATA, AUX, SMALL]);
  assert.deepEqual(chosen.sources.map((row) => row.amountRaw), ["9", "9", "3"]);
});

test("a frozen account is held but never spendable", () => {
  const grouped = groupSendInventory([
    account({ address: ATA, amountRaw: "1", state: "FROZEN", canonical: true }),
  ]);

  assert.equal(grouped[0].amountRaw, "1");
  assert.equal(grouped[0].spendableRaw, "0");
  const chosen = chooseSpendSources(grouped[0], "1");
  assert.equal(chosen.ok, false);
  assert.equal(chosen.code, "INSUFFICIENT_SPENDABLE_BALANCE");
});

test("an unknown account state is excluded from spendable rather than assumed", () => {
  const grouped = groupSendInventory([
    account({ address: ATA, amountRaw: "8", canonical: true }),
    account({ address: AUX, amountRaw: "8", state: "UNKNOWN" }),
  ]);

  assert.equal(grouped[0].amountRaw, "16");
  assert.equal(grouped[0].spendableRaw, "8");
  assert.equal(chooseSpendSources(grouped[0], "9").ok, false);
});

test("asking for more than the spendable balance refuses instead of sending part", () => {
  const grouped = groupSendInventory([account({ address: ATA, amountRaw: "10", canonical: true })]);
  const chosen = chooseSpendSources(grouped[0], "11");
  assert.equal(chosen.ok, false);
  assert.equal(chosen.code, "INSUFFICIENT_SPENDABLE_BALANCE");
  assert.match(chosen.reason, /spendable/i);
});

test("a zero or malformed amount is refused before any source is chosen", () => {
  const grouped = groupSendInventory([account({ address: ATA, amountRaw: "10", canonical: true })]);
  for (const amount of ["0", "-1", "1.5", "", "01"]) {
    const chosen = chooseSpendSources(grouped[0], amount);
    assert.equal(chosen.ok, false, `${amount} must be refused`);
  }
});

test("assets sort by identity order, never by raw amount", () => {
  const grouped = groupSendInventory([
    account({ address: AUX, mint: OTHER_MINT, amountRaw: "999999999999" }),
    account({ address: ATA, mint: MINT, amountRaw: "1", canonical: true }),
  ]);

  /* A raw unit count is not comparable across decimals; ranking by it puts
     airdrop millions above a dollar of USDC. Grouping preserves the order the
     accounts arrived in, and presentation ranking stays the caller's job. */
  assert.deepEqual(grouped.map((row) => row.mint), [OTHER_MINT, MINT]);
});

test("native SOL is an asset row with no mint and no token program", () => {
  const native = nativeSendInventoryAsset("2039280");
  assert.equal(native.kind, "NATIVE_SOL");
  assert.equal(native.mint, null);
  assert.equal(native.tokenProgram, null);
  /* What the wallet holds is the whole balance — a person's own figure should
     match what their wallet shows them. */
  assert.equal(native.amountRaw, "2039280");
  /* What this product will offer to send holds back the fee. MAX used to fill
     in every lamport and the builder then refused for want of anything to pay
     the signature with: a button that always failed. */
  assert.equal(native.spendableRaw, String(2039280n - NATIVE_SOL_FEE_RESERVE_LAMPORTS));
  assert.equal(native.decimals, 9);
  assert.deepEqual(native.sourceAccounts, []);
});

test("a balance too small to pay its own fee offers nothing to send", () => {
  /* Not a negative number, and not the whole balance either. Below the
     reserve there is genuinely nothing this product can offer to move. */
  for (const lamports of ["0", "1", "499999", "500000"]) {
    assert.equal(nativeSendInventoryAsset(lamports).spendableRaw, "0", lamports);
    assert.equal(nativeSendInventoryAsset(lamports).amountRaw, lamports, lamports);
  }
  assert.equal(nativeSendInventoryAsset("500001").spendableRaw, "1");
});
