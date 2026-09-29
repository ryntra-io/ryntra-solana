// Run from repo root: node --test lib/stellar/wallets/wallets.test.mjs
//
// The wallet layer's job is to be the only place a wallet package exists, to
// tell the truth about which network is connected, and to refuse a signature
// when that truth says it must. These guard those three things.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { StellarWalletError, isUserDecision } from "./adapter.ts";
import { mockWallet } from "./mock.ts";
import { STELLAR_WALLETS, networkMatches, resolveState, supports, walletEntry } from "./registry.ts";
import {
  SIGNING_BLOCKED_STATES,
  STELLAR_WALLET_STATES,
  WALLET_COPY,
  canRequestSignature,
  isUserDecisionState,
  stateForError,
} from "./states.ts";
import { STELLAR_MAINNET, STELLAR_TESTNET } from "../network.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");

// ------------------------------------------------------------- contract --

test("the mock satisfies the adapter contract, so the contract is exercisable without a wallet", async () => {
  const wallet = mockWallet();
  for (const method of ["isAvailable", "connect", "getAddress", "getNetwork", "signTransaction", "disconnect"]) {
    assert.equal(typeof wallet[method], "function", `${method} is missing from the contract`);
  }
  assert.equal(await wallet.isAvailable(), true);

  const connection = await wallet.connect();
  assert.match(connection.address, /^G[A-Z2-7]{55}$/, "an address must be a Stellar account id");
  assert.equal(connection.networkPassphrase, STELLAR_TESTNET.passphrase);

  assert.ok(supports(wallet, "SIGN_TRANSACTION"));
  assert.ok(!supports(wallet, "SIGN_MESSAGE"), "a capability must not be assumed when it is not declared");
});

test("a mock signature is marked, so it can never be mistaken for a real one", async () => {
  const signed = await mockWallet().signTransaction({
    unsignedXdr: "AAAA",
    address: "G",
    networkPassphrase: STELLAR_TESTNET.passphrase,
  });
  assert.match(signed.signedXdr, /^MOCK_SIGNED:/);
});

test("a refusal is a typed error, and a user's decision is not a failure", async () => {
  await assert.rejects(
    () => mockWallet({ failWith: "SIGNATURE_REJECTED" }).signTransaction({
      unsignedXdr: "AAAA",
      address: "G",
      networkPassphrase: STELLAR_TESTNET.passphrase,
    }),
    (error) => {
      assert.ok(error instanceof StellarWalletError);
      assert.equal(error.code, "SIGNATURE_REJECTED");
      assert.equal(isUserDecision(error), true, "a rejected signature is a decision, not a fault");
      return true;
    },
  );

  assert.equal(isUserDecision(new StellarWalletError("UNAVAILABLE", "x")), false);
  assert.equal(isUserDecision(new Error("x")), false);
});

test("a caller's own timeout is provable, because the mock can hang forever", async () => {
  /* The real package's `requestAccess` never settles with no extension
     installed. A test that cannot reproduce a hang cannot prove the timeout
     that contains it. */
  const hung = mockWallet({ hang: true }).connect();
  const raced = await Promise.race([
    hung.then(() => "settled"),
    new Promise((r) => setTimeout(() => r("timed out"), 40)),
  ]);
  assert.equal(raced, "timed out");
});

// --------------------------------------------------------- network guard --

test("the network guard compares passphrases, never names", () => {
  /* A wallet on mainnet will sign a testnet transaction without complaint and
     the signature will be valid — over the wrong network. Names are labels;
     the passphrase is what the signature is computed over. */
  const impostor = { network: "TESTNET", networkPassphrase: STELLAR_MAINNET.passphrase };
  assert.equal(
    networkMatches(impostor, STELLAR_TESTNET),
    false,
    "a wallet calling mainnet TESTNET must not pass a testnet guard",
  );

  const renamed = { network: "something else entirely", networkPassphrase: STELLAR_TESTNET.passphrase };
  assert.equal(networkMatches(renamed, STELLAR_TESTNET), true, "the name is not the identity");

  assert.equal(networkMatches(null, STELLAR_TESTNET), false, "no network is never a match");
});

