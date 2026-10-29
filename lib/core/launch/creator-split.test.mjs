import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, PublicKey } from "@solana/web3.js";

import {
  CREATOR_DEPTH_RULE,
  SPLIT_HOLDERS_PER_ROUND,
  creatorDepthLadder,
  depthRangePct,
  holderSnapshot,
  holdersPayout,
  parseSplitRuleMemo,
  splitDue,
  splitLeaf,
  splitMinimums,
  splitOutstanding,
  splitProblems,
  splitProof,
  splitRaiseProblems,
  splitRoot,
  splitRoundMemo,
  splitRuleLines,
  splitRuleMemo,
  verifySplitProof,
} from "./creator-split.ts";

const CREATOR = Keypair.generate().publicKey.toBase58();
const COMMUNITY = Keypair.generate().publicKey.toBase58();
const TOKEN = Keypair.generate().publicKey.toBase58();
const rule = (shares, community = null) => ({ shares: { self: 0, depth: 0, community: 0, holders: 0, ...shares }, community });
const segment = (r, fromEarnedRaw, at = 1_800_000_000) => ({ rule: r, fromEarnedRaw: String(fromEarnedRaw), at, signature: "sig" });

test("a rule holds when its parts are whole, add up to the creator's whole share and give something away", () => {
  assert.deepEqual(splitProblems(rule({ self: 5_000, depth: 2_000, holders: 3_000 }), CREATOR), []);
  assert.deepEqual(splitProblems(rule({ self: 6_000, community: 4_000 }, COMMUNITY), CREATOR), []);
  const codes = (r, excluded) => splitProblems(r, CREATOR, excluded);
  assert.deepEqual(codes(rule({ self: 10_000 })), ["NOTHING_SHARED"], "all to self is no rule");
  assert.deepEqual(codes(rule({ self: 5_000, depth: 4_000 })), ["NOT_ALL"]);
  assert.deepEqual(codes(rule({ self: 9_950, holders: 50 })), ["SHARE_TOO_SMALL"]);
  assert.deepEqual(codes(rule({ self: 5_000, depth: 4_999.5, holders: 0.5 })), ["NOT_WHOLE"]);
  assert.deepEqual(codes(rule({ self: 5_000, community: 5_000 })), ["COMMUNITY_WALLET_MISSING"]);
  assert.deepEqual(codes(rule({ self: 5_000, depth: 5_000 }, COMMUNITY)), ["COMMUNITY_WALLET_UNUSED"]);
  assert.deepEqual(codes(rule({ self: 5_000, community: 5_000 }, CREATOR)), ["COMMUNITY_IS_CREATOR"]);
  assert.deepEqual(codes(rule({ self: 5_000, community: 5_000 }, "not-an-address")), ["NOT_AN_ADDRESS"]);
  assert.deepEqual(codes(rule({ self: 5_000, community: 5_000 }, "2".repeat(32))), ["NOT_AN_ADDRESS"], "base58 of fewer than 32 bytes is no key");
  assert.deepEqual(codes(rule({ self: 5_000, community: 5_000 }, "z".repeat(44))), ["NOT_AN_ADDRESS"], "nor of more");
  assert.deepEqual(codes(rule({ self: 5_000, community: 5_000 }, COMMUNITY), new Set([COMMUNITY])), ["COMMUNITY_EXCLUDED"], "Ryntra's wallet is no community");
});

test("a rule may only be raised: no given part lowered, the community's wallet kept, and a change at all", () => {
  const now = rule({ self: 6_000, depth: 2_000, community: 2_000 }, COMMUNITY);
  assert.deepEqual(splitRaiseProblems(now, rule({ self: 4_000, depth: 2_000, community: 2_000, holders: 2_000 }, COMMUNITY)), []);
  assert.deepEqual(splitRaiseProblems(now, rule({ self: 7_000, depth: 1_000, community: 2_000 }, COMMUNITY)), ["LOWERED"]);
  assert.deepEqual(splitRaiseProblems(now, rule({ self: 6_000, depth: 2_000, community: 2_000 }, CREATOR)), ["WALLET_CHANGED"]);
  assert.deepEqual(splitRaiseProblems(now, now), ["SAME"]);
});

test("what the rule owes is what the creator claimed after the rule's earnings began, divided by the rule, rounded down", () => {
  const r = rule({ self: 5_000, depth: 2_000, community: 1_000, holders: 2_000 }, COMMUNITY);
  /* 100 earned before the rule: the first 100 claimed are not the rule's. */
  assert.equal(splitDue([segment(r, 100)], 60n).subjectRaw, 0n);
  const { due, subjectRaw } = splitDue([segment(r, 100)], 1_103n);
  assert.equal(subjectRaw, 1_003n);
  assert.deepEqual(due, { depth: 200n, community: 100n, holders: 200n, self: 503n }, "the given parts rounded down, «собі» the rest");
  assert.equal(due.self + due.depth + due.community + due.holders, subjectRaw, "nothing lost in rounding");
});

