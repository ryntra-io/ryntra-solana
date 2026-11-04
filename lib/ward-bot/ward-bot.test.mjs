/**
 * The pre-sign check's Telegram bot (CITY-166): a message in a chat → one line, through the real engine
 * (`lib/ward/check.ts`) on a chain that answers what it was told (`lib/ward/fixtures.mjs`). Then the brakes — what the
 * bot does not answer, how often it answers, what it says once past a limit — and the cleaning of foreign text.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { getBase58Decoder } from "@solana/kit";

import { checkRecipient } from "../solana/recipient-check.server.ts";
import { checkWardAddress } from "../ward/check.ts";
import * as f from "../ward/fixtures.mjs";
import { engineCheck, handleWardUpdate, WARD_BOT_CHECK_MS } from "./bot.ts";
import { cleanForeign, cleanIncoming } from "./clean.ts";
import { checkSubject, verdictLine } from "./engine.ts";
import { findSubject, subjectKey } from "./extract.ts";
import { WARD_BOT_LIMITS, WardBotGate } from "./limits.ts";
import { wardTelegram } from "./telegram.ts";
import { WARD_BOT_WORDS } from "./words.ts";

const SOL = 1_000_000_000n;
const T0 = Date.parse("2026-10-31T10:00:00.000Z");
const GROUP = { id: -100_123, type: "supergroup" };
const DM = { id: 42, type: "private" };
const ALICE = { id: 42, language_code: "en" };
const OKSANA = { id: 77, language_code: "uk" };

/** The transfer builder's own recipient classifier, on the fixture chain: a wallet or nothing is payable, anything else is not. */
function recipientOn(before) {
  return (to, mint, from) =>
    checkRecipient(
      {
        linkHosts: ["ryntra.io"],
        readLink: async () => null,
        linkIdByReference: async () => null,
        resolveNative: async (address) => {
          const state = before[address];
          if (state && state.owner !== f.SYSTEM) return { ok: false, code: "UNSAFE_SOL_RECIPIENT", reason: "owned by a program" };
          return { ok: true, kind: "WALLET_OWNER", owner: address, destinationTokenAccount: null, createsAccount: !state };
        },
        resolveToken: async () => ({ ok: false, code: "RECIPIENT_UNREADABLE", reason: "not in this test" }),
        tokenProgramOf: async () => ({ ok: false, unavailable: true }),
        now: () => new Date(T0),
      },
      { to, ...(mint ? { mint } : {}), ...(from ? { from } : {}) },
    );
}

/** A bot on the fixture chain with a clock the test moves, and every line it sends. */
function bot(chainArgs = {}, options = {}) {
  let now = options.now ?? T0;
  const before = chainArgs.before ?? {};
  const { reads, calls } = f.chain({ ...chainArgs, recipient: recipientOn(before) });
  const sent = [];
  const checks = [];
  const gate = new WardBotGate({ now: () => now });
  const real = engineCheck(() => (options.reads ? options.reads(reads) : reads));
  const deps = {
    send: async (reply) => {
      sent.push(reply);
      return {};
    },
    check: async (subject, known) => {
      checks.push({ subject, known });
      return options.check ? options.check(subject, known) : real(subject, known);
    },
    gate,
    username: async () => options.username ?? "RyntraCheckBot",
    now: () => now,
  };
  let update = 1;
  let messageId = 100;
  const say = (text, { chat = GROUP, from = ALICE, ...rest } = {}) =>
    handleWardUpdate({ update_id: update++, message: { message_id: messageId++, date: Math.floor(now / 1_000), chat, from, text, ...rest } }, deps);
  return {
    deps,
    sent,
    checks,
    calls,
    say,
    tick: (ms) => {
      now += ms;
    },
    last: () => sent.at(-1),
  };
}

/* ---------------------------------------------------------------- message → verdict */

