// Run from repo root: node --test lib/core/authority-matrix.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AUTHORITY_MATRIX,
  AUTOMATION_ELEMENTS,
  BOTS_AUTHORITY_IDS,
  ENFORCEMENT_LEVELS,
  EXECUTION_MODES,
  HONEST_STATES,
  anyAutomatic,
  authorityViews,
  findAuthority,
  gatePosition,
  isAutomatic,
  resolveAuthority,
  validateAuthorityMatrix,
} from "./authority-matrix.ts";
import { AUTHORITY_HEAD_WORDS, ENFORCEMENT_WORDS, HONEST_STATE_WORDS, MODE_WORDS } from "./authority-words.ts";
import { CAPABILITY_REGISTRY, capabilityKey } from "./capabilities.ts";
import { SOLANA_LANES, SOLANA_LANE_STATE_ENV, resolveSolanaLaneState } from "../solana/lane-state.ts";
import { liquidityGateMode } from "../liquidity/studio/gate.ts";
import { admitOrders } from "../phoenix/orders.ts";
import { admitCollateral } from "../phoenix/collateral.ts";
import { treasuryNetworkFrom } from "../solana/treasury/model.ts";
import { allowanceNetworkFrom } from "../solana/allowances/model.ts";
import { readLiveSettings } from "../predictions/live.ts";
import { PRODUCT_CAPABILITIES as CLAIMS } from "../product/capabilities.ts";
import { STRATEGY_TYPES } from "../product/strategy-types.ts";
import { BOTS_WORDS } from "../../app/app/bots/bots-words.ts";
import { INVEST_WORDS } from "../../app/app/invest/invest-words.ts";
import { PLAN_WORDS } from "../../app/app/strategies/plans/plan-words.ts";
import { buildCapabilities } from "../api/v1/capabilities.server.ts";
import { CapabilitiesSchema } from "../api/v1/contract.ts";

/**
 * EXE-1 «Матриця можливостей і повноважень» (spec §17.3 PR-1, §5.3, §6.1, §13.4): one matrix of venue × action, no
 * false LIVE, no «automatic» without the seven elements, the switches read the way the routes read them, the older
 * registries in agreement, the API and «Боти» drawn from it.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

/* Every switch the matrix reads, wide open. */
const ALL_OPEN = {
  ...Object.fromEntries(Object.values(SOLANA_LANE_STATE_ENV).map((key) => [key, "OPEN"])),
  RYNTRA_LIQUIDITY_ACTIONS: "OPEN",
  RYNTRA_PHOENIX_COLLATERAL: "OPEN",
  RYNTRA_PHOENIX_ORDERS: "OPEN",
  NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "mainnet",
  NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK: "mainnet",
  PREDICTIONS_LIVE_FUNDING: "on",
};

test("the matrix is valid as a whole: every row passes its rules, no id twice", () => {
  assert.deepEqual(validateAuthorityMatrix(), []);
  assert.ok(AUTHORITY_MATRIX.length >= 25);
});

test("the vocabulary is the spec's: seven honest states, four levels of enforcement, three modes", () => {
  assert.deepEqual([...HONEST_STATES], ["LIVE", "PAPER", "PREVIEW", "DISABLED", "UNAVAILABLE", "UNKNOWN", "RECOVERY"]);
  assert.deepEqual([...ENFORCEMENT_LEVELS], ["PROGRAM_ENFORCED", "PROVIDER_NATIVE", "RYNTRA_GATEWAY_ENFORCED", "OBSERVE_ONLY"]);
  assert.deepEqual([...EXECUTION_MODES], ["MANUAL", "ASSISTED", "AUTONOMOUS"]);
  assert.equal(AUTOMATION_ELEMENTS.length, 7);
  /* Words, never a colour alone: each state, bound and mode has its own word in both languages. */
  for (const locale of ["en", "uk"]) {
    const chips = HONEST_STATES.map((state) => HONEST_STATE_WORDS[state].chip[locale]);
    assert.equal(new Set(chips).size, 7, `${locale}: seven distinct words`);
    for (const state of HONEST_STATES) assert.ok(HONEST_STATE_WORDS[state].means[locale].length > 10);
    assert.equal(new Set(ENFORCEMENT_LEVELS.map((level) => ENFORCEMENT_WORDS[level][locale])).size, 4);
    assert.equal(new Set(EXECUTION_MODES.map((mode) => MODE_WORDS[mode][locale])).size, 3);
  }
});

