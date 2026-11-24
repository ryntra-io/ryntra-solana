// Ryntra Private ready for mainnet behind its switch: the network from the switch, shut without its key, the
// relay's limit shared by every instance and refused when its store does not answer, Ryntra's payout fee as a setting
// shown before the signature, and the same «who sees what» on both networks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createMemoryGuardStore } from "../guard/store.ts";
import { FixedWindowLimiter } from "../http-control.ts";
import { exposureOf } from "./exposure.ts";
import { privateNetwork } from "./network.ts";
import { chargesFee, feeOf, feePercent, NO_PAYOUT_FEE, PAYOUT_FEE_ENV, PAYOUT_FEE_MAX_BPS, payoutFee, payoutFeeSetting } from "./payouts/fee.ts";
import { RELAY_KEY_ENV, openNetwork, relayKey, servedNetwork } from "./relay-key.server.ts";
import { RELAY_COLLECTION, RELAY_LIMIT, consumeRelayQuota, relayQuotaKey, relayWindowPrefix } from "./relay-limit.server.ts";
import { RING_NEVER, STOCK_EXTENSIONS, ringAdmits } from "./stocks/ring-admits.ts";
import { feeText } from "../../terminal/money/payouts/payouts-view.ts";
import { PAYOUTS } from "../../terminal/money/payouts/words.ts";
import { PRIVATE_STOCK } from "../../terminal/stocks/private/words.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const FEE_TO = "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS";
const SOL = 1_000_000_000n;

/** A store every instance shares, as the Postgres adapter is: the memory store, declared multi-writer. */
const sharedStore = () => ({ ...createMemoryGuardStore(), durability: "DURABLE_MULTI_WRITER" });

test("the network comes from the switch; mainnet opens only with its key on the server", () => {
  const keys = { HELIUS_DEVNET_API_KEY: "dev", HELIUS_PRIVACY_MAINNET_API_KEY: " main " };
  assert.deepEqual(RELAY_KEY_ENV, { devnet: "HELIUS_DEVNET_API_KEY", mainnet: "HELIUS_PRIVACY_MAINNET_API_KEY" });
  assert.equal(relayKey("mainnet", keys), "main", "trimmed");
  assert.equal(relayKey("mainnet", {}), "");

  assert.equal(openNetwork(keys, "devnet"), "devnet");
  assert.equal(openNetwork(keys, "mainnet"), "mainnet");
  assert.equal(openNetwork({ HELIUS_DEVNET_API_KEY: "dev" }, "mainnet"), null, "mainnet without its key — shut");
  assert.equal(openNetwork({ HELIUS_PRIVACY_MAINNET_API_KEY: "   " }, "mainnet"), null, "a blank key is no key");
  assert.equal(openNetwork({ RYNTRA_SOLANA_RPC_MAINNET: "x" }, "mainnet"), null, "the site's own mainnet key does not open it");
  assert.equal(openNetwork(keys, undefined), null, "no switch — shut");
  assert.equal(openNetwork(keys, "mainnet-beta"), null);

  assert.deepEqual(servedNetwork("devnet", keys, "devnet"), { network: "devnet", key: "dev" });
  assert.deepEqual(servedNetwork("mainnet", keys, "mainnet"), { network: "mainnet", key: "main" });
  assert.equal(servedNetwork("mainnet", keys, "devnet"), null, "the relay serves the switch's network only");
  assert.equal(servedNetwork("devnet", keys, "mainnet"), null, "a mainnet build serves no devnet relay");
  assert.equal(servedNetwork("mainnet", { HELIUS_DEVNET_API_KEY: "dev" }, "mainnet"), null, "closed without the key");
  assert.equal(servedNetwork("devnet", { HELIUS_PRIVACY_MAINNET_API_KEY: "main" }, "devnet"), null, "devnet without its key — 404, as before");
  for (const bad of ["testnet", "__proto__", "", "rpc"]) assert.equal(servedNetwork(bad, keys, "devnet"), null, bad);

  // The page side: the build is told whether the key exists, never its value.
  assert.equal(privateNetwork("mainnet", false), null);
  assert.equal(privateNetwork("mainnet", true), "mainnet");
  const config = read("next.config.ts");
  assert.match(config, /env: \{ RYNTRA_PRIVATE_MAINNET_KEY_SEEN: process\.env\.HELIUS_PRIVACY_MAINNET_API_KEY\?\.trim\(\) \? "1" : "" \}/);
  assert.equal((strip(config).match(/HELIUS_PRIVACY_MAINNET_API_KEY/g) ?? []).length, 1, "the key is read once, for its presence");
});

