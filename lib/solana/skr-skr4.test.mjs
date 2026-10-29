import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SKR_PARENT, TLD_HOUSE_PROGRAM_ADDRESS, getSkrNameAddress } from "@solana-mobile/skr-domain";
import { getAddressEncoder, getBase64Decoder, getProgramDerivedAddress } from "@solana/kit";

import { SkrNameReadSchema } from "../api/v1/contract.ts";
import { sendRecipientOf } from "./receipt-view.ts";
import { addressGroups, lookalikeOf, shownSkrName, skrNameOf } from "./skr-name.ts";
import { forgetSkrNamesForTests as forgetClient, resolveSkrName, skrNameFor } from "./skr.client.ts";
import { forgetSkrNamesForTests as forgetServer, readSkrName, resolveSkrForward } from "./skr.server.ts";

/**
 * SKR-4 — `.skr` names instead of addresses. The chain is a fixture: the account bytes an AllDomains name record and a
 * TLD House `MainDomain` carry, laid out as `@solana-mobile/skr-domain` reads them, so these tests run the package
 * itself — never a stub of it — against an RPC that answers from a map.
 */

const ALICE = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const BOB = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const POISON = "7xKXzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzgAsU"; // the same first and last four as ALICE

const encoder = getAddressEncoder();
const toBase64 = (bytes) => getBase64Decoder().decode(bytes);

function nameRecord({ owner, parent = SKR_PARENT, expiresAt = 0n, label = null }) {
  const data = new Uint8Array(label ? 200 + label.length + 1 : 200);
  data.set(encoder.encode(parent), 8);
  data.set(encoder.encode(owner), 40);
  new DataView(data.buffer).setBigUint64(104, expiresAt, true);
  if (label) data.set(new TextEncoder().encode(label), 200);
  return data;
}

function mainDomain({ nameAccount, tld = ".skr", domain }) {
  const tldBytes = new TextEncoder().encode(tld);
  const domainBytes = new TextEncoder().encode(domain);
  const data = new Uint8Array(8 + 32 + 4 + tldBytes.length + 4 + domainBytes.length);
  data.set([109, 239, 227, 199, 98, 226, 66, 175], 0);
  data.set(encoder.encode(nameAccount), 8);
  const view = new DataView(data.buffer);
  view.setUint32(40, tldBytes.length, true);
  data.set(tldBytes, 44);
  view.setUint32(44 + tldBytes.length, domainBytes.length, true);
  data.set(domainBytes, 48 + tldBytes.length);
  return data;
}

async function mainDomainAddress(wallet) {
  const [pda] = await getProgramDerivedAddress({ programAddress: TLD_HOUSE_PROGRAM_ADDRESS, seeds: ["main_domain", encoder.encode(wallet)] });
  return pda;
}

/** An RPC that answers `getAccountInfo` from a map and counts every call; `fail` makes every call throw. */
function fakeRpc(accounts, { fail = false, programAccounts = null } = {}) {
  const calls = [];
  const rpc = {
    getAccountInfo: (address) => ({
      send: async () => {
        calls.push(["getAccountInfo", String(address)]);
        if (fail) throw new Error("RPC down");
        const data = accounts.get(String(address));
        return { value: data ? { data: [toBase64(data), "base64"] } : null };
      },
    }),
    getProgramAccounts: () => ({
      send: async () => {
        calls.push(["getProgramAccounts"]);
        if (fail || programAccounts === null) throw new Error("getProgramAccounts is disabled");
        return programAccounts;
      },
    }),
    getMultipleAccounts: () => ({
      send: async () => {
        calls.push(["getMultipleAccounts"]);
        return { value: [] };
      },
    }),
  };
  return { rpc, calls };
}

function depsOf(rpc, now = () => 1_000_000) {
  return { read: (run) => run(rpc, new AbortController().signal), now };
}

async function chain() {
  const aliceAccount = await getSkrNameAddress("alice.skr");
  const accounts = new Map([
    [String(aliceAccount), nameRecord({ owner: ALICE })],
    [String(await getSkrNameAddress("old.skr")), nameRecord({ owner: BOB, expiresAt: 1n })],
    [String(await mainDomainAddress(ALICE)), mainDomain({ nameAccount: aliceAccount, domain: "alice" })],
    /* Bob chose alice.skr once, then the name went to Alice: the MainDomain account still points at it. */
    [String(await mainDomainAddress(BOB)), mainDomain({ nameAccount: aliceAccount, domain: "alice" })],
  ]);
  return accounts;
}

