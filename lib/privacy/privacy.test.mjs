import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { declaredVersions, derivationFit, reportText, sameBytes, signsV1 } from "./check.ts";
import { decodeKeyCopy, decodeLinkSecret, encodeKeyCopy, encodeLinkSecret, keyCopyFile, linkFragmentsIn } from "./codes.ts";
import { createHash } from "node:crypto";
import { needsDevelopmentRepository } from "../development-repository.mjs";
import { phantomBrowseUrl, solflareBrowseUrl, withoutFragment } from "../solana/open-in-wallet.ts";
import { exposureOf, exposureParts } from "./exposure.ts";
import { lamportsOf, solText } from "./flows.ts";
import { DERIVE_FROM_WALLET, LINK_MIN_LAMPORTS, PRIVATE_SDK_SHA256, RING_SOL, PRIVATE_BALANCE_CAP_USD, PRIVATE_CHAIN, PRIVATE_FEE_BPS, privateNetwork } from "./network.ts";
import { MAX_BATCH, POLICY_URL, RELAY_HOST, RING_PROGRAMS, passInHeaders, passOutHeaders, rpcAllowed, sameSite, upstreamUrl } from "./relay.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");
const OWNER = "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS";

test("the private balance opens on the test network only, and the numbers not decided stay empty", () => {
  assert.equal(privateNetwork("devnet"), "devnet");
  for (const value of [undefined, "", "open", "mainnet", "mainnet-beta", "DEVNET"]) assert.equal(privateNetwork(value), null, String(value));
  assert.equal(PRIVATE_CHAIN, "solana:devnet");
  assert.equal(PRIVATE_BALANCE_CAP_USD, null, "no starting cap is set in code");
  assert.equal(PRIVATE_FEE_BPS, null, "no fee is set in code");
  assert.deepEqual([...DERIVE_FROM_WALLET], [], "no wallet derives keys from a signature until a wallet check passes");
  assert.equal(RING_SOL, "11111111111111111111111111111111", "the ring names SOL by the system program, as the SDK's SOL_MINT");
  assert.ok(LINK_MIN_LAMPORTS >= 890_880n, "a link carries at least a fresh wallet's rent-exempt minimum");
});

test("the relay reaches Helius devnet only, with the key in the address, and passes the SDK's paths", () => {
  const rpc = upstreamUrl("rpc", [], "", "K");
  assert.equal(rpc.host, RELAY_HOST);
  assert.equal(rpc.searchParams.get("api-key"), "K");
  assert.equal(rpc.searchParams.get("apiKey"), null, "the prover refuses the apiKey form");
  assert.equal(upstreamUrl("rpc", ["x"], "", "K"), null);
  const spr = upstreamUrl("spr", ["attestation"], "?api-key=evil&jobId=abc-1", "K");
  assert.equal(spr.pathname, "/v1/spr/attestation");
  assert.equal(spr.searchParams.get("api-key"), "K", "a key the browser sent is dropped");
  assert.equal(spr.searchParams.get("jobId"), "abc-1");
  assert.equal(upstreamUrl("spr", [], "", "K").pathname, "/v1/spr");
  for (const bad of [["..", "x"], ["a/b"], ["%2e%2e"], ["."]]) assert.equal(upstreamUrl("spr", bad, "", "K"), null, bad.join("/"));
  assert.equal(upstreamUrl("spr", ["x"], "?jobId=../x", "K"), null);
  const attest = upstreamUrl("spr", ["attestation"], "?nonce=0a1B&other=1", "K");
  assert.equal(attest.searchParams.get("nonce"), "0a1B", "the attestation's nonce passes");
  assert.equal(attest.searchParams.get("other"), null);
  assert.equal(upstreamUrl("spr", ["attestation"], "?nonce=zz", "K"), null);
  assert.equal(upstreamUrl("spr", ["prove", "transfer_2x2"], "", "K").pathname, "/v1/spr/prove/transfer_2x2");
  assert.equal(upstreamUrl("spr", [".."], "", "K"), null);
  assert.equal(upstreamUrl("other", [], "", "K"), null);
  assert.equal(upstreamUrl("policy", [], "?api-key=x", "K").href, POLICY_URL, "the signed policy, as the SDK pins it, without a key");
  assert.equal(upstreamUrl("policy", ["x"], "", "K"), null);
  assert.equal(upstreamUrl("rpc", [], "", ""), null, "no key — no relay");
  assert.doesNotMatch(read("lib/privacy/relay.ts"), /mainnet/i);
});

