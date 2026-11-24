// «Повторюй за гаманцем» — the screen: the wallet, her numbers, the month's fees in one line, one action on paper;
// her copies kept with her proven wallet. «Start with money» — live only with the switch; one signature of her
// budget held against the card; her copies with money in «My bots» with «Freeze» and «Stop», stuck coins named.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { COPY_SIGNER_READY, COPY_START_READY, copyMoneyOpen } from "../../lib/wallet-watch/copy-agent.ts";
import { setCopyEnv, useCopies } from "./copy-store.ts";
import { copiesOf, copiesWorking, feesOf, formIssue, moneyOf, readSpan, STUCK_WORDS, stuckWordOf, tradeOf, typedSol, worstOf } from "./copy-view.ts";
import { COPY } from "./copy-words.ts";
import { BOTS } from "./words.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const OWNER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const LEADER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MEME = "4CJfADKLXAKzv8meQ3rywzQULGN535WAMJJUGWZnpump";
const NOW = Date.parse("2026-11-21T12:00:00Z");
const form = (over = {}) => ({ day: "1", share: 25, days: 7, bound: 5, ...over });

test("her numbers: any day's sum, a trade its share; what is wrong said in the screen's words", () => {
  assert.equal(typedSol("1,5"), 1.5, "a comma as her keyboard writes it");
  assert.equal(typedSol(""), null);
  assert.equal(formIssue(form()), null);
  assert.equal(formIssue(form({ day: "500" })), null, "no ceiling of Ryntra's");
  assert.equal(formIssue(form({ day: "" })), "zero");
  assert.equal(formIssue(form({ day: "0.002", share: 10 })), "tradeMin");
  assert.deepEqual(tradeOf(form()), { tradeSol: 0.25, perDay: 4 });
  assert.deepEqual(tradeOf(form({ share: 10 })), { tradeSol: 0.1, perDay: 10 });
  assert.equal(tradeOf(form({ day: "x" })), null);
});

test("the month's fees on the wallet's own read; the span it read", () => {
  const trades = Array.from({ length: 12 }, (_, i) => ({ side: "buy", at: NOW / 1000 - i * 6 * 3_600, mint: MEME, quote: "SOL" }));
  const read = { trades, oldestAt: NOW / 1000 - 3 * 86_400 };
  const fees = feesOf(form(), read, NOW);
  assert.ok(Math.abs(fees.leaderPerDay - 4) < 1e-9);
  assert.equal(fees.copiesPerDay, 4);
  assert.ok(fees.sol > 0);
  assert.equal(feesOf(form(), null, NOW), null, "no wallet read — «once the wallet is read»");
  assert.equal(feesOf(form({ day: "" }), read, NOW), null);
  assert.deepEqual(readSpan(read, NOW), { unit: "d", n: 3 });
  assert.deepEqual(readSpan({ ...read, oldestAt: NOW / 1000 - 5 * 3_600 }, NOW), { unit: "h", n: 5 });
});

test("the engine's copies as the list reads them", () => {
  const body = {
    ok: true,
    copies: [
      { leader: LEADER, name: null, since: "2026-11-21T10:00:00.000Z", sizeSol: 0.25, slippagePct: 5, agent: { perDaySol: 1, perTradeSol: 0.25, days: 7, sharePct: 25, endsAt: "2026-11-28T10:00:00.000Z", todaySol: 0.5, ended: false }, summary: { filled: 3, missed: 2, resultSol: -0.012, pct: -1.6, unpriced: 0 } },
      { leader: OWNER, name: "Кит", since: "2026-11-01T10:00:00.000Z", sizeSol: 0.5, slippagePct: 5, agent: { perDaySol: 2, perTradeSol: 0.5, days: 7, sharePct: 25, endsAt: "2026-11-08T10:00:00.000Z", todaySol: 0, ended: true }, summary: { filled: 0, missed: 0, resultSol: 0, pct: null, unpriced: 0 } },
      { leader: "not an address", since: "x" },
    ],
  };
  const rows = copiesOf(body);
  assert.equal(rows.length, 2, "a row that is not a copy is left out");
  assert.equal(rows[0].terms.todaySol, 0.5);
  assert.equal(rows[0].missed, 2);
  assert.equal(copiesWorking(rows), 1, "a copy whose term is over is not at work");
  assert.equal(copiesOf({ ok: false }), null);
});

