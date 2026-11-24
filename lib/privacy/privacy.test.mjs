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
import { DERIVE_FROM_WALLET, LINK_MIN_LAMPORTS, PRIVATE_NET, PRIVATE_SDK_SHA256, PRIVATE_TEST, RING_SOL, PRIVATE_BALANCE_CAP_USD, PRIVATE_CHAIN, PRIVATE_RELAY, chainOf, explorerUrl, privateNetwork, relayOf } from "./network.ts";
import { MAX_BATCH, POLICY_URL, POLICY_URLS, RELAY_HOST, RELAY_HOSTS, RING_PROGRAMS, passInHeaders, passOutHeaders, rpcAllowed, sameSite, upstreamUrl } from "./relay.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");
const OWNER = "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS";

test("the network comes from the switch: devnet, or mainnet only with its key; the numbers not decided stay empty", () => {
  assert.equal(privateNetwork("devnet"), "devnet");
  assert.equal(privateNetwork("devnet", false), "devnet", "devnet needs no mainnet key");
  assert.equal(privateNetwork("mainnet", true), "mainnet", "mainnet with its key");
  assert.equal(privateNetwork("mainnet", false), null, "mainnet without its key stays shut, as before");
  assert.equal(privateNetwork("mainnet"), null, "a build that did not see the key keeps mainnet shut");
  for (const value of [undefined, "", "open", "mainnet-beta", "DEVNET", "Mainnet", " mainnet"]) {
    assert.equal(privateNetwork(value, true), null, String(value));
  }
  // Without the switch (this test's process) the build names everything for devnet, as before.
  assert.equal(PRIVATE_NET, "devnet");
  assert.equal(PRIVATE_TEST, true);
  assert.equal(PRIVATE_CHAIN, "solana:devnet");
  assert.equal(chainOf("mainnet"), "solana:mainnet");
  assert.deepEqual({ ...PRIVATE_RELAY }, { rpc: "/api/v1/privacy/devnet/rpc", spr: "/api/v1/privacy/devnet/spr", policy: "/api/v1/privacy/devnet/policy", session: "/api/v1/privacy/devnet/session" });
  assert.deepEqual({ ...relayOf("mainnet") }, { rpc: "/api/v1/privacy/mainnet/rpc", spr: "/api/v1/privacy/mainnet/spr", policy: "/api/v1/privacy/mainnet/policy", session: "/api/v1/privacy/mainnet/session" });
  assert.equal(explorerUrl("tx", "S"), "https://explorer.solana.com/tx/S?cluster=devnet");
  assert.equal(explorerUrl("tx", "S", "mainnet"), "https://explorer.solana.com/tx/S", "mainnet is the explorer's own cluster");
  assert.equal(PRIVATE_BALANCE_CAP_USD, null, "no starting cap is set in code");
  assert.deepEqual([...DERIVE_FROM_WALLET], [], "no wallet is named as one that gives the keys until the owner's check passes it");
  assert.equal(RING_SOL, "11111111111111111111111111111111", "the ring names SOL by the system program, as the SDK's SOL_MINT");
  assert.ok(LINK_MIN_LAMPORTS >= 890_880n, "a link carries at least a fresh wallet's rent-exempt minimum");
});