test("a name is one ASCII label before .skr — a homograph, a subdomain or another TLD is never read as one", () => {
  assert.equal(skrNameOf(" Alice.SKR "), "alice.skr");
  assert.equal(skrNameOf("alice_01-x.skr"), "alice_01-x.skr");
  assert.equal(skrNameOf("alice"), null, "a bare label is not a name the person typed as one");
  assert.equal(skrNameOf("pay.alice.skr"), null);
  assert.equal(skrNameOf("alice.sol"), null);
  assert.equal(skrNameOf(".skr"), null);
  assert.equal(skrNameOf("аlice.skr"), null, "Cyrillic а");
  assert.equal(skrNameOf(ALICE), null, "an address stays an address");
  assert.equal(shownSkrName("Alice.skr"), "alice.skr");
  assert.equal(shownSkrName(42), null);
});

test("SEC-2: a look-alike copies a known address's first and last four characters, never the address itself", () => {
  assert.equal(lookalikeOf([ALICE, BOB], POISON), ALICE);
  assert.equal(lookalikeOf([ALICE], ALICE), null, "the same address is not its own look-alike");
  assert.equal(lookalikeOf([BOB], POISON), null);
  assert.equal(addressGroups(ALICE).join(""), ALICE, "Review groups every character, drops none");
  assert.ok(addressGroups(ALICE).every((group) => group.length <= 4));
});

test("name → address: the owner now, from the chain on every read — never a cached answer", async () => {
  forgetServer();
  const accounts = await chain();
  const { rpc, calls } = fakeRpc(accounts);
  const first = await resolveSkrForward("Alice.skr", depsOf(rpc));
  assert.deepEqual(first, { state: "FOUND", name: "alice.skr", address: ALICE });
  /* The name changes hands; the next read says so, because nothing kept the first answer. */
  accounts.set(String(await getSkrNameAddress("alice.skr")), nameRecord({ owner: BOB }));
  const second = await resolveSkrForward("alice.skr", depsOf(rpc));
  assert.deepEqual(second, { state: "FOUND", name: "alice.skr", address: BOB });
  assert.equal(calls.filter(([method]) => method === "getAccountInfo").length, 2);
});

test("name → address: no such name and an expired one are NOT_FOUND; a chain that does not answer is UNAVAILABLE", async () => {
  const accounts = await chain();
  assert.deepEqual(await resolveSkrForward("nobody.skr", depsOf(fakeRpc(accounts).rpc)), { state: "NOT_FOUND", name: "nobody.skr" });
  assert.deepEqual(await resolveSkrForward("old.skr", depsOf(fakeRpc(accounts).rpc)), { state: "NOT_FOUND", name: "old.skr" });
  assert.deepEqual(await resolveSkrForward("alice.skr", depsOf(fakeRpc(accounts, { fail: true }).rpc)), { state: "UNAVAILABLE", name: "alice.skr" });
  await assert.rejects(() => resolveSkrForward("not a name", depsOf(fakeRpc(accounts).rpc)));
});

test("address → name: only the primary name, and only while that wallet still owns it", async () => {
  forgetServer();
  const accounts = await chain();
  const { rpc } = fakeRpc(accounts);
  assert.deepEqual(await readSkrName(ALICE, {}, depsOf(rpc)), { state: "FOUND", address: ALICE, name: "alice.skr", source: "primary" });
  assert.deepEqual(await readSkrName(BOB, {}, depsOf(rpc)), { state: "NONE", address: BOB }, "a primary name that moved on is no name");
});