test("a CA pasted in a group: a plain mint answers «No known blockers», with the reading that did not happen counted", async () => {
  const mint = await f.wallet();
  const b = bot({ before: { [mint]: f.mintState({ decimals: 6 }) } });
  const result = await b.say(`new gem 🚀 CA: ${mint} — buy now`);
  assert.equal(result.why, "verdict:allow");
  assert.equal(b.sent.length, 1);
  const reply = b.last();
  assert.equal(reply.chatId, GROUP.id);
  assert.equal(reply.replyTo, 100);
  assert.equal(reply.quiet, true);
  assert.equal(reply.text, `⚪ No known blockers · 1 check not read · token ${mint.slice(0, 4)}…${mint.slice(-4)}`);
});

test("a CA whose issuer keeps the freeze and the mint: «Look first», the heaviest reason leading and the rest counted", async () => {
  const mint = await f.wallet();
  const issuer = await f.wallet();
  const b = bot({ before: { [mint]: f.mintState({ decimals: 6, mintAuthority: issuer, freezeAuthority: issuer }) } });
  await b.say(mint);
  assert.match(b.last().text, /^🟡 Look first — Issuer can freeze holders \(\+1\) · token /);
});

test("a CA that can never be sold or that arrives frozen: «Stop», and only a Stop makes a sound", async () => {
  const bound = await f.wallet();
  const frozen = await f.wallet();
  const issuer = await f.wallet();
  const b = bot({
    before: {
      [bound]: f.mintState({ extensions: [{ __kind: "NonTransferable" }] }),
      [frozen]: f.mintState({ freezeAuthority: issuer, extensions: [{ __kind: "DefaultAccountState", state: 2 }] }),
    },
  });
  await b.say(bound);
  assert.match(b.last().text, /^🔴 Stop — Can never be moved once held · token /);
  assert.equal(b.last().quiet, false);
  await b.say(frozen, { from: OKSANA });
  assert.match(b.last().text, /^🔴 Стоп — Приходить замороженим — не продати \(\+1\) · токен /);
});

test("a wallet on Ryntra's threat list, and a brand-new one: «Stop» and «Look first»", async () => {
  const drainer = await f.wallet();
  const fresh = await f.wallet();
  const b = bot({
    before: { [drainer]: f.walletState(SOL) },
    history: { [fresh]: "none" },
    threats: [{ address: drainer, kind: "drainer", source: "test entry", addedAt: "2026-10-31" }],
  });
  await b.say(`send here ${drainer}`);
  assert.equal(b.last().text, `🔴 Stop — Known wallet drainer · ${drainer.slice(0, 4)}…${drainer.slice(-4)}`);
  await b.say(`or here ${fresh}`, { from: { id: 9, language_code: "uk" } });
  assert.equal(b.last().text, `🟡 Подивіться уважно — Нова адреса — без історії · ${fresh.slice(0, 4)}…${fresh.slice(-4)}`);
});

test("address poisoning in a group: a look-alike of an address pasted earlier is stopped", async () => {
  const real = await f.wallet();
  const fake = f.lookalike(real);
  const b = bot({ before: { [real]: f.walletState(SOL) } });
  await b.say(real);
  assert.match(b.last().text, /^⚪ No known blockers/);
  await b.say(`correct address: ${fake}`, { from: { id: 13 } });
  assert.match(b.last().text, /^🔴 Stop — Looks like another address — compare every character · /);
  assert.deepEqual(b.checks.at(-1).known, [real]);
});

test("a fake CA ground to look like the real one is stopped too", async () => {
  const realMint = await f.wallet();
  const fakeMint = f.lookalike(realMint);
  const b = bot({ before: { [realMint]: f.mintState(), [fakeMint]: f.mintState() } });
  await b.say(realMint);
  await b.say(fakeMint, { from: { id: 13 } });
  assert.match(b.last().text, /^🔴 Stop — Looks like another address — compare every character · token /);
});