test("a raised rule divides the earnings from its own moment on; earlier ones keep the old rule", () => {
  const first = rule({ self: 8_000, holders: 2_000 });
  const second = rule({ self: 5_000, holders: 3_000, depth: 2_000 });
  const segments = [segment(first, 0), segment(second, 1_000)];
  const { due } = splitDue(segments, 1_500n);
  assert.deepEqual(due, { self: 800n + 250n, holders: 200n + 150n, depth: 100n, community: 0n });
  assert.deepEqual(splitDue(segments, 400n).due, { self: 320n, holders: 80n, depth: 0n, community: 0n }, "the second rule owes nothing before its earnings are claimed");
});

test("what is outstanding is what is owed less what was done, never below zero", () => {
  const due = { self: 0n, depth: 100n, community: 50n, holders: 30n };
  assert.deepEqual(splitOutstanding(due, { depth: 40n, community: 60n, holders: 0n }), { depth: 60n, community: 0n, holders: 30n });
});

test("the least amounts follow the pair's dollar price, and the stand moves cents", () => {
  const usdc = { decimals: 6, usdPrice: 1 };
  assert.deepEqual(splitMinimums(usdc, "mainnet"), { depthRaw: 10_000_000n, communityRaw: 1_000_000n, holdersRoundRaw: 5_000_000n, perHolderRaw: 10_000n });
  assert.equal(splitMinimums({ decimals: 9, usdPrice: 200 }, "mainnet").depthRaw, 50_000_000n, "$10 of a $200 coin is 0.05");
  assert.equal(splitMinimums(usdc, "devnet").perHolderRaw, 1n);
});

test("the snapshot adds an owner's accounts up and leaves out the creator, the linked, the bundle, programs and Ryntra", () => {
  const people = Array.from({ length: 4 }, () => Keypair.generate().publicKey.toBase58());
  const [a, b, bundled, ryntra] = people;
  const vault = PublicKey.findProgramAddressSync([Buffer.from("vault")], new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"))[0].toBase58();
  const snapshot = holderSnapshot(
    [
      { owner: a, amountRaw: "100" },
      { owner: a, amountRaw: "50" },
      { owner: b, amountRaw: "300" },
      { owner: CREATOR, amountRaw: "1000" },
      { owner: COMMUNITY, amountRaw: "70" },
      { owner: bundled, amountRaw: "500" },
      { owner: ryntra, amountRaw: "20" },
      { owner: vault, amountRaw: "900000" },
      { owner: b, amountRaw: "0" },
    ],
    {
      creator: CREATOR,
      linked: new Set([COMMUNITY]),
      bundle: new Set([bundled]),
      ryntra: new Set([ryntra]),
      onCurve: (address) => PublicKey.isOnCurve(new PublicKey(address).toBytes()),
      bought: new Map([[a, 150n], [b, 300n]]),
    },
  );
  assert.deepEqual(snapshot.eligible, [{ wallet: b, amountRaw: "300" }, { wallet: a, amountRaw: "150" }]);
  assert.deepEqual(snapshot.excluded.unbought, { wallets: 0, amountRaw: "0" });
  assert.deepEqual(snapshot.excluded.creator, { wallets: 1, amountRaw: "1000" });
  assert.deepEqual(snapshot.excluded.linked, { wallets: 1, amountRaw: "70" });
  assert.deepEqual(snapshot.excluded.bundle, { wallets: 1, amountRaw: "500" });
  assert.deepEqual(snapshot.excluded.program, { wallets: 1, amountRaw: "900000" }, "a curve's vault is no holder");
  assert.deepEqual(snapshot.excluded.ryntra, { wallets: 1, amountRaw: "20" });
});

test("only what a wallet bought on the market and still holds counts: tokens received by a transfer earn nothing", () => {
  const [fresh, buyer, flipper] = Array.from({ length: 3 }, () => Keypair.generate().publicKey.toBase58());
  const snapshot = holderSnapshot(
    [
      { owner: fresh, amountRaw: "5000" },
      { owner: buyer, amountRaw: "800" },
      { owner: flipper, amountRaw: "400" },
    ],
    { creator: CREATOR, linked: new Set(), bundle: new Set(), ryntra: new Set(), onCurve: () => true, bought: new Map([[buyer, 500n], [flipper, -10n]]) },
  );
  assert.deepEqual(snapshot.eligible, [{ wallet: buyer, amountRaw: "500" }], "the creator's fresh wallet, filled by a transfer, holds nothing it bought");
  assert.deepEqual(snapshot.excluded.unbought, { wallets: 3, amountRaw: "5700" });
});

test("a round pays the largest holders by what they hold, rounded down; a part below the least is not paid and stays owed", () => {
  const eligible = [
    { wallet: "W1", amountRaw: "600" },
    { wallet: "W2", amountRaw: "300" },
    { wallet: "W3", amountRaw: "99" },
    { wallet: "W4", amountRaw: "1" },
  ];
  const paid = holdersPayout(1_000n, { eligible }, { perHolderRaw: 5n });
  assert.deepEqual(paid.rows.map((row) => [row.wallet, row.amountRaw]), [["W1", "600"], ["W2", "300"], ["W3", "99"]]);
  assert.equal(paid.totalRaw, 999n, "W4's single unit is below the least: owed for a next round");
  const many = Array.from({ length: SPLIT_HOLDERS_PER_ROUND + 5 }, (_, index) => ({ wallet: `W${index}`, amountRaw: "10" }));
  assert.equal(holdersPayout(1_000_000n, { eligible: many }, { perHolderRaw: 1n }).rows.length, SPLIT_HOLDERS_PER_ROUND);
  assert.equal(holdersPayout(0n, { eligible }, { perHolderRaw: 1n }).rows.length, 0);
});

test("the root is the same for the same rows in any order, and each row's proof leads to it", async () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ wallet: Keypair.generate().publicKey.toBase58(), amountRaw: String(1_000 + index) }));
  const root = await splitRoot(rows);
  assert.match(root, /^[0-9a-f]{64}$/);
  assert.equal(await splitRoot([...rows].reverse()), root);
  for (const row of rows) {
    const proof = await splitProof(rows, row.wallet);
    assert.ok(await verifySplitProof(row, proof, root), "the proof holds");
    assert.equal(await verifySplitProof({ ...row, amountRaw: "1" }, proof, root), false, "another amount does not");
  }
  assert.equal(await splitProof(rows, CREATOR), null);
  assert.equal(await splitRoot([]), "0".repeat(64));
  assert.equal(await splitRoot([rows[0]]), await splitLeaf(rows[0]), "one row is its own root");
});

