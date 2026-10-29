import assert from "node:assert/strict";
import test from "node:test";

import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { getAddressDecoder } from "@solana/kit";
import { privateKeyToAccount } from "viem/accounts";

import { createMemoryGuardStore } from "../guard/store.ts";
import { buildWalletLinkFields, parseWalletLinkMessage, verifyWalletLink, walletLinkMessage, walletLinkNonceContext } from "./wallet-link.ts";
import { linkedWallets, linkWallets } from "./wallet-link-store.ts";

const SITE = { domain: "ryntra.io", uri: "https://ryntra.io" };
const NONCE = "A1b2C3d4E5f6G7h8I9j0K1l2";
const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const evmAccount = privateKeyToAccount(`0x${"11".repeat(32)}`);
const otherEvm = privateKeyToAccount(`0x${"22".repeat(32)}`);

async function solanaWallet() {
  const secret = utils.randomSecretKey ? utils.randomSecretKey() : utils.randomPrivateKey();
  const publicKey = await getPublicKeyAsync(secret);
  return { secret, address: getAddressDecoder().decode(publicKey) };
}

/** Both wallets sign the server's message; `issued` says which pair the nonce was minted for. */
async function signed({ solana, evm = evmAccount, signer = evm, now = NOW } = {}) {
  const message = walletLinkMessage(buildWalletLinkFields({ ...SITE, solana: solana.address, evm: evm.address, nonce: NONCE, now }));
  const solanaSignature = Buffer.from(await signAsync(new TextEncoder().encode(message), solana.secret)).toString("base64");
  const evmSignature = await signer.signMessage({ message });
  return { message, solanaSignature, evmSignature };
}

const issuedFor = (solana, evm) => (nonce, context) => nonce === NONCE && context === walletLinkNonceContext(solana, evm);

test("a link both wallets signed verifies; the message is the server's words and nothing else", async () => {
  const solana = await solanaWallet();
  const input = await signed({ solana });
  const verified = await verifyWalletLink({ ...input, expected: SITE, nonceIssuedHere: issuedFor(solana.address, evmAccount.address), now: NOW + 1_000 });
  assert.deepEqual(verified, { ok: true, solana: solana.address, evm: evmAccount.address.toLowerCase(), issuedAt: "2026-10-15T12:00:00.000Z" });
  assert.match(input.message, /^ryntra\.io wants you to sign in with your Ethereum account:/, "an EIP-4361 message: EVM wallets check the asking page against its domain");
  assert.ok(input.message.includes(`to the Solana wallet ${solana.address} as one partner of Ryntra. This authorizes no transaction and moves no funds.`));
  assert.notEqual(parseWalletLinkMessage(input.message), null);
  assert.equal(parseWalletLinkMessage(`${input.message}\nResources:\n- https://x.example`), null, "an extra line is not the server's message");
  assert.equal(parseWalletLinkMessage(input.message.replace("Chain ID: 1", "Chain ID: 5")), null);
});

test("a wrong signature, another site, a foreign nonce or an old message is refused", async () => {
  const solana = await solanaWallet();
  const stranger = await solanaWallet();
  const nonceIssuedHere = issuedFor(solana.address, evmAccount.address);
  const good = await signed({ solana });

  const byOtherEvm = await signed({ solana, signer: otherEvm });
  assert.deepEqual(await verifyWalletLink({ ...byOtherEvm, expected: SITE, nonceIssuedHere, now: NOW }), { ok: false, reason: "evm_signature" });
  const byOtherSolana = await signed({ solana: { ...stranger, address: solana.address } });
  assert.deepEqual(await verifyWalletLink({ ...byOtherSolana, expected: SITE, nonceIssuedHere, now: NOW }), { ok: false, reason: "solana_signature" });
  assert.deepEqual(await verifyWalletLink({ ...good, expected: { domain: "evil.example", uri: "https://evil.example" }, nonceIssuedHere, now: NOW }), { ok: false, reason: "domain" });
  assert.deepEqual(await verifyWalletLink({ ...good, expected: SITE, nonceIssuedHere: issuedFor(stranger.address, evmAccount.address), now: NOW }), { ok: false, reason: "nonce" });
  assert.deepEqual(await verifyWalletLink({ ...good, expected: SITE, nonceIssuedHere, now: NOW + 11 * 60_000 }), { ok: false, reason: "expired" });
  assert.deepEqual(await verifyWalletLink({ ...good, expected: { ...SITE, uri: "https://ryntra.io.evil.example" }, nonceIssuedHere, now: NOW }), { ok: false, reason: "uri" });
  const ahead = await signed({ solana, now: NOW + 5 * 60_000 });
  assert.deepEqual(await verifyWalletLink({ ...ahead, expected: SITE, nonceIssuedHere, now: NOW }), { ok: false, reason: "issued_at" }, "a message dated ahead of the server's clock is not a fresh one");
  const tampered = good.message.replace(`Solana wallet ${solana.address}`, `Solana wallet ${stranger.address}`);
  assert.deepEqual(await verifyWalletLink({ ...good, message: tampered, expected: SITE, nonceIssuedHere: issuedFor(stranger.address, evmAccount.address), now: NOW }), { ok: false, reason: "solana_signature" });
});