/** A fake engine: the proof, the list, the start and the stop. */
function engine({ proven = false } = {}) {
  const state = { proven, copies: [], posts: [], proofs: 0 };
  const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  setCopyEnv({
    prove: async () => {
      state.proofs += 1;
      state.proven = true;
      return { ok: true };
    },
    fetch: async (url, init = {}) => {
      if (!state.proven) return answer(401, { error: "proof required" });
      const method = init.method ?? "GET";
      if (method === "POST") {
        const body = JSON.parse(init.body);
        state.posts.push(body);
        if (state.copies.length >= 5) return answer(409, { error: "limit", code: "LIMIT" });
        state.copies.push({ leader: body.leader, name: null, since: new Date(NOW).toISOString(), sizeSol: body.perDaySol * (body.sharePct / 100), slippagePct: body.slippagePct, agent: { perDaySol: body.perDaySol, perTradeSol: 0.25, days: body.days, sharePct: body.sharePct, endsAt: new Date(NOW + 7 * 86_400_000).toISOString(), todaySol: 0, ended: false }, summary: { filled: 0, missed: 0, resultSol: 0, pct: null, unpriced: 0 } });
      }
      if (method === "DELETE") state.copies = state.copies.filter((copy) => copy.leader !== new URL(url, "https://x").searchParams.get("leader"));
      return answer(200, { ok: true, copies: state.copies });
    },
  });
  return state;
}

test("a start on paper: one signed message when the wallet is not proven yet, then the copy — her numbers as typed", async () => {
  const state = engine();
  await useCopies.getState().follow(OWNER);
  assert.equal(useCopies.getState().status, "proof", "not proven: the list asks for one message, never an empty list");
  const ok = await useCopies.getState().start({ wallet: "Phantom", address: OWNER }, LEADER, form({ day: "1,5", share: 10, bound: 15 }));
  assert.equal(ok, true);
  assert.equal(state.proofs, 1);
  assert.deepEqual(state.posts[0], { address: OWNER, leader: LEADER, perDaySol: 1.5, sharePct: 10, days: 7, slippagePct: 15 });
  assert.equal(useCopies.getState().note, "started");
  assert.equal(useCopies.getState().rows.length, 1);
  assert.equal("money" in state.posts[0], false, "the screen never asks for money");
  await useCopies.getState().stop(LEADER);
  assert.equal(useCopies.getState().rows.length, 0);
  await useCopies.getState().follow(null);
  assert.equal(useCopies.getState().status, "idle");
});

test("five at most: the sixth is said, not taken", async () => {
  const state = engine({ proven: true });
  await useCopies.getState().follow(OWNER);
  for (let i = 0; i < 5; i += 1) state.copies.push({ leader: `${"B".repeat(43)}${i + 1}`, since: new Date(NOW).toISOString(), summary: {} });
  assert.equal(await useCopies.getState().start({ wallet: "Phantom", address: OWNER }, LEADER, form()), false);
  assert.equal(useCopies.getState().note, "full");
  await useCopies.getState().follow(null);
});