test("the spec's venue × action rows are all there (SOS-0 §9 п. 1)", () => {
  for (const id of [
    "jupiter.swap",
    "jupiter.limit",
    "meteora-dlmm.limit",
    "relay.cross-swap",
    "circle-cctp.bridge",
    "meteora-dbc.launch",
    "meteora-dbc.creator-claim",
    "meteora-dbc.partner-claim",
    "meteora-dlmm.liquidity",
    "meteora-damm2.liquidity",
    "meteora-dlmm.grid",
    "phoenix.collateral",
    "phoenix.orders",
    "squads.treasury",
    "subscriptions.allowance",
    "agg.predictions-paper",
    "agg.predictions-live",
    "solana-pay.pay",
    "ryntra.recurring-buy",
    "ryntra.auto-dca",
  ]) {
    assert.ok(findAuthority(id), id);
  }
});

const bad = (patch) => validateAuthorityMatrix([{ ...findAuthority("jupiter.swap"), ...patch }]).join("\n");

test("no false LIVE: a live ceiling needs its recorded mainnet cycle, mainnet, a venue that offers it, someone to act", () => {
  assert.match(bad({ evidence: null }), /LIVE ceiling needs its recorded mainnet cycle/);
  assert.match(bad({ readiness: "BUILT" }), /LIVE ceiling needs a proven cycle/);
  assert.match(bad({ readiness: "PARTIAL" }), /LIVE ceiling needs a proven cycle/);
  assert.match(bad({ eligibility: "OPERATOR" }), /A LIVE row is open to people/);
  assert.match(bad({ network: "devnet" }), /LIVE is mainnet only/);
  assert.match(bad({ provider: "DEVNET" }), /LIVE needs the venue on mainnet/);
  assert.match(bad({ eligibility: "NOBODY" }), /A LIVE row is open to people/);
  assert.match(bad({ readiness: "MISSING" }), /Nothing built reads UNAVAILABLE/);
  assert.match(bad({ ceiling: "PAPER" }), /A simulation signs nothing/);
});

test("no false LIVE at runtime: under any switch a row reads LIVE only with a live ceiling and its switch open", () => {
  const envs = [{}, ALL_OPEN, Object.fromEntries(Object.keys(ALL_OPEN).map((key) => [key, "CANARY"])), Object.fromEntries(Object.keys(ALL_OPEN).map((key) => [key, "open "]))];
  for (const env of envs) {
    for (const row of AUTHORITY_MATRIX) {
      const resolved = resolveAuthority(row, env);
      if (resolved.state === "LIVE") {
        assert.equal(row.ceiling, "LIVE", row.id);
        assert.ok(row.evidence, row.id);
        assert.ok(resolved.gate === "OPEN" || resolved.gate === "NONE", `${row.id}: ${resolved.gate}`);
      }
      /* `CANARY` is reserved: a canary is never announced, a pilot names its wallets. */
      assert.notEqual(resolved.eligibility, "CANARY", row.id);
      /* No row sits in a runtime-only state. */
      assert.notEqual(resolved.state, "UNKNOWN");
      assert.notEqual(resolved.state, "RECOVERY");
    }
  }
  /* With nothing set, every row behind a switch is off — a missing variable opens nothing. */
  for (const row of AUTHORITY_MATRIX.filter((r) => r.gate.kind !== "NONE")) {
    assert.ok(["DISABLED", "UNAVAILABLE"].includes(resolveAuthority(row, {}).state), row.id);
  }
});

