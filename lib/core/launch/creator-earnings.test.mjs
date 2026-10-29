import assert from "node:assert/strict";
import test from "node:test";

import { creatorEarnings, creatorGraduationFeeRaw, creatorSurplusRaw } from "./creator-earnings.ts";
import { creatorEarningsCard } from "./earnings-card.ts";
import { FEE_SHARE_TOTAL_BPS, feeShareProblems, partOf, withCreatorShare } from "./fee-shares.ts";

const CREATOR = "D6qfb7KivAR1RUHQSWqvyNejxmbft7bq4u3dos8yKwgU";
const OTHER = "Fb2AbDwuQ4yNvmQRK7bTZWXoDZRE3AYLcqamPyhg4tL8";
const THIRD = "EAMKay5kBxeN78xCvHVyL77ZkhGqkuTmJC2G4D2MsUuC";

test("a split holds only as the program allows it: the creator among two to five wallets, whole basis points of at least 1 %, all of the fee", () => {
  assert.deepEqual(feeShareProblems(CREATOR, [{ address: CREATOR, bps: 6_000 }, { address: OTHER, bps: 4_000 }]), []);
  assert.ok(feeShareProblems(CREATOR, [{ address: CREATOR, bps: 10_000 }]).includes("TOO_FEW"));
  assert.ok(feeShareProblems(CREATOR, [{ address: OTHER, bps: 5_000 }, { address: THIRD, bps: 5_000 }]).includes("CREATOR_MISSING"));
  assert.ok(feeShareProblems(CREATOR, [{ address: CREATOR, bps: 5_000 }, { address: OTHER, bps: 4_000 }]).includes("NOT_ALL"));
  assert.ok(feeShareProblems(CREATOR, [{ address: CREATOR, bps: 9_950 }, { address: OTHER, bps: 50 }]).includes("SHARE_TOO_SMALL"));
  assert.ok(feeShareProblems(CREATOR, [{ address: CREATOR, bps: 5_000.5 }, { address: OTHER, bps: 4_999.5 }]).includes("SHARE_NOT_WHOLE"));
  assert.ok(feeShareProblems(CREATOR, [{ address: CREATOR, bps: 5_000 }, { address: CREATOR, bps: 5_000 }]).includes("REPEATED"));
  assert.ok(feeShareProblems(CREATOR, [{ address: CREATOR, bps: 5_000 }, { address: "not-a-wallet", bps: 5_000 }]).includes("NOT_AN_ADDRESS"));
  const six = [CREATOR, OTHER, THIRD, "9WBQamBC9Amdzzrq8QANXweZCKpfhLMLvPQJzMBgFbbu", "EUHoULND3ycKoYbiiYRCTiCVY7HDcWxmQ966wWJXL5Ux", "DG1NZsiS18egP4adUQ7vGLh8jaauLFHmLmdrsrrNUHx"];
  assert.ok(feeShareProblems(CREATOR, six.map((address) => ({ address, bps: address === CREATOR ? 5_000 : 1_000 }))).includes("TOO_MANY"));
  /* The form's rows never carry the creator: it keeps what the others do not take. */
  assert.deepEqual(withCreatorShare(CREATOR, [{ address: OTHER, bps: 3_000 }, { address: THIRD, bps: 1_500 }]), [
    { address: CREATOR, bps: 5_500 },
    { address: OTHER, bps: 3_000 },
    { address: THIRD, bps: 1_500 },
  ]);
  assert.equal(partOf(1_186_971_462n, 6_000, FEE_SHARE_TOTAL_BPS), 712_182_877n, "the vault paid the creator exactly this on devnet");
  assert.equal(partOf(1_186_971_462n, 4_000, FEE_SHARE_TOTAL_BPS), 474_788_584n, "and the second wallet exactly this");
});

/* The devnet rehearsal's run 3, «Класичний», read from the chain on 06.10: everything claimed. */
const CLAIMED = {
  roleOwner: CREATOR,
  curve: { totalTradingRaw: "2427280859", creatorPct: 40, unclaimedRaw: "0" },
  graduation: { migrated: true, thresholdRaw: "15454411163", feePct: 2, creatorPct: 40, withdrawn: true },
  lp: { claimedRaw: "38243510", unclaimedRaw: "0" },
  sharing: null,
};

test("what the creator earned is the programs' own counters: 970,91 on the curve, 123,64 at graduation, 38,24 from the LP — as the rehearsal claimed", () => {
  assert.equal(creatorGraduationFeeRaw(CLAIMED.graduation), 123_635_289n);
  const earnings = creatorEarnings(CLAIMED, CREATOR);
  assert.equal(earnings.role.curve.earnedRaw, "970912343");
  assert.equal(earnings.role.graduation.earnedRaw, "123635289");
  assert.equal(earnings.role.lp.earnedRaw, "38243510");
  assert.equal(earnings.role.unclaimedRaw, "0");
  assert.deepEqual(earnings.mine, { shareBps: 10_000, earnedRaw: "1132791142", unclaimedRaw: "0", claimedRaw: "1132791142" });
});

