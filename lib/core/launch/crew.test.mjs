import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CREW_OWNER_WORD, consentWords, creatorPartBps, crewFeeShares, crewInviteWords, crewOpenOn, crewProblems, handleOf, isCrewPreset } from "./crew.ts";
import { feeShareProblems } from "./fee-shares.ts";

const CREATOR = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const ADA = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTO = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";

test("a handle is X's own: one to fifteen letters, digits and underscores, typed with its decorations", () => {
  assert.equal(handleOf("@Ada_R"), "Ada_R");
  assert.equal(handleOf("https://x.com/Ada_R"), "Ada_R");
  assert.equal(handleOf("twitter.com/x"), null, "a bare domain is no handle");
  assert.equal(handleOf("@ada-r"), null);
  assert.equal(handleOf("a".repeat(16)), null);
});

test("the invitations hold: one to four different handles, each at least 1 %, and at least 1 % left to the creator", () => {
  assert.deepEqual(crewProblems([{ handle: "ada", bps: 2000 }]), []);
  assert.deepEqual(crewProblems([]), ["TOO_FEW"]);
  assert.ok(crewProblems(Array.from({ length: 5 }, (_, i) => ({ handle: `m${i}`, bps: 100 }))).includes("TOO_MANY"));
  assert.ok(crewProblems([{ handle: "Ada", bps: 1000 }, { handle: "ada", bps: 1000 }]).includes("HANDLE_REPEATED"), "a handle is one person whatever its case");
  assert.ok(crewProblems([{ handle: "ada", bps: 99 }]).includes("SHARE_TOO_SMALL"));
  assert.ok(crewProblems([{ handle: "ada", bps: 9950 }]).includes("CREATOR_SHARE_TOO_SMALL"));
  assert.ok(crewProblems([{ handle: "ada", bps: 10.5 }]).includes("SHARE_NOT_WHOLE"));
  assert.ok(crewProblems([{ handle: "me", bps: 1000 }], "ME").includes("HANDLE_IS_CREATOR"));
});

test("the vault's rows: the creator and every member who said yes; a part nobody accepted stays the creator's", () => {
  const members = [
    { handle: "ada", bps: 2000, state: "ACCEPTED", wallet: ADA, answeredAt: "x" },
    { handle: "oto", bps: 1500, state: "INVITED", wallet: null, answeredAt: null },
    { handle: "kai", bps: 500, state: "DECLINED", wallet: null, answeredAt: "x" },
  ];
  const shares = crewFeeShares(CREATOR, members);
  assert.deepEqual(shares, [{ address: CREATOR, bps: 8000 }, { address: ADA, bps: 2000 }]);
  assert.deepEqual(feeShareProblems(CREATOR, shares), [], "the program's own rule holds");
  assert.equal(crewFeeShares(CREATOR, members.map((m) => ({ ...m, state: "INVITED", wallet: null }))), null, "nobody aboard — no vault");
  assert.equal(crewFeeShares(CREATOR, [{ ...members[0], wallet: CREATOR }]), null, "the creator is never their own member");
  assert.equal(crewFeeShares(CREATOR, [members[0], { ...members[1], state: "ACCEPTED", wallet: ADA }]), null, "a wallet is aboard once");
  assert.equal(creatorPartBps([{ bps: 2000, state: "ACCEPTED" }, { bps: 1500, state: "ACCEPTED" }]), 6500);
  assert.equal(crewFeeShares(CREATOR, [members[0], { ...members[1], state: "ACCEPTED", wallet: OTO }]).length, 3);
});

test("the yes is to words that promise nothing; the invitation post is the creator's own; mainnet waits for its own word", () => {
  const words = consentWords({ symbol: "KITE", creator: CREATOR }, { handle: "ada", bps: 2000 });
  const text = words.join(" ");
  assert.match(text, /@ada/);
  assert.match(text, /20% of the creator's fees/);
  assert.match(text, /fixed for ever/);
  assert.match(text, /until I claim them with this wallet/);
  assert.doesNotMatch(text, /guarantee|profit|moon|100x|earn up to/i);
  assert.equal(crewInviteWords("KITE", ["ada", "oto"]), "@ada @oto join my crew for $KITE on Ryntra — your part of the creator's fees is waiting for your yes.");
  assert.equal(CREW_OWNER_WORD, false, "closed on mainnet");
  assert.equal(crewOpenOn("devnet"), true);
  assert.equal(crewOpenOn("mainnet"), false);
  assert.equal(crewOpenOn("mainnet", true), true);
  assert.ok(isCrewPreset("classic") && isCrewPreset("protected"));
  assert.ok(!isCrewPreset("community") && !isCrewPreset("micro"), "«Спільнота» keeps its own rows; Micro its lock");
  assert.match(readFileSync(new URL("./creator-split.ts", import.meta.url), "utf8"), /export const CREATOR_SPLIT_OWNER_WORD = false;/);
});
