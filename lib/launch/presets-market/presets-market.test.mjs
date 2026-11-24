import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { getAddressDecoder, getBase58Decoder } from "@solana/kit";

import { DEVNET_ADVANCED_BOUNDS, SNIPER_FEES } from "../../core/launch/advanced.ts";
import { LAUNCH_PRESETS } from "../../core/venues/meteora-dbc/presets.ts";
import { SET_USE_FEE_BOUNDS, SET_USE_FEE_ENV, setUseFeeLamports } from "./price.ts";
import { countSetUse, forgetTopRead, launchTerms, listSets, saveSet } from "./service.server.ts";
import {
  PRESET_CURVES,
  SAVE_FRESH_MS,
  rankSets,
  ryntraSetTerms,
  ryntraSets,
  saveProblems,
  setChanges,
  setNameProblem,
  setSaveText,
  setTermsOf,
  termsKey,
  termsOfPreset,
  termsProblems,
} from "./set.ts";
import { createSetStore, isSetId, storedSetOf } from "./store.ts";
import { setSignatureBytes, verifySetSignature } from "./verify.server.ts";

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-11-20T18:00:00.000Z");
const ISSUED = new Date(NOW - 60_000).toISOString();
const MINT = "So11111111111111111111111111111111111111112";
const UUID = "1b4e28ba-2fa1-4d2b-883f-0016d3cca427";

async function wallet() {
  const secret = utils.randomSecretKey ? utils.randomSecretKey() : utils.randomPrivateKey();
  const publicKey = await getPublicKeyAsync(secret);
  return { secret, address: getAddressDecoder().decode(publicKey) };
}

async function sign(text, secret) {
  return Buffer.from(await signAsync(new TextEncoder().encode(text), secret)).toString("base64");
}

const own = (over = {}) => ({ curve: "own", startMarketCapUsd: 4_000, graduationMarketCapUsd: 60_000, sniperFee: { ...pick(SNIPER_FEES.strong) }, creatorTradingFeePct: 30, ...over });
const pick = (fee) => ({ startBps: fee.startBps, endBps: fee.endBps, seconds: fee.seconds });

/* ------------------------------------------------------------- the set's rules */

test("Ryntra's own sets are the presets people launch on, number for number, and only those served", () => {
  assert.deepEqual([...PRESET_CURVES].sort(), ["classic", "community", "micro", "protected"]);
  const sets = ryntraSets(["classic", "protected", "demo"], { "ryntra-protected": 7 });
  assert.deepEqual(sets.map((set) => set.id), ["ryntra-classic", "ryntra-protected"]);
  for (const set of sets) {
    const preset = LAUNCH_PRESETS[set.terms.curve];
    assert.equal(set.author, null);
    assert.deepEqual(set.names, { uk: preset.name.uk, en: preset.name.en });
    assert.equal(set.terms.startMarketCapUsd, preset.curve.startMarketCapUsd);
    assert.equal(set.terms.graduationMarketCapUsd, preset.curve.graduationMarketCapUsd);
    assert.deepEqual(set.terms.sniperFee, pick(preset.sniperFee));
    assert.equal(set.terms.creatorTradingFeePct, preset.creatorTradingFeePct);
  }
  assert.equal(sets[1].uses, 7);
  assert.deepEqual(ryntraSetTerms("ryntra-classic"), termsOfPreset("classic"));
  assert.equal(ryntraSetTerms("ryntra-demo"), null, "the demo market is never a set");
  assert.equal(ryntraSetTerms(UUID), null);
});

test("a set on a preset carries that preset's numbers; an own curve stays within the network's bounds", () => {
  assert.deepEqual(termsProblems(termsOfPreset("protected"), null), []);
  assert.deepEqual(termsProblems({ ...termsOfPreset("classic"), creatorTradingFeePct: 90 }, null), ["NOT_PRESET"], "a preset has one shape");
  assert.deepEqual(termsProblems(own(), null), ["OWN_CLOSED"], "no bounds — no own curve");
  assert.deepEqual(termsProblems(own(), DEVNET_ADVANCED_BOUNDS), []);
  assert.deepEqual(termsProblems(own({ sniperFee: { startBps: 9_000, endBps: 100, seconds: 30 } }), DEVNET_ADVANCED_BOUNDS), ["SNIPER"], "only the fees Launch builds");
  assert.ok(termsProblems(own({ graduationMarketCapUsd: 8_000 }), DEVNET_ADVANCED_BOUNDS).includes("MULTIPLE"));
  assert.ok(termsProblems(own({ creatorTradingFeePct: 30.5 }), DEVNET_ADVANCED_BOUNDS).includes("CREATOR_SHARE"));
  assert.ok(termsProblems(own({ startMarketCapUsd: 100 }), DEVNET_ADVANCED_BOUNDS).includes("START_CAP"));
});