test("the screen: a bot of the section at its own page; one amber action; money behind its switch; words in both languages", () => {
  assert.ok(existsSync(new URL("app/(terminal)/bots/copy/page.tsx", root)));
  const screen = read("terminal/bots/Copy.tsx");
  assert.equal((screen.match(/<Action\b/g) ?? []).length, 1, "one amber action");
  /* Closed — as before: quiet, shut, «Coming». */
  assert.match(screen, /\) : \(\s*<>\s*<Quiet size="s" disabled>\s*\{c\.startMoney\}\s*<\/Quiet>\s*<Chip>\{c\.coming\}<\/Chip>/, "«Start with money» quiet and shut without the switch");
  /* Open — the same quiet place, live: one signature of her budget; the amber action stays the paper start's. */
  assert.match(screen, /\{MONEY_OPEN \? \(\s*<Quiet size="s" disabled=\{[^}]+\}[^>]*onClick=\{goMoney\} data-copy-start-money="">\s*\{c\.startMoney\}/);
  assert.match(screen, /const MONEY_OPEN = copyMoneyOpen\(process\.env\.NEXT_PUBLIC_RYNTRA_AGENT_COPY\);/);
  assert.equal(COPY_SIGNER_READY, true, "the signer holds the rule for copying");
  assert.equal(COPY_START_READY, true, "the start is wired");
  assert.equal(copyMoneyOpen("on"), true);
  assert.equal(copyMoneyOpen(undefined), false, "the switch unset: shut");
  assert.match(screen, /<HowInfo lines=\{\[c\.howCopy, c\.howExit, c\.howBound, c\.howSlip, c\.howCoins, c\.howFees\(fee\.major, fee\.stock, fee\.trending, fee\.meme\), c\.howPaper, MONEY_OPEN \? c\.howMoneyOpen : c\.howMoney, c\.howWorst\]\}/, "how it works behind the «i»");
  assert.doesNotMatch(COPY.en.howMoneyOpen, /coming/i);
  assert.doesNotMatch(COPY.uk.howMoneyOpen, /скоро/i);
  /* «My bots»: her copies with money first — whatever the switch. At work: «Freeze» (with the switch) and
     «Stop» always; stopped: «Take the rest» while anything stands; unfinished: «Finish» (with the switch) or «Take back». */
  assert.match(screen, /const moneyRows = money;/);
  assert.doesNotMatch(screen, /MONEY_OPEN \? money : \[\]/);
  assert.match(screen, /: \[\.\.\.\(MONEY_OPEN \? \[\{ id: 'freeze', label: row\.frozen \? c\.resume : c\.freeze, run: freeze \}\] : \[\]\), \{ id: 'stop', label: c\.stop, run: stop \}\];/, "«Stop» whatever the switch");
  assert.match(screen, /: stopped\s*\? row\.rest\s*\? \[\{ id: 'rest', label: c\.takeRest, run: stop \}\]\s*: \[\]/, "«Take the rest» on a stopped row while anything stands");
  assert.match(screen, /\[\.\.\.\(MONEY_OPEN \? \[\{ id: 'finish', label: c\.finish, run: finish \}\] : \[\]\), \{ id: 'back', label: c\.takeBack, run: stop \}\]/, "an unfinished start: finish or take back");
  assert.match(screen, /stopMoney\(connection, row\.policy, row\.review\)/, "an unfinished start stopped from her review");
  assert.match(screen, /data-copy-money-act=\{act\.id\}/);
  assert.match(screen, /empty=\{[^}]*\(!moneyRead \? c\.mineUnread : c\.mineEmpty\)/, "her copies unread — said, whatever the switch");
  /* «your coins are back» only when no coin is named as staying, waiting or failed. */
  assert.match(screen, /const some = note\.stuck\.length > 0 \|\| note\.left > 0 \|\| note\.failed > 0 \|\| note\.rest === true;/);
  assert.match(screen, /stopped: some \? c\.stopDoneSome : c\.stopDone, nothing: note\.stuck\.length \? c\.stopNothingStuck : c\.stopNothing/);
  for (const lang of ["en", "uk"]) {
    assert.doesNotMatch(COPY[lang].stopDoneSome, /coin|монет/i, `${lang}: the budget only`);
    assert.doesNotMatch(COPY[lang].stopNothingStuck, /nothing left|нічого повертати/i);
  }
  assert.match(screen, /c\.stuckLine\(shortAddress\(coin\.mint\), c\[stuckWordOf\(coin\.reason\)\]\)/, "a coin left in her vault named with its reason");
  /* The worst day with money — one number on the screen, three day's caps however many coins; the rest behind the «i». */
  assert.match(screen, /<span className=\{`\$\{b\.line\} \$\{x\.worst\}`\} data-copy-worst="">\s*\{worst !== null \? c\.worstLine\(solText\(worst, lang\)\) : null\}\s*<\/span>/);
  assert.equal(worstOf({ day: "0,5", share: 25, days: 7, bound: 5 }), 1.5);
  assert.equal(worstOf({ day: "", share: 25, days: 7, bound: 5 }), null);
  assert.equal(COPY.en.worstLine("1.5"), "Worst case with money: 1.5 SOL a day");
  assert.equal(COPY.uk.worstLine("1,5"), "Найгірше з грошима — 1,5 SOL на день");
  /* The swap's 1 % at most — one line under the bound, the rest behind the «i». */
  assert.match(screen, /<span className=\{b\.line\} data-copy-slip="">\s*\{c\.slipLine\}\s*<\/span>/);
  assert.match(COPY.en.slipLine, /1%/);
  assert.match(COPY.uk.slipLine, /1%/);
  assert.match(screen, /data-copy-fees/, "the month's fees in one line over the action");
  assert.doesNotMatch(screen, /sendTransaction|signTransaction|signAllTransactions|signMessage|\/execute|jupiter/i, "the screen signs and trades nothing");
  assert.match(read("terminal/bots/BotsScreen.tsx"), /bot === 'copy' \? \(\s*<CopyBot lay=\{lay\} \/>/);
  for (const lang of ["en", "uk"]) {
    assert.deepEqual(Object.keys(COPY[lang]).sort(), Object.keys(COPY.en).sort(), `${lang}: the same keys`);
    const all = Object.values(COPY[lang])
      .map((value) => (typeof value === "string" ? value : value("2", "3")))
      .join(" ");
    assert.doesNotMatch(all, /BONK|PUMP|WIF|profit|прибут|заробиш|x\d|guarantee|гарант|API|RPC|cron|Helius|endpoint/iu, lang);
    assert.ok(BOTS[lang].copy && BOTS[lang].copyJob);
  }
  assert.equal(BOTS.uk.copy, "Повтор за гаманцем");
  assert.equal(COPY.uk.startPaper, "Спершу на папері");
  assert.equal(COPY.uk.startMoney, "Почати з грошима");
});

/* ---------------------------------------------------------------- with money */


const SSA = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const POLICY = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
/** An unsigned transaction of hers alone that calls her smart account — as the server's review builds them. */
const wireOf = (payer = OWNER, program = SSA) =>
  Buffer.from(new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(payer), recentBlockhash: "11111111111111111111111111111111", instructions: [new TransactionInstruction({ programId: program, keys: [], data: Buffer.from([1]) })] }).compileToV0Message()).serialize()).toString("base64");