test("an address that is not a wallet (a program's account): «Stop — not a wallet»", async () => {
  const pool = await f.wallet();
  const b = bot({ before: { [pool]: { lamports: 10n * SOL, owner: f.TOKEN, data: new Uint8Array(10) } } });
  await b.say(pool);
  assert.match(b.last().text, /^🔴 Stop — Not a wallet — anything sent here is lost · /);
});

test("a transaction pasted in a group — base64 or base58: the owner swap is stopped, in the sender's language", async () => {
  const victim = await f.wallet();
  const drainer = await f.wallet();
  const transaction = f.wire(victim, [f.assign(victim, drainer)]);
  const chainArgs = {
    before: { [victim]: f.walletState(42n * SOL) },
    after: { [victim]: { lamports: 42n * SOL - 5_000n, owner: drainer, data: new Uint8Array(0) } },
  };
  const b = bot(chainArgs);
  await b.say(`sign this to claim: ${transaction}`, { from: OKSANA });
  assert.equal(b.last().text, "🔴 Стоп — Віддає гаманець програмі — назавжди · транзакція");
  const base58 = getBase58Decoder().decode(Buffer.from(transaction, "base64"));
  const again = bot(chainArgs);
  await again.say(base58);
  assert.match(again.last().text, /^🔴 Stop — Hands the wallet to a program — for good/);
  assert.equal(again.checks[0].subject.value, transaction);
});

test("an action link (a «blink»): «Look first» — the link builds its transaction on a server", async () => {
  const b = bot();
  await b.say("claim your airdrop https://dial.to/?action=solana-action:https://claim.example/api/drop");
  assert.equal(b.checks[0].subject.value, "solana-action:https://claim.example/api/drop");
  assert.equal(b.last().text, "🟡 Look first — Builds its transaction on a server — check that transaction · link");
});

test("the chain does not answer: no verdict, and the same paste may be tried again", async () => {
  const mint = await f.wallet();
  let silent = true;
  const b = bot({ before: { [mint]: f.mintState() } }, { reads: (reads) => ({ ...reads, accounts: async (a) => (silent ? null : reads.accounts(a)) }) });
  await b.say(mint);
  assert.equal(b.last().text, WARD_BOT_WORDS.en.unread);
  silent = false;
  await b.say(mint);
  assert.match(b.last().text, /^⚪ No known blockers/);
});

test("a check that fails or hangs: one short line, never a verdict", async () => {
  const mint = await f.wallet();
  const broken = bot({}, { check: async () => { throw new Error("boom"); } });
  await broken.say(mint);
  assert.equal(broken.last().text, WARD_BOT_WORDS.en.failed);
  assert.ok(WARD_BOT_CHECK_MS <= 25_000, "the bot gives up inside the route's 30 s");
});

test("/check: its argument, or the message it replies to — the line goes under the paste", async () => {
  const mint = await f.wallet();
  const b = bot({ before: { [mint]: f.mintState() } });
  await b.say(`/check@RyntraCheckBot ${mint}`);
  assert.equal(b.last().replyTo, 100);
  assert.match(b.last().text, /^⚪ No known blockers/);
  const original = { message_id: 7, date: Math.floor(T0 / 1_000), chat: GROUP, from: { id: 5 }, text: `ape this ${mint}` };
  b.tick(WARD_BOT_LIMITS.repeatMs);
  await b.say("/check", { reply_to_message: original, from: { id: 6 } });
  assert.equal(b.last().replyTo, 7);
  await b.say("/check nothing here");
  assert.equal(b.last().text, WARD_BOT_WORDS.en.hint);
});

test("/check for another bot, unknown commands and channels are not this bot's", async () => {
  const mint = await f.wallet();
  const b = bot({ before: { [mint]: f.mintState() } });
  assert.equal((await b.say(`/check@OtherBot ${mint}`)).why, "another bot's command");
  assert.equal((await b.say("/price SOL")).why, "not a command of this bot");
  assert.equal((await b.say(mint, { chat: { id: -5, type: "channel" } })).why, "not a group");
  assert.equal(b.sent.length, 0);
});

