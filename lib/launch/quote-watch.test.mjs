// SOL-L12: the pair-currency watch. A badge Meteora gives a quote token does not bind its issuer, so every pair Launch
// trades against is read from its mint on each pass and held against the profile first read: a change marks the
// market's page, writes the creator of each market on that pair one note, and pauses new launches on it — until the mint
// reads as before or the operator accepts the change. USDC is mainnet's bytes (`../solana/fixtures/usdc-spl.json`, read
// 17.08); the Token-2022 pairs are laid out by spl-token's own layouts (`../solana/fixtures/token-2022-mints.mjs`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ExtensionType } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";

import { ADVANCED_DEFAULT_CHOICE } from "../core/launch/advanced.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { listInbox } from "../monitoring/store.ts";
import { mintProfileChanges, mintProfileOf } from "../solana/mint-profile.ts";
import { ISSUER, OTHER, fee, token2022Mint, transferFee } from "../solana/fixtures/token-2022-mints.mjs";
import { prepareAdvancedConfig } from "./advanced.server.ts";
import { launchNetwork } from "./config.server.ts";
import { creatorNoteWords } from "./creator-notes.server.ts";
import { prepareLaunch } from "./flow.server.ts";
import { storeLaunchMetadata } from "./metadata.server.ts";
import { QUOTE_ACCEPTED_ENV, acceptedFingerprints, mintFingerprint, networkQuotes, nextQuoteWatch, pairWatchView, quotePaused, readQuoteWatch, runQuoteWatch } from "./quote-watch.server.ts";
import { LAUNCH_FAILURE_CODES, launchFailureCode } from "./runtime.server.ts";

const fixture = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PAIR = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
const usdcAugust = fixture("../solana/fixtures/usdc-spl.json");
const bytes = (row) => ({ owner: new PublicKey(row.owner), data: Buffer.from(row.dataBase64 ?? row.data, "base64"), lamports: 1, executable: false });
const at = (iso) => ({ cluster: "mainnet", mint: PAIR, symbol: "PAIR", now: iso, accepted: new Set() });

test("SOL-L12: USDC's mint read as mainnet holds it — the classic program and its two authorities; more supply is no change", () => {
  const august = mintProfileOf(USDC, bytes(usdcAugust));
  assert.equal(august.program, "spl-token");
  assert.equal(august.decimals, 6);
  assert.equal(august.mintAuthority, "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG", "Circle can still mint USDC");
  assert.equal(august.freezeAuthority, "7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar", "and freeze an account");
  assert.deepEqual(august.extensions, [], "the classic program has no extensions");
  assert.equal(august.transferFee, null);
  /* The same mint with a billion more in supply (bytes 36–43): the issuer minted, nothing it can do changed. */
  const minted = bytes(usdcAugust);
  minted.data.writeBigUInt64LE(minted.data.readBigUInt64LE(36) + 1_000_000_000_000_000n, 36);
  assert.deepEqual(mintProfileChanges(august, mintProfileOf(USDC, minted)), []);
  assert.equal(mintFingerprint(august), mintFingerprint(mintProfileOf(USDC, minted)));
  /* Its freeze authority handed to another key is a change. */
  const handed = bytes(usdcAugust);
  OTHER.toBuffer().copy(handed.data, 50);
  assert.deepEqual(mintProfileChanges(august, mintProfileOf(USDC, handed)), ["freezeAuthority"]);
});

test("SOL-L12: a Token-2022 pair's profile names every extension that acts on holders, and a change names its field", () => {
  const plain = mintProfileOf(PAIR, token2022Mint({ extensions: transferFee() }));
  assert.equal(plain.program, "token-2022");
  assert.deepEqual(plain.extensions, [String(ExtensionType.TransferFeeConfig)], "by the program's type numbers");
  assert.deepEqual(plain.transferFee?.older, { epoch: "0", bps: 0, maxRaw: "0" });
  /* The issuer schedules a 1 % fee from epoch 900: caught the pass it is set, before it is in force. */
  const scheduled = mintProfileOf(PAIR, token2022Mint({ extensions: transferFee({ newer: fee(900, 100) }) }));
  assert.deepEqual(mintProfileChanges(plain, scheduled), ["transferFee"]);
  const handedOver = mintProfileOf(PAIR, token2022Mint({ extensions: transferFee({ authority: OTHER }) }));
  assert.deepEqual(mintProfileChanges(plain, handedOver), ["transferFeeAuthority"]);
  /* A badge does not stop the issuer from adding power over every holder. */
  const every = mintProfileOf(
    PAIR,
    token2022Mint({
      freezeAuthority: ISSUER,
      extensions: {
        ...transferFee(),
        [ExtensionType.PermanentDelegate]: { delegate: OTHER },
        [ExtensionType.DefaultAccountState]: { state: 2 },
        [ExtensionType.TransferHook]: { authority: ISSUER, programId: OTHER },
        [ExtensionType.MintCloseAuthority]: { closeAuthority: ISSUER },
        [ExtensionType.PausableConfig]: { authority: ISSUER, paused: true },
      },
    }),
  );
  assert.equal(every.permanentDelegate, OTHER.toBase58());
  assert.equal(every.defaultAccountState, "frozen");
  assert.deepEqual(every.transferHook, { authority: ISSUER.toBase58(), program: OTHER.toBase58() });
  assert.deepEqual(every.pausable, { authority: ISSUER.toBase58(), paused: true });
  assert.deepEqual(mintProfileChanges(plain, every), ["freezeAuthority", "extensions", "permanentDelegate", "defaultAccountState", "transferHook", "closeAuthority", "pausable"]);
  /* A mint no longer there is a change like any other — the strongest one. */
  assert.deepEqual(mintProfileChanges(plain, mintProfileOf(PAIR, null)).slice(0, 2), ["program", "decimals"]);
  assert.equal(mintProfileOf(PAIR, { owner: OTHER, data: Buffer.alloc(82) }).program, "other");
});