test("the rows that may read LIVE today, named: a new one is a deliberate edit here, with its evidence", () => {
  const live = AUTHORITY_MATRIX.filter((row) => resolveAuthority(row, ALL_OPEN).state === "LIVE").map((row) => row.id);
  assert.deepEqual(live, [
    "jupiter.swap",
    "jupiter.limit",
    "relay.cross-swap",
    "phoenix.collateral",
    "phoenix.orders",
    "meteora-dlmm.liquidity",
    "meteora-dlmm.grid",
    "ryntra.recurring-buy",
    "ryntra.trade-plan",
    "meteora-dbc.launch",
    "meteora-dbc.trade",
    "solana.send",
    "solana-pay.pay",
    "squads.treasury",
  ]);
  /* SOS-0 §5.1: what may not be called Live. */
  for (const id of ["meteora-dbc.partner-claim", "meteora-dbc.creator-claim", "meteora-damm2.liquidity", "ryntra.exit-plan", "meteora-dbc.holder-collect", "meteora-dbc.graduation", "meteora-dbc.liquidity-ladder", "meteora-dlmm.limit", "circle-cctp.bridge", "squads.spending-limit", "agg.predictions-live", "ryntra.agent-mandate", "ryntra.auto-dca"]) {
    assert.notEqual(resolveAuthority(findAuthority(id), ALL_OPEN).state, "LIVE", id);
  }
  assert.equal(resolveAuthority(findAuthority("agg.predictions-paper"), ALL_OPEN).state, "PAPER");
});

test("automatic only with all seven elements of spec §6.1 — and no row is automatic today", () => {
  const autonomous = { ...findAuthority("ryntra.auto-dca"), readiness: "PROVEN", ceiling: "LIVE", eligibility: "EVERYONE", evidence: "a test cycle", signer: "RYNTRA_KEY" };
  assert.match(validateAuthorityMatrix([autonomous]).join("\n"), /Autonomous LIVE lacks strategyDefinition/);
  const seven = Object.fromEntries(AUTOMATION_ELEMENTS.map((element) => [element, true]));
  assert.deepEqual(validateAuthorityMatrix([{ ...autonomous, automation: seven }]), []);
  assert.equal(isAutomatic({ ...autonomous, automation: seven }), true);
  assert.match(validateAuthorityMatrix([{ ...autonomous, automation: seven, enforcement: "OBSERVE_ONLY" }]).join(), /Nothing binds an observed bot/);
  assert.match(validateAuthorityMatrix([{ ...autonomous, automation: seven, notCovered: "a bypass" }]).join(), /bypass path exists/);
  /* A reminder buys nothing; an executor that signs is the autonomous mode. */
  assert.match(validateAuthorityMatrix([{ ...findAuthority("ryntra.recurring-buy"), mode: "ASSISTED", signer: "PERSON_ONCE" }]).join(), /A reminder buys nothing/);
  assert.match(validateAuthorityMatrix([{ ...findAuthority("jupiter.swap"), runsAlone: "EXECUTOR" }]).join(), /An executor that signs is the autonomous mode/);

  assert.equal(anyAutomatic(), false);
  for (const row of AUTHORITY_MATRIX) assert.equal(isAutomatic(row), false, row.id);
  /* The grid is Assisted (decision 64): the pool's own bins; the recurring buy only reminds. */
  const grid = findAuthority("meteora-dlmm.grid");
  assert.equal(grid.mode, "ASSISTED");
  assert.equal(grid.enforcement, "PROVIDER_NATIVE");
  assert.equal(grid.runsAlone, "VENUE");
  const recurring = findAuthority("ryntra.recurring-buy");
  assert.equal(recurring.mode, "MANUAL");
  assert.equal(recurring.runsAlone, "REMINDER");
  assert.equal(recurring.enforcement, "OBSERVE_ONLY");
  assert.match(recurring.notCovered, /only silences reminders/);
});

/* «автоматичн…» / «automatic» said of a bot: only in a sentence that denies it, while no row is automatic. */
const AUTOMATIC = /automat|автомат|autopilot|автопілот|автостоп|autoinvest|автоінвест/iu;
/* JavaScript's \b knows no Cyrillic: a Ukrainian negation is a word between spaces or punctuation. */
const DENIES = /\b(no|not|never|nothing)\b|(^|[\s«(])(не|немає|без)(?=[\s,.:;»)—]|$)/iu;
/* The denial must stand within four words of the claim: «Автоматичний бот купує сам, без комісії» is a claim. */
const denied = (line) => {
  const words = line.split(/\s+/u);
  return words.some((word, index) => AUTOMATIC.test(word) && words.slice(Math.max(0, index - 4), index + 5).some((near) => DENIES.test(` ${near} `)));
};