test("a set reads from JSON only whole, and its numbers make one line", () => {
  assert.deepEqual(setTermsOf(termsOfPreset("classic")), termsOfPreset("classic"));
  assert.equal(setTermsOf({ ...termsOfPreset("classic"), curve: "demo" }), null);
  assert.equal(setTermsOf({ ...termsOfPreset("classic"), sniperFee: null }), null);
  assert.equal(setTermsOf({ ...termsOfPreset("classic"), startMarketCapUsd: "5000" }), null);
  assert.equal(termsKey(termsOfPreset("classic")), "classic|5000|75000|2000-100-120|40");
  assert.notEqual(termsKey(termsOfPreset("classic")), termsKey(termsOfPreset("protected")));
});

test("a set's name: letters of any language, never Ryntra's, a brand's or a hate word", () => {
  assert.equal(setNameProblem("Night start"), null);
  assert.equal(setNameProblem("  Нічний   старт "), null);
  assert.equal(setNameProblem("ab"), "TOO_SHORT");
  assert.equal(setNameProblem("   "), "REQUIRED");
  assert.equal(setNameProblem("x".repeat(33)), "TOO_LONG");
  assert.equal(setNameProblem("<b>bold</b>"), "CHARS");
  assert.equal(setNameProblem("Ryntra Pro"), "RESERVED");
  assert.equal(setNameProblem("R.yntra fast"), "RESERVED");
  assert.equal(setNameProblem("Google start"), "BORROWED");
});

test("the signed text names every number, the wallet, the network and the time, and that it moves nothing", () => {
  const text = setSaveText({ network: "solana:mainnet", name: " Night  start ", author: MINT, terms: termsOfPreset("protected"), issuedAt: ISSUED });
  assert.equal(
    text,
    [
      "Ryntra: save a launch set",
      "Name: Night start",
      "Curve: protected",
      "Start: $5000",
      "Moves to a pool at: $75000",
      "First buyers pay: 50% to 1% over 600 s",
      "Creator share of fees: 40%",
      `Wallet: ${MINT}`,
      "Network: solana:mainnet",
      `Issued: ${ISSUED}`,
      "This signature moves no money and is not a transaction.",
    ].join("\n"),
  );
});

test("a save is fresh, its time exact and its author an address", () => {
  const save = { network: "solana:devnet", name: "Night start", author: MINT, terms: termsOfPreset("classic"), issuedAt: ISSUED };
  assert.deepEqual(saveProblems(save, null, NOW), []);
  assert.deepEqual(saveProblems({ ...save, issuedAt: new Date(NOW - SAVE_FRESH_MS - 1).toISOString() }, null, NOW), [{ field: "issuedAt", code: "STALE" }]);
  assert.deepEqual(saveProblems({ ...save, issuedAt: "2026-11-20 18:00" }, null, NOW), [{ field: "issuedAt", code: "INVALID" }]);
  assert.deepEqual(saveProblems({ ...save, author: "not-a-wallet" }, null, NOW), [{ field: "author", code: "INVALID" }]);
});

test("what a set changes from the form's start, in the form's order", () => {
  assert.deepEqual(setChanges(termsOfPreset("protected"), termsOfPreset("classic")), ["sniper"]);
  assert.deepEqual(setChanges(termsOfPreset("classic"), termsOfPreset("classic")), []);
  assert.deepEqual(setChanges(own(), termsOfPreset("classic")), ["start", "graduation", "sniper", "creator"]);
});

test("the most used first; on a tie Ryntra's own, then the newest", () => {
  const set = (id, uses, author, createdAt = null) => ({ id, name: id, names: null, author, terms: termsOfPreset("classic"), uses, createdAt });
  const ranked = rankSets([set("a", 1, MINT, "2026-11-01T00:00:00.000Z"), set("ryntra-classic", 1, null), set("b", 5, MINT), set("c", 1, MINT, "2026-11-10T00:00:00.000Z")], 3);
  assert.deepEqual(ranked.map((entry) => entry.id), ["b", "ryntra-classic", "c"]);
});

/* -------------------------------------------------------------- the signature */