test("address → name is kept an hour, a «none» too; a failed read is never kept", async () => {
  forgetServer();
  const accounts = await chain();
  let now = 1_000_000;
  const clock = () => now;
  const { rpc, calls } = fakeRpc(accounts);
  await readSkrName(ALICE, {}, depsOf(rpc, clock));
  await readSkrName(ALICE, {}, depsOf(rpc, clock));
  assert.equal(calls.length, 2, "the second read is served from the hour's copy (two getAccountInfo for the first)");
  now += 60 * 60_000;
  await readSkrName(ALICE, {}, depsOf(rpc, clock));
  assert.equal(calls.length, 4, "after the hour the chain is asked again");

  forgetServer();
  const down = fakeRpc(accounts, { fail: true });
  assert.deepEqual(await readSkrName(ALICE, {}, depsOf(down.rpc, clock)), { state: "UNAVAILABLE", address: ALICE });
  const up = fakeRpc(accounts);
  assert.equal((await readSkrName(ALICE, {}, depsOf(up.rpc, clock))).state, "FOUND", "the failure was not remembered as «no name»");
});

test("the names a wallet holds are asked only for its own wallet, and a refused getProgramAccounts is UNAVAILABLE, not «none»", async () => {
  forgetServer();
  const accounts = await chain();
  const other = fakeRpc(accounts);
  await readSkrName(BOB, {}, depsOf(other.rpc));
  assert.ok(!other.calls.some(([method]) => method === "getProgramAccounts"), "someone else's address never lists its names");

  forgetServer();
  const own = fakeRpc(accounts);
  assert.deepEqual(await readSkrName(BOB, { self: true }, depsOf(own.rpc)), { state: "UNAVAILABLE", address: BOB });
  assert.ok(own.calls.some(([method]) => method === "getProgramAccounts"));

  forgetServer();
  const listed = fakeRpc(accounts, { programAccounts: [] });
  assert.deepEqual(await readSkrName(BOB, { self: true }, depsOf(listed.rpc)), { state: "NONE", address: BOB });
});