test("/start and /help: one introduction that says it only reads and never asks for keys", async () => {
  const b = bot();
  await b.say("/start", { chat: DM });
  assert.equal(b.last().text, WARD_BOT_WORDS.en.intro);
  assert.equal(b.last().replyTo, null);
  await b.say("/help", { chat: DM, from: OKSANA });
  assert.match(b.last().text, /не підписую.*ніколи не прошу ключів чи сід-фрази/);
  await b.say("/help");
  assert.equal((await b.say("/help")).why, "introduced");
});

test("added to a group: one line on what it does, once", async () => {
  const b = bot();
  const joined = (update_id, date = Math.floor(T0 / 1_000)) =>
    handleWardUpdate({ update_id, my_chat_member: { chat: GROUP, from: OKSANA, date, old_chat_member: { status: "left" }, new_chat_member: { status: "member" } } }, b.deps);
  assert.equal((await joined(900)).why, "intro");
  assert.equal(b.last().text, WARD_BOT_WORDS.uk.intro);
  assert.equal((await joined(901)).why, "introduced");
});

test("a signature: quiet in a group, explained in a private chat", async () => {
  const signature = getBase58Decoder().decode(new Uint8Array(64).fill(7));
  const b = bot();
  assert.equal((await b.say(`tx: ${signature}`)).why, "signature");
  assert.equal(b.sent.length, 0);
  await b.say(signature, { chat: DM });
  assert.equal(b.last().text, WARD_BOT_WORDS.en.signature);
});

test("nothing to check: silence in a group, one hint in a private chat", async () => {
  const b = bot();
  assert.equal((await b.say("gm everyone, who is buying today?")).why, "nothing to check");
  assert.equal(b.sent.length, 0);
  await b.say("hello?", { chat: DM });
  assert.equal(b.last().text, WARD_BOT_WORDS.en.hint);
});

/* ---------------------------------------------------------------- spam */

test("not answered: bots, inline bots' results, edits, stale backlog and a redelivered update", async () => {
  const mint = await f.wallet();
  const b = bot({ before: { [mint]: f.mintState() } });
  assert.equal((await b.say(mint, { from: { id: 1, is_bot: true } })).why, "from a bot");
  assert.equal((await b.say(mint, { via_bot: { id: 2, is_bot: true } })).why, "from a bot");
  assert.equal((await handleWardUpdate({ update_id: 500, edited_message: { message_id: 1, date: T0 / 1_000, chat: GROUP, from: ALICE, text: mint } }, b.deps)).why, "nothing to do");
  assert.equal((await b.say(mint, { date: Math.floor((T0 - WARD_BOT_LIMITS.staleMs - 1_000) / 1_000) })).why, "stale");
  const update = { update_id: 777, message: { message_id: 1, date: T0 / 1_000, chat: GROUP, from: ALICE, text: mint } };
  assert.equal((await handleWardUpdate(update, b.deps)).why, "verdict:allow");
  assert.equal((await handleWardUpdate(update, b.deps)).why, "redelivered");
  assert.equal(b.sent.length, 1);
});

test("the same paste in the same chat is answered once per window; another chat gets its own answer", async () => {
  const mint = await f.wallet();
  const b = bot({ before: { [mint]: f.mintState() } });
  await b.say(mint);
  assert.equal((await b.say(`again ${mint}`, { from: { id: 99 } })).why, "repeat");
  await b.say(mint, { chat: { id: -200, type: "group" } });
  assert.equal(b.sent.length, 2);
  b.tick(WARD_BOT_LIMITS.repeatMs);
  assert.equal((await b.say(mint)).why, "verdict:allow");
});