/** Her wallet signs them as they are. */
const signedOf = (wire) => {
  const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
  tx.signatures[0] = new Uint8Array(64).fill(7);
  return Buffer.from(tx.serialize()).toString("base64");
};

/** A fake engine of the money routes beside the paper list. */
const moneyRow = () => ({ policy: POLICY, leader: LEADER, status: "working", since: new Date(NOW).toISOString(), endsAt: new Date(NOW + 7 * 86_400_000).toISOString(), ended: false, frozen: false, perDaySol: 1, perTradeSol: 0.25, todaySol: 0, coins: 1, bought: 0, sold: 0, missed: 0, rest: false, review: null });

function moneyEngine({ review = {}, start = {}, stop = {}, sign = "ok" } = {}) {
  const state = { calls: [], signs: [], money: [] };
  const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  setCopyEnv({
    prove: async () => ({ ok: true }),
    sign: async (args) => {
      state.signs.push(args);
      return sign === "ok" ? { ok: true, signedWireBase64: args.unsignedWireBase64.map(signedOf) } : { ok: false, reason: "User rejected." };
    },
    fetch: async (url, init = {}) => {
      if ((init.method ?? "GET") === "GET") return answer(200, { ok: true, money: true, copies: [], moneyCopies: state.money });
      const verb = url.replace("/api/wallet-watch/copy/money/", "");
      const body = JSON.parse(init.body);
      state.calls.push({ verb, body });
      if (verb === "review") {
        if (review.status) return answer(review.status, { error: { code: review.code, message: "No." } });
        return answer(200, { network: "mainnet", review: "a".repeat(32), policy: POLICY, transactions: review.transactions ?? [wireOf(), wireOf()], perDay: review.perDay ?? "1000000000", perTrade: "250000000", fundLamports: "7000000000", worstLamports: "3000000000", coins: [MEME], skipped: [] });
      }
      if (verb === "start") {
        /* The first transaction lands, the next does not — no copy, her start listed as unfinished. */
        if (start.partial && body.items && !state.partialDone) {
          state.partialDone = true;
          state.money = [{ ...moneyRow(), status: "pending", review: body.review }];
          return answer(422, { error: { code: "FAILED", message: "A transaction failed on mainnet." }, partial: true, signatures: ["s0", "s1"] });
        }
        state.money = [moneyRow()];
        return answer(200, { network: "mainnet", copy: state.money[0] });
      }
      if (verb === "finish") return answer(200, { network: "mainnet", policy: body.policy, review: body.review, transactions: [wireOf()] });
      if (verb === "stop") return answer(200, { network: "mainnet", transactions: [wireOf(), wireOf(), wireOf()], skipped: stop.skipped ?? [], left: stop.left ?? 0, unclosed: 0 });
      if (verb === "stop/send") {
        const rest = stop.rest ?? false;
        state.money = state.money.filter((row) => row.status !== "pending" || rest).map((row) => ({ ...row, status: row.status === "pending" ? "pending" : "stopped", rest }));
        return answer(200, { network: "mainnet", signatures: ["s"], failed: stop.failed ?? 0, stopped: true, rest });
      }
      if (verb === "freeze") {
        state.money = state.money.map((row) => ({ ...row, frozen: body.frozen }));
        return answer(200, { network: "mainnet", frozen: body.frozen });
      }
      return answer(404, {});
    },
  });
  return state;
}
const WHO = { wallet: "Phantom", address: OWNER };