function jsonFetch(body, status = 200, seen = []) {
  return async (url, init) => {
    seen.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

test("the browser asks for a name's address every time, with no-store, and believes only an answer about that name", async () => {
  const seen = [];
  const fetchImpl = jsonFetch({ direction: "name", state: "FOUND", name: "alice.skr", address: ALICE }, 200, seen);
  assert.deepEqual(await resolveSkrName("Alice.skr", { fetchImpl }), { state: "FOUND", name: "alice.skr", address: ALICE });
  await resolveSkrName("alice.skr", { fetchImpl });
  assert.equal(seen.length, 2, "never kept");
  assert.equal(seen[0].init.cache, "no-store");
  assert.match(seen[0].url, /^\/api\/v1\/research\/skr-name\?name=alice\.skr$/);

  const otherName = jsonFetch({ direction: "name", state: "FOUND", name: "bob.skr", address: BOB });
  assert.equal((await resolveSkrName("alice.skr", { fetchImpl: otherName })).state, "UNAVAILABLE");
  const badAddress = jsonFetch({ direction: "name", state: "FOUND", name: "alice.skr", address: "0xnot" });
  assert.equal((await resolveSkrName("alice.skr", { fetchImpl: badAddress })).state, "UNAVAILABLE");
  assert.equal((await resolveSkrName("alice.skr", { fetchImpl: jsonFetch({}, 503) })).state, "UNAVAILABLE");
  assert.equal((await resolveSkrName("alice.skr", { fetchImpl: jsonFetch({ direction: "name", state: "NOT_FOUND", name: "alice.skr", address: null }) })).state, "NOT_FOUND");
});

test("the browser keeps an address's name for the page, shares one read, and forgets a failure", async () => {
  forgetClient();
  const seen = [];
  const fetchImpl = jsonFetch({ direction: "address", state: "FOUND", address: ALICE, name: "alice.skr", source: "primary" }, 200, seen);
  const [a, b] = await Promise.all([skrNameFor(ALICE, { fetchImpl }), skrNameFor(ALICE, { fetchImpl })]);
  assert.equal(a, "alice.skr");
  assert.equal(b, "alice.skr");
  assert.equal(seen.length, 1);
  await skrNameFor(ALICE, { self: true, fetchImpl });
  assert.match(seen[1].url, /&self=1$/, "the own wallet is its own question");

  const failing = [];
  assert.equal(await skrNameFor(BOB, { fetchImpl: jsonFetch({}, 503, failing) }), null);
  assert.equal(await skrNameFor(BOB, { fetchImpl: jsonFetch({}, 503, failing) }), null);
  assert.equal(failing.length, 2, "a failed read is asked again");
  assert.equal(await skrNameFor("not-an-address", { fetchImpl }), null);
});

test("the contract: both directions, a name in one shape, and an address answer that never invents a source", () => {
  assert.ok(SkrNameReadSchema.safeParse({ direction: "name", state: "FOUND", name: "alice.skr", address: ALICE }).success);
  assert.ok(SkrNameReadSchema.safeParse({ direction: "address", state: "NOT_FOUND", address: ALICE, name: null, source: null }).success);
  assert.ok(!SkrNameReadSchema.safeParse({ direction: "name", state: "FOUND", name: "Alice.skr", address: ALICE }).success);
  assert.ok(!SkrNameReadSchema.safeParse({ direction: "address", state: "FOUND", address: ALICE, name: "alice.skr", source: "guess" }).success);
});

test("a send receipt names whom it paid from its own signed facts; any other receipt names nobody", () => {
  const facts = (body) => ({ id: "outcome_fixture", contentHash: "0x1", outcome: { observedEffects: [{ description: JSON.stringify(body), sourceRef: "ryntra.solana.send-receipt.facts@1:fixture#1/1", observedAt: "2026-10-22T09:00:00.000Z" }] } });
  assert.equal(sendRecipientOf(facts({ schema: "ryntra.solana.send-receipt", network: "mainnet", recipient: ALICE })), ALICE);
  assert.equal(sendRecipientOf(facts({ schema: "ryntra.solana.send-receipt", network: "devnet", recipient: ALICE })), null, "names live on mainnet");
  assert.equal(sendRecipientOf(facts({ schema: "ryntra.solana.swap-receipt-facts", recipient: ALICE })), null);
  assert.equal(sendRecipientOf(facts({ schema: "ryntra.solana.send-receipt", network: "mainnet", recipient: "alice.skr" })), null, "a name is never what a receipt paid");
  assert.equal(sendRecipientOf({ id: "x", contentHash: "0x1" }), null);
});

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("«Надіслати» reads the name again right before the wallet opens, and Review shows the whole address", () => {
  const card = read("app/solana/workspace/send/send-card.tsx");
  const sign = card.slice(card.indexOf("const signAndSend = useCallback"), card.indexOf("const signingOpen"));
  const again = sign.indexOf("await recheckName(recipientName, prepared.input.recipient)");
  assert.ok(again > 0, "the name is resolved again inside signAndSend");
  assert.ok(again < sign.indexOf("await signTransaction("), "…before the wallet is asked");
  const last = sign.indexOf("await recheckName(recipientName, bundle.plan.recipient)");
  assert.ok(last > sign.indexOf("await signTransaction(") && last < sign.indexOf("rememberPendingSend("), "…and once more before the signed bytes leave");
  const recheck = card.slice(card.indexOf("const recheckName = useCallback"), card.indexOf("const requestReview"));
  assert.match(recheck, /await resolveSkrName\(name\)/, "every check asks the server, never the copy on screen");
  assert.match(recheck, /again\.address === expected \? null : "SKR_CHANGED"/, "a name that moved stops the transfer");
  const review = card.slice(card.indexOf("const requestReview = useCallback"), card.indexOf("const signAndSend"));
  assert.ok(review.indexOf("await recheckName(recipientName") < review.indexOf("/api/solana/transfer/plan"), "Review is built on a fresh read too");
  assert.match(card, /addressGroups\(plan\.plan\.recipient\)\.join\(" "\)/, "Review prints every character of the address it pays");
  assert.match(card, /lookalikeOf\(knownAddresses, recipientAddress\)/, "SEC-2's look-alike check runs on the address a name resolved to too");
});

function sources(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      found.push(...sources(path));
    } else if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

test("getSkrDomains runs on the server only, and nothing in the browser reaches the name program", () => {
  /* `fileURLToPath`, not `.pathname`: on Windows the pathname is `/H:/…`, which `join` turns into `H:\H:\…`. */
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const callers = [...sources(join(root, "app")), ...sources(join(root, "lib"))]
    .filter((file) => /\bgetSkrDomains\(|from "@solana-mobile\/skr-domain"/.test(readFileSync(file, "utf8")))
    .map((file) => file.slice(root.length).replaceAll("\\", "/"));
  assert.deepEqual(callers, ["lib/solana/skr.server.ts"]);
});