test("the rule's memo reads back as the rule, and the round's memo names the root", () => {
  const r = rule({ self: 5_000, depth: 2_000, community: 1_000, holders: 2_000 }, COMMUNITY);
  const memo = splitRuleMemo(TOKEN, r);
  assert.ok(Buffer.byteLength(memo) < 200);
  assert.deepEqual(parseSplitRuleMemo(memo), { token: TOKEN, rule: r });
  assert.equal(parseSplitRuleMemo("ryntra:split:1:rule:x"), null);
  assert.equal(splitRoundMemo(TOKEN, 2, "ab".repeat(32), 3, 900n), `ryntra:split:1:round:${TOKEN}:2:${"ab".repeat(32)}:3:900`);
});

test("the depth steps stand from about −3 % to about −25 % under the reference, inside one position", () => {
  const onePct = creatorDepthLadder(1_000, 100);
  assert.deepEqual(onePct, { lowerBinId: 1_000 - 28, upperBinId: 1_000 - 4 });
  const range = depthRangePct(onePct, 1_000, 100);
  assert.ok(range.fromPct >= CREATOR_DEPTH_RULE.topGapPct && range.fromPct < 4.5, `top ${range.fromPct}`);
  assert.ok(range.toPct <= CREATOR_DEPTH_RULE.deepestPct && range.toPct > 23, `bottom ${range.toPct}`);
  const fine = creatorDepthLadder(0, 10);
  assert.equal(fine.upperBinId - fine.lowerBinId + 1, CREATOR_DEPTH_RULE.maxBins, "a fine bin step is cut to one position's width");
  assert.ok(fine.upperBinId < 0);
});

test("the lines before a purchase say each given part, who carries it out, and promise no income", () => {
  const r = rule({ self: 5_000, depth: 2_000, community: 1_000, holders: 2_000 }, COMMUNITY);
  const uk = splitRuleLines(r, { since: 1_800_000_000, pairSymbol: "USDC" }, "uk");
  assert.match(uk[0], /собі 50 % · глибина 20 % · спільнота 10 % · холдерам 20 %/);
  assert.ok(uk.some((line) => /бандл творця/.test(line) && /Корінь/.test(line)));
  assert.match(uk.at(-1), /не обіцянка доходу/);
  assert.match(uk.at(-1), /Ryntra бере 0/);
  const en = splitRuleLines(rule({ self: 9_000, holders: 1_000 }), { since: 1_800_000_000, pairSymbol: "USDC" }, "en");
  assert.equal(en.length, 3, "no depth or community line where they take nothing");
  assert.match(en.at(-1), /no promise of income/);
});

test("Closed, read by the server and the cabinet alike", async () => {
  const { readFileSync } = await import("node:fs");
  const { CREATOR_SPLIT_OWNER_WORD } = await import("./creator-split.ts");
  assert.equal(CREATOR_SPLIT_OWNER_WORD, false);
  const server = readFileSync(new URL("../../launch/creator-split.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(server, /export const CREATOR_SPLIT_OWNER_WORD/, "no second value on the server");
  const block = readFileSync(new URL("../../../app/app/launch/mine/split-block.tsx", import.meta.url), "utf8");
  /* Closed there: the cabinet neither reads nor draws the split — no «reading…» or «not read» on every row. */
  assert.match(block, /const closedHere = network === "solana:mainnet" && !CREATOR_SPLIT_OWNER_WORD;/);
  assert.match(block, /if \(!closedHere\) void load\(\);/);
  assert.match(block, /if \(closedHere\) return null;\n\s*if \(view === null\)/);
});