test("start with money: her review held against the card, one signature, then the copy — the server's record, never hers", async () => {
  const state = moneyEngine();
  await useCopies.getState().follow(OWNER);
  assert.equal(await useCopies.getState().startMoney(WHO, LEADER, form()), true);
  assert.deepEqual(state.calls.map((call) => call.verb), ["review", "start"]);
  assert.deepEqual(state.calls[0].body, { owner: OWNER, leader: LEADER, perDaySol: 1, sharePct: 25, days: 7, boundPct: 5 });
  assert.equal(state.signs.length, 1, "one prompt");
  assert.equal(state.signs[0].chain, "solana:mainnet");
  assert.equal(state.signs[0].unsignedWireBase64.length, 2);
  /* The start names the server's review and carries her signed transactions — no record of the client's. */
  assert.deepEqual(Object.keys(state.calls[1].body).sort(), ["items", "owner", "policy", "review"]);
  assert.equal(state.calls[1].body.review, "a".repeat(32));
  assert.equal(useCopies.getState().note, "money");
  assert.equal(useCopies.getState().money.length, 1);
  await useCopies.getState().follow(null);
});

test("start with money: numbers that are not the card's, a transaction not hers alone — never signed; her «no» — nothing sent", async () => {
  for (const review of [{ perDay: "2000000000" }, { transactions: [wireOf(LEADER)] }, { transactions: [wireOf(OWNER, new PublicKey(MEME))] }]) {
    const state = moneyEngine({ review });
    await useCopies.getState().follow(OWNER);
    assert.equal(await useCopies.getState().startMoney(WHO, LEADER, form()), false);
    assert.equal(state.signs.length, 0, JSON.stringify(review));
    assert.deepEqual(state.calls.map((call) => call.verb), ["review"]);
    assert.equal(useCopies.getState().note, "failed");
  }
  const declined = moneyEngine({ sign: "no" });
  await useCopies.getState().follow(OWNER);
  assert.equal(await useCopies.getState().startMoney(WHO, LEADER, form()), false);
  assert.deepEqual(declined.calls.map((call) => call.verb), ["review"]);
  assert.equal(useCopies.getState().note, "declined");
  /* None of the wallet's coins the agent trades, the leader copied already, five at most: each said. */
  for (const [review, note] of [[{ status: 422, code: "REFUSED" }, "noCoins"], [{ status: 422, code: "NO_COINS" }, "noCoins"], [{ status: 409, code: "ALREADY" }, "already"], [{ status: 409, code: "LIMIT" }, "full"]]) {
    moneyEngine({ review });
    await useCopies.getState().follow(OWNER);
    await useCopies.getState().startMoney(WHO, LEADER, form());
    assert.equal(useCopies.getState().note, note, review.code);
  }
  await useCopies.getState().follow(null);
});