test("no word says a bot is automatic without the seven elements — «Боти», the catalogue, the rules, the plans", () => {
  assert.equal(anyAutomatic("bots"), false, "the words below assume no automatic bot");
  const lines = [
    ...Object.entries(BOTS_WORDS).flatMap(([key, word]) => [[`bots.${key}`, word.en], [`bots.${key}`, word.uk]]),
    ...Object.entries(INVEST_WORDS).flatMap(([key, word]) => (typeof word === "object" && word && "en" in word ? [[`invest.${key}`, word.en], [`invest.${key}`, word.uk]] : [])),
    ...Object.entries(PLAN_WORDS).flatMap(([key, word]) => [[`plan.${key}`, word.en], [`plan.${key}`, word.uk]]),
    ...STRATEGY_TYPES.flatMap((type) => [type.name, type.blurb, type.runs].filter(Boolean).flatMap((word) => [[`type.${type.id}`, word.en], [`type.${type.id}`, word.uk]])),
    ...Object.entries(AUTHORITY_HEAD_WORDS).flatMap(([key, word]) => [[`head.${key}`, word.en], [`head.${key}`, word.uk]]),
  ];
  assert.ok(lines.length > 200);
  /* The check itself: a claim is caught, a denial passes. */
  for (const claim of ["Automatic bot: buys on its own", "Автоматичний бот купує сам", "Автоінвест щопонеділка", "Автоматичний бот купує сам, а потім ще й продає без комісії"]) assert.ok(AUTOMATIC.test(claim) && !denied(claim), claim);
  for (const denial of ["No automatic sell is set up", "Автоматичний продаж не налаштований", "автостопу немає", "Автоматичного бота тут ще немає: жоден не підписує замість тебе."]) assert.ok(denied(denial), denial);
  for (const [key, line] of lines) {
    if (key === "bots.truthLeadSome" || key === "bots.truthTitle" || key === "head.alone") continue; /* drawn only beside the matrix's own words */
    if (AUTOMATIC.test(line)) assert.ok(denied(line), `${key}: «${line}» calls something automatic`);
  }
  /* The mode word «Працює сам» belongs to an autonomous row only — none is drawn. */
  assert.match(MODE_WORDS.AUTONOMOUS.uk, /сам/u);
});