test("the relay passes the RPC methods the SDK uses, the ring's two programs, and nothing else", () => {
  assert.ok(rpcAllowed({ method: "getLatestBlockhash" }));
  assert.ok(rpcAllowed([{ method: "getAccountInfo" }, { method: "sendTransaction" }]));
  for (const id of RING_PROGRAMS) assert.ok(rpcAllowed({ method: "getProgramAccounts", params: [id, {}] }), id);
  for (const bad of [{ method: "requestAirdrop" }, { method: "getTransaction" }, { method: "simulateTransaction" }, { method: "getProgramAccounts", params: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"] }, { method: "getProgramAccounts" }, null, [], "x", [{ method: "getSlot" }, { method: "minimumLedgerSlot" }]]) assert.equal(rpcAllowed(bad), false, JSON.stringify(bad));
  assert.equal(rpcAllowed(Array.from({ length: MAX_BATCH + 1 }, () => ({ method: "getSlot" }))), false, "a batch has a ceiling");
});

test("the relay carries the enclave's envelope headers and no cookie", () => {
  const inbound = new Headers({ "content-type": "application/octet-stream", "Spr-Tee": "1", "Spr-Tee-Enc": "aa", cookie: "s=1", authorization: "x" });
  const out = passInHeaders(inbound);
  assert.equal(out.get("spr-tee"), "1");
  assert.equal(out.get("spr-tee-enc"), "aa");
  assert.equal(out.get("cookie"), null);
  assert.equal(out.get("authorization"), null);
  const back = passOutHeaders(new Headers({ "Spr-Tee": "1", "set-cookie": "a=1", "content-type": "application/json" }));
  assert.equal(back.get("spr-tee"), "1");
  assert.equal(back.get("set-cookie"), null);
  assert.equal(back.get("cache-control"), "no-store");
  assert.ok(sameSite(new Headers({ "sec-fetch-site": "same-origin" })));
  assert.equal(sameSite(new Headers({ "sec-fetch-site": "cross-site" })), false);
  assert.equal(sameSite(new Headers({ origin: "https://evil" })), false);
  assert.equal(sameSite(new Headers()), false, "a call without a browser's mark (a script, curl) is refused");
});

test("the relay route is shut without the flag and the server key, and never logs or keeps a body", () => {
  const route = read("app/api/v1/privacy/devnet/[target]/[[...path]]/route.ts");
  assert.match(route, /if \(!privateNetwork\(\) \|\| !key\) return new NextResponse\(null, \{ status: 404 \}\)/);
  assert.match(route, /process\.env\.HELIUS_DEVNET_API_KEY/);
  assert.doesNotMatch(route, /console\.|NEXT_PUBLIC_HELIUS/);
  assert.doesNotMatch(route, /mainnet/i);
  assert.ok(route.indexOf('request.headers.get("content-length")') < route.indexOf("await request.arrayBuffer()"), "the size is checked before the body is read");
  assert.match(route, /bytes\.byteLength > MAX_ANSWER_BYTES/, "the answer has a ceiling");
});

test("a key copy goes there and back, names its wallet, and a changed copy is refused", async () => {
  const viewing = Uint8Array.from({ length: 32 }, (_, i) => i);
  const nullifier = Uint8Array.from({ length: 31 }, (_, i) => 200 - i);
  const code = await encodeKeyCopy({ network: "devnet", owner: OWNER, viewing, nullifier });
  assert.match(code, new RegExp(`^rpk1\\.devnet\\.${OWNER}\\.`));
  const back = await decodeKeyCopy(keyCopyFile(code, "title line"));
  assert.deepEqual([...back.viewing], [...viewing]);
  assert.deepEqual([...back.nullifier], [...nullifier]);
  assert.equal(back.owner, OWNER);
  const tail = code.at(-2) === "A" ? "B" : "A";
  assert.equal(await decodeKeyCopy(code.slice(0, -2) + tail + code.at(-1)), null, "a changed letter");
  assert.equal(await decodeKeyCopy(code.replace(OWNER, OWNER.slice(0, -1) + "T")), null, "another wallet's name on these keys");
  assert.equal(await decodeKeyCopy("nothing here"), null);
  // The links nobody has taken yet ride in the same file and come back with it.
  const link = `https://ryntra.io/private/claim#${await encodeLinkSecret(new Uint8Array(32).fill(7))}`;
  const file = keyCopyFile(code, "title", [link]);
  assert.deepEqual([...(await decodeKeyCopy(file)).viewing], [...viewing]);
  assert.deepEqual(linkFragmentsIn(file), [link.split("#")[1]]);
  assert.deepEqual(linkFragmentsIn(keyCopyFile(code, "title")), []);
  await assert.rejects(encodeKeyCopy({ network: "devnet", owner: OWNER, viewing: new Uint8Array(31), nullifier }));
});

test("a link's secret lives in the fragment and a cut link is refused", async () => {
  const seed = Uint8Array.from({ length: 32 }, (_, i) => (i * 7) & 255);
  const fragment = await encodeLinkSecret(seed);
  assert.match(fragment, /^k=[A-Za-z0-9_-]+$/);
  assert.deepEqual([...(await decodeLinkSecret(`#${fragment}`))], [...seed]);
  assert.deepEqual([...(await decodeLinkSecret(fragment))], [...seed]);
  assert.equal(await decodeLinkSecret(`#${fragment.slice(0, -3)}`), null);
  assert.equal(await decodeLinkSecret("#x=abc"), null);
  assert.equal(await decodeLinkSecret(""), null);
});

test("«others see» says only what devnet showed — a link ties the sender to whoever takes it to a wallet", () => {
  assert.deepEqual(exposureOf("send"), { who: "seen", to: "hidden", amount: "hidden" }, "a transfer shows only the sender");
  assert.deepEqual(exposureOf("hide"), { who: "seen", to: "none", amount: "seen" }, "a deposit shows who and how much");
  assert.deepEqual(exposureOf("return"), { who: "none", to: "seen", amount: "seen" }, "a withdrawal shows to whom and how much");
  assert.deepEqual(exposureOf("link"), { who: "seen", to: "ifWallet", amount: "ifWallet" }, "the public top-up ties the link to the sender");
  assert.deepEqual(exposureOf("claimWallet"), { who: "seen", to: "seen", amount: "seen" }, "sender, link and wallet read from the chain");
  assert.deepEqual(exposureOf("claimPrivate"), { who: "seen", to: "hidden", amount: "hidden" });
  assert.deepEqual(exposureParts("enable"), [["who", "seen"]]);
});

test("a wallet's «open in its browser» link never carries the page's fragment to another site", () => {
  const page = "https://ryntra.io/private/claim?lang=uk#k=SECRETsecretSECRETsecretSECRETsecretSECRETs";
  assert.equal(withoutFragment(page), "https://ryntra.io/private/claim?lang=uk");
  for (const url of [phantomBrowseUrl(page, "https://ryntra.io"), solflareBrowseUrl(page, "https://ryntra.io")]) {
    assert.doesNotMatch(url, /SECRET|%23|#/, url);
  }
  const claim = read("terminal/portfolio/private/ClaimScreen.tsx");
  assert.ok(claim.includes("holder.va('beforeSend', (event: VaEvent) => ({ ...event, url: withoutFragment(event.url) }))"), "analytics events of the link's page lose the fragment");
  assert.doesNotMatch(claim, /phantomBrowseUrl|solflareBrowseUrl/, "the link's page offers no «open in a wallet» link");
});

test("the wallet check reads what a wallet declares and says yes only when both envelope signatures agree", () => {
  assert.deepEqual(declaredVersions({ supportedTransactionVersions: ["legacy", 0, 1] }), ["legacy", "0", "1"]);
  assert.equal(declaredVersions({}), null);
  assert.equal(signsV1(["legacy", "0"]), "no");
  assert.equal(signsV1(["legacy", "0", "1"]), "yes");
  assert.equal(signsV1(null), "unknown");
  assert.equal(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])), "yes");
  assert.equal(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3])), "no");
  assert.equal(sameBytes(null, new Uint8Array([1])), "unknown");
  const base = { wallet: "W", address: OWNER, versions: ["legacy", "0"], signMessage: true, v1: { signed: "unknown", messageKept: "unknown", valid: "unknown", landed: null } };
  assert.equal(derivationFit({ ...base, envelope: { sameBytes: "yes", valid: "yes", repeatable: "yes" } }), "yes");
  assert.equal(derivationFit({ ...base, envelope: { sameBytes: "yes", valid: "yes", repeatable: "no" } }), "no");
  assert.equal(derivationFit({ ...base, envelope: { sameBytes: "yes", valid: "yes", repeatable: "unknown" } }), "unknown");
  const text = reportText({ ...base, envelope: { sameBytes: "yes", valid: "yes", repeatable: "no" } }, new Date("2026-11-18T00:00:00Z"));
  assert.match(text, /two envelope signatures equal: no/);
  assert.match(text, /signs v1: no/);
  assert.match(text, /keys from the wallet's signature: no/);
});

