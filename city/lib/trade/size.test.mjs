import { test } from "node:test";
import assert from "node:assert/strict";

import { PRIORITY_CEILING_LAMPORTS, SIGNATURE_LAMPORTS, TOKEN_ACCOUNT_RENT_LAMPORTS } from "../../../lib/spot/radar-cost.ts";
import { typedAmount } from "./amount.ts";
import {
  amountAt,
  amountText,
  keyShare,
  NEW_ACCOUNT_RENT_LAMPORTS,
  pointerShare,
  SHARES,
  shareOf,
  sizingOf,
  slideAmount,
  spendMax,
  startAmount,
  SWAP_SOL_RESERVE_LAMPORTS,
} from "./size.ts";
import { SOL, USDC } from "./tiles.ts";

const JUP = { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", decimals: 6 };

test("the chips are a quarter, a half, three quarters and MAX, the same for buying and selling", () => {
  assert.deepEqual([...SHARES], [25, 50, 75, 100]);
  const sizing = sizingOf(1_000_003n, null);
  assert.deepEqual(sizing.chips.map((chip) => chip.label), ["25%", "50%", "75%", "MAX"]);
  // Rounded down: never more than the share says; MAX is all of it.
  assert.deepEqual(sizing.chips.map((chip) => chip.amountRaw), ["250000", "500001", "750002", "1000003"]);
  assert.ok(sizing.chips.every((chip) => chip.usable && !chip.on));
  assert.equal(sizing.share, 0);
  assert.equal(sizing.max, "1000003");
});

test("MAX in SOL keeps what the swap needs to land, from the engine's own figures", () => {
  assert.equal(SWAP_SOL_RESERVE_LAMPORTS, BigInt(SIGNATURE_LAMPORTS + PRIORITY_CEILING_LAMPORTS + TOKEN_ACCOUNT_RENT_LAMPORTS));
  assert.equal(SWAP_SOL_RESERVE_LAMPORTS, 2_344_280n);
  assert.equal(NEW_ACCOUNT_RENT_LAMPORTS, 2_039_280n);
  const balance = { spendableRaw: "2400000000", decimals: 9 };
  assert.equal(spendMax(balance, true, false), 2_400_000_000n - 2_344_280n);
  // A coin the wallet does not hold yet opens its account: its rent is kept too.
  assert.equal(spendMax(balance, true, true), 2_400_000_000n - 2_344_280n - 2_039_280n);
  // Any other coin is spent to the last unit.
  assert.equal(spendMax({ spendableRaw: "84200000", decimals: 6 }, false, true), 84_200_000n);
  // Less SOL than the reserve: nothing to spend, never a negative amount.
  assert.equal(spendMax({ spendableRaw: "3000000", decimals: 9 }, true, true), 0n);
  assert.equal(spendMax(null, true, true), null);
  const max = spendMax(balance, true, true);
  assert.equal(sizingOf(max, null).chips[3].amountRaw, "2395616440");
  assert.equal(amountText(max, 9), "2.39561644");
});

test("chip, slider and field are one amount: each moves the other two", () => {
  const max = 2_000_000_000n;
  // A chip writes its exact share into the field.
  const half = amountAt(max, 50);
  assert.equal(amountText(half, 9), "1");
  let sizing = sizingOf(max, half.toString());
  assert.deepEqual(sizing.chips.map((chip) => chip.on), [false, true, false, false]);
  assert.equal(sizing.share, 50);
  // The slider at 37 writes a short amount, rounded down, and stands where that amount is.
  const slid = slideAmount(max, 37);
  assert.equal(amountText(slid, 9), "0.74");
  sizing = sizingOf(max, slid.toString());
  assert.equal(sizing.share, 37);
  assert.ok(sizing.chips.every((chip) => !chip.on));
  // A typed amount puts the slider at its share; a chip lights only on its exact amount.
  const typed = typedAmount("1.5", SOL, null);
  sizing = sizingOf(max, typed.amountRaw);
  assert.equal(sizing.share, 75);
  assert.deepEqual(sizing.chips.map((chip) => chip.on), [false, false, true, false]);
  const near = typedAmount("1.4999", SOL, null);
  sizing = sizingOf(max, near.amountRaw);
  assert.equal(sizing.share, 74.99);
  assert.ok(sizing.chips.every((chip) => !chip.on));
  // The slider on a chip's share is that chip, exactly.
  for (const share of SHARES) assert.equal(slideAmount(2_395_616_440n, share), amountAt(2_395_616_440n, share));
  assert.equal(amountText(slideAmount(2_395_616_440n, 37), 9), "0.8863");
});

test("the slider's ends: 0 empties the field, 100 is MAX, past the most stays at the end", () => {
  const max = 84_200_000n;
  assert.equal(slideAmount(max, 0), 0n);
  assert.equal(amountText(0n, 6), "");
  assert.equal(slideAmount(max, 100), max);
  assert.equal(slideAmount(max, 140), max);
  assert.equal(slideAmount(max, -5), 0n);
  assert.equal(shareOf(0n, max), 0);
  assert.equal(shareOf(max, max), 100);
  assert.equal(shareOf(max * 2n, max), 100);
  assert.equal(sizingOf(max, "84200000").chips[3].on, true);
  // A tiny holding: its smallest units, never a share that rounds above it.
  const one = sizingOf(1n, null);
  assert.deepEqual(one.chips.map((chip) => chip.amountRaw), ["0", "0", "0", "1"]);
  assert.deepEqual(one.chips.map((chip) => chip.usable), [false, false, false, true]);
  assert.equal(slideAmount(1n, 60), 0n);
});

test("no wallet or an empty balance: chips and slider rest, the field still works", () => {
  const unknown = sizingOf(null, "100000000");
  assert.equal(unknown.max, null);
  assert.equal(unknown.share, null);
  assert.ok(unknown.chips.every((chip) => !chip.usable && !chip.on));
  const empty = sizingOf(0n, null);
  assert.equal(empty.max, "0");
  assert.equal(empty.share, null);
  assert.ok(empty.chips.every((chip) => !chip.usable));
  assert.equal(typedAmount("2", USDC, null).amountRaw, "2000000");
});

test("where the amount starts: all of a sale; a small first buy the wallet covers, else a quarter", () => {
  assert.equal(startAmount("sell", SOL, 5_000_000n), 5_000_000n);
  assert.equal(startAmount("sell", SOL, null), 0n);
  assert.equal(startAmount("buy", SOL, null), 100_000_000n);
  assert.equal(startAmount("buy", SOL, 2_395_616_440n), 100_000_000n);
  assert.equal(startAmount("buy", USDC, 84_200_000n), 10_000_000n);
  assert.equal(startAmount("buy", USDC, 8_000_000n), 2_000_000n);
  assert.equal(startAmount("buy", SOL, 0n), 0n);
  assert.equal(startAmount("buy", JUP, 120_000_000n), 30_000_000n);
  assert.equal(startAmount("buy", JUP, null), 0n);
});

test("the slider's keyboard: arrows by one, pages by ten, Home and End to the ends", () => {
  assert.equal(keyShare(50, "ArrowRight"), 51);
  assert.equal(keyShare(50, "ArrowUp"), 51);
  assert.equal(keyShare(50, "ArrowLeft"), 49);
  assert.equal(keyShare(50, "ArrowDown"), 49);
  assert.equal(keyShare(37, "PageUp"), 40);
  assert.equal(keyShare(40, "PageUp"), 50);
  assert.equal(keyShare(37, "PageDown"), 30);
  assert.equal(keyShare(37, "Home"), 0);
  assert.equal(keyShare(37, "End"), 100);
  assert.equal(keyShare(100, "ArrowRight"), 100);
  assert.equal(keyShare(0, "ArrowLeft"), 0);
  assert.equal(keyShare(95, "PageUp"), 100);
  // From an amount the slider rounded down (36.99), the next step is on, never the same one again.
  assert.equal(keyShare(36.99, "ArrowRight"), 38);
  assert.equal(keyShare(36.99, "ArrowLeft"), 36);
  assert.equal(keyShare(50, "Enter"), null);
});

test("the pointer: whole shares across the track, held inside it", () => {
  assert.equal(pointerShare(150, 100, 200), 25);
  assert.equal(pointerShare(200, 100, 200), 50);
  assert.equal(pointerShare(40, 100, 200), 0);
  assert.equal(pointerShare(900, 100, 200), 100);
  assert.equal(pointerShare(150, 100, 0), 0);
});