test("the switches are read the way the routes read them — no second switch", () => {
  const values = [undefined, "", "OPEN", "open", " Open ", "CANARY", "canary", "PAUSED", "CLOSED", "mainnet", "devnet", "mainnet-beta", "on", "ON", "yes"];
  const position = (gate, value, extra = {}) => gatePosition(gate, { ...extra, [gate.key ?? SOLANA_LANE_STATE_ENV[gate.lane]]: value });
  for (const value of values) {
    for (const lane of SOLANA_LANES) {
      assert.equal(position({ kind: "LANE", lane }, value) === "OPEN", resolveSolanaLaneState(lane, { [SOLANA_LANE_STATE_ENV[lane]]: value }) === "OPEN", `${lane}=${value}`);
    }
    assert.equal(position({ kind: "TRIAD", key: "RYNTRA_LIQUIDITY_ACTIONS" }, value), liquidityGateMode({ RYNTRA_LIQUIDITY_ACTIONS: value }) === "CLOSED" ? "CLOSED" : liquidityGateMode({ RYNTRA_LIQUIDITY_ACTIONS: value }));
    const wallet = "So11111111111111111111111111111111111111112";
    const orders = admitOrders(wallet, { RYNTRA_PHOENIX_ORDERS: value, RYNTRA_PHOENIX_CANARY_WALLET: wallet });
    assert.equal(position({ kind: "TRIAD", key: "RYNTRA_PHOENIX_ORDERS" }, value), orders.ok ? orders.mode : "CLOSED", `orders=${value}`);
    const collateral = admitCollateral(wallet, { RYNTRA_PHOENIX_COLLATERAL: value, RYNTRA_PHOENIX_CANARY_WALLET: wallet });
    assert.equal(position({ kind: "TRIAD", key: "RYNTRA_PHOENIX_COLLATERAL" }, value), collateral.ok ? collateral.mode : "CLOSED", `collateral=${value}`);
    const network = (from) => (from === "mainnet" ? "OPEN" : from === "devnet" ? "DEVNET" : "CLOSED");
    assert.equal(position({ kind: "NETWORK", key: "NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK" }, value), network(treasuryNetworkFrom(value)), `treasury=${value}`);
    assert.equal(position({ kind: "NETWORK", key: "NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK" }, value), network(allowanceNetworkFrom(value)), `allowances=${value}`);
    assert.equal(position({ kind: "PILOT", key: "PREDICTIONS_LIVE_FUNDING" }, value) !== "CLOSED", readLiveSettings({ PREDICTIONS_LIVE_FUNDING: value }).funding, `predictions=${value}`);
  }
  /* Graduations run under Launch's lane alone; the ladder needs the floor's lane too. */
  assert.equal(gatePosition(findAuthority("meteora-dbc.graduation").gate, { RYNTRA_SOLANA_LAUNCH_STATE: "OPEN" }), "OPEN");
  const ladder = findAuthority("meteora-dbc.liquidity-ladder");
  assert.equal(gatePosition(ladder.gate, { RYNTRA_SOLANA_LAUNCH_STATE: "OPEN" }), "CLOSED");
  assert.equal(gatePosition(ladder.gate, { RYNTRA_SOLANA_LAUNCH_STATE: "OPEN", RYNTRA_SOLANA_LAUNCH_FLOOR_STATE: "OPEN" }), "OPEN");
  /* A canary is never announced: a stranger reads what CLOSED says (lib/liquidity/studio/gate.ts). A pilot names its wallets; devnet is never live. */
  for (const id of ["phoenix.orders", "phoenix.collateral", "meteora-dlmm.liquidity", "meteora-dlmm.grid"]) {
    const key = findAuthority(id).gate.key;
    assert.deepEqual(resolveAuthority(findAuthority(id), { [key]: "CANARY" }), { id, state: "DISABLED", eligibility: "NOBODY", gate: "CLOSED" });
  }
  assert.equal(resolveAuthority(findAuthority("agg.predictions-live"), { PREDICTIONS_LIVE_FUNDING: "on" }).eligibility, "PILOT");
  assert.equal(resolveAuthority(findAuthority("squads.treasury"), { NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "devnet" }).state, "PREVIEW");
});

