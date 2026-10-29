/*
 * SOL-L8 — «Правила на кривій»: the verified set, what is refused in code, and the hook that ends at the DEX.
 *
 * - the flag: closed by default, open only with `RYNTRA_LAUNCH_CURVE_RULES=open`, the audited program, its published
 *   audit (SEC-3) and DBC SDK 2.0.0;
 * - every rule Ryntra allows, with its bounds, and every rule that locks a buyer in — refused by name, with the reason;
 *   a rule the set does not hold, a scope that would outlive the DEX and a program anyone could change — refused too;
 * - the reference semantics the audited program must match: each rule refuses what it is for, no rule ever refuses a
 *   transfer a holder other than the creator sends, and after the DEX nothing refuses anything;
 * - the hook taken off the mint at the move to the DEX, and a hook that survives it refused;
 * - the launch receipt: a hook mint is Ryntra's only on a `rules` config fixing the audited program, and it says its
 *   rules instead of «Без правил на переказах» — the preset with rules against the presets without them.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Keypair } from "@solana/web3.js";

import { buildLaunchReceiptFacts, launchCreationProblems, launchObservationProblems } from "../venues/meteora-dbc/receipt.ts";
import { LAUNCH_PRESETS, PEOPLE_PRESET_IDS, honestLaunchProblems } from "../venues/meteora-dbc/presets.ts";
import { createMeteoraDbcLaunchVenue } from "../venues/meteora-dbc/launch.server.ts";
import { fixtureConnection } from "../venues/meteora-dbc/sdk-compare-kit.mjs";
import { marketRules } from "./market-health.ts";
import { presetTerms } from "./preset-terms.ts";
import { proofOfLaunch } from "./proof.ts";
import {
  CURVE_RULES_AUDIT_ENV,
  CURVE_RULES_FLAG,
  CURVE_RULES_PRESET_ID,
  CURVE_RULES_PROGRAM_ENV,
  CURVE_RULES_SCOPE,
  CURVE_RULE_BOUNDS,
  CURVE_RULE_IDS,
  LOCKED_IN_REASONS,
  LOCKED_IN_RULE_IDS,
  curveHookTimeline,
  curveRuleOf,
  curveRuleSetFrom,
  curveRuleSetOf,
  curveRuleSetProblems,
  curveRulesFormat,
  curveRulesProgramOf,
  curveRulesProgramProblems,
  curveRulesRefusal,
  mintCurveRulesProblems,
} from "./curve-rules.ts";

const seeded = (byte) => Keypair.fromSeed(Buffer.alloc(32, byte)).publicKey.toBase58();
const PROGRAM = seeded(61);
const MULTISIG = seeded(62);
const POOL_AUTHORITY = seeded(63);
const AUDIT = "https://ryntra.io/audits/curve-rules-v1";
const MULTISIGS = [MULTISIG];

const FROZEN = { program: PROGRAM, upgrade: "FROZEN", upgradeAuthority: null, audit: AUDIT };
const GOVERNED = { program: PROGRAM, upgrade: "MULTISIG", upgradeAuthority: MULTISIG, audit: AUDIT };

const EVERY_RULE = [
  { id: "WALLET_CAP", capBps: 200 },
  { id: "ANTI_BUNDLE", windowSeconds: 10, buysPerWallet: 2, buysPerSlot: 8 },
  { id: "CREATOR_VESTING" },
  { id: "SNIPER_CEILING", seconds: 300, capBps: 50 },
];

const set = (over = {}) => ({ rules: EVERY_RULE, scope: CURVE_RULES_SCOPE, program: FROZEN, ...over });

/* ------------------------------------------------------------ the switch */