test("SOL-L12: the watch — the first read is the baseline; a change holds its time until it reads as before or is accepted; a read that failed changes nothing", () => {
  const plain = mintProfileOf(PAIR, token2022Mint({ extensions: transferFee() }));
  const scheduled = mintProfileOf(PAIR, token2022Mint({ extensions: transferFee({ newer: fee(900, 100) }) }));
  assert.equal(nextQuoteWatch(null, null, at("2026-10-25T10:00:00.000Z")), null, "nothing known, nothing written");
  const first = nextQuoteWatch(null, plain, at("2026-10-25T10:00:00.000Z"));
  assert.equal(first.state, "OK");
  assert.equal(first.baselineAt, "2026-10-25T10:00:00.000Z");
  const same = nextQuoteWatch(first, plain, at("2026-10-25T10:10:00.000Z"));
  assert.equal(same.state, "OK");
  assert.equal(same.baselineAt, "2026-10-25T10:00:00.000Z", "the baseline keeps its time");
  const changed = nextQuoteWatch(same, scheduled, at("2026-10-25T10:20:00.000Z"));
  assert.equal(changed.state, "CHANGED");
  assert.deepEqual(changed.changes, ["transferFee"]);
  assert.equal(changed.changedAt, "2026-10-25T10:20:00.000Z");
  const again = nextQuoteWatch(changed, scheduled, at("2026-10-25T10:30:00.000Z"));
  assert.equal(again.changedAt, "2026-10-25T10:20:00.000Z", "the same change keeps the time it was first read");
  const unread = nextQuoteWatch(again, null, at("2026-10-25T10:40:00.000Z"));
  assert.equal(unread.state, "CHANGED", "not read is not «as before»");
  assert.equal(unread.unreadSince, "2026-10-25T10:40:00.000Z");
  assert.equal(unread.checkedAt, "2026-10-25T10:30:00.000Z");
  const reverted = nextQuoteWatch(unread, plain, at("2026-10-25T10:50:00.000Z"));
  assert.equal(reverted.state, "OK", "the issuer put it back");
  assert.equal(reverted.changedAt, null);
  assert.equal(reverted.unreadSince, null);
  /* The operator accepts the new profile by its fingerprint: it is the baseline from then on. */
  const accepted = acceptedFingerprints({ [QUOTE_ACCEPTED_ENV]: ` ${PAIR}:${mintFingerprint(scheduled)} , junk, ${USDC}:nothex` });
  assert.deepEqual([...accepted], [`${PAIR}:${mintFingerprint(scheduled)}`]);
  const taken = nextQuoteWatch(changed, scheduled, { ...at("2026-10-25T11:00:00.000Z"), accepted });
  assert.equal(taken.state, "OK");
  assert.equal(taken.baselineFingerprint, mintFingerprint(scheduled));
  assert.equal(taken.baselineAt, "2026-10-25T11:00:00.000Z");
  assert.deepEqual(pairWatchView(changed), { mint: PAIR, symbol: "PAIR", state: "CHANGED", changes: ["transferFee"], since: "2026-10-25T10:20:00.000Z", checkedAt: "2026-10-25T10:20:00.000Z" });
  assert.equal(pairWatchView(null), null);
});