test("her copy with money: freeze, then stop — one signature; a coin that stays in her vault named with its reason", async () => {
  const state = moneyEngine({ stop: { skipped: [{ mint: MEME, reason: "its issuer froze it in your vault" }], left: 2 } });
  await useCopies.getState().follow(OWNER);
  await useCopies.getState().startMoney(WHO, LEADER, form());
  await useCopies.getState().freezeMoney(WHO, POLICY, true);
  assert.deepEqual(state.calls.at(-1), { verb: "freeze", body: { owner: OWNER, policy: POLICY, frozen: true } });
  assert.equal(useCopies.getState().money[0].frozen, true);
  state.signs.length = 0;
  await useCopies.getState().stopMoney(WHO, POLICY);
  assert.deepEqual(state.calls.slice(-2).map((call) => call.verb), ["stop", "stop/send"]);
  assert.equal(state.signs.length, 1);
  assert.equal(state.signs[0].unsignedWireBase64.length, 3, "the stop, its coins, its accounts — one prompt");
  assert.equal(state.calls.at(-1).body.items.length, 3);
  const note = useCopies.getState().stopNote;
  assert.deepEqual([note.kind, note.left, note.stuck], ["stopped", 2, [{ mint: MEME, reason: "its issuer froze it in your vault" }]]);
  assert.equal(stuckWordOf(note.stuck[0].reason), "whyFrozen");
  assert.equal(useCopies.getState().money[0].status, "stopped");
  /* Her «no» to the stop: nothing relayed — the copy stays frozen, said so. */
  const declined = moneyEngine({ sign: "no" });
  await useCopies.getState().follow(OWNER);
  await useCopies.getState().stopMoney(WHO, POLICY);
  assert.deepEqual(declined.calls.map((call) => call.verb), ["stop"]);
  assert.equal(useCopies.getState().stopNote.kind, "declined");
  await useCopies.getState().follow(null);
});

test("her copies with money as the list reads them; every reason the engine gives a stuck coin has its words", () => {
  const row = { policy: POLICY, leader: LEADER, status: "working", frozen: true, since: "2026-11-21T10:00:00.000Z", endsAt: "2026-11-28T10:00:00.000Z", ended: false, perDaySol: 1, perTradeSol: 0.25, todaySol: 0.5, coins: 3, bought: 2, sold: 1, missed: 4 };
  assert.deepEqual(moneyOf({ ok: true, copies: [] }), [], "the switch closed: none");
  assert.equal(moneyOf({ ok: true, copies: [], moneyCopies: null }), null, "the book did not answer: said, never «none»");
  const [listed] = moneyOf({ ok: true, copies: [], moneyCopies: [row, { policy: "nope" }] });
  assert.deepEqual([listed.frozen, listed.bought + listed.sold, listed.todaySol], [true, 3, 0.5]);
  /* The engine's reasons (`coinHome`): each one its own line in both languages. */
  const engine = read("lib/wallet-watch/copy-money.server.ts");
  const reasons = [
    ...[...engine.matchAll(/\[EXTENSION\.\w+, "([^"]+)"\]/g)].map((match) => match[1]),
    ...[...engine.matchAll(/const (?:FROZEN|UNKNOWN_FEATURE) = "([^"]+)"/g)].map((match) => match[1]),
    ...[...engine.matchAll(/return \{ reason: "([^"]+)" \}/g)].map((match) => match[1]),
  ];
  assert.ok(reasons.length >= 12, `${reasons.length} reasons`);
  for (const reason of reasons) assert.notEqual(stuckWordOf(reason), "whyCannotMove", reason);
  for (const key of [...new Set(Object.values(STUCK_WORDS)), "whyCannotMove"]) {
    assert.ok(COPY.en[key] && COPY.uk[key], key);
  }
});


test("a start that landed in part: said so, listed as unfinished — «Finish» signs only what is missing, «Take back» stops it from her review", async () => {
  const state = moneyEngine({ start: { partial: true } });
  await useCopies.getState().follow(OWNER);
  assert.equal(await useCopies.getState().startMoney(WHO, LEADER, form()), false);
  assert.equal(useCopies.getState().note, "partial");
  const [pending] = useCopies.getState().money;
  assert.deepEqual([pending.status, pending.review], ["pending", "a".repeat(32)], "listed — the list read again after it");
  /* «Finish»: her missing transactions, one signature, then her start relays them and writes the book. */
  state.signs.length = 0;
  state.calls.length = 0;
  assert.equal(await useCopies.getState().finishMoney(WHO, POLICY, pending.review), true);
  assert.deepEqual(state.calls.map((call) => call.verb), ["finish", "start"]);
  assert.deepEqual(state.calls[0].body, { owner: OWNER, policy: POLICY, review: "a".repeat(32) });
  assert.equal(state.signs.length, 1);
  assert.equal(state.signs[0].unsignedWireBase64.length, 1);
  assert.deepEqual(Object.keys(state.calls[1].body).sort(), ["items", "owner", "policy", "review"]);
  assert.equal(useCopies.getState().note, "money");
  /* «Take back»: her stop, named by her review — the book has no row of it. */
  const back = moneyEngine({ start: { partial: true } });
  await useCopies.getState().follow(OWNER);
  await useCopies.getState().startMoney(WHO, LEADER, form());
  back.calls.length = 0;
  await useCopies.getState().stopMoney(WHO, POLICY, "a".repeat(32));
  assert.deepEqual(back.calls.map((call) => [call.verb, call.body.review]), [["stop", "a".repeat(32)], ["stop/send", "a".repeat(32)]]);
  assert.deepEqual([useCopies.getState().stopNote.kind, useCopies.getState().stopNote.rest], ["stopped", false]);
  assert.equal(useCopies.getState().money.length, 0, "taken home whole: no longer listed");
  /* Her bounds at the book (one copy of a wallet, five at most): said as they are, not as «in part». */
  for (const [code, note] of [["ALREADY", "already"], ["LIMIT", "full"]]) {
    const money = await import("./copy-money.ts");
    const fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: { code }, partial: true }) });
    const outcome = await money.finishWithMoney(WHO, POLICY, "a".repeat(32), { fetch: async (url, init) => (url.endsWith("/finish") ? { ok: true, status: 200, json: async () => ({ transactions: [] }) } : fetch(url, init)), sign: async () => assert.fail("nothing to sign") });
    assert.deepEqual(outcome, { kind: "refused", code }, note);
  }
  await useCopies.getState().follow(null);
});

