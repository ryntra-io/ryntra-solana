import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVNET_EARLY_ACCESS_BOUNDS,
  EARLY_ACCESS_POOL_FEE,
  EARLY_ACCESS_TIMING,
  RYNTRA_EARLY_ACCESS_SHARE_BPS,
  earlyAccessBoundsProblems,
  earlyAccessFill,
  earlyAccessMintProblems,
  earlyAccessPhase,
  earlyAccessProblems,
  earlyAccessRuleLines,
  earlyAccessSchedule,
  presaleBpsOf,
  startPriceUsd,
  supplyRawOf,
} from "./early-access.ts";

const NOW = 1_800_000_000;
const FCFS = Object.freeze({
  mode: "FCFS",
  depositStartsAt: NOW + 600,
  depositEndsAt: NOW + 600 + 3_600,
  maxCapRaw: "10000000000", // 10 000 USDC
  individualCapRaw: "500000000", // 500 USDC
  vestingHours: 24,
  startMarketCapUsd: 50_000,
  supply: 1_000_000_000,
});
const PRO_RATA = Object.freeze({ ...FCFS, mode: "PRO_RATA", individualCapRaw: null });

test("Ryntra takes nothing on early access", () => {
  assert.equal(RYNTRA_EARLY_ACCESS_SHARE_BPS, 0);
});

test("the schedule follows the programs: trading opens 65 minutes after the last deposit, the vault buys in the hour before", () => {
  const schedule = earlyAccessSchedule(FCFS);
  assert.equal(schedule.activatesAt, FCFS.depositEndsAt + 3_900);
  assert.equal(schedule.activatesAt - schedule.depositEndsAt, EARLY_ACCESS_TIMING.preActivationSeconds + EARLY_ACCESS_TIMING.lastJoinBufferSeconds);
  assert.equal(schedule.fillStartsAt, schedule.activatesAt - 3_600);
  assert.equal(schedule.vestingStartsAt, schedule.activatesAt + 1);
  assert.equal(schedule.vestingEndsAt, schedule.vestingStartsAt + 24 * 3_600);
  /* No vesting: the end still follows the start, by a second. */
  const instant = earlyAccessSchedule({ ...FCFS, vestingHours: 0 });
  assert.equal(instant.vestingEndsAt, instant.vestingStartsAt + 1);
});

test("the phase moves UPCOMING → DEPOSITS → FILLING → VESTING → DONE", () => {
  const s = earlyAccessSchedule(FCFS);
  assert.equal(earlyAccessPhase(s, s.depositStartsAt - 1), "UPCOMING");
  assert.equal(earlyAccessPhase(s, s.depositStartsAt), "DEPOSITS");
  assert.equal(earlyAccessPhase(s, s.depositEndsAt), "DEPOSITS");
  assert.equal(earlyAccessPhase(s, s.depositEndsAt + 1), "FILLING");
  assert.equal(earlyAccessPhase(s, s.activatesAt - 1), "FILLING");
  assert.equal(earlyAccessPhase(s, s.activatesAt), "VESTING");
  assert.equal(earlyAccessPhase(s, s.vestingEndsAt), "DONE");
});

test("the start price is the market cap over the supply", () => {
  assert.equal(startPriceUsd(FCFS), 0.00005);
  assert.equal(supplyRawOf(FCFS), 1_000_000_000_000_000n);
});

test("the vault's purchase is a constant-product trade on the single-sided curve", () => {
  const fill = earlyAccessFill(FCFS);
  /* 10 000 USDC less the 1 % end fee = 9 900 net against a 50 000 USDC start market cap. */
  assert.equal(fill.spentRaw, "10000000000");
  assert.equal(fill.feeRaw, "100000000");
  const net = 9_900_000_000n;
  assert.equal(fill.tokensOutRaw, ((supplyRawOf(FCFS) * net) / (50_000_000_000n + net)).toString());
  assert.equal(fill.shareBps, 1652);
  assert.equal(presaleBpsOf(FCFS), 1652);
  /* The price after: P0 · ((M0 + q) / M0)², the market cap with it. */
  assert.ok(Math.abs(fill.priceAfterUsd - 0.00005 * (59_900 / 50_000) ** 2) < 1e-12);
  assert.ok(Math.abs(fill.marketCapAfterUsd - 71_760.2) < 0.01);
  /* Averaged with the fee: above the start price, below the price after. */
  assert.ok(fill.averagePriceUsd > startPriceUsd(FCFS) && fill.averagePriceUsd < fill.priceAfterUsd);
  assert.equal(fill.refundRaw, "0");
});