test("a link is written for both wallets at once; a replay changes nothing; a newer link both wallets signed replaces the older, the history keeps both", async () => {
  const store = createMemoryGuardStore();
  const solana = (await solanaWallet()).address;
  const second = (await solanaWallet()).address;
  const evm = evmAccount.address;
  const at = "2026-10-15T12:00:00.000Z";

  const first = await linkWallets(store, { solana, evm, signedAt: at, now: at });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.deepEqual(await linkedWallets(store, "solana", solana), { linked: [evm.toLowerCase()], unavailable: false });
  assert.deepEqual(await linkedWallets(store, "evm", evm.toUpperCase().replace("0X", "0x")), { linked: [solana], unavailable: false });

  const replay = await linkWallets(store, { solana, evm, signedAt: at, now: "2026-10-15T13:00:00.000Z" });
  assert.equal(replay.created, false);
  assert.equal(replay.link.linkedAt, at);

  const later = "2026-10-15T14:00:00.000Z";
  const moved = await linkWallets(store, { solana, evm: otherEvm.address, signedAt: later, now: later });
  assert.deepEqual(moved.replaced, { evm: evm.toLowerCase(), solana: null });
  assert.deepEqual(await linkedWallets(store, "solana", solana), { linked: [otherEvm.address.toLowerCase()], unavailable: false });
  assert.deepEqual(await linkedWallets(store, "evm", evm), { linked: [], unavailable: false }, "the half left behind links nothing");

  const latest = "2026-10-15T15:00:00.000Z";
  const back = await linkWallets(store, { solana: second, evm: otherEvm.address, signedAt: latest, now: latest });
  assert.deepEqual(back.replaced, { evm: null, solana });
  assert.deepEqual(await linkedWallets(store, "solana", solana), { linked: [], unavailable: false });
  assert.deepEqual(await linkedWallets(store, "solana", second), { linked: [otherEvm.address.toLowerCase()], unavailable: false });
  /* A message signed before the link it would replace — replayed within its expiry — never wins. */
  assert.deepEqual(await linkWallets(store, { solana: second, evm, signedAt: later, now: "2026-10-15T15:05:00.000Z" }), { ok: false, code: "STALE" });
  const history = await store.collection("growthWalletLinks").valuesWithPrefix(`history:${solana}:`);
  assert.equal(history.length, 2, "every link written is kept");
  const { everLinked } = await import("./wallet-link-store.ts");
  assert.deepEqual(new Set((await everLinked(store, "evm", otherEvm.address)).linked), new Set([solana, second]), "both Solana wallets this EVM wallet was ever linked to");
});

test("half a link links nothing", async () => {
  const store = createMemoryGuardStore();
  const solana = (await solanaWallet()).address;
  await store.collection("growthWalletLinks").insertIfAbsent(`solana:${solana}`, { schema: 1, solana, evm: otherEvm.address.toLowerCase(), linkedAt: "2026-10-15T12:00:00.000Z", signedAt: "2026-10-15T12:00:00.000Z", version: 1 });
  assert.deepEqual(await linkedWallets(store, "solana", solana), { linked: [], unavailable: false });
});