test("one message, one check: a list of addresses gets the first one only", async () => {
  const [a, c, d] = [await f.wallet(), await f.wallet(), await f.wallet()];
  const b = bot();
  await b.say(`${a}\n${c}\n${d}`);
  assert.equal(b.checks.length, 1);
  assert.equal(b.checks[0].subject.value, a);
  assert.equal(b.sent.length, 1);
});

/* ---------------------------------------------------------------- limits */

test("one person flooding a group is not answered past the limit — and is not told so in the group", async () => {
  const b = bot({}, { check: async () => ({ kind: "verdict", verdict: "allow", reasons: [], notRead: 0, topic: { kind: "transaction" } }) });
  for (let at = 0; at < WARD_BOT_LIMITS.member.limit; at += 1) assert.equal((await b.say(await f.wallet())).why, "verdict:allow");
  assert.equal((await b.say(await f.wallet())).why, "member");
  assert.equal(b.sent.length, WARD_BOT_LIMITS.member.limit);
  b.tick(WARD_BOT_LIMITS.member.windowMs);
  assert.equal((await b.say(await f.wallet())).why, "verdict:allow");
});

test("in a private chat the limit is said once, then the bot is quiet", async () => {
  const b = bot({}, { check: async () => ({ kind: "verdict", verdict: "allow", reasons: [], notRead: 0, topic: { kind: "transaction" } }) });
  for (let at = 0; at < WARD_BOT_LIMITS.direct.limit; at += 1) await b.say(await f.wallet(), { chat: DM });
  assert.equal((await b.say(await f.wallet(), { chat: DM })).why, "busy:member");
  assert.equal(b.last().text, "Too many checks. Try again in 1 min.");
  assert.equal((await b.say(await f.wallet(), { chat: DM })).why, "member");
});

test("a busy group: past its limit one notice, then silence until the window turns", async () => {
  const b = bot({}, { check: async () => ({ kind: "verdict", verdict: "allow", reasons: [], notRead: 0, topic: { kind: "transaction" } }) });
  for (let at = 0; at < WARD_BOT_LIMITS.chat.limit; at += 1) await b.say(await f.wallet(), { from: { id: 1_000 + at } });
  assert.equal(b.sent.length, WARD_BOT_LIMITS.chat.limit);
  assert.equal((await b.say(await f.wallet(), { from: { id: 5_000 } })).why, "busy:chat");
  assert.equal(b.last().text, "Too many checks here. Back in 10 min.");
  assert.equal((await b.say(await f.wallet(), { from: { id: 5_001 } })).why, "chat");
  assert.equal(b.sent.length, WARD_BOT_LIMITS.chat.limit + 1);
  b.tick(WARD_BOT_LIMITS.chat.windowMs);
  assert.equal((await b.say(await f.wallet(), { from: { id: 5_002 } })).why, "verdict:allow");
});

test("what is not a verdict comes out of the same person's budget: /check with nothing, /help by name, a signature", async () => {
  const b = bot();
  const signature = getBase58Decoder().decode(new Uint8Array(64).fill(9));
  const asks = ["/check nothing", "/help@RyntraCheckBot", `/check ${signature}`, "/check still nothing"];
  for (const ask of asks) assert.equal((await b.say(ask)).sent, true, ask);
  assert.equal(WARD_BOT_LIMITS.member.limit, asks.length);
  assert.equal((await b.say("/check one more")).why, "member");
  assert.equal((await b.say("/help@RyntraCheckBot")).why, "member");
  assert.equal(b.sent.length, asks.length);
});

test("the whole bot's budget: past it, groups are told once each and the chain is not read", async () => {
  const gate = new WardBotGate({ now: () => T0 });
  let admitted = 0;
  for (let at = 0; at < WARD_BOT_LIMITS.global.limit; at += 1) {
    if (gate.admit({ chatId: -at - 1, userId: at, direct: false, key: `k${at}` }).ok) admitted += 1;
  }
  assert.equal(admitted, WARD_BOT_LIMITS.global.limit);
  const over = gate.admit({ chatId: -9_999, userId: 1, direct: false, key: "x" });
  assert.deepEqual([over.ok, over.why, over.notice], [false, "global", true]);
  assert.equal(gate.admit({ chatId: -9_999, userId: 2, direct: false, key: "y" }).notice, false);
});