test("the state is resolved from facts, and the wrong network blocks a signature", () => {
  const on = { network: "TESTNET", networkPassphrase: STELLAR_TESTNET.passphrase };
  const off = { network: "PUBLIC", networkPassphrase: STELLAR_MAINNET.passphrase };
  const base = { installed: true, address: "GABC", walletNetwork: on, expected: STELLAR_TESTNET };

  assert.equal(resolveState({ ...base, installed: false, address: null, walletNetwork: null }), "NOT_INSTALLED");
  assert.equal(resolveState({ ...base, address: null, walletNetwork: null }), "AVAILABLE");
  assert.equal(resolveState({ ...base, busy: "connecting" }), "CONNECTING");
  assert.equal(resolveState({ ...base, busy: "signing" }), "SIGNING");
  assert.equal(resolveState({ ...base, walletNetwork: off }), "WRONG_NETWORK");
  assert.equal(resolveState(base), "CONNECTED");

  assert.equal(canRequestSignature("WRONG_NETWORK"), false, "the whole point of the guard");
  assert.equal(canRequestSignature("NOT_INSTALLED"), false);
  assert.equal(canRequestSignature("CONNECTED"), true);
});

test("every state has copy, and a user's decision is never phrased as a fault", () => {
  for (const state of STELLAR_WALLET_STATES) {
    const copy = WALLET_COPY[state];
    assert.ok(copy, `${state} has no copy, so it would render as nothing`);
    assert.ok(copy.title.length > 0 && copy.body.length > 0, `${state} has empty copy`);
  }

  for (const state of ["ACCESS_DENIED", "SIGNATURE_REJECTED"]) {
    assert.equal(isUserDecisionState(state), true);
    assert.doesNotMatch(
      `${WALLET_COPY[state].title} ${WALLET_COPY[state].body}`,
      /\b(error|failed|failure)\b/i,
      `${state} reads as a system failure; it is a person deciding`,
    );
  }

  /* Signing must not be reachable from a state that cannot honestly support it,
     and the list must stay a subset of the states that exist. */
  for (const blocked of SIGNING_BLOCKED_STATES) {
    assert.ok(STELLAR_WALLET_STATES.includes(blocked), `${blocked} is not a state`);
  }

  assert.equal(stateForError("NOT_INSTALLED"), "NOT_INSTALLED");
  assert.equal(stateForError("TIMEOUT"), "UNAVAILABLE", "a silent wallet is unavailable, not a rejection");
  assert.equal(stateForError("SIGNATURE_REJECTED"), "SIGNATURE_REJECTED");
});

// -------------------------------------------------------------- registry --