test("before graduation nothing is earned at graduation or from the LP; unclaimed is the curve's own counter, never below what it holds", () => {
  const onCurve = { ...CLAIMED, curve: { totalTradingRaw: "72082890", creatorPct: 40, unclaimedRaw: "28833141" }, graduation: { ...CLAIMED.graduation, migrated: false, withdrawn: false }, lp: null };
  const earnings = creatorEarnings(onCurve, CREATOR);
  /* The program rounds the creator's part of each trade down: the counter's 40 % is a ceiling, the unclaimed the fact. */
  assert.equal(earnings.role.curve.earnedRaw, "28833156");
  assert.equal(earnings.role.curve.unclaimedRaw, "28833141");
  assert.equal(earnings.role.graduation.earnedRaw, "0");
  assert.equal(earnings.role.lp.earnedRaw, "0");
  const higher = creatorEarnings({ ...onCurve, curve: { ...onCurve.curve, unclaimedRaw: "29000000" } }, CREATOR);
  assert.equal(higher.role.curve.earnedRaw, "29000000", "never less than what the curve holds for the creator");
});

test("unshared, the creator's fees are the role owner's alone: any other wallet takes nothing, never the creator's figures", () => {
  const stranger = creatorEarnings(CLAIMED, "1111111111111111111111111111111111111111111");
  assert.deepEqual(stranger.mine, { shareBps: 0, earnedRaw: "0", unclaimedRaw: "0", claimedRaw: "0" });
  /* A wallet named in a sharing that has not landed: the role is still the creator's wallet — nothing is the other's. */
  assert.equal(creatorEarnings(CLAIMED, OTHER).mine.earnedRaw, "0");
  assert.equal(creatorEarnings({ ...CLAIMED, roleOwner: THIRD }, CREATOR).mine.shareBps, 0, "a role handed elsewhere is not the creator's to take");
});

test("shared fees: a wallet's part is the program's own — ⌊share × (fee per share − checkpoint) / 2⁶⁴⌋ — so after every claim nothing waits, not a rounding unit", () => {
  /* «Hive Bee» on devnet, read from the chain after all three wallets claimed (06.10). */
  const FPS = "37415491761101741133032691";
  const read = {
    roleOwner: "BviXJiJoaa8JFWc4LB4WRssnBnJ5Ji98Dx7t51aV1xRT",
    curve: { totalTradingRaw: "16972784714", creatorPct: 40, unclaimedRaw: "0" },
    graduation: { migrated: true, thresholdRaw: "1545441116310", feePct: 2, creatorPct: 40, withdrawn: true },
    lp: { claimedRaw: "1130335913", unclaimedRaw: "0" },
    sharing: {
      vault: "BviXJiJoaa8JFWc4LB4WRssnBnJ5Ji98Dx7t51aV1xRT",
      totalShare: 10_000,
      fundedRaw: "20282978726",
      feePerShare: FPS,
      users: [
        { address: THIRD, share: 3_500, claimedRaw: "7099042553", checkpoint: FPS },
        { address: OTHER, share: 4_000, claimedRaw: "8113191489", checkpoint: FPS },
        { address: CREATOR, share: 2_500, claimedRaw: "5070744680", checkpoint: FPS },
      ],
    },
  };
  for (const wallet of [THIRD, OTHER, CREATOR]) assert.equal(creatorEarnings(read, wallet).mine.unclaimedRaw, "0", "a whole claim leaves nothing to press «Claim» for");
  assert.deepEqual(creatorEarnings(read, CREATOR).mine, { shareBps: 2_500, earnedRaw: "5070744680", unclaimedRaw: "0", claimedRaw: "5070744680" });
  /* A fee still at its source: funded first, then paid by the same rounding — the quarter of 1 000 raw units, less what the program keeps. */
  const pending = { ...read, curve: { ...read.curve, unclaimedRaw: "1000" } };
  const quarter = BigInt(creatorEarnings(pending, CREATOR).mine.unclaimedRaw);
  assert.ok(quarter === 249n || quarter === 250n, `a quarter, rounded down by the program: ${quarter}`);
  /* A wallet behind on its checkpoint: what sits in the vault for it. */
  const behind = { ...read, sharing: { ...read.sharing, users: read.sharing.users.map((user) => (user.address === CREATOR ? { ...user, checkpoint: "0" } : user)) } };
  assert.equal(creatorEarnings(behind, CREATOR).mine.unclaimedRaw, ((2_500n * BigInt(FPS)) >> 64n).toString());
  assert.equal(creatorEarnings(read, "9WBQamBC9Amdzzrq8QANXweZCKpfhLMLvPQJzMBgFbbu").mine.shareBps, 0, "a wallet outside the vault takes no part");
});