test("SOL-L8: the preset is closed by default and opens only with its flag, the audited program, its audit and SDK 2.0.0", () => {
  assert.equal(CURVE_RULES_FLAG, "RYNTRA_LAUNCH_CURVE_RULES");
  const open = { [CURVE_RULES_FLAG]: "open", [CURVE_RULES_PROGRAM_ENV]: PROGRAM, [CURVE_RULES_AUDIT_ENV]: AUDIT };
  assert.equal(curveRulesProgramOf({}, "2.0.0", { multisigs: MULTISIGS }), null, "nothing set — closed");
  assert.equal(curveRulesProgramOf(open, "1.5.13", { multisigs: MULTISIGS }), null, "1.5.13 builds no hook config");
  assert.equal(curveRulesProgramOf({ ...open, [CURVE_RULES_FLAG]: "" }, "2.0.0", { multisigs: MULTISIGS }), null, "the flag closed");
  assert.equal(curveRulesProgramOf({ ...open, [CURVE_RULES_AUDIT_ENV]: "" }, "2.0.0", { multisigs: MULTISIGS }), null, "no independent audit — never offered");
  assert.equal(curveRulesProgramOf({ ...open, [CURVE_RULES_PROGRAM_ENV]: "" }, "2.0.0", { multisigs: MULTISIGS }), null, "no program named");
  assert.deepEqual(curveRulesProgramOf(open, "2.0.0", { multisigs: MULTISIGS }), FROZEN, "frozen when no multisig is named");
  assert.deepEqual(curveRulesProgramOf(open, "2.0.0", { multisigs: MULTISIGS, upgradeAuthority: MULTISIG }), GOVERNED);
  assert.equal(curveRulesProgramOf(open, "2.0.0", { multisigs: MULTISIGS, upgradeAuthority: seeded(64) }), null, "an authority that is not Ryntra's multisig");
  assert.equal(curveRulesFormat(null), null);
  const format = curveRulesFormat(FROZEN);
  assert.deepEqual(
    format.rules.map((rule) => rule.id),
    [...CURVE_RULE_IDS],
  );
  assert.deepEqual(format.forbidden.map((rule) => rule.id), [...LOCKED_IN_RULE_IDS]);
  assert.equal(format.side, "PURCHASE", "every rule acts on a purchase");
});

/* ------------------------------------------------------------ what is allowed and what is not */

test("SOL-L8: every rule of Ryntra's set is allowed inside its bounds and refused outside them", () => {
  assert.deepEqual(curveRuleSetProblems(set(), { multisigs: MULTISIGS }), []);
  assert.deepEqual(curveRuleSetProblems(set({ program: GOVERNED }), { multisigs: MULTISIGS }), []);
  /* Each rule on its own is a set too: a creator may take one of the four. */
  for (const rule of EVERY_RULE) assert.deepEqual(curveRuleSetProblems(set({ rules: [rule] }), { multisigs: MULTISIGS }), [], rule.id);
  const outside = [
    [{ id: "WALLET_CAP", capBps: CURVE_RULE_BOUNDS.WALLET_CAP.capBps.min - 1 }, /capBps must be a whole number/],
    [{ id: "WALLET_CAP", capBps: CURVE_RULE_BOUNDS.WALLET_CAP.capBps.max + 1 }, /capBps must be a whole number/],
    [{ id: "WALLET_CAP", capBps: 100.5 }, /capBps must be a whole number/],
    [{ id: "WALLET_CAP" }, /capBps must be a whole number/],
    [{ id: "ANTI_BUNDLE", windowSeconds: 600, buysPerWallet: 2, buysPerSlot: 8 }, /windowSeconds must be a whole number/],
    [{ id: "ANTI_BUNDLE", windowSeconds: 10, buysPerWallet: 0, buysPerSlot: 8 }, /buysPerWallet must be a whole number/],
    [{ id: "ANTI_BUNDLE", windowSeconds: 10, buysPerWallet: 2, buysPerSlot: 1 }, /buysPerSlot must be a whole number/],
    [{ id: "SNIPER_CEILING", seconds: 10, capBps: 50 }, /seconds must be a whole number/],
    [{ id: "SNIPER_CEILING", seconds: 300, capBps: 500 }, /capBps must be a whole number/],
    [{ id: "CREATOR_VESTING", days: 30 }, /days is not a number this rule takes/],
  ];
  for (const [rule, expected] of outside) {
    const problems = curveRuleSetProblems(set({ rules: [rule] }), { multisigs: MULTISIGS });
    assert.ok(problems.some((line) => expected.test(line)), `${JSON.stringify(rule)} → ${problems.join("; ")}`);
    assert.equal(curveRuleOf(rule), null);
  }
  /* Numbers that would never bite are not numbers: a ceiling above the wallet's own cap. */
  assert.ok(
    curveRuleSetProblems(set({ rules: [{ id: "WALLET_CAP", capBps: 100 }, { id: "SNIPER_CEILING", seconds: 300, capBps: 200 }] }), { multisigs: MULTISIGS }).some((line) =>
      /above the wallet's own cap/.test(line),
    ),
  );
  assert.ok(curveRuleSetProblems(set({ rules: [EVERY_RULE[0], EVERY_RULE[0]] }), { multisigs: MULTISIGS }).includes("WALLET_CAP is named twice"));
  assert.ok(curveRuleSetProblems(set({ rules: [] }), { multisigs: MULTISIGS }).includes("a launch with rules on the curve and no rule in them"));
});

