import assert from "node:assert/strict";
import test from "node:test";

import { formatPoints, usdMicrosFromDecimalText, utcDayOf } from "./model.ts";
import { levelFor, POINTS_POLICY_V1, POINTS_POLICY_VERSION, USD_MICROS, volumePoints } from "./policy.ts";

const usd = (dollars) => BigInt(dollars) * USD_MICROS;
const policy = POINTS_POLICY_V1;

test("the policy carries its version and the figures the card promises", () => {
  assert.equal(policy.version, POINTS_POLICY_VERSION);
  assert.equal(policy.version, "1.0.0");
  assert.deepEqual(
    policy.volumeTiers.map((tier) => [tier.upToUsdMicros === null ? null : tier.upToUsdMicros / USD_MICROS, tier.pointsPerThousandUsd]),
    [
      [1_000n, 1_000n],
      [5_000n, 500n],
      [25_000n, 200n],
      [null, 50n],
    ],
  );
  assert.equal(policy.dailyVolumePointsCap, 10_000n);
  assert.equal(policy.activeDay.points, 10n);
  assert.equal(policy.activeDay.minimumDayVolumeUsdMicros, usd(10));
  assert.equal(policy.qualifiedReferral.points, 100n);
  assert.equal(policy.strategyCompleted.points, 0n, "reserved, with no writer");
  assert.deepEqual(policy.levels, [0n, 1_000n, 5_000n, 25_000n, 100_000n]);
});

test("the first thousand dollars of a day earn one point per dollar", () => {
  assert.equal(volumePoints(policy, { dayVolumeBeforeUsdMicros: 0n, volumeUsdMicros: usd(1), dayVolumePointsBefore: 0n }), 1n);
  assert.equal(volumePoints(policy, { dayVolumeBeforeUsdMicros: 0n, volumeUsdMicros: usd(250), dayVolumePointsBefore: 0n }), 250n);
  assert.equal(volumePoints(policy, { dayVolumeBeforeUsdMicros: 0n, volumeUsdMicros: usd(1_000), dayVolumePointsBefore: 0n }), 1_000n);
});

test("diminishing returns are marginal across the day, not a rate on the whole", () => {
  /* $1,000 at 1.0 + $4,000 at 0.5 + $20,000 at 0.2 + $10,000 at 0.05 */
  assert.equal(
    volumePoints(policy, { dayVolumeBeforeUsdMicros: 0n, volumeUsdMicros: usd(35_000), dayVolumePointsBefore: 0n }),
    1_000n + 2_000n + 4_000n + 500n,
  );
  /* A second trade starts where the first stopped. */
  assert.equal(volumePoints(policy, { dayVolumeBeforeUsdMicros: usd(900), volumeUsdMicros: usd(200), dayVolumePointsBefore: 900n }), 100n + 50n);
  /* Deep in the last tier the marginal point costs twenty dollars. */
  assert.equal(volumePoints(policy, { dayVolumeBeforeUsdMicros: usd(40_000), volumeUsdMicros: usd(100), dayVolumePointsBefore: 8_250n }), 5n);
});

test("sub-dollar remainders are floored, never rounded up", () => {
  assert.equal(volumePoints(policy, { dayVolumeBeforeUsdMicros: 0n, volumeUsdMicros: 999_999n, dayVolumePointsBefore: 0n }), 0n);
  assert.equal(volumePoints(policy, { dayVolumeBeforeUsdMicros: 0n, volumeUsdMicros: 1_999_999n, dayVolumePointsBefore: 0n }), 1n);
  assert.equal(volumePoints(policy, { dayVolumeBeforeUsdMicros: 0n, volumeUsdMicros: 0n, dayVolumePointsBefore: 0n }), 0n);
});

test("the daily cap is a ceiling on what remains of the day, not on one trade", () => {
  assert.equal(
    volumePoints(policy, { dayVolumeBeforeUsdMicros: 0n, volumeUsdMicros: usd(1_000_000), dayVolumePointsBefore: 0n }),
    10_000n,
    "one enormous trade stops at the cap",
  );
  assert.equal(
    volumePoints(policy, { dayVolumeBeforeUsdMicros: usd(500), volumeUsdMicros: usd(100), dayVolumePointsBefore: 9_950n }),
    50n,
    "only the room left under the cap is awarded",
  );
  assert.equal(
    volumePoints(policy, { dayVolumeBeforeUsdMicros: usd(500), volumeUsdMicros: usd(100), dayVolumePointsBefore: 10_000n }),
    0n,
    "a day at the cap earns nothing more",
  );
});

test("levels begin at the policy's thresholds and name the next one", () => {
  assert.deepEqual(levelFor(policy, 0n), { level: 1, nextAt: 1_000n });
  assert.deepEqual(levelFor(policy, 999n), { level: 1, nextAt: 1_000n });
  assert.deepEqual(levelFor(policy, 1_000n), { level: 2, nextAt: 5_000n });
  assert.deepEqual(levelFor(policy, 24_999n), { level: 3, nextAt: 25_000n });
  assert.deepEqual(levelFor(policy, 100_000n), { level: 5, nextAt: null });
  assert.deepEqual(levelFor(policy, 5_000_000n), { level: 5, nextAt: null });
});

test("a provider's decimal dollar text becomes exact micros through text, never a float", () => {
  assert.equal(usdMicrosFromDecimalText("0.1"), 100_000n);
  assert.equal(usdMicrosFromDecimalText("0.2"), 200_000n);
  assert.equal(usdMicrosFromDecimalText("142.3799999"), 142_379_999n, "floored at the sixth decimal");
  assert.equal(usdMicrosFromDecimalText("5"), 5_000_000n);
  assert.equal(usdMicrosFromDecimalText("1e3"), null, "exponent notation is refused");
  assert.equal(usdMicrosFromDecimalText("-1"), null);
  assert.equal(usdMicrosFromDecimalText(""), null);
  assert.equal(usdMicrosFromDecimalText(null), null);
});

test("the day is the UTC calendar day and points read with a group separator", () => {
  assert.equal(utcDayOf("2026-09-11T23:59:59.000Z"), "2026-09-11");
  assert.equal(utcDayOf("2026-09-11T22:30:00.000-03:00"), "2026-09-12");
  assert.throws(() => utcDayOf("yesterday"));
  assert.equal(formatPoints(0n), "0");
  assert.equal(formatPoints(999n), "999");
  assert.equal(formatPoints(1_234_567n), "1 234 567");
});