test("a signature is the author's own over the exact text, in either form wallets hand it", async () => {
  const author = await wallet();
  const other = await wallet();
  const text = setSaveText({ network: "solana:devnet", name: "Night start", author: author.address, terms: termsOfPreset("classic"), issuedAt: ISSUED });
  const signature = await sign(text, author.secret);
  assert.equal(verifySetSignature(text, author.address, signature), true);
  assert.equal(verifySetSignature(text, author.address, getBase58Decoder().decode(Buffer.from(signature, "base64"))), true, "base58 too");
  assert.equal(verifySetSignature(`${text} `, author.address, signature), false, "another text");
  assert.equal(verifySetSignature(text, other.address, signature), false, "another wallet");
  assert.equal(verifySetSignature(text, "not-a-wallet", signature), false);
  assert.equal(setSignatureBytes("short"), null);
});

/* ------------------------------------------------------------------ the price */

test("the price of a set is zero unless Ryntra sets a figure within DBC's bounds", () => {
  assert.equal(setUseFeeLamports({}), 0);
  assert.equal(setUseFeeLamports({ [SET_USE_FEE_ENV]: "" }), 0);
  assert.equal(setUseFeeLamports({ [SET_USE_FEE_ENV]: "0" }), 0);
  assert.equal(setUseFeeLamports({ [SET_USE_FEE_ENV]: "50000000" }), 50_000_000);
  assert.equal(setUseFeeLamports({ [SET_USE_FEE_ENV]: String(SET_USE_FEE_BOUNDS.minLamports - 1) }), 0);
  assert.equal(setUseFeeLamports({ [SET_USE_FEE_ENV]: String(SET_USE_FEE_BOUNDS.maxLamports + 1) }), 0);
  assert.equal(setUseFeeLamports({ [SET_USE_FEE_ENV]: "0.5" }), 0);
  assert.equal(setUseFeeLamports({ [SET_USE_FEE_ENV]: "-5" }), 0);
});

test("the price is only read for launchpads: no launch, preset or screen carries it", () => {
  for (const path of ["lib/core/venues/meteora-dbc/presets.ts", "lib/launch/flow.server.ts", "terminal/launch/presets/StartFromSet.tsx", "terminal/launch/presets/useSets.ts", "terminal/launch/presets/words.ts"]) {
    assert.doesNotMatch(read(path), /SET_USE_FEE|setUseFeeLamports|feeLamports/, path);
  }
  for (const preset of Object.values(LAUNCH_PRESETS)) assert.equal(preset.poolCreationFeeLamports, 0, `${preset.id}: no creation fee`);
});

/* ------------------------------------------------------------------ the store */

const row = (over = {}) => ({ id: UUID, name: "Night start", author: MINT, terms: termsOfPreset("classic"), uses: 3, created_at: "2026-11-20T10:00:00Z", ...over });

test("the store reads only whole rows; anything that is not the function's answer is no store", async () => {
  assert.equal(storedSetOf(row({ id: "x" })), null);
  assert.equal(storedSetOf(row({ author: "nope" })), null);
  assert.equal(storedSetOf(row({ terms: { curve: "classic" } })), null);
  assert.equal(storedSetOf(row()).createdAt, "2026-11-20T10:00:00.000Z");
  assert.ok(isSetId(UUID) && isSetId("ryntra-classic") && !isSetId("ryntra-") && !isSetId("../x"));

  const calls = [];
  const store = createSetStore(async (fn, args) => {
    calls.push([fn, args]);
    if (fn === "launch_sets_top") return { ok: true, sets: [row(), row({ id: "bad" })], ryntra: [{ id: "ryntra-classic", uses: 4 }, { id: "other", uses: 9 }] };
    if (fn === "launch_set_save") return args.p_name === "Taken" ? { ok: false, error: "name_taken" } : { ok: true, set: row({ name: args.p_name, uses: 0 }) };
    return { ok: true, counted: true };
  });
  const top = await store.top("devnet", 500);
  assert.equal(top.sets.length, 1);
  assert.deepEqual(top.ryntraUses, { "ryntra-classic": 4 });
  assert.equal(calls[0][1].p_limit, 100, "at most a hundred");
  assert.deepEqual(await store.save("devnet", { name: "Taken", author: MINT, terms: termsOfPreset("classic"), message: "m", signature: "s" }), { ok: false, code: "NAME_TAKEN" });
  const saved = await store.save("devnet", { name: "Mine", author: MINT, terms: termsOfPreset("classic"), message: "m", signature: "s" });
  assert.equal(saved.ok && saved.set.name, "Mine");
  assert.equal(calls.at(-1)[1].p_terms_key, termsKey(termsOfPreset("classic")));
  assert.deepEqual(await store.use("devnet", UUID, MINT, termsOfPreset("classic")), { counted: true });

  const absent = createSetStore(async () => null);
  assert.equal(await absent.top("devnet", 12), null);
  assert.equal(await absent.save("devnet", { name: "Mine", author: MINT, terms: termsOfPreset("classic"), message: "m", signature: "s" }), null);
  assert.equal(await absent.use("devnet", UUID, MINT, termsOfPreset("classic")), null);
  const throwing = createSetStore(async () => {
    throw new Error("down");
  });
  assert.equal(await throwing.top("devnet", 12), null);
});