/** The stand with USDC on its presets and one Token-2022 community pair. */
function stand() {
  const env = { RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io", RYNTRA_LAUNCH_COMMUNITY_CONFIGS: JSON.stringify([{ config: Keypair.generate().publicKey.toBase58(), mint: PAIR, symbol: "PAIR", decimals: 6, usdPrice: 1 }]) };
  return launchNetwork(env);
}

const launch = (token, creator, pairMint, preset) => ({
  cluster: "devnet",
  state: "LAUNCHED",
  token,
  pool: Keypair.generate().publicKey.toBase58(),
  config: Keypair.generate().publicKey.toBase58(),
  pairMint,
  preset,
  creator,
  name: "Stair",
  symbol: "STAIR",
  metadataUri: "https://ryntra.io/api/launch/metadata/x",
  signature: "sig",
  launchedAt: "2026-10-25T09:00:00.000Z",
});

test("SOL-L12: a pass reads every pair once; a changed pair writes each of its markets' creators one note, and none to markets on another pair", async () => {
  const network = stand();
  const quotes = networkQuotes(network);
  assert.ok(quotes.some((quote) => quote.mint === PAIR));
  assert.equal(new Set(quotes.map((quote) => quote.mint)).size, quotes.length, "each pair once");
  const store = createMemoryGuardStore();
  const onPair = [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()];
  const onUsdc = Keypair.generate().publicKey.toBase58();
  const usdcMint = network.pairs.classic.mint;
  const launches = store.collection("launches");
  for (const [index, creator] of onPair.entries()) {
    const token = Keypair.generate().publicKey.toBase58();
    await launches.set(`solana:devnet:${token}`, launch(token, creator, PAIR, "community"));
    if (index === 0) await launches.set(`solana:devnet:${Keypair.generate().publicKey.toBase58()}`, { ...launch(token, creator, PAIR, "community"), state: "PENDING" });
  }
  const usdcToken = Keypair.generate().publicKey.toBase58();
  await launches.set(`solana:devnet:${usdcToken}`, launch(usdcToken, onUsdc, usdcMint, "classic"));
  let pairAccount = token2022Mint({ extensions: transferFee() });
  let reads = 0;
  let answers = true;
  const connection = {
    async getMultipleAccountsInfo(keys) {
      reads += 1;
      if (!answers) throw new Error("429 Too Many Requests");
      return keys.map((key) => (key.toBase58() === PAIR ? pairAccount : bytes(usdcAugust)));
    },
  };
  let now = new Date("2026-10-25T10:00:00.000Z");
  const deps = { network, connection, store, now: () => now, env: {} };

  const first = await runQuoteWatch(deps);
  assert.equal(reads, 1, "every pair's mint in one read");
  assert.ok(first.every((step) => step.state === "OK" && step.notes === 0));
  assert.equal(await quotePaused(store, "devnet", PAIR), false);

  pairAccount = token2022Mint({ extensions: transferFee({ newer: fee(900, 250) }) });
  now = new Date("2026-10-25T10:10:00.000Z");
  const second = await runQuoteWatch(deps);
  const step = second.find((entry) => entry.mint === PAIR);
  assert.deepEqual({ state: step.state, changes: step.changes, notes: step.notes }, { state: "CHANGED", changes: ["transferFee"], notes: 2 });
  assert.equal(second.find((entry) => entry.mint === usdcMint).state, "OK");
  assert.equal(await quotePaused(store, "devnet", PAIR), true);
  assert.equal(await quotePaused(store, "devnet", usdcMint), false);
  for (const creator of onPair) {
    const inbox = await listInbox(store, creator);
    assert.equal(inbox.length, 1, "one note per market");
    assert.equal(inbox[0].text.en.title, "Pair token changed");
    assert.equal(inbox[0].text.uk.reason, "PAIR, пара $STAIR, змінив свої правила");
    assert.equal(inbox[0].subject.kind, "launch-creator");
  }
  assert.equal((await listInbox(store, onUsdc)).length, 0, "a market on another pair hears nothing");

  /* A node that answers with no account for the pair, or bytes that are not a mint: not read — no pause lifted or set, no note. */
  const kept = pairAccount;
  pairAccount = null;
  assert.equal((await runQuoteWatch(deps)).find((entry) => entry.mint === PAIR).state, "UNREAD");
  pairAccount = { owner: kept.owner, data: Buffer.alloc(10), lamports: 1, executable: false };
  assert.equal((await runQuoteWatch(deps)).find((entry) => entry.mint === PAIR).state, "UNREAD");
  pairAccount = kept;
  assert.equal(await quotePaused(store, "devnet", PAIR), true);
  /* The same change read again writes nothing again; a read that fails keeps the pause. */
  now = new Date("2026-10-25T10:20:00.000Z");
  assert.equal((await runQuoteWatch(deps)).find((entry) => entry.mint === PAIR).notes, 0);
  answers = false;
  const failed = await runQuoteWatch(deps);
  assert.ok(failed.every((entry) => entry.state === "UNREAD"));
  assert.equal(await quotePaused(store, "devnet", PAIR), true);
  answers = true;
  for (const creator of onPair) assert.equal((await listInbox(store, creator)).length, 1);

  /* The operator accepts it: launches on the pair open again, and the next change is a change of its own. */
  const watch = await readQuoteWatch(store, "devnet", PAIR);
  await runQuoteWatch({ ...deps, env: { [QUOTE_ACCEPTED_ENV]: `${PAIR}:${watch.fingerprint}` } });
  assert.equal(await quotePaused(store, "devnet", PAIR), false);
  pairAccount = token2022Mint({ extensions: { ...transferFee({ newer: fee(900, 250) }), [ExtensionType.PermanentDelegate]: { delegate: OTHER } } });
  await runQuoteWatch(deps);
  assert.deepEqual((await readQuoteWatch(store, "devnet", PAIR)).changes, ["extensions", "permanentDelegate"]);
  for (const creator of onPair) assert.equal((await listInbox(store, creator)).length, 2, "a new change, a new note");
});

test("SOL-L12: new launches on a changed pair wait — the launch and «Розширений»'s config — and say so in the contract's codes", async () => {
  const network = stand();
  const store = createMemoryGuardStore();
  const usdc = network.pairs.classic.mint;
  const changed = (mint, symbol) => {
    const before = nextQuoteWatch(null, mintProfileOf(mint, token2022Mint({ extensions: transferFee() })), { cluster: "devnet", mint, symbol, now: "2026-10-25T10:00:00.000Z", accepted: new Set() });
    return nextQuoteWatch(before, mintProfileOf(mint, token2022Mint({ extensions: transferFee({ newer: fee(900, 100) }) })), { cluster: "devnet", mint, symbol, now: "2026-10-25T10:10:00.000Z", accepted: new Set() });
  };
  await store.collection("launchQuoteWatch").set(`devnet:${usdc}`, changed(usdc, "USDC"));
  const node = { getAccountInfo: async () => null, getBalance: async () => 1_000_000_000 };
  const deps = { network, connection: node, store, poolPayer: Keypair.generate(), origin: "https://ryntra.io", now: () => new Date("2026-10-25T10:20:00.000Z"), env: { BETA_TOKEN_SECRET: "a-secret-of-thirty-two-characters!" } };
  const creator = Keypair.generate().publicKey.toBase58();
  const metadataUri = `https://ryntra.io/api/launch/metadata/${(await storeLaunchMetadata(store, { name: "Wide Owl", symbol: "WOWL", description: "", image: "https://ryntra.io/api/launch/image/x", createdOn: "https://ryntra.io" }, "t")).sha256}`;
  const refused = await prepareLaunch(deps, { creator, metadataUri, firstBuyRaw: "0", lock: null, preset: "classic" });
  assert.equal(refused.code, "QUOTE_PAUSED");
  assert.equal((await prepareAdvancedConfig(deps, { creator, choice: ADVANCED_DEFAULT_CHOICE })).code, "QUOTE_PAUSED", "no config rent paid for a launch that would wait");
  /* «Спільнота» on its own pair is not held by another pair's change. */
  const community = await prepareLaunch(deps, { creator, metadataUri, firstBuyRaw: "0", lock: null, preset: "community", pairMint: PAIR });
  assert.notEqual(community.code, "QUOTE_PAUSED");
  assert.equal(LAUNCH_FAILURE_CODES.QUOTE_PAUSED, "LAUNCH_QUOTE_PAUSED");
  const headers = (version) => new Headers(version ? { "X-Ryntra-API-Version": version } : {});
  assert.equal(launchFailureCode("QUOTE_PAUSED", headers("1.73.0")), "LAUNCH_QUOTE_PAUSED");
  assert.equal(launchFailureCode("QUOTE_PAUSED", headers("1.72.0")), "LAUNCH_PAUSED", "a client before 1.73.0 reads «nothing was sent»");
  assert.equal(launchFailureCode("QUOTE_PAUSED", headers(null)), "LAUNCH_PAUSED");
  assert.equal(launchFailureCode("NETWORK_BUSY", headers("1.73.0")), "LAUNCH_BUSY", "the older gate stands");
});

test("SOL-L12: the note names the pair and the token on one line a lock screen holds, never an amount", () => {
  const words = creatorNoteWords("quote", "ST<b>AIR", 0, "US$DC");
  assert.equal(words.en.reason, "USDC, the pair of $STbAIR, changed its rules");
  assert.equal(words.uk.title, "Змінився токен пари");
  assert.doesNotMatch(`${words.en.reason}${words.uk.reason}`, /\d/);
});