test("the registry loads a wallet on demand and refuses one it does not know", () => {
  assert.ok(STELLAR_WALLETS.length >= 1);
  const freighter = walletEntry("freighter");
  assert.equal(typeof freighter.load, "function", "an adapter must be loadable on demand, not imported eagerly");
  assert.match(freighter.installUrl, /^https:\/\//);
  assert.throws(() => walletEntry("nope"), /Unknown Stellar wallet/);
});

// -------------------------------------------------------------- boundary --

/**
 * A file's code, with its prose removed.
 *
 * More than once a source-shape assertion has matched a comment
 * *explaining* the defect instead of the defect. Here the doc comment names
 * `requestAccess()` and `getNetwork()` while describing the hang they cause, so
 * an unstripped search finds them far from any timeout and fails a file that is
 * entirely correct. Strip first, always.
 */
const code = (path) =>
  readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every source file under a directory, recursively. */
function sources(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

test("exactly one file imports the wallet package, and it loads it dynamically", () => {
  /*
   * The contract's whole value is that a wallet library cannot reach the
   * policy engine, the passport, a receipt or reconciliation. That is only true
   * while this stays true.
   *
   * The dynamic import is not style: a static one would put the package in the
   * bundle of every page that never connects a wallet, including the public
   * read surface.
   */
  const importers = [];
  for (const file of [...sources(join(REPO, "lib")), ...sources(join(REPO, "app"))]) {
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    if (/["']@stellar\/freighter-api["']/.test(source)) importers.push(file);
  }

  assert.deepEqual(
    importers.map((file) => file.slice(REPO.length + 1).replace(/\\/g, "/")),
    ["lib/stellar/wallets/freighter.client.ts"],
    "the wallet package must exist in exactly one file",
  );

  const adapter = code(join(HERE, "freighter.client.ts"));
  assert.match(adapter, /\bimport\("@stellar\/freighter-api"\)/, "the package must be loaded on demand");
  assert.doesNotMatch(
    adapter,
    /^import .*@stellar\/freighter-api/m,
    "a static import would ship the package to every page",
  );
  assert.doesNotMatch(adapter, /"use server"/);
});

test("the wallet layer never reaches evidence, policy, passport or receipts", () => {
  for (const file of sources(HERE)) {
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(
      source,
      /from ["'][^"']*(passport|evidence|reads)\.ts["']/,
      `${file} reaches into the evidence layer; the wallet contract must stay below it`,
    );
  }
});

test("every wallet call is bounded, because the package hangs forever without the extension", () => {
  /*
   * `@stellar/freighter-api` applies its own two-second timeout to exactly two
   * message types. `requestAccess`, `getNetwork` and every signing method are
   * not among them: with no extension installed those promises never settle —
   * not a rejection, an `await` that never returns.
   *
   * So every call goes through `withTimeout`, and every unprotected one is also
   * gated behind an availability check. This asserts both, because losing
   * either reintroduces a hang that looks exactly like a slow network.
   */
  const adapter = code(join(HERE, "freighter.client.ts"));

  /* Each package call must be the first argument of `withTimeout`, asserted
     exactly rather than by proximity. A window-based check passed here by luck
     — it matched the `withTimeout` belonging to the *previous* method — and
     failed on `signAuthEntry` only because the method declaration shares its
     name with the call. Proximity is not a relationship. */
  for (const call of ["isConnected", "requestAccess", "getAddress", "getNetwork", "signTransaction", "signAuthEntry"]) {
    assert.match(
      adapter,
      new RegExp(`withTimeout\\(\\s*${call}\\(`),
      `${call} is called outside a timeout; with no extension installed that promise never settles`,
    );
  }

  const guarded = adapter.match(/await requireExtension\(\);/g) ?? [];
  assert.ok(guarded.length >= 5, `every entry point must gate on availability; found ${guarded.length}`);

  assert.match(adapter, /Promise\.race/, "the timeout must actually race the call");
});

test("the network the wallet is held to is the network the signing surface builds for", () => {
  /*
   * The inverted guard, as a test.
   *
   * The provider held the wallet to a hard-coded `STELLAR_MAINNET` while the
   * only surface that signs — `/authorize` — builds on `STELLAR_TESTNET`. Both
   * halves of that were wrong in the worst possible direction: a wallet on
   * mainnet passed the check and produced a signature the comparison had to
   * reject *after* a person approved it in Freighter, and a wallet correctly on
   * testnet was shown "Wrong Stellar network" and blocked from signing the
   * transaction the page had just built for it.
   *
   * `states.ts` warns about exactly this in prose — "a wallet pointed at
   * mainnet will happily sign a transaction built for testnet" — one file away
   * from where it was being enforced backwards. Prose is not a gate.
   */
  const repo = resolve(HERE, "..", "..", "..");
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const shell = strip(readFileSync(join(repo, "app", "stellar", "workspace", "hub", "shell.tsx"), "utf8"));
  const console_ = strip(readFileSync(join(repo, "app", "stellar", "workspace", "send", "send-console.tsx"), "utf8"));
  const provider = strip(
    readFileSync(join(repo, "app", "stellar", "components", "stellar-wallet-provider.tsx"), "utf8"),
  );

  const mounted = shell.match(/<StellarWalletProvider\s+expected=\{(STELLAR_\w+)\}/);
  assert.ok(mounted, "the shell must declare which network the wallet is held to, as a prop.");

  const signing = console_.match(/const NETWORK\s*=\s*(STELLAR_\w+)/);
  assert.ok(signing, "the Send console must name the network it builds on.");

  assert.equal(
    mounted[1],
    signing[1],
    `The wallet is held to ${mounted[1]} while the signing surface builds on ${signing[1]}. ` +
      `One of those rejects the correct wallet; the other admits the wrong one.`,
  );

  /* And the provider must not reintroduce a default. A fallback here is the
     same constant by another name, silently wrong at whichever surface did not
     pass the prop. */
  assert.doesNotMatch(
    provider,
    /expected\s*=\s*STELLAR_\w+/,
    "the provider must take the expected network from its mount, never default to one.",
  );
});