/* ---------------------------------------------------------------- the service */

function deps(over = {}) {
  const store = over.store ?? createSetStore(async () => null);
  return {
    network: { chain: "solana:devnet", cluster: "devnet" },
    served: ["classic", "protected", "micro"],
    bounds: null,
    store,
    now: () => NOW,
    verify: verifySetSignature,
    readLaunch: async () => null,
    env: {},
    ...over,
  };
}

test("without the store the read is Ryntra's own sets, free, and says so", async () => {
  forgetTopRead();
  const answer = await listSets(deps());
  assert.equal(answer.network, "solana:devnet");
  assert.equal(answer.stored, false);
  assert.deepEqual(answer.use, { feeLamports: 0 });
  assert.deepEqual(answer.sets.map((set) => set.id), ["ryntra-classic", "ryntra-protected", "ryntra-micro"]);
});

test("with the store, creators' sets join Ryntra's own by launches; a curve not served here is left out", async () => {
  forgetTopRead();
  const store = createSetStore(async () => ({
    ok: true,
    sets: [row({ uses: 9 }), row({ id: "2b4e28ba-2fa1-4d2b-883f-0016d3cca427", name: "Own", terms: own(), uses: 50 }), row({ id: "3b4e28ba-2fa1-4d2b-883f-0016d3cca427", name: "Group", terms: termsOfPreset("community"), uses: 40 })],
    ryntra: [{ id: "ryntra-protected", uses: 12 }],
  }));
  const answer = await listSets(deps({ store }), 3);
  assert.equal(answer.stored, true);
  assert.deepEqual(answer.sets.map((set) => set.name), ["Protected", "Night start", "Classic"]);
});

test("a save is checked whole, then its signature, then kept — and the next read shows it", async () => {
  forgetTopRead();
  const author = await wallet();
  const kept = [];
  const store = createSetStore(async (fn, args) => {
    if (fn === "launch_set_save") {
      kept.push(args);
      return { ok: true, set: row({ name: args.p_name, author: args.p_author, terms: args.p_terms, uses: 0 }) };
    }
    if (fn === "launch_sets_top") return { ok: true, sets: kept.map((entry) => row({ name: entry.p_name, author: entry.p_author, terms: entry.p_terms, uses: 0 })), ryntra: [] };
    return null;
  });
  const base = { name: "Night start", author: author.address, terms: termsOfPreset("protected"), issuedAt: ISSUED };
  await listSets(deps({ store }));
  const text = setSaveText({ ...base, network: "solana:devnet" });
  const signature = await sign(text, author.secret);

  assert.deepEqual(await saveSet(deps({ store }), { ...base, signature: await sign(`${text}!`, author.secret) }), { ok: false, code: "SIGNATURE_INVALID", message: "The signature is not this wallet's over this set." });
  assert.equal((await saveSet(deps({ store }), { ...base, name: "Ryntra best", signature })).code, "VALIDATION_ERROR");
  assert.equal((await saveSet(deps({ store }), { ...base, terms: { ...termsOfPreset("protected"), creatorTradingFeePct: 99 }, signature })).code, "VALIDATION_ERROR");
  assert.equal((await saveSet(deps({ store }), { ...base, terms: termsOfPreset("community"), signature })).code, "VALIDATION_ERROR", "a curve not served here");
  assert.equal(kept.length, 0, "nothing reached the store before its checks");

  const saved = await saveSet(deps({ store }), { ...base, signature });
  assert.equal(saved.ok, true);
  assert.equal(kept[0].p_message, text, "the store keeps the text that was signed");
  assert.equal(kept[0].p_signature, signature);
  assert.ok((await listSets(deps({ store }))).sets.some((set) => set.name === "Night start"), "the author sees the set at once");

  const closed = await saveSet(deps(), { ...base, signature });
  assert.deepEqual(closed, { ok: false, code: "UNAVAILABLE", message: "Sets cannot be saved here yet; nothing was kept." });
});