test("her stop that leaves something: «Take the rest» in the note and on her row — after a reload too; the budget said back, never the coins", async () => {
  const state = moneyEngine({ stop: { skipped: [{ mint: MEME, reason: "its issuer froze it in your vault" }], rest: true } });
  await useCopies.getState().follow(OWNER);
  await useCopies.getState().startMoney(WHO, LEADER, form());
  await useCopies.getState().stopMoney(WHO, POLICY);
  const note = useCopies.getState().stopNote;
  assert.deepEqual([note.kind, note.rest, note.stuck.length], ["stopped", true, 1]);
  /* A reload: the note is gone, the row still offers «Take the rest». */
  useCopies.setState({ stopNote: null });
  await useCopies.getState().follow(OWNER);
  const [row] = useCopies.getState().money;
  assert.deepEqual([row.status, row.rest], ["stopped", true]);
  state.calls.length = 0;
  await useCopies.getState().stopMoney(WHO, POLICY, row.review);
  assert.deepEqual(state.calls.map((call) => call.verb), ["stop", "stop/send"], "«Take the rest» is her stop again");
  /* The engine's word on what is left: a send that says nothing is taken as something left. */
  const money = await import("./copy-money.ts");
  const silent = await money.stopWithMoney(WHO, POLICY, {
    fetch: async (url) => ({ ok: true, status: 200, json: async () => (url.endsWith("/stop") ? { transactions: [wireOf()], skipped: [], left: 0 } : { signatures: ["s"], failed: 0, stopped: true }) }),
    sign: async (args) => ({ ok: true, signedWireBase64: args.unsignedWireBase64.map(signedOf) }),
  });
  assert.deepEqual([silent.kind, silent.rest], ["stopped", true]);
  await useCopies.getState().follow(null);
});

test("her copies with money read whatever the switch: unfinished starts and «the rest» as the list reads them", () => {
  const base = moneyRow();
  const [pending, stopped, odd] = moneyOf({ ok: true, money: false, copies: [], moneyCopies: [{ ...base, status: "pending", review: "b".repeat(32) }, { ...base, status: "stopped", rest: true }, { ...base, status: "pending", review: "not a review" }] });
  assert.deepEqual([pending.status, pending.review, pending.rest], ["pending", "b".repeat(32), false]);
  assert.deepEqual([stopped.status, stopped.rest], ["stopped", true]);
  assert.deepEqual([odd.status, odd.review], ["working", null], "an unfinished start without its review's name is none");
  assert.equal(moneyOf({ ok: true, money: false, copies: [], moneyCopies: [base] }).length, 1, "the switch closed: her copies still listed");
  for (const key of ["unfinished", "finish", "takeBack", "restLine", "stopDoneSome", "stopNothingStuck", "partial"]) assert.ok(COPY.en[key] && COPY.uk[key], key);
  assert.equal(COPY.uk.takeRest, "Забрати решту");
});
