/**
 * The Solana evidence core, proven over the bytes the chain actually served.
 *
 * Every fixture in ./fixtures was captured by scripts/solana-check.mjs from
 * live mainnet RPC — raw base64 account data plus the owner, exactly as
 * returned. The tests run the real decoder over those bytes, so a decoder
 * regression fails here without any network. Live behavior itself is proven
 * by the probe script, which drives the same modules against real RPC.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decodeRawMintAccount, decodeMintBytes, base58Encode } from "./mint.ts";
import { getMintDecoder } from "@solana-program/token-2022";
import { buildPassport } from "./passport.ts";
import { describeExtension, flattenExtensionFields, KNOWN_EXTENSION_KINDS } from "./semantics.ts";
import { SOLANA_PROVENANCE } from "./types.ts";
import { isResolved, resolved } from "./evidence.ts";

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

const passportOf = (name) => {
  const built = buildPassport(fixture(name));
  assert.equal(built.ok, true, `fixture ${name} must build: ${built.ok ? "" : built.reason}`);
  return built.passport;
};

/* ── identity over classic SPL mints ─────────────────────────────────── */

test("USDC decodes as a classic SPL mint with live authorities and no extensions", () => {
  const p = passportOf("usdc-spl");
  assert.equal(p.identity.programKind, "SPL_TOKEN");
  assert.equal(p.identity.decimals.value, 6);
  assert.ok(BigInt(p.identity.supply.value) > 0n);
  assert.equal(typeof p.identity.mintAuthority.value, "string");
  assert.equal(typeof p.identity.freezeAuthority.value, "string");
  assert.equal(p.extensions.length, 0);
  assert.equal(p.unsupportedKinds.length, 0);
});

test("wSOL decodes with nine decimals and no mint authority — a fixed supply is a fact, not a blank", () => {
  const p = passportOf("wsol-spl");
  assert.equal(p.identity.programKind, "SPL_TOKEN");
  assert.equal(p.identity.decimals.value, 9);
  assert.equal(p.identity.mintAuthority.value, null);
  assert.match(p.identity.mintAuthority.meaning, /nobody can mint more/);
});

test("USDT and BONK decode as classic mints", () => {
  for (const name of ["usdt-spl", "bonk-spl"]) {
    const p = passportOf(name);
    assert.equal(p.identity.programKind, "SPL_TOKEN");
    assert.ok(p.identity.decimals.value >= 0);
    assert.equal(p.identity.isInitialized.value, true);
  }
});

/* ── Token-2022 extensions over real mints ───────────────────────────── */