test("the older registries agree: the core's routing rows name matrix rows, and neither calls live what the matrix does not", () => {
  for (const row of CAPABILITY_REGISTRY) {
    for (const id of row.authority) assert.ok(findAuthority(id), `${capabilityKey(row)} → ${id}`);
    if (row.state === "LIVE") {
      assert.ok(row.authority.some((id) => findAuthority(id).ceiling === "LIVE"), `${capabilityKey(row)} is LIVE with no live matrix row`);
    }
  }
  /* The claims registry's automation stays unshipped while the matrix has no automatic row. */
  const automation = CLAIMS.find((claim) => claim.id === "guarded-automation");
  assert.ok(automation);
  assert.notEqual(automation.maturity, "live");
  assert.equal(anyAutomatic(), false);
  /* The DBC row says what is live: the creator's claim; the partner's claim on the multisig is not built. */
  assert.match(read("./capabilities.ts"), /The partner's claim on the treasury multisig is not built \(SOL-L1d\)/);
});

test("`/api/v1/capabilities` carries the matrix resolved on the deployment, and names no switch's variable", () => {
  const closed = buildCapabilities({ env: {}, now: () => new Date("2026-10-24T12:00:00Z") });
  assert.equal(CapabilitiesSchema.safeParse(closed).success, true);
  assert.deepEqual(closed.authority.rows.map((row) => row.id), AUTHORITY_MATRIX.map((row) => row.id));
  assert.deepEqual(closed.authority.states, [...HONEST_STATES]);
  assert.equal(closed.authority.rows.find((row) => row.id === "jupiter.swap").state, "DISABLED");
  const open = buildCapabilities({ env: ALL_OPEN, now: () => new Date("2026-10-24T12:00:00Z") });
  assert.equal(CapabilitiesSchema.safeParse(open).success, true);
  const swap = open.authority.rows.find((row) => row.id === "jupiter.swap");
  assert.equal(swap.state, "LIVE");
  assert.equal(swap.automatic, false);
  for (const row of open.authority.rows) assert.equal(row.automatic, false, row.id);
  const text = JSON.stringify(open.authority);
  assert.doesNotMatch(text, /RYNTRA_(SOLANA|LIQUIDITY|PHOENIX|LAUNCH)_|NEXT_PUBLIC_|PREDICTIONS_LIVE|SECRET|PRIVATE_KEY/);
  /* No internal process: no task ids, no person. */
  assert.doesNotMatch(text, /\b(EXE|SOL|MOS|WP|PERP|TEAM|AGT|SIG|SOS|DEV|MET|RYN|PM|GR|AI|B)-[A-Z0-9]|\bthe Owner\b|власник/u);
  assert.ok(open.authority.rows.every((row) => !("next" in row)));
});

test("«Боти» draws its bots' states from the matrix on the server: the page, the catalogue, the grid", () => {
  assert.deepEqual([...BOTS_AUTHORITY_IDS], ["meteora-dlmm.grid", "ryntra.recurring-buy", "ryntra.trade-plan"]);
  const views = authorityViews(BOTS_AUTHORITY_IDS, ALL_OPEN);
  assert.equal(views["meteora-dlmm.grid"].state, "LIVE");
  assert.equal(views["meteora-dlmm.grid"].mode, "ASSISTED");
  assert.equal(authorityViews(BOTS_AUTHORITY_IDS, {})["meteora-dlmm.grid"].state, "DISABLED");
  assert.throws(() => authorityViews(["ryntra.nothing"]), /no row ryntra.nothing/);

  const page = read("../../app/app/bots/page.tsx");
  assert.match(page, /authority=\{authorityViews\(BOTS_AUTHORITY_IDS\)\}/);
  const view = read("../../app/app/bots/bots-view.tsx");
  assert.match(view, /<BotsTruth locale=\{locale\} authority=\{authority\} \/>/);
  const truth = read("../../app/app/bots/bots-truth.tsx");
  assert.match(truth, /<HonestStateChip state=\{view\.state\}/);
  assert.match(truth, /ENFORCEMENT_WORDS\[view\.enforcement\]/);
  assert.match(truth, /word\(automatic \? "truthLeadSome" : "truthLeadNone"\)/);
  const catalog = read("../../app/app/bots/catalog/page.tsx");
  assert.match(catalog, /<HonestStateChip state=\{authority\[card\.authority\]\.state\}/);
  const grid = read("../../app/app/bots/grid/page.tsx");
  assert.match(grid, /authorityViews\(\["meteora-dlmm\.grid"\]\)/);
  const pools = read("../../app/app/markets/pools/page.tsx");
  /* Each venue its own chip: DAMM v2 has no proven cycle and must not stand under DLMM's LIVE. */
  assert.match(pools, /authorityViews\(\["meteora-dlmm\.liquidity", "meteora-damm2\.liquidity"\]\)/);
  assert.match(pools, /data-authority="meteora-damm2\.liquidity"/);
  assert.match(pools, /<HonestStateChip state=\{actions\["meteora-damm2\.liquidity"\]\.state\}/);
  /* The chip is a word: a state never stands as a colour alone. */
  const chip = read("../../app/shell/honest-state-chip.tsx");
  assert.match(chip, /\{words\.chip\[locale\]\}/);
  /* Each bot says what it does alone and what waits for the person — in both languages. */
  for (const key of ["gridAlone", "gridYou", "recurringAlone", "recurringYou", "planAlone", "planYou"]) {
    assert.ok(BOTS_WORDS[key].en.length > 20 && BOTS_WORDS[key].uk.length > 20, key);
  }
  assert.match(BOTS_WORDS.recurringAlone.en, /does not buy/u);
  assert.match(BOTS_WORDS.recurringAlone.uk, /Сам не купує/u);
  assert.match(BOTS_WORDS.gridYou.uk, /не переставляються/u);
  assert.doesNotMatch(BOTS_WORDS.recurringYou.uk, /\bReview\b/u, "«перевірка» in Ukrainian");
});