test("the earnings card says each currency apart, the period from the first launch, and never counts a launch it could not read as nothing", () => {
  const usdc = { mint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", symbol: "USDC", decimals: 6, dollar: true };
  const comm = { mint: "8QwXVdfGjmnjZjF3TkzT4FZzA8J1gg9s8SfF9TUxFgEX", symbol: "COMM", decimals: 6, dollar: false };
  const card = creatorEarningsCard({
    wallet: CREATOR,
    network: "solana:devnet",
    now: "2026-10-06T00:00:00.000Z",
    receipts: ["DyXZZCSiBREJ8YZ5cULd7PVdKpbkhHvHJ7otbJmLJajJtRsyq1irMMqKimYeKvRmZ8Sc2qWLhKjYR4ekM8RSzkV"],
    rows: [
      { launchedAt: "2026-10-05T08:42:40.961Z", migrated: true, read: true, pair: usdc, earnedRaw: "174088003", claimedRaw: "174088003" },
      { launchedAt: "2026-10-05T09:17:08.605Z", migrated: false, read: true, pair: usdc, earnedRaw: "160208", claimedRaw: "0" },
      { launchedAt: "2026-10-05T23:24:00.000Z", migrated: false, read: true, pair: comm, earnedRaw: "361326827", claimedRaw: "0" },
      { launchedAt: "2026-10-04T10:00:00.000Z", migrated: null, read: false, pair: usdc, earnedRaw: "0", claimedRaw: "0" },
    ],
  });
  assert.equal(card.launches, 4);
  assert.equal(card.graduated, 1);
  assert.equal(card.unread, 1);
  assert.equal(card.period.from, "2026-10-04T10:00:00.000Z");
  assert.deepEqual(
    card.amounts.map((amount) => [amount.symbol, amount.earnedRaw, amount.claimedRaw]),
    [
      ["USDC", "174248211", "174088003"],
      ["COMM", "361326827", "0"],
    ],
  );
});

test("a vault that could not be read is a failed read, never «no vault» — its figures would read as zero", async () => {
  const { observeFeeSharing } = await import("../venues/meteora-dbc/fee-sharing.server.ts");
  const vault = "BviXJiJoaa8JFWc4LB4WRssnBnJ5Ji98Dx7t51aV1xRT";
  assert.equal(await observeFeeSharing({ getAccountInfo: async () => null }, vault), null, "no account: no vault");
  await assert.rejects(observeFeeSharing({ getAccountInfo: async () => { throw new Error("429 Too Many Requests"); } }, vault), /429/);
});

test("SOL-L1d: the curve's surplus is the creator's part by Meteora's formula once the curve is full, withdrawn by the curve's own flag", () => {
  /* A curve filled 15 454,411163 USDC over a 15 000 threshold: 454,411163 above it, 80 % of that to partner and creator, 40 % of it the creator's. */
  const surplus = { full: true, reserveRaw: "15454411163", thresholdRaw: "15000000000", creatorPct: 40, withdrawn: false };
  assert.equal(creatorSurplusRaw(surplus), 145_411_572n, "⌊⌊454 411 163 × 80 / 100⌋ × 40 / 100⌋");
  assert.equal(creatorSurplusRaw({ ...surplus, full: false }), 0n, "a curve still on its way has none");
  assert.equal(creatorSurplusRaw({ ...surplus, reserveRaw: "15000000000" }), 0n, "stopped exactly at the threshold: none");
  const earnings = creatorEarnings({ ...CLAIMED, surplus }, CREATOR);
  assert.deepEqual(earnings.role.surplus, { earnedRaw: "145411572", unclaimedRaw: "145411572" });
  assert.equal(earnings.role.unclaimedRaw, "145411572", "the only source still waiting");
  assert.equal(earnings.mine.earnedRaw, String(1_132_791_142n + 145_411_572n));
  const taken = creatorEarnings({ ...CLAIMED, surplus: { ...surplus, withdrawn: true } }, CREATOR);
  assert.deepEqual(taken.role.surplus, { earnedRaw: "145411572", unclaimedRaw: "0" });
  assert.equal(taken.mine.claimedRaw, taken.mine.earnedRaw);
  /* A read stored before the surplus was read counts none — never a guess. */
  assert.deepEqual(creatorEarnings(CLAIMED, CREATOR).role.surplus, { earnedRaw: "0", unclaimedRaw: "0" });
});

test("SOL-L1d: shared, the surplus funds the vault like any source — each wallet's part by the program's fee per share", () => {
  const surplus = { full: true, reserveRaw: "15454411163", thresholdRaw: "15000000000", creatorPct: 40, withdrawn: false };
  const read = {
    ...CLAIMED,
    roleOwner: "VauLt1111111111111111111111111111111111111",
    surplus,
    sharing: { vault: "VauLt1111111111111111111111111111111111111", totalShare: 10_000, fundedRaw: "0", feePerShare: "0", users: [{ address: CREATOR, share: 6_000, claimedRaw: "0", checkpoint: "0" }, { address: OTHER, share: 4_000, claimedRaw: "0", checkpoint: "0" }] },
  };
  const mine = creatorEarnings(read, CREATOR).mine;
  const theirs = creatorEarnings(read, OTHER).mine;
  assert.ok(BigInt(mine.unclaimedRaw) + BigInt(theirs.unclaimedRaw) <= 145_411_572n, "never more than the surplus");
  assert.ok(145_411_572n - (BigInt(mine.unclaimedRaw) + BigInt(theirs.unclaimedRaw)) <= 2n, "the program's rounding keeps back a unit a wallet at most");
  assert.equal(mine.shareBps, 6_000);
});