test("a use counts a fresh Ryntra launch of this network, once, only where its numbers are the set's", async () => {
  const used = [];
  const store = createSetStore(async (fn, args) => {
    used.push(args);
    return { ok: true, counted: true };
  });
  const launch = (over = {}) => async () => ({ cluster: "devnet", preset: "classic", advanced: null, launchedAt: new Date(NOW - 60_000).toISOString(), ...over });

  assert.equal((await countSetUse(deps({ store }), "../etc", MINT)).code, "VALIDATION_ERROR");
  assert.equal((await countSetUse(deps({ store }), UUID, "nope")).code, "VALIDATION_ERROR");
  assert.equal((await countSetUse(deps({ store }), UUID, MINT)).code, "LAUNCH_NOT_FOUND", "no such launch");
  assert.equal((await countSetUse(deps({ store, readLaunch: launch({ launchedAt: new Date(NOW - 25 * 3600_000).toISOString() }) }), UUID, MINT)).code, "LAUNCH_NOT_FOUND", "too old");
  assert.equal((await countSetUse(deps({ store, readLaunch: launch({ cluster: "mainnet" }) }), UUID, MINT)).code, "LAUNCH_NOT_FOUND", "another network");
  assert.deepEqual(await countSetUse(deps({ store, readLaunch: launch() }), "ryntra-protected", MINT), { ok: true, counted: false }, "Ryntra's set with other numbers");
  assert.equal(used.length, 0);

  assert.deepEqual(await countSetUse(deps({ store, readLaunch: launch() }), "ryntra-classic", MINT), { ok: true, counted: true });
  assert.deepEqual(await countSetUse(deps({ store, readLaunch: launch() }), UUID, MINT), { ok: true, counted: true });
  assert.equal(used.at(-1).p_terms_key, termsKey(termsOfPreset("classic")), "the store checks a creator's set against the launch's own numbers");
  assert.equal((await countSetUse(deps({ readLaunch: launch() }), UUID, MINT)).code, "UNAVAILABLE");
});

test("a launch's own numbers: a preset's, or its own curve's from its record", () => {
  assert.deepEqual(launchTerms({ preset: "protected" }), termsOfPreset("protected"));
  assert.equal(launchTerms({ preset: "demo" }), null);
  assert.equal(launchTerms({ preset: "advanced", advanced: null }), null);
  const advanced = { supply: 1_000_000_000, startMarketCapUsd: 4_000, graduationMarketCapUsd: 60_000, creatorTradingFeePct: 30, sniper: "strong", poolStartFeeBps: 200, poolEndFeeBps: 50, graduationFee: { pct: 2, creatorPct: 40 }, firstBuyCapBps: 200 };
  assert.deepEqual(launchTerms({ preset: "advanced", advanced }), own());
});

/* ------------------------------------------------------------- the boundaries */

test("the presets route and its answer are unchanged; the sets routes build and sign nothing", () => {
  const presets = read("app/api/v1/launch/presets/route.ts");
  assert.match(presets, /return apiJson\(view\);/);
  assert.doesNotMatch(presets, /presets-market/);
  for (const path of ["app/api/v1/launch/presets/sets/route.ts", "app/api/v1/launch/presets/sets/[id]/uses/route.ts", "lib/launch/presets-market/service.server.ts", "lib/launch/presets-market/runtime.server.ts"]) {
    const imports = read(path).split("\n").filter((line) => /^import /.test(line)).join("\n");
    assert.doesNotMatch(imports, /signer|mandate|web3\.js|Transaction|keypair|privateKey/i, `${path}: no signer, no transaction, no key`);
    assert.doesNotMatch(read(path), /SERVICE_ROLE|sendRawTransaction|signTransaction/, path);
  }
});

test("the migration is a file: private tables behind three secret-gated functions, nothing else touched", () => {
  const sql = read("supabase/migrations/20261120190000_launch_sets_v1.sql");
  assert.match(sql, /PREPARED 2026-11-20 as a file only\. Not applied/);
  assert.equal((sql.match(/create table private\./g) ?? []).length, 2);
  assert.equal((sql.match(/force row level security/g) ?? []).length, 2);
  const functions = [...sql.matchAll(/create function (public\.[a-z_]+)\(/g)].map((m) => m[1]);
  assert.deepEqual(functions, ["public.launch_sets_top", "public.launch_set_save", "public.launch_set_use"]);
  assert.equal((sql.match(/perform private\.beta_check_secret\(p_secret\);/g) ?? []).length, 3);
  assert.equal((sql.match(/security definer\nset search_path = ''/g) ?? []).length, 3);
  assert.equal((sql.match(/^grant execute on function public\.launch_set/gm) ?? []).length, 3);
  assert.doesNotMatch(sql, /\bdrop\b|\balter table public\.|\bservice_role\b(?!;)|grant .* to authenticated/i);
});