test("pro rata: deposits above the cap buy the cap and the rest is refunded", () => {
  const fill = earlyAccessFill(PRO_RATA, 25_000_000_000n);
  assert.equal(fill.spentRaw, PRO_RATA.maxCapRaw);
  assert.equal(fill.refundRaw, "15000000000");
  /* Under the cap, all of it is spent. */
  const under = earlyAccessFill(PRO_RATA, "4000000000");
  assert.equal(under.spentRaw, "4000000000");
  assert.equal(under.refundRaw, "0");
  assert.equal(earlyAccessFill(PRO_RATA, "0").tokensOutRaw, "0");
});

test("valid rules have no problems, on both modes", () => {
  assert.deepEqual(earlyAccessProblems(FCFS, DEVNET_EARLY_ACCESS_BOUNDS, NOW), []);
  assert.deepEqual(earlyAccessProblems(PRO_RATA, DEVNET_EARLY_ACCESS_BOUNDS, NOW), []);
});

test("every broken rule is named in a plain line", () => {
  const problems = (rules, bounds = DEVNET_EARLY_ACCESS_BOUNDS) => earlyAccessProblems({ ...FCFS, ...rules }, bounds, NOW).join(" | ");
  assert.match(problems({ depositStartsAt: NOW + 30, depositEndsAt: NOW + 3_000 }), /at least 2 minutes from now/);
  assert.match(problems({ depositEndsAt: FCFS.depositStartsAt + 60 }), /shorter than 20 minutes/);
  /* The vault's own floor (6021 on devnet 20.10): a window of 19:59 is refused even under bounds that would take it. */
  const loose = { ...DEVNET_EARLY_ACCESS_BOUNDS, minDepositMinutes: 2 };
  assert.match(problems({ depositEndsAt: FCFS.depositStartsAt + EARLY_ACCESS_TIMING.minDepositSeconds - 1 }, loose), /shorter than 20 minutes/);
  assert.doesNotMatch(problems({ depositEndsAt: FCFS.depositStartsAt + EARLY_ACCESS_TIMING.minDepositSeconds }, loose), /shorter than/);
  assert.match(problems({ depositEndsAt: FCFS.depositStartsAt + 40 * 24 * 3_600 }), /31 days|longer than/);
  assert.match(problems({ individualCapRaw: null }), /cap per wallet/);
  assert.match(problems({ individualCapRaw: "20000000000" }), /above the vault's cap/);
  assert.match(earlyAccessProblems({ ...PRO_RATA, individualCapRaw: "1" }, DEVNET_EARLY_ACCESS_BOUNDS, NOW).join(" "), /no cap per wallet/);
  assert.match(problems({ maxCapRaw: "1" }), /cap is outside the bounds/);
  assert.match(problems({ maxCapRaw: "abc" }), /not a raw amount/);
  assert.match(problems({ vestingHours: 10_000 }), /vesting is outside/);
  assert.match(problems({ startMarketCapUsd: 10 }), /market cap is outside/);
  assert.match(problems({ supply: 12.5 }), /supply/);
  assert.match(problems({ mode: "LOTTERY" }), /neither FCFS nor Pro Rata/);
  assert.match(problems({}, { ...DEVNET_EARLY_ACCESS_BOUNDS, modes: ["PRO_RATA"] }), /FCFS mode is not offered/);
  /* A cap that would buy more than the bounds allow: 60 000 USDC at a 50 000 start buys ~54 % of the supply. */
  assert.match(problems({ maxCapRaw: "60000000000", individualCapRaw: "500000000" }), /would buy 54\.\d % of the supply, above 50\.0 %/);
});

test("the bounds are validated as configured", () => {
  assert.deepEqual(earlyAccessBoundsProblems(DEVNET_EARLY_ACCESS_BOUNDS), []);
  assert.deepEqual(earlyAccessBoundsProblems(JSON.parse(JSON.stringify(DEVNET_EARLY_ACCESS_BOUNDS))), []);
  assert.ok(earlyAccessBoundsProblems(null).length > 0);
  assert.ok(earlyAccessBoundsProblems([]).length > 0);
  assert.match(earlyAccessBoundsProblems({ ...DEVNET_EARLY_ACCESS_BOUNDS, minCapRaw: "5", maxCapRaw: "1" }).join(), /out of order/);
  assert.match(earlyAccessBoundsProblems({ ...DEVNET_EARLY_ACCESS_BOUNDS, extra: 1 }).join(), /unknown field extra/);
  assert.match(earlyAccessBoundsProblems({ ...DEVNET_EARLY_ACCESS_BOUNDS, modes: ["FCFS", "AUCTION"] }).join(), /modes/);
  assert.match(earlyAccessBoundsProblems({ ...DEVNET_EARLY_ACCESS_BOUNDS, maxPresaleBps: 9_500 }).join(), /maxPresaleBps/);
  /* Bounds below the vault's 20-minute window would offer what the chain refuses. */
  assert.match(earlyAccessBoundsProblems({ ...DEVNET_EARLY_ACCESS_BOUNDS, minDepositMinutes: 19 }).join(), /at least 20/);
  /* The operator's bounds for later (CURRENT, 20.10 evening) hold. */
  const owners = { modes: ["PRO_RATA"], minCapRaw: "1000000000", maxCapRaw: "25000000000", minIndividualCapRaw: "10000000", minDepositMinutes: 60, maxDepositHours: 72, maxStartDelayHours: 168, minVestingHours: 24, maxVestingHours: 720, minStartMarketCapUsd: 10000, maxStartMarketCapUsd: 500000, maxPresaleBps: 2000 };
  assert.deepEqual(earlyAccessBoundsProblems(owners), []);
});

test("the lines a buyer reads: the mode, the window, the price, the vesting, the lock, Ryntra's zero — and no promise", () => {
  for (const locale of ["uk", "en"]) {
    const fcfs = earlyAccessRuleLines(FCFS, locale);
    const prorata = earlyAccessRuleLines(PRO_RATA, locale);
    assert.equal(fcfs.length, prorata.length);
    const all = [...fcfs, ...prorata].join("\n");
    assert.doesNotMatch(all, /безпечн|гарантован|гарантія|safe|guarantee|risk-free/i);
    assert.match(all, /Ryntra/);
  }
  const uk = earlyAccessRuleLines(FCFS, "uk").join("\n");
  assert.match(uk, /Хто перший/);
  assert.match(uk, /10 000 USDC/);
  assert.match(uk, /до 500 USDC/);
  assert.match(uk, /забрати назад не можна/);
  assert.match(uk, /заблокована назавжди/);
  assert.match(uk, /Ryntra нічого не бере/);
  assert.match(uk, /24 год/);
  assert.match(uk, /16,5 % пропозиції/);
  const en = earlyAccessRuleLines(PRO_RATA, "en").join("\n");
  assert.match(en, /Pro rata/);
  assert.match(en, /returned to each depositor pro rata/);
  assert.match(en, /locked for ever/);
  assert.match(en, /Ryntra takes nothing/);
  assert.match(en, /0\.0000500 USDC a token/);
  assert.match(en, /50,000 \$/);
  assert.match(en, new RegExp(`falls to ${EARLY_ACCESS_POOL_FEE.endBps / 100} %`));
  const instant = earlyAccessRuleLines({ ...FCFS, vestingHours: 0 }, "en").join("\n");
  assert.match(instant, /as soon as trading opens/);
});

test("a mint read back from the chain: honest, or each break named", () => {
  const mint = "So11111111111111111111111111111111111111112";
  const honest = {
    mint,
    program: "token-2022",
    supplyRaw: "1000000000000000",
    decimals: 6,
    mintAuthority: null,
    freezeAuthority: null,
    extensions: ["MetadataPointer", "TokenMetadata"],
    transferHookProgram: null,
    metadataPointerAuthority: null,
    metadataPointerAddress: mint,
    metadataUpdateAuthority: null,
  };
  assert.deepEqual(earlyAccessMintProblems(honest, { supplyRaw: "1000000000000000" }), []);
  const broken = earlyAccessMintProblems(
    { ...honest, mintAuthority: "x", freezeAuthority: "y", extensions: [...honest.extensions, "TransferHook", "PermanentDelegate"], transferHookProgram: "z", metadataUpdateAuthority: "w", metadataPointerAuthority: "v" },
    { supplyRaw: "1000000000000000" },
  ).join(" | ");
  for (const words of ["mint more", "freeze", "transfer hook", "PermanentDelegate", "metadata pointer", "change the metadata"]) assert.match(broken, new RegExp(words));
  assert.match(earlyAccessMintProblems({ ...honest, metadataUpdateAuthority: undefined }, { supplyRaw: honest.supplyRaw }).join(), /not read/);
  assert.match(earlyAccessMintProblems({ ...honest, supplyRaw: "1" }, { supplyRaw: honest.supplyRaw }).join(), /supply/);
});