test("the relay reaches Helius on its network only, with the key in the address, and passes the SDK's paths", () => {
  const rpc = upstreamUrl("rpc", [], "", "K");
  assert.equal(rpc.host, RELAY_HOST);
  assert.equal(RELAY_HOST, "devnet.helius-rpc.com");
  const main = upstreamUrl("rpc", [], "", "M", "mainnet");
  assert.equal(main.host, "mainnet.helius-rpc.com");
  assert.equal(main.searchParams.get("api-key"), "M");
  assert.equal(upstreamUrl("spr", ["attestation"], "", "M", "mainnet").href, "https://mainnet.helius-rpc.com/v1/spr/attestation?api-key=M");
  assert.equal(upstreamUrl("policy", [], "", "M", "mainnet").href, POLICY_URLS.mainnet);
  assert.match(POLICY_URLS.mainnet, /\/tee-policy\/mainnet\.json$/);
  assert.equal(upstreamUrl("rpc", [], "", "K", "testnet"), null, "no third network");
  assert.deepEqual(Object.keys(RELAY_HOSTS), ["devnet", "mainnet"]);
  for (const bad of ["testnet", "mainnet-beta", "__proto__", "constructor"]) assert.equal(upstreamUrl("rpc", [], "", "K", bad), null, bad);
  // The SDK bundle pins the same two policy addresses the relay hands over.
  const bundle = read("public/privacy/spr-0.9.0-alpha.mjs");
  for (const url of Object.values(POLICY_URLS)) assert.ok(bundle.includes(url), url);
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
  assert.equal(upstreamUrl("rpc", [], "", "", "mainnet"), null, "no mainnet key — no mainnet relay");
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

test("the relay route is shut without the flag and the network's server key, and never logs or keeps a body", () => {
  const route = read("app/api/v1/privacy/[network]/[target]/[[...path]]/route.ts");
  // The route is the door: the served network and its key; the call itself is decided in the handler.
  const handler = read("lib/privacy/relay-handler.server.ts");
  assert.match(route, /const served = servedNetwork\(asked\);\n  if \(!served\) return new NextResponse\(null, \{ status: 404 \}\)/);
  assert.match(route, /relayCall\(request, \{ network: served\.network, key: served\.key, target, path \}/, "the handler gets the served network and its key only");
  assert.match(handler, /upstreamUrl\(target, \[\.\.\.path\], self\.search, key, network\)/, "the upstream is the served network's");
  for (const [name, source] of [["route", route], ["handler", handler]]) {
    assert.doesNotMatch(source, /console\.|NEXT_PUBLIC_HELIUS|process\.env/, name);
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /mainnet/i, `${name}: the code names no network: the switch and the key decide`);
  }
  assert.ok(handler.indexOf("request.headers.get('content-length')") < handler.indexOf("await request.arrayBuffer()"), "the size is checked before the body is read");
  assert.match(handler, /bytes\.byteLength > MAX_ANSWER_BYTES/, "the answer has a ceiling");
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
  assert.deepEqual(exposureOf("send"), { who: "seen", to: "seen", amount: "hidden" }, "a transfer shows both addresses and hides the amount");
  assert.deepEqual(exposureOf("hide"), { who: "seen", to: "none", amount: "seen" }, "a deposit shows who and how much");
  assert.deepEqual(exposureOf("return"), { who: "none", to: "seen", amount: "seen" }, "a withdrawal shows to whom and how much");
  assert.deepEqual(exposureOf("link"), { who: "seen", to: "ifWallet", amount: "ifWallet" }, "the public top-up ties the link to the sender");
  assert.deepEqual(exposureOf("claimWallet"), { who: "seen", to: "seen", amount: "seen" }, "sender, link and wallet read from the chain");
  assert.deepEqual(exposureOf("claimPrivate"), { who: "seen", to: "seen", amount: "hidden" });
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

test("the wallet check reads what a wallet declares and says yes only when both key request signatures agree", () => {
  assert.deepEqual(declaredVersions({ supportedTransactionVersions: ["legacy", 0, 1] }), ["legacy", "0", "1"]);
  assert.equal(declaredVersions({}), null);
  assert.equal(signsV1(["legacy", "0"]), "no");
  assert.equal(signsV1(["legacy", "0", "1"]), "yes");
  assert.equal(signsV1(null), "unknown");
  assert.equal(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])), "yes");
  assert.equal(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3])), "no");
  assert.equal(sameBytes(null, new Uint8Array([1])), "unknown");
  const base = { wallet: "W", address: OWNER, device: "desktop", versions: ["legacy", "0"], signMessage: true, v1: { signed: "unknown", messageKept: "unknown", valid: "unknown", landed: null, refused: null }, registry: "unread" };
  assert.equal(derivationFit({ ...base, keys: { sameBytes: "yes", valid: "yes", repeatable: "yes", refused: null } }), "yes");
  assert.equal(derivationFit({ ...base, keys: { sameBytes: "yes", valid: "yes", repeatable: "no", refused: null } }), "no");
  assert.equal(derivationFit({ ...base, keys: { sameBytes: "yes", valid: "yes", repeatable: "unknown", refused: null } }), "unknown");
  const text = reportText({ ...base, keys: { sameBytes: "yes", valid: "yes", repeatable: "no", refused: null } }, new Date("2026-11-18T00:00:00Z"));
  assert.match(text, /two key request signatures equal: no/);
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

/** Where the network is decided: the switch, the relay's table, the server's keys. Every other file follows `PRIVATE_NET`. */
const NAMES_MAINNET = new Set(["lib/privacy/network.ts", "lib/privacy/relay.ts", "lib/privacy/relay-key.server.ts", "lib/privacy/check.ts"]);
/** The one file that names the relay's keys — on the server only. */
const NAMES_KEYS = new Set(["lib/privacy/relay-key.server.ts"]);

test("Ryntra Private keeps no key in the browser and names mainnet only where the network is decided", () => {
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
  for (const path of NAMES_MAINNET) assert.ok(files.includes(path), path);
  // The server's keys never reach a page: their file is server-only by name and no browser module imports it.
  for (const path of files.filter((f) => !f.endsWith(".server.ts"))) assert.doesNotMatch(read(path).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /relay-key\.server|relay-limit\.server/, path);
  for (const path of files) {
    const source = read(path).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    if (!NAMES_KEYS.has(path)) assert.doesNotMatch(source, /HELIUS_[A-Z_]*API_KEY|api-key=/, `${path}: the key lives in the relay only`);
    if (!NAMES_MAINNET.has(path)) assert.doesNotMatch(source, /mainnet/i, `${path}: follows the build's network, names none`);
    assert.doesNotMatch(source, /localStorage|sessionStorage/, `${path}: secrets go to the sealed vault, not plain storage`);
    assert.doesNotMatch(source, /fetch\(\s*['"`]\/api\/(?!v1\/privacy)/, `${path}: no key goes to another Ryntra route`);
  }
  // Keys come from the wallet only (`keys.test.mjs`): «Turn on» makes and seals no keys of its own, reads the
  // registry before it writes. A failed read never turns a landed step into a refusal.
  const store = read("lib/privacy/usePrivate.ts");
  const on = store.slice(store.indexOf("turnOn: async"), store.indexOf("unlock: async"));
  assert.doesNotMatch(on, /makeSecrets|seal\(/);
  assert.ok(on.indexOf("readRecord(") < on.indexOf("await enable(ctx, signer(), keys)"));
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