test("SOL-L8: a rule that locks a buyer in is refused in code, by name and with its reason", () => {
  for (const id of LOCKED_IN_RULE_IDS) {
    const problems = curveRuleSetProblems(set({ rules: [{ id }] }), { multisigs: MULTISIGS });
    assert.ok(problems.some((line) => line === `${id} is forbidden on Ryntra: ${LOCKED_IN_REASONS[id]}`), `${id} → ${problems.join("; ")}`);
    assert.equal(curveRuleOf({ id }), null);
    assert.equal(curveRuleSetFrom(set({ rules: [{ id }] }), { multisigs: MULTISIGS }), null);
    assert.throws(() => curveRuleSetOf(set({ rules: [{ id }] }), { multisigs: MULTISIGS }), /outside Ryntra's set/);
  }
  /* The set is a list of what is allowed, so a rule nobody named is refused too — never let through for being unknown. */
  for (const unknown of [{ id: "ANYTHING_ELSE" }, { id: 5 }, "SELL_FORBIDDEN", null, {}]) {
    assert.equal(curveRuleOf(unknown), null, JSON.stringify(unknown));
    assert.ok(curveRuleSetProblems(set({ rules: [unknown] }), { multisigs: MULTISIGS }).length > 0);
  }
  /* The rules must end at the DEX, and the set carries nothing else. */
  assert.ok(curveRuleSetProblems(set({ scope: "FOR_EVER" }), { multisigs: MULTISIGS }).some((line) => /outlive the move to the DEX/.test(line)));
  assert.ok(curveRuleSetProblems({ ...set(), extra: 1 }, { multisigs: MULTISIGS }).includes("extra is not a part of a set of rules"));
  assert.deepEqual(curveRuleSetFrom(set(), { multisigs: MULTISIGS }), set());
});

test("SOL-L8: a rule program is frozen or upgraded by one of Ryntra's multisigs, with an independent audit, and nothing else", () => {
  assert.deepEqual(curveRulesProgramProblems(FROZEN, { multisigs: MULTISIGS }), []);
  assert.deepEqual(curveRulesProgramProblems(GOVERNED, { multisigs: MULTISIGS }), []);
  const refused = [
    [{ ...GOVERNED, upgradeAuthority: seeded(65) }, /not one of Ryntra's multisigs/],
    [{ ...GOVERNED, upgradeAuthority: null }, /names no multisig/],
    [{ ...FROZEN, upgradeAuthority: MULTISIG }, /a frozen rule program has no upgrade authority/],
    [{ ...FROZEN, upgrade: "CREATOR" }, /either frozen or upgraded by one of Ryntra's multisigs/],
    [{ ...FROZEN, upgrade: "ANYONE" }, /either frozen or upgraded by one of Ryntra's multisigs/],
    [{ ...FROZEN, audit: "" }, /carries no independent audit/],
    [{ ...FROZEN, program: "not-an-address" }, /is not an address/],
    [null, /the rules name no program/],
  ];
  for (const [program, expected] of refused) {
    const problems = curveRulesProgramProblems(program, { multisigs: MULTISIGS });
    assert.ok(problems.some((line) => expected.test(line)), `${JSON.stringify(program)} → ${problems.join("; ")}`);
    assert.ok(curveRuleSetProblems(set({ program }), { multisigs: MULTISIGS }).length > 0);
  }
  /* A deployment that knows no multisig cannot run an upgradable program at all. */
  assert.ok(curveRulesProgramProblems(GOVERNED, { multisigs: [] }).some((line) => /not one of Ryntra's multisigs/.test(line)));
});

/* ------------------------------------------------------------ the reference semantics */

const SUPPLY = 1_000_000_000_000_000n;
const CREATOR = seeded(66);
const BUYER = seeded(67);
const state = (over = {}) => ({ supplyRaw: SUPPLY, toHeldRaw: 0n, toPurchasesInWindow: 0, purchasesInSlot: 0, creator: CREATOR, migrated: false, ...over });
const buy = (over = {}) => ({ purchase: true, from: "curve", to: BUYER, amountRaw: SUPPLY / 1_000n, sinceStartSeconds: 3_600, slot: 10, ...over });
const send = (over = {}) => ({ purchase: false, from: BUYER, to: seeded(68), amountRaw: SUPPLY / 1_000n, sinceStartSeconds: 3_600, slot: 10, ...over });

test("SOL-L8: each rule refuses what it is for — the behaviour the audited program must match", () => {
  const only = (rule) => set({ rules: [rule] });
  /* The wallet's cap: 2 % of the supply, counted with what the wallet already holds. */
  const cap = only({ id: "WALLET_CAP", capBps: 200 });
  assert.equal(curveRulesRefusal(cap, buy({ amountRaw: (SUPPLY * 200n) / 10_000n }), state()), null, "exactly the cap is allowed");
  assert.equal(curveRulesRefusal(cap, buy({ amountRaw: (SUPPLY * 200n) / 10_000n + 1n }), state()), "WALLET_CAP");
  assert.equal(curveRulesRefusal(cap, buy({ amountRaw: 1n }), state({ toHeldRaw: (SUPPLY * 200n) / 10_000n })), "WALLET_CAP", "what it holds counts");
  /* The anti-bundle: one wallet's purchases in the window, and the whole mint's in one slot. */
  const bundle = only({ id: "ANTI_BUNDLE", windowSeconds: 10, buysPerWallet: 2, buysPerSlot: 8 });
  assert.equal(curveRulesRefusal(bundle, buy(), state({ toPurchasesInWindow: 1 })), null);
  assert.equal(curveRulesRefusal(bundle, buy(), state({ toPurchasesInWindow: 2 })), "ANTI_BUNDLE");
  assert.equal(curveRulesRefusal(bundle, buy(), state({ purchasesInSlot: 7 })), null);
  assert.equal(curveRulesRefusal(bundle, buy(), state({ purchasesInSlot: 8 })), "ANTI_BUNDLE", "a bundle of wallets in one slot");
  /* The ceiling for the first minutes, and nothing after them. */
  const sniper = only({ id: "SNIPER_CEILING", seconds: 300, capBps: 50 });
  const over = (SUPPLY * 50n) / 10_000n + 1n;
  assert.equal(curveRulesRefusal(sniper, buy({ amountRaw: over, sinceStartSeconds: 299 }), state()), "SNIPER_CEILING");
  assert.equal(curveRulesRefusal(sniper, buy({ amountRaw: over, sinceStartSeconds: 300 }), state()), null, "the window has passed");
  /* The creator's own purchase does not move until the DEX. */
  const vesting = only({ id: "CREATOR_VESTING" });
  assert.equal(curveRulesRefusal(vesting, send({ from: CREATOR }), state()), "CREATOR_VESTING");
  assert.equal(curveRulesRefusal(vesting, buy({ to: CREATOR }), state()), null, "buying is not moving");
  assert.equal(curveRulesRefusal(vesting, send({ from: CREATOR }), state({ migrated: true })), null, "the DEX frees it");
});

test("SOL-L8: no rule of the set ever refuses a holder's own transfer, and after the DEX nothing refuses anything", () => {
  const whole = set();
  /* The one property that makes this set impossible to lock a buyer in with: a holder's own transfer always passes. */
  for (const transfer of [send(), send({ amountRaw: SUPPLY }), send({ sinceStartSeconds: 0, slot: 1 }), send({ to: CREATOR })]) {
    for (const over of [{}, { toHeldRaw: SUPPLY }, { toPurchasesInWindow: 99 }, { purchasesInSlot: 99 }]) {
      assert.equal(curveRulesRefusal(whole, transfer, state(over)), null, `${transfer.from} → ${transfer.to} ${Object.keys(over).join(",")}`);
    }
  }
  /* And after the move to the DEX the hook is off the mint, so even a purchase is refused by nothing. */
  for (const transfer of [buy({ amountRaw: SUPPLY, sinceStartSeconds: 0 }), send({ from: CREATOR })]) {
    assert.equal(curveRulesRefusal(whole, transfer, state({ migrated: true, toHeldRaw: SUPPLY, purchasesInSlot: 99 })), null);
  }
});

/* ------------------------------------------------------------ the hook, read from the mint */

const hookArgs = (over = {}) => ({ program: PROGRAM, migrated: false, poolAuthority: POOL_AUTHORITY, ...over });

test("SOL-L8: the hook runs on the curve, is taken off the mint at the DEX, and a hook that survives it is refused", () => {
  const onCurve = { program: PROGRAM, authority: POOL_AUTHORITY };
  assert.deepEqual(curveHookTimeline(onCurve, hookArgs()), { phase: "CURVE", programNow: PROGRAM, authorityLive: true });
  assert.deepEqual(mintCurveRulesProblems(onCurve, hookArgs()), []);
  const removed = { program: null, authority: null };
  assert.deepEqual(curveHookTimeline(removed, hookArgs({ migrated: true })), { phase: "REMOVED", programNow: null, authorityLive: false });
  assert.deepEqual(mintCurveRulesProblems(removed, hookArgs({ migrated: true })), []);
  /* Outside the rule, each said plainly. */
  assert.equal(curveHookTimeline({ program: seeded(69), authority: POOL_AUTHORITY }, hookArgs()).phase, "OUTSIDE_RULE");
  assert.ok(mintCurveRulesProblems({ program: seeded(69), authority: POOL_AUTHORITY }, hookArgs()).includes("the mint's transfer hook is not the audited rule program"));
  assert.ok(mintCurveRulesProblems({ program: PROGRAM, authority: CREATOR }, hookArgs()).includes("the transfer hook is not held by the curve's own authority"));
  assert.ok(mintCurveRulesProblems({ program: PROGRAM, authority: null }, hookArgs({ migrated: true })).includes("the transfer hook was not taken off the mint at the move to the DEX"));
  assert.ok(mintCurveRulesProblems({ program: null, authority: CREATOR }, hookArgs({ migrated: true })).includes("someone can still put a transfer hook on the mint after the DEX"));
  /* The rules never start without the hook: no program on the curve is no rules at all. */
  assert.equal(curveHookTimeline(removed, hookArgs()).phase, "OUTSIDE_RULE");
});

/* ------------------------------------------------------------ the preset */

test("SOL-L8: launches with rules are a preset of their own, offered to nobody, and no other preset carries them", () => {
  assert.equal(CURVE_RULES_PRESET_ID, "rules");
  assert.equal(LAUNCH_PRESETS.rules.curveRules, true);
  assert.equal(presetTerms("rules").curveRules, true);
  for (const id of ["classic", "protected", "community", "micro", "demo", "advanced"]) {
    assert.equal(LAUNCH_PRESETS[id].curveRules, undefined, id);
    assert.equal(presetTerms(id).curveRules, false, id);
  }
  assert.equal(PEOPLE_PRESET_IDS.includes("rules"), false, "never in the presets a person picks");
  /* A hook config is a Ryntra config only for the audited program, and only when this deployment runs it. */
  const config = { ...honestConfig, hasTransferHook: true, transferHookProgram: PROGRAM };
  assert.ok(honestLaunchProblems(config).some((line) => /transfer-hook config/.test(line)), "no program here — refused as always");
  assert.deepEqual(honestLaunchProblems(config, { curveRules: FROZEN }), []);
  assert.ok(honestLaunchProblems({ ...config, transferHookProgram: seeded(70) }, { curveRules: FROZEN }).some((line) => /not Ryntra's audited rule program/.test(line)));
  assert.ok(honestLaunchProblems({ ...honestConfig, transferHookProgram: PROGRAM }, { curveRules: FROZEN }).some((line) => /names a transfer-hook program but is not/.test(line)));
  assert.deepEqual(honestLaunchProblems(honestConfig, { curveRules: FROZEN }), [], "a config without a hook is unchanged");
});

/* A created config that keeps «Чесний лаунч» whole — the mirror of `presets.test.mjs`'s own. */
const honestConfig = {
  hasTransferHook: false,
  tokenType: 1,
  tokenUpdateAuthority: 1,
  migrationOption: 1,
  partnerLiquidityPercentage: 0,
  partnerPermanentLockedLiquidityPercentage: 50,
  partnerVestingPercentage: 0,
  creatorLiquidityPercentage: 0,
  creatorPermanentLockedLiquidityPercentage: 50,
  creatorVestingPercentage: 0,
  lockedVestingAmount: "0",
  baseFeeMode: 1,
  migratedCollectFeeMode: 2,
  compoundingFeeBps: 5_000,
  migratedPoolBaseFeeMode: 4,
  enableFirstSwapWithMinFee: true,
  preMigrationTokenSupply: "1000000000000000",
  postMigrationTokenSupply: "1000000000000000",
};

test("SOL-L8: nothing builds such a launch until the rule program is audited and the preset is open", async () => {
  const fixture = JSON.parse(readFileSync(new URL("../venues/meteora-dbc/fixtures/mainnet-dbc-accounts-2026-10-18.json", import.meta.url), "utf8"));
  const accounts = Object.fromEntries(Object.entries(fixture.accounts).map(([address, entry]) => [address, { owner: entry.owner, data: Buffer.from(entry.data, "base64") }]));
  const venue = createMeteoraDbcLaunchVenue({ connection: fixtureConnection(accounts).connection, configs: fixture.configs, curveRules: FROZEN });
  await assert.rejects(
    () => venue.buildConfig({ preset: "rules", quote: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, usdPrice: 1 }, feeClaimer: MULTISIG, leftoverReceiver: MULTISIG, payer: MULTISIG }),
    /is not built here/,
  );
});

/* ------------------------------------------------------------ the receipt and the mark */

const fixture = (name) => JSON.parse(readFileSync(new URL(`../venues/meteora-dbc/fixtures/${name}`, import.meta.url), "utf8"));
const base = fixture("devnet-classic-observation.json");
const creation = fixture("devnet-classic-creation.json");
const { poolPayer } = fixture("devnet-classic-config.json");

/** The same rehearsal launch, read as one with rules on its curve: the `rules` preset, the hook config, the mint's hook. */
const withRules = (over = {}) => ({
  ...base,
  preset: "rules",
  configRuleProgram: PROGRAM,
  transferHook: { mint: { program: PROGRAM, authority: POOL_AUTHORITY }, poolAuthority: POOL_AUTHORITY },
  mint: { ...base.mint, extensions: [...base.mint.extensions, "TransferHook"], transferHookProgram: PROGRAM },
  curve: { ...base.curve, migrated: false },
  graduated: null,
  ...over,
});

test("SOL-L8: a mint with a hook is a Ryntra launch only on a `rules` config fixing the audited program", () => {
  assert.deepEqual(launchObservationProblems(withRules()), []);
  /* A preset without rules whose config fixes a program, or whose mint carries a hook: refused, as it always was. */
  assert.ok(launchObservationProblems(withRules({ preset: "classic" })).some((line) => /fixes a transfer-hook program/.test(line)));
  assert.ok(launchObservationProblems({ ...withRules(), configRuleProgram: null }).some((line) => /fixes no rule program/.test(line)));
  assert.ok(launchObservationProblems({ ...base, mint: { ...base.mint, transferHookProgram: PROGRAM } }).includes("the mint has a transfer hook"));
  /* The config's program and the mint's hook must be the same program, held by the curve's own authority. */
  assert.ok(
    launchObservationProblems(withRules({ transferHook: { mint: { program: seeded(71), authority: POOL_AUTHORITY }, poolAuthority: POOL_AUTHORITY } })).includes(
      "the mint's transfer hook is not the audited rule program",
    ),
  );
  assert.ok(launchObservationProblems(withRules({ transferHook: { mint: { program: PROGRAM, authority: CREATOR }, poolAuthority: POOL_AUTHORITY } })).length > 0);
  assert.ok(launchObservationProblems(withRules({ mint: { ...base.mint, transferHookProgram: PROGRAM } })).includes("the config fixes rules on the curve the mint does not carry"));
  assert.deepEqual(launchCreationProblems(withRules(), creation, poolPayer), []);
});

test("SOL-L8: the receipt says a launch's rules in place of «Без правил на переказах», and the preset without them keeps it", () => {
  const input = { cluster: "devnet", creation, ryntraPoolPayer: poolPayer, observedAt: "2026-10-05T06:10:00.000Z" };
  const facts = buildLaunchReceiptFacts({ ...input, observation: withRules(), curveRuleSet: set({ program: GOVERNED }) });
  assert.deepEqual(
    facts.marks.map((mark) => mark.code),
    ["MINT_REVOKED", "NO_FREEZE", "METADATA_FIXED", "CURVE_RULES_UNTIL_DEX", "CURVE_HOLDS_FUNDS"],
  );
  assert.equal(facts.marks.some((mark) => mark.code === "NO_TRANSFER_HOOK"), false, "«Без правил на переказах» would be a lie here");
  assert.deepEqual(facts.curveRules, {
    program: PROGRAM,
    scope: "UNTIL_DEX",
    phase: "CURVE",
    rules: ["WALLET_CAP", "ANTI_BUNDLE", "CREATOR_VESTING", "SNIPER_CEILING"],
    upgrade: "MULTISIG",
    upgradeAuthority: MULTISIG,
    audit: AUDIT,
  });
  assert.equal(facts.token2022.transferHookProgram, PROGRAM);
  assert.ok(facts.token2022.extensions.includes("TransferHook"));
  /* The same launch after the DEX: the hook is off the mint and the mark says so. */
  const after = buildLaunchReceiptFacts({
    ...input,
    observation: { ...withRules(), curve: { ...base.curve, migrated: true }, graduated: base.graduated, transferHook: { mint: { program: null, authority: null }, poolAuthority: POOL_AUTHORITY }, mint: { ...base.mint, extensions: [...base.mint.extensions, "TransferHook"], transferHookProgram: null } },
    curveRuleSet: set(),
  });
  assert.equal(after.curveRules.phase, "REMOVED");
  assert.equal(after.token2022.transferHookProgram, null);
  assert.equal(after.marks.some((mark) => mark.code === "NO_TRANSFER_HOOK"), false);
  /* A set whose program is not this launch's draws no rules at all. */
  const strange = buildLaunchReceiptFacts({ ...input, observation: withRules(), curveRuleSet: set({ program: { ...FROZEN, program: seeded(72) } }) });
  assert.equal(strange.curveRules, undefined);
  /* And a preset without rules still says «Без правил на переказах», exactly as before. */
  const plain = buildLaunchReceiptFacts({ ...input, observation: base });
  assert.ok(plain.marks.some((mark) => mark.code === "NO_TRANSFER_HOOK"));
  assert.equal(plain.curveRules, undefined);
  assert.equal(plain.token2022.transferHookProgram, null);
});

test("SOL-L8: the market's rules and the proof of launch say the rules and who may change their program", () => {
  const receipt = {
    program: PROGRAM,
    rules: ["WALLET_CAP", "CREATOR_VESTING"],
    upgrade: "MULTISIG",
    upgradeAuthority: MULTISIG,
    audit: AUDIT,
  };
  const rules = marketRules({
    migrated: false,
    tokenMarks: [{ code: "CURVE_RULES_UNTIL_DEX", account: base.token }],
    curveRules: receipt,
    config: "c",
    curve: "p",
    launchSignature: "s",
    thresholdRaw: "1",
    lockedPositions: [],
    creatorLock: null,
    feeVault: null,
    firstBuyCapBps: null,
    executor: null,
    ladderPool: null,
    concentrationRead: false,
    creatorSalesRead: false,
    now: 0,
  });
  assert.deepEqual(rules.find((rule) => rule.code === "CURVE_RULES_UNTIL_DEX"), {
    code: "CURVE_RULES_UNTIL_DEX",
    enforcement: "rule",
    by: "token-2022",
    source: { kind: "account", id: base.token },
    values: { program: PROGRAM, rules: "WALLET_CAP,CREATOR_VESTING" },
  });
  assert.deepEqual(rules.find((rule) => rule.code === "CURVE_RULES_PROGRAM_GOVERNED"), {
    code: "CURVE_RULES_PROGRAM_GOVERNED",
    enforcement: "rule",
    by: "solana-loader",
    /* Where anyone checks it for themselves: the program's own account. */
    source: { kind: "account", id: PROGRAM },
    values: { upgrade: "MULTISIG", multisig: MULTISIG, audit: AUDIT },
  });
  assert.equal(rules.some((rule) => rule.code === "NO_TRANSFER_HOOK"), false);
  /* A mark with no set behind it says nothing — never a rule nobody can read. */
  assert.equal(marketRules({ migrated: false, tokenMarks: [{ code: "CURVE_RULES_UNTIL_DEX", account: base.token }], config: "c", curve: "p", launchSignature: "s", thresholdRaw: "1", lockedPositions: [], creatorLock: null, feeVault: null, firstBuyCapBps: null, executor: null, ladderPool: null, concentrationRead: false, creatorSalesRead: false, now: 0 }).some((rule) => rule.code === "CURVE_RULES_UNTIL_DEX"), false);

  const [rights] = proofOfLaunch({
    token: base.token,
    creator: CREATOR,
    creation: creation.signature,
    terms: presetTerms("rules"),
    receipt: {
      config: "c",
      curve: "p",
      supplyRaw: "1000000000000000",
      decimals: 6,
      marks: [{ code: "CURVE_RULES_UNTIL_DEX", account: base.token }],
      curveRules: receipt,
      creatorFirstBuy: null,
      creatorLock: null,
      migrated: false,
      progressBps: 0,
      thresholdRaw: "1",
      graduated: null,
    },
    lockUnread: false,
    exitUnread: false,
    market: null,
    health: null,
  }).filter((section) => section.topic === "rights");
  assert.deepEqual(
    rights.claims.map((claim) => claim.code),
    ["CURVE_RULES_UNTIL_DEX", "CURVE_RULES_PROGRAM_GOVERNED"],
  );
  assert.deepEqual(rights.claims[1].evidence, [{ kind: "account", id: PROGRAM, what: "rules" }]);
  assert.equal(rights.claims.some((claim) => claim.code === "NO_TRANSFER_HOOK"), false);
});