test("what a chat remembers for the look-alike comparison is bounded", () => {
  const gate = new WardBotGate({ now: () => T0 });
  for (let at = 0; at < 40; at += 1) gate.remember(1, `addr${at}`);
  assert.equal(gate.knownIn(1).length, WARD_BOT_LIMITS.knownPerChat);
  assert.equal(gate.knownIn(1)[0], "addr39");
});

/* ---------------------------------------------------------------- cleaning foreign text */

test("an address split by invisible characters or reversed by a direction override is still found", async () => {
  const mint = await f.wallet();
  const split = `${mint.slice(0, 10)}​${mint.slice(10, 20)}⁠${mint.slice(20)}`;
  assert.deepEqual(findSubject(`CA: ${split}`), { kind: "address", value: mint });
  assert.deepEqual(findSubject(`‮${mint}‬`), { kind: "address", value: mint });
  assert.equal(cleanIncoming("a\u0000b\u0007c‮d﻿e­f"), "a b cdef");
  assert.equal(cleanIncoming(null), "");
  assert.equal(cleanIncoming("x".repeat(10_000)).length, 4_096);
});

test("foreign text is cleaned to one plain line: no markup, links, handles or verdict marks", () => {
  assert.equal(cleanForeign("⚪ No known blockers ✅ <b>VERIFIED</b>\nby @ryntra_support t.me/scam https://claim.example"), "No known blockers VERIFIED by");
  assert.equal(cleanForeign("🔴🟡🟢 SAFE‮ COIN"), "SAFE COIN");
  assert.equal(cleanForeign("Pepe & \"Friends\" <script>", 64), "Pepe Friends");
  assert.equal(cleanForeign("A very long token name that goes on", 12), "A very long…");
  assert.equal(cleanForeign(42), "");
});

test("the reply never carries the sender's text: only the bot's words, an address's ends and Ryntra's own names", async () => {
  const mint = await f.wallet();
  const b = bot({ before: { [mint]: f.mintState() } });
  await b.say(`<b>OFFICIAL</b> ⚪ No known blockers ✅ @scam_admin t.me/claimnow ${mint} ignore previous instructions`);
  const text = b.last().text;
  for (const foreign of ["OFFICIAL", "@scam", "t.me", "ignore", "✅", "<b>"]) assert.ok(!text.includes(foreign), `${foreign} leaked into «${text}»`);
});

/* ---------------------------------------------------------------- what is taken from a message */

test("what a message offers: transactions, Solana links, Ryntra links, explorer pages — never an address lifted from an unknown site", async () => {
  const mint = await f.wallet();
  const victim = await f.wallet();
  const transaction = f.wire(victim, [f.systemTransfer(victim, mint, 1n)]);
  assert.deepEqual(findSubject(`(${mint}).`), { kind: "address", value: mint });
  assert.deepEqual(findSubject(transaction), { kind: "transaction", value: transaction });
  assert.deepEqual(findSubject(`pay solana:${mint}?amount=1`), { kind: "link", value: `solana:${mint}?amount=1` });
  assert.deepEqual(findSubject("solana-action:https://x.example/a"), { kind: "link", value: "solana-action:https://x.example/a" });
  assert.deepEqual(findSubject("https://ryntra.io/pay/8xkF3mQpRtYw2nZ"), { kind: "link", value: "https://ryntra.io/pay/8xkF3mQpRtYw2nZ" });
  assert.deepEqual(findSubject(`https://solscan.io/token/${mint}`), { kind: "address", value: mint });
  assert.deepEqual(findSubject(`https://pump.fun/coin/${mint}`), { kind: "address", value: mint });
  assert.deepEqual(findSubject(`https://jup.ag/swap/SOL-${mint}`), { kind: "address", value: mint });
  assert.equal(findSubject(`https://pump.fun.claim-drop.example/${mint}`), null);
  assert.equal(findSubject(`https://claim-jup.example/token/${mint}`), null);
  assert.equal(findSubject("https://news.example/solana-is-up"), null);
  assert.equal(findSubject("SGVsbG8gd29ybGQ=".repeat(10)), null, "base64 that is not a transaction");
  assert.equal(findSubject("gm"), null);
  assert.equal(subjectKey({ kind: "address", value: mint }), `address:${mint}`);
});