test("every private route opens on the switch's network with its key, and names no key itself", () => {
  const routes = {
    relay: "app/api/v1/privacy/[network]/[target]/[[...path]]/route.ts",
    gate: "app/api/v1/privacy/gate/route.ts",
    tally: "app/api/v1/privacy/gate/tally/route.ts",
    ring: "app/api/v1/privacy/ring/route.ts",
  };
  for (const [name, path] of Object.entries(routes)) {
    const source = strip(read(path));
    assert.doesNotMatch(source, /HELIUS_[A-Z_]*API_KEY|privateNetwork\(/, `${name}: the key and the network come from relay-key.server`);
    assert.match(source, /servedNetwork\(|openNetwork\(/, name);
  }
  assert.match(read(routes.ring), /readRingCount\(\{ key: relayKey\(network\), network \}\)/, "the counter reads its own network");
  assert.match(read(routes.gate), /testNetwork: openNetwork\(\) === "devnet"/, "off the test network the gate wants a cap and a list");
});

test("the relay's limit is one window for every instance", async () => {
  const store = sharedStore();
  const limit = 5;
  const now = 1_700_000_000_000;
  // Two warm instances: each has its own memory floor, which alone would let the address through twice over.
  const instances = [new FixedWindowLimiter({ limit, windowMs: 60_000, maxKeys: 10, now: () => now }), new FixedWindowLimiter({ limit, windowMs: 60_000, maxKeys: 10, now: () => now })];
  const allowed = [];
  for (let call = 0; call < 2 * limit; call += 1) {
    const local = instances[call % 2].consume("203.0.113.7");
    assert.ok(local.allowed, "each instance's own floor lets every call by");
    const answer = await consumeRelayQuota(store, { network: "mainnet", address: "203.0.113.7", nowMs: now, limit });
    assert.equal(answer.kind, "counted");
    allowed.push(answer.decision.allowed);
  }
  assert.equal(allowed.filter(Boolean).length, limit, "the shared window lets the address through `limit` times in all");
  assert.deepEqual(allowed.slice(limit), Array(limit).fill(false));

  // Racing at once from both instances: still one count.
  const raced = sharedStore();
  const answers = await Promise.all(Array.from({ length: 12 }, (_, i) => consumeRelayQuota(raced, { network: "mainnet", address: `a${i % 1}`, nowMs: now, limit })));
  const counted = answers.filter((a) => a.kind === "counted");
  assert.equal(counted.filter((a) => a.decision.allowed).length, Math.min(limit, counted.length));
  assert.ok(answers.every((a) => a.kind === "counted"), "a race ends counted — never refused for contention, never let through uncounted");

  // Another address and another network keep windows of their own; the next minute starts over.
  assert.equal((await consumeRelayQuota(store, { network: "mainnet", address: "198.51.100.1", nowMs: now, limit })).decision.allowed, true);
  assert.deepEqual(await consumeRelayQuota(store, { network: "devnet", address: "203.0.113.7", nowMs: now, limit }), { kind: "local" }, "devnet keeps its instance's own window even with a shared store (the lead's review of #1984)");
  const next = await consumeRelayQuota(store, { network: "mainnet", address: "203.0.113.7", nowMs: now + 60_000, limit });
  assert.equal(next.decision.allowed, true);
  assert.equal(next.decision.remaining, limit - 1);
  // The same minute is one count, whichever call opened it (the key names the minute).
  const behind = await consumeRelayQuota(store, { network: "mainnet", address: "203.0.113.7", nowMs: now + 59_000, limit });
  assert.equal(behind.decision.remaining, limit - 2);
  // A record that names another minute than its key (a garbled write) never holds an address shut: the window starts over.
  const far = sharedStore();
  const minute = Math.floor(now / 60_000) * 60_000;
  await far.versioned(RELAY_COLLECTION).set(relayQuotaKey("mainnet", "x", minute), { version: 3, windowStartMs: now + 86_400_000, used: limit });
  const freed = await consumeRelayQuota(far, { network: "mainnet", address: "x", nowMs: now, limit });
  assert.equal(freed.decision.allowed, true);
  assert.equal(freed.decision.remaining, limit - 1);

  // One row per address in a minute, the address never in the clear.
  const key = relayQuotaKey("mainnet", "203.0.113.7", minute);
  assert.match(key, /^mainnet:\d+:[0-9a-f]{64}$/);
  assert.doesNotMatch(key, /203\.0\.113\.7/);
  assert.equal((await store.collection(RELAY_COLLECTION).valuesWithPrefix(relayWindowPrefix("mainnet", minute))).length, 2);
  assert.deepEqual(RELAY_LIMIT, { limit: 300, windowMs: 60_000 }, "the stand's 300 a minute, now across instances");
});

test("a store that does not answer refuses the call; off the test network the store must be shared", async () => {
  const broken = sharedStore();
  const refused = async () => { throw new Error("connection refused"); };
  broken.versioned = () => ({ get: refused, compareAndSet: refused, countStep: refused });
  broken.collection = () => ({ get: refused, insertIfAbsent: refused, valuesWithPrefix: refused });
  assert.deepEqual(await consumeRelayQuota(broken, { network: "mainnet", address: "a", nowMs: 0 }), { kind: "refused", refusal: "UNAVAILABLE" }, "mainnet");
  assert.deepEqual(await consumeRelayQuota(broken, { network: "devnet", address: "a", nowMs: 0 }), { kind: "local" }, "devnet never waits on the store, nor fails with it");
  // The count is one atomic step of the store: no compare-and-set to lose, so no refusal for contention.
  const slowCas = sharedStore();
  const casLoses = slowCas.versioned;
  slowCas.versioned = (name) => ({ ...casLoses(name), compareAndSet: async () => false });
  assert.equal((await consumeRelayQuota(slowCas, { network: "mainnet", address: "a", nowMs: 0 })).kind, "counted", "a compare-and-set that always loses changes nothing");
  const garbled = sharedStore();
  await garbled.versioned(RELAY_COLLECTION).set(relayQuotaKey("mainnet", "a", 0), { version: "x", windowStartMs: 0, used: 1 });
  assert.deepEqual(await consumeRelayQuota(garbled, { network: "mainnet", address: "a", nowMs: 0 }), { kind: "refused", refusal: "UNAVAILABLE" }, "an unreadable record is no count");

  const perInstance = createMemoryGuardStore();
  assert.deepEqual(await consumeRelayQuota(perInstance, { network: "mainnet", address: "a", nowMs: 0 }), { kind: "refused", refusal: "NOT_SHARED" });
  assert.deepEqual(await consumeRelayQuota(perInstance, { network: "devnet", address: "a", nowMs: 0 }), { kind: "local" }, "devnet keeps its instance's limit, as before");

  const route = strip(read("lib/privacy/relay-handler.server.ts"));
  assert.match(route, /if \(!rate\) return refusedNoStore\(\);/, "no count — 503");
  assert.match(route, /empty\(503/);
  assert.ok(route.indexOf("await sharedLimit(") < route.indexOf("await deps.fetch(upstream"), "counted before Helius is asked");
  assert.ok(route.indexOf("limiter.consume(") < route.indexOf("await sharedLimit("), "the instance's floor stands in front of the store");
});

test("Ryntra's payout fee is a setting: unset — none, and the line before the signature says so", () => {
  assert.deepEqual(PAYOUT_FEE_ENV, { bps: "RYNTRA_PRIVATE_PAYOUT_FEE_BPS", to: "RYNTRA_PRIVATE_PAYOUT_FEE_TO" });
  assert.deepEqual(payoutFeeSetting({}), NO_PAYOUT_FEE);
  assert.deepEqual(payoutFeeSetting({ RYNTRA_PRIVATE_PAYOUT_FEE_BPS: "20" }), NO_PAYOUT_FEE, "a rate without an address charges nothing");
  assert.deepEqual(payoutFeeSetting({ RYNTRA_PRIVATE_PAYOUT_FEE_TO: FEE_TO }), NO_PAYOUT_FEE);
  assert.deepEqual(payoutFeeSetting({ RYNTRA_PRIVATE_PAYOUT_FEE_BPS: " 20 ", RYNTRA_PRIVATE_PAYOUT_FEE_TO: FEE_TO }), { bps: 20, to: FEE_TO });
  for (const bad of ["0", "-5", "0.2", "2%", "abc", String(PAYOUT_FEE_MAX_BPS + 1), "99999"]) {
    assert.deepEqual(payoutFeeSetting({ RYNTRA_PRIVATE_PAYOUT_FEE_BPS: bad, RYNTRA_PRIVATE_PAYOUT_FEE_TO: FEE_TO }), NO_PAYOUT_FEE, bad);
  }
  assert.deepEqual(payoutFeeSetting({ RYNTRA_PRIVATE_PAYOUT_FEE_BPS: "20", RYNTRA_PRIVATE_PAYOUT_FEE_TO: "not an address" }), NO_PAYOUT_FEE);

  const none = payoutFee();
  const set = payoutFee({ bps: 20, to: FEE_TO });
  assert.equal(chargesFee(none), false);
  assert.equal(chargesFee(set), true);
  assert.equal(feeOf(100n * SOL, set), SOL / 5n);
  assert.equal(feePercent(20), "0.2");
  assert.equal(feePercent(25), "0.25");
  assert.equal(feePercent(100), "1");

  const fig = (units) => String(Number(units) / 1e9);
  assert.equal(feeText(PAYOUTS.en, none, 0n, 1, fig, "en"), "No Ryntra fee · 1 signature");
  assert.equal(feeText(PAYOUTS.uk, none, 0n, 3, fig, "uk"), "Без комісії Ryntra · 3 підписи");
  assert.equal(feeText(PAYOUTS.en, set, SOL / 5n, 2, fig, "en"), "Ryntra fee 0.2% · 0.2 SOL · 2 signatures");
  assert.equal(feeText(PAYOUTS.uk, set, SOL / 5n, 1, fig, "uk"), "Комісія Ryntra 0,2% · 0.2 SOL · 1 підпис");
  assert.equal(feeText(PAYOUTS.en, set, 0n, 1, fig, "en"), "No Ryntra fee · 1 signature", "a payout that carries none says none");

  // The page reads the setting on the server and hands the screen the rate and the address; the screen shows the line.
  assert.match(read("app/(terminal)/money/page.tsx"), /<MoneyScreen payoutFee=\{payoutFeeSetting\(process\.env\)\} \/>/);
  assert.match(read("terminal/money/MoneyScreen.tsx"), /<Payouts onConnect=\{connect\} feeSetting=\{payoutFee\} \/>/);
  const screen = read("terminal/money/payouts/Payouts.tsx");
  assert.match(screen, /const fee = useMemo\(\(\) => payoutFee\(feeSetting\), \[feeSetting\]\);/);
  assert.match(screen, /said = <span>\{feeText\(w, fee, plan\.fee, plan\.signatures, fig, lang\)\}<\/span>;/);
  assert.match(screen, /pay\(\{ rows: paying, plan, coin: SOL, fee \}\)/, "the fee shown is the fee paid");
  assert.doesNotMatch(strip(read("lib/privacy/network.ts")), /FEE_BPS/, "no rate in code");
});

test("on mainnet the screens say the same «who sees what», drop only the test-network lines, and keep the stock line", () => {
  // «Others see» comes from the ring's rules, not from the network: one table for both.
  assert.doesNotMatch(read("lib/privacy/exposure.ts"), /from '\.\/network\.ts'/);
  assert.deepEqual(exposureOf("send"), { who: "seen", to: "seen", amount: "hidden" });
  assert.deepEqual(exposureOf("hide"), { who: "seen", to: "none", amount: "seen" });

  // «Test network» and «test money» show only on the test network.
  const screens = [
    "terminal/portfolio/private/PrivateBalance.tsx",
    "terminal/portfolio/private/ClaimScreen.tsx",
    "terminal/portfolio/private/WalletCheckScreen.tsx",
    "terminal/money/private/PayScreen.tsx",
    "terminal/money/private/PrivateInvoices.tsx",
    "terminal/money/payouts/Payouts.tsx",
  ];
  for (const path of screens) {
    const source = read(path);
    const chips = source.match(/<Chip>\{w\.net\}<\/Chip>/g) ?? [];
    const guarded = source.match(/PRIVATE_TEST \? <Chip>\{w\.net\}<\/Chip>/g) ?? [];
    assert.ok(chips.length > 0 && chips.length === guarded.length, `${path}: the test-network mark only on the test network`);
    // «Test network only: test money.» — `how6` in «Payouts», `how4` on the other screens.
    const key = path.endsWith("Payouts.tsx") ? "how6" : "how4";
    const lines = source.match(new RegExp(`<(li|span)>\\{w\\.${key}\\}</\\1>`, "g")) ?? [];
    const guardedLines = source.match(new RegExp(`PRIVATE_TEST \\? <(li|span)>\\{w\\.${key}\\}</\\1> : null`, "g")) ?? [];
    assert.equal(lines.length, guardedLines.length, `${path}: «test money» only on the test network`);
  }
  // The wallet check sends nothing off the test network.
  const check = read("terminal/portfolio/private/WalletCheckScreen.tsx");
  assert.match(check, /if \(!wire \|\| !PRIVATE_TEST\) return;/);
  assert.match(check, /\{PRIVATE_TEST \? \(\n\s*<Quiet[^\n]*sendV1\(\)/);
  assert.match(check, /PRIVATE_TEST \? w\.checkLine : w\.checkLineReal/);

  // A stock never sits in the private balance until Helius admits its extensions — said once, behind «i».
  for (const program of ["main", "live"]) assert.equal(ringAdmits(STOCK_EXTENSIONS, program).admitted, false, program);
  assert.ok(RING_NEVER.includes("defaultAccountState") && RING_NEVER.includes("pausableConfig"));
  assert.match(PRIVATE_STOCK.en.stockStays, /can’t hold stock tokens yet.*Helius/);
  assert.match(PRIVATE_STOCK.uk.stockStays, /не тримає токенів акцій.*Helius/);
  assert.match(read("terminal/stocks/private/PrivateStockBuy.tsx"), /<Info label=\{w\.stockLabel\}>\s*<span[^>]*>\s*<span>\{w\.stockStays\}<\/span>/);
});