test("amounts: SOL text and lamports go there and back without rounding", () => {
  assert.equal(solText(20_000_000n), "0.02");
  assert.equal(solText(1_234_567_891n), "1.234567891");
  assert.equal(solText(0n), "0");
  assert.equal(lamportsOf("0,05"), 50_000_000n);
  assert.equal(lamportsOf(".5"), 500_000_000n);
  assert.equal(lamportsOf("1"), 1_000_000_000n);
  for (const bad of ["", ".", "0", "-1", "1e3", "0.0000000001", "abc"]) assert.equal(lamportsOf(bad), null, bad);
});

test("Ryntra Private keeps no key on its server and never names mainnet", () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(REPO, dir))) {
      const path = `${dir}/${name}`;
      if (statSync(join(REPO, path)).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  walk("lib/privacy");
  walk("terminal/portfolio/private");
  for (const path of files) {
    const source = read(path).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(source, /HELIUS_[A-Z_]*API_KEY|api-key=/, `${path}: the key lives in the relay only`);
    assert.doesNotMatch(source, /mainnet/i, `${path}: devnet only`);
    assert.doesNotMatch(source, /localStorage|sessionStorage/, `${path}: secrets go to the sealed vault, not plain storage`);
    assert.doesNotMatch(source, /fetch\(\s*['"`]\/api\/(?!v1\/privacy)/, `${path}: no key goes to another Ryntra route`);
  }
  // Keys: kept ones are used as they are; new ones are made only when none are kept, sealed before anything is signed,
  // and only those are forgotten when the chain refuses them. A failed read never turns a landed step into a refusal.
  const store = read("lib/privacy/usePrivate.ts");
  const on = store.slice(store.indexOf("turnOn: async"), store.indexOf("restore: async"));
  assert.match(on, /if \(kept\) secrets = secretsOf\(kept\);\s*else \{/);
  assert.ok(on.indexOf("await seal(keysId(NETWORK, owner)") < on.indexOf("await enable(ctx, signer(), keys)"));
  assert.match(on, /if \(made\) await forget\(keysId\(NETWORK, owner\)\)/);
  const step = store.slice(store.indexOf("async function step("), store.indexOf("return {", store.indexOf("async function step(")));
  assert.ok(step.indexOf("landed = await act()") < step.indexOf("catch (error)") && step.indexOf("catch (error)") < step.indexOf("await reread("), "the read stands outside the step's own try");
  assert.match(store, /const pending = \(await storedLinks\(owner\)\)\.find\(\(l\) => !l\.funded\)/, "a half-made link is finished, not made again");
  assert.match(read("lib/privacy/vault.client.ts"), /generateKey\(\{ name: 'AES-GCM', length: 256 \}, false/);
});

test("the SDK bundle is the pinned one, built by its script, and loaded only by the private balance", { skip: needsDevelopmentRepository("scripts/privacy/vendor/") }, () => {
  const pkg = JSON.parse(read("scripts/privacy/vendor/package.json"));
  assert.equal(pkg.dependencies["@heliuslabs/spr"], "0.9.0-alpha");
  const lock = JSON.parse(read("scripts/privacy/vendor/package-lock.json"));
  assert.match(lock.packages["node_modules/@heliuslabs/spr"].integrity, /^sha512-/);
  const head = readFileSync(join(REPO, "public/privacy/spr-0.9.0-alpha.mjs")).subarray(0, 200).toString("utf8");
  assert.match(head, /^\/\* @heliuslabs\/spr 0\.9\.0-alpha with @solana\/kit 8\.6\.0/);
  const bundle = readFileSync(join(REPO, "public/privacy/spr-0.9.0-alpha.mjs"));
  assert.equal(createHash("sha256").update(bundle).digest("hex"), PRIVATE_SDK_SHA256, "the committed bundle is the one its inputs build (scripts/privacy/vendor-sdk.mjs --check)");
  for (const id of RING_PROGRAMS) assert.ok(bundle.includes(id), `the relay's ring program ${id} is the SDK's`);
  assert.equal(JSON.parse(read("package.json")).dependencies["@heliuslabs/spr"], undefined, "Ryntra's own dependencies stay as they are");
  assert.match(read("lib/privacy/sdk.client.ts"), /import\(\/\* webpackIgnore: true \*\/ PRIVATE_SDK_URL\)/);
});