test("no word the bot can say is «safe»", () => {
  const all = [];
  const walk = (value) => {
    if (typeof value === "string") all.push(value);
    else if (typeof value === "function") all.push(String(value(1)), String(value(3)), String(value(null)));
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(WARD_BOT_WORDS);
  for (const text of all) {
    assert.doesNotMatch(text, /\bsafe\b|\bsecure\b|guarantee|безпечн|гарант/i, text);
  }
  assert.equal(WARD_BOT_WORDS.en.allow, "No known blockers");
  assert.equal(WARD_BOT_WORDS.uk.allow, "Відомих перешкод немає");
});

test("the engine's address path: a mint is a token, a wallet a recipient, a silent chain no verdict at all", async () => {
  const mint = await f.wallet();
  const holder = await f.wallet();
  const before = { [mint]: f.mintState({ mintAuthority: holder }), [holder]: f.walletState(SOL) };
  const { reads } = f.chain({ before, recipient: recipientOn(before) });
  const token = await checkWardAddress({ address: mint }, reads);
  assert.equal(token.subject, "token");
  assert.equal(token.result.verdict, "warn");
  assert.equal(token.result.reasons[0].code, "TOKEN_MINT_AUTHORITY");
  const wallet = await checkWardAddress({ address: holder }, reads);
  assert.equal(wallet.subject, "address");
  assert.equal(wallet.result.verdict, "allow");
  assert.equal((await checkWardAddress({ address: holder }, { ...reads, accounts: async () => null })).subject, "unread");
  await assert.rejects(checkWardAddress({ address: "not-an-address" }, reads));
  assert.deepEqual(await checkSubject({ kind: "signature", value: "x" }, reads), { kind: "not-checkable" });
  const line = verdictLine({ kind: "verdict", verdict: "allow", reasons: [], notRead: 0, topic: { kind: "token", mint: f.USDC, symbol: null } }, "uk");
  assert.equal(line, "⚪ Відомих перешкод немає · токен USDC");
});

test("the Telegram client sends plain text under the paste, and its token never reaches a log", async () => {
  const seen = [];
  const telegram = wardTelegram({
    token: "123:SECRET",
    fetch: async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
    },
  });
  await telegram.send({ chatId: -1, text: "⚪ No known blockers · token USDC", replyTo: 5, quiet: true });
  assert.equal(seen[0].url, "https://api.telegram.org/bot123:SECRET/sendMessage");
  assert.deepEqual(seen[0].body, {
    chat_id: -1,
    text: "⚪ No known blockers · token USDC",
    link_preview_options: { is_disabled: true },
    disable_notification: true,
    reply_parameters: { message_id: 5, allow_sending_without_reply: true },
  });
  assert.equal("parse_mode" in seen[0].body, false);

  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const failing = wardTelegram({ token: "123:SECRET", fetch: async () => { throw new Error("connect to https://api.telegram.org/bot123:SECRET failed"); } });
    assert.equal(await failing.call("getMe", {}), null);
    assert.equal(await wardTelegram({ token: null }).call("getMe", {}), null);
  } finally {
    console.error = original;
  }
  assert.ok(logged.length === 2 && logged.every((line) => !line.includes("SECRET")), logged.join(" | "));
});