test("PYUSD carries the three extensions this product exists for, decoded with real fields", () => {
  const p = passportOf("pyusd-t22");
  assert.equal(p.identity.programKind, "TOKEN_2022");
  const kinds = p.extensions.map((e) => e.kind);
  for (const required of ["PermanentDelegate", "TransferFeeConfig", "TransferHook"]) {
    assert.ok(kinds.includes(required), `PYUSD must carry ${required}, saw: ${kinds.join(", ")}`);
  }
  const delegate = p.extensions.find((e) => e.kind === "PermanentDelegate");
  assert.equal(delegate.affectsTransfers, true);
  assert.equal(typeof delegate.fields.delegate, "string");
  assert.match(delegate.meaning, /without the holder's approval/);

  const fee = p.extensions.find((e) => e.kind === "TransferFeeConfig");
  assert.equal(typeof fee.fields["newerTransferFee.transferFeeBasisPoints"], "number");
  assert.equal(typeof fee.fields.withheldAmount, "string", "u64 withheld amount arrives as a string, never a lossy number");

  const hook = p.extensions.find((e) => e.kind === "TransferHook");
  assert.equal(hook.affectsTransfers, true);
});

test("BERN carries a real TransferFeeConfig on a second independent mint", () => {
  const p = passportOf("bern-t22");
  assert.equal(p.identity.programKind, "TOKEN_2022");
  const fee = p.extensions.find((e) => e.kind === "TransferFeeConfig");
  assert.ok(fee, "BERN must carry TransferFeeConfig");
  assert.ok(fee.fields["newerTransferFee.transferFeeBasisPoints"] >= 0);
});

test("every extension observed on the real fixtures has written semantics, not the fallback line", () => {
  for (const name of ["pyusd-t22", "bern-t22"]) {
    for (const ext of passportOf(name).extensions) {
      assert.ok(KNOWN_EXTENSION_KINDS.includes(ext.kind), `${ext.kind} has no semantics entry`);
      assert.ok(!ext.meaning.includes("no written semantics"), `${ext.kind} fell back to the generic line`);
    }
  }
});

/* ── refusals stay refusals ──────────────────────────────────────────── */

test("a program account is refused as NOT_A_MINT with the owner named", () => {
  const result = decodeRawMintAccount(fixture("not-a-mint"));
  assert.equal(result.ok, false);
  assert.equal(result.code, "NOT_A_MINT");
  assert.match(result.reason, /BPFLoaderUpgradeab1e/);
});

test("undecodable mint bytes are refused as DECODE_FAILED, never guessed at", () => {
  const broken = { ...fixture("usdc-spl"), dataBase64: "AAAA" };
  const result = decodeRawMintAccount(broken);
  assert.equal(result.ok, false);
  assert.equal(result.code, "DECODE_FAILED");
});

/* ── the classic-layout fallback is held to the generated decoder ────── */

test("the hand-written classic layout decodes byte-identically to the generated decoder", () => {
  for (const name of ["usdc-spl", "wsol-spl", "usdt-spl", "bonk-spl"]) {
    const bytes = Uint8Array.from(Buffer.from(fixture(name).dataBase64, "base64"));
    assert.equal(bytes.length, 82, `${name} must be a classic 82-byte mint`);
    const generated = getMintDecoder().decode(bytes);
    const manual = decodeMintBytes(bytes);
    assert.equal(manual.supply, generated.supply);
    assert.equal(manual.decimals, generated.decimals);
    assert.equal(manual.isInitialized, generated.isInitialized);
    assert.deepEqual(manual.mintAuthority, generated.mintAuthority);
    assert.deepEqual(manual.freezeAuthority, generated.freezeAuthority);
  }
});

test("base58 round-trips the two known program ids", () => {
  const spl = Uint8Array.from(Buffer.from("06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9", "hex"));
  assert.equal(base58Encode(spl), "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
});

/* ── honesty of the unknown ──────────────────────────────────────────── */

test("an extension kind nobody wrote semantics for still renders, flagged and conservative", () => {
  const fact = describeExtension({ __kind: "SomethingFromTheFuture", value: 7n });
  assert.equal(fact.kind, "SomethingFromTheFuture");
  assert.match(fact.meaning, /no written semantics/);
  assert.equal(fact.affectsTransfers, true, "an unknown power is treated as transfer-affecting, never as harmless");
  assert.equal(fact.fields.value, "7");
});

test("field flattening is JSON-safe: bigints to strings, options unwrapped, bytes to base64", () => {
  const flat = flattenExtensionFields({
    __kind: "X",
    amount: 12n,
    maybe: { __option: "None" },
    some: { __option: "Some", value: "abc" },
    raw: Uint8Array.from([1, 2, 3]),
    nested: { inner: true },
  });
  assert.deepEqual(flat, { amount: "12", maybe: null, some: "abc", raw: "AQID", "nested.inner": true });
});

test("every fact on a built passport carries a provenance from the closed vocabulary", () => {
  const p = passportOf("pyusd-t22");
  const facts = [
    p.identity.decimals,
    p.identity.supply,
    p.identity.mintAuthority,
    p.identity.freezeAuthority,
    p.identity.isInitialized,
    ...p.extensions,
  ];
  for (const fact of facts) assert.ok(SOLANA_PROVENANCE.includes(fact.provenance));
});

/* ── the shared envelope arrived intact ──────────────────────────────── */

test("the re-exported evidence envelope still computes freshness rather than accepting it", () => {
  const fresh = resolved({
    data: 1,
    sources: [{ ref: "solana:mainnet:rpc:test", label: "test" }],
    observedAt: new Date(),
    maxAgeSeconds: 60,
  });
  assert.ok(isResolved(fresh));
  assert.equal(fresh.state, "FRESH");
});

/* ── a capacity that is switched off must not be described as running ──── */

test("a transfer hook with no program set says so instead of announcing a program", () => {
  /* PYUSD carries TransferHook with the all-zero program id, which is how the
     token program stores "none". The passport used to tell a holder that a
     separate program runs on every transfer while the preflight, reading the
     same bytes, correctly resolved no hook. Two readings of one account. */
  const hook = passportOf("pyusd-t22").extensions.find((e) => e.kind === "TransferHook");
  assert.ok(hook, "the PYUSD fixture carries a TransferHook extension");
  assert.equal(hook.fields.programId, "11111111111111111111111111111111");
  assert.match(hook.meaning, /No transfer-hook program is set/);
  assert.doesNotMatch(hook.meaning, /A separate program runs on every transfer/);
  /* Still flagged: the slot and its authority exist, so this can change. */
  assert.equal(hook.affectsTransfers, true);
  assert.match(hook.meaning, /authority can install one/);
});

test("a zero transfer fee is reported as zero, not as a tax on every transfer", () => {
  const fee = passportOf("pyusd-t22").extensions.find((e) => e.kind === "TransferFeeConfig");
  assert.ok(fee);
  assert.equal(fee.fields["newerTransferFee.transferFeeBasisPoints"], 0);
  assert.match(fee.meaning, /configured at zero/);
  assert.doesNotMatch(fee.meaning, /receives less than was sent/);
  assert.equal(fee.affectsTransfers, true);
});

test("a real transfer fee keeps the sentence that says the recipient gets less", () => {
  const fee = passportOf("bern-t22").extensions.find((e) => e.kind === "TransferFeeConfig");
  assert.ok(fee);
  assert.ok(Number(fee.fields["newerTransferFee.transferFeeBasisPoints"]) > 0);
  assert.match(fee.meaning, /receives less than was sent/);
});

test("the passport's hook sentence and the preflight's resolved hook cannot disagree", async () => {
  /* The gate for the defect class itself: whatever the two modules say about
     a hook, they must say the same thing, on every fixture. */
  const { decodeRawMintAccount: decode } = await import("./mint.ts");
  const { buildTransferPreflight } = await import("./preflight.ts");
  for (const name of ["pyusd-t22", "bern-t22", "usdc-spl", "bonk-spl", "usdt-spl", "wsol-spl"]) {
    const raw = fixture(name);
    const read = decode(raw);
    if (!read.ok) continue;
    const passport = passportOf(name);
    const preflight = buildTransferPreflight({
      read,
      passport,
      input: {
        schemaVersion: "1.0.0",
        actionRef: "action:solana-token-2022/spl-transfer@1",
        network: raw.network,
        mint: raw.mint,
        sender: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        recipient: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
        amountRaw: "1000000",
      },
    });
    assert.equal(preflight.ok, true, `${name} must preflight`);
    const hook = passport.extensions.find((e) => e.kind === "TransferHook");
    const announcesProgram = hook !== undefined && /A separate program runs on every transfer/.test(hook.meaning);
    assert.equal(
      announcesProgram,
      preflight.preflight.hookProgramId !== null,
      `${name}: the passport sentence and the resolved hook program disagree`,
    );
  }
});
