import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { bindReferrer, ensureRewardAccount } from "../rewards/ledger.ts";
import { chooseOffered, normalizeLaunch, selfReferralVerdict, withinRecordWindow } from "./partner.ts";
import { readCreatorPartners, readPoolPartner, recheckPoolPartner, recordPoolPartner, resolvePartner } from "./partner-store.ts";
import { linkWallets } from "./wallet-link-store.ts";

const CREATOR = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const PARTNER = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const CONFIG = "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G";
const POOL = "8VtucGA9hvmH8GTVnVRbF5CNNfaLTKie5DyLAEaQJ6e1";
const POOL_2 = "AFoxY8SRfJ2SmCYNRWgXsMN27PpJyy2iUk2zGYsrXc7K";
const TX = "5".repeat(88);
const TX_2 = "4".repeat(88);
const CREATOR_EVM = "0x1111111111111111111111111111111111111111";
const FACTORY_EVM = "0x2222222222222222222222222222222222222222";
const POOL_ID_EVM = `0x${"ab".repeat(32)}`;
const TX_EVM = `0x${"cd".repeat(32)}`;
const NOW = "2026-10-15T12:00:00.000Z";
const LATER = "2026-10-15T12:05:00.000Z";

const launch = (over = {}) => ({ network: "solana", factory: CONFIG, pool: POOL, creator: CREATOR, creationTx: TX, launchedAt: NOW, ...over });

/** Profiles and the team, as the tests need them; `undefined` in `profiles` is a lookup that did not answer. */
function deps({ profiles = {}, team = new Set() } = {}) {
  return {
    profileOf: async (_family, address) => (address in profiles ? profiles[address] : null),
    team: async () => team,
  };
}

async function seed() {
  const store = createMemoryGuardStore();
  const partner = await ensureRewardAccount(store, PARTNER, NOW);
  const other = await ensureRewardAccount(store, OTHER, NOW);
  const creator = await ensureRewardAccount(store, CREATOR, NOW);
  return { store, partner, other, creator };
}

test("the creator's inviter is offered, masked, and the binding is written once; a repeat is the same binding", async () => {
  const { store, partner } = await seed();
  assert.equal((await bindReferrer(store, { wallet: CREATOR, code: partner.code, now: NOW })).ok, true);

  const offered = await resolvePartner(store, deps(), { network: "solana", creator: CREATOR, carriedCode: null, proven: true, choice: { kind: "offered" } });
  assert.equal(offered.ok, true);
  assert.deepEqual(offered.candidate, { wallet: PARTNER, code: partner.code, source: "inviter" });
  assert.deepEqual(offered.view, { partnerMasked: `${PARTNER.slice(0, 4)}…${PARTNER.slice(-4)}`, codeMasked: `${partner.code.slice(0, 4)}…${partner.code.slice(-4)}`, source: "inviter" });
  assert.equal(JSON.stringify(offered.view).includes(PARTNER), false, "the full address never reaches the review");

  const first = await recordPoolPartner(store, deps(), { launch: launch(), partner: offered.candidate, now: NOW });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(first.binding.partner, PARTNER);
  assert.equal(first.binding.partnerCode, partner.code);
  assert.equal(first.binding.rulesVersion, "network-1.0.0");
  assert.equal(first.binding.factory, CONFIG);
  assert.deepEqual(first.binding.checks, { status: "measured", reasons: [], at: NOW });

  const again = await recordPoolPartner(store, deps(), { launch: launch(), partner: offered.candidate, now: LATER });
  assert.equal(again.ok, true);
  assert.equal(again.created, false);
  assert.equal(again.binding.recordedAt, NOW, "the first record stands");
  assert.equal((await readCreatorPartners(store, "solana", CREATOR)).length, 1);
});

test("before signing the creator can change the partner to another code or remove it; the record carries what they chose", async () => {
  const { store, partner, other } = await seed();
  await bindReferrer(store, { wallet: CREATOR, code: partner.code, now: NOW });

  const changed = await resolvePartner(store, deps(), { network: "solana", creator: CREATOR, carriedCode: null, proven: true, choice: { kind: "code", code: `ryntra.io/r/${other.code}` } });
  assert.equal(changed.ok, true);
  assert.deepEqual(changed.candidate, { wallet: OTHER, code: other.code, source: "chosen" });
  const written = await recordPoolPartner(store, deps(), { launch: launch(), partner: changed.candidate, now: NOW });
  assert.equal(written.binding.partner, OTHER);
  assert.equal(written.binding.source, "chosen");

  const removed = await resolvePartner(store, deps(), { network: "solana", creator: CREATOR, carriedCode: null, proven: true, choice: { kind: "none" } });
  assert.deepEqual(removed, { ok: true, candidate: null, decided: true, view: null }, "removing the partner is the creator's own decision");
  const bare = await recordPoolPartner(store, deps(), { launch: launch({ pool: POOL_2, creationTx: TX_2 }), partner: removed.candidate, now: NOW });
  assert.equal(bare.binding.partner, null);
  assert.equal(bare.binding.source, "none");
  assert.equal(bare.binding.checks, null);

  const unknown = await resolvePartner(store, deps(), { network: "solana", creator: CREATOR, carriedCode: null, proven: true, choice: { kind: "code", code: "BCDFGHJKLMNP" } });
  assert.deepEqual(unknown, { ok: false, code: "UNKNOWN_CODE" });
});

test("after the launch nothing moves the binding: another partner, or none, is refused; past the window nothing is written", async () => {
  const { store, partner, other } = await seed();
  await recordPoolPartner(store, deps(), { launch: launch(), partner: { wallet: PARTNER, code: partner.code, source: "carried" }, now: NOW });

  assert.deepEqual(await recordPoolPartner(store, deps(), { launch: launch(), partner: { wallet: OTHER, code: other.code, source: "chosen" }, now: LATER }), { ok: false, code: "FINAL" });
  assert.deepEqual(await recordPoolPartner(store, deps(), { launch: launch(), partner: null, now: LATER }), { ok: false, code: "FINAL" });
  assert.deepEqual(await recordPoolPartner(store, deps(), { launch: launch({ creator: OTHER }), partner: { wallet: PARTNER, code: partner.code, source: "carried" }, now: LATER }), { ok: false, code: "FINAL" });
  assert.equal((await readPoolPartner(store, "solana", POOL)).partner, PARTNER);

  const late = await recordPoolPartner(store, deps(), { launch: launch({ pool: POOL_2, creationTx: TX_2, launchedAt: "2026-10-13T12:00:00.000Z" }), partner: { wallet: PARTNER, code: partner.code, source: "carried" }, now: NOW });
  assert.deepEqual(late, { ok: false, code: "LATE" });
  assert.equal(await readPoolPartner(store, "solana", POOL_2), null);
  assert.equal(withinRecordWindow("2026-10-15T12:03:00.000Z", NOW), true, "a few minutes of clock skew is not the future");
  assert.equal(withinRecordWindow("2026-10-15T13:00:00.000Z", NOW), false);
});

test("for the creator's own proven wallet a self-referral is never offered and their own code is refused: the same wallet, one profile, the team, a linked wallet", async () => {
  const { store, partner, creator } = await seed();
  const offered = (d, over = {}) => resolvePartner(store, d, { network: "solana", creator: CREATOR, carriedCode: partner.code, proven: true, choice: { kind: "offered" }, ...over });

  assert.deepEqual(await offered(deps(), { carriedCode: creator.code }), { ok: true, candidate: null, decided: false, view: null }, "your own link carried back to you");
  assert.deepEqual(await offered(deps(), { carriedCode: null, choice: { kind: "code", code: creator.code } }), { ok: false, code: "SELF_REFERRAL" });
  assert.deepEqual(await offered(deps({ profiles: { [CREATOR]: "acct-1", [PARTNER]: "acct-1" } })), { ok: true, candidate: null, decided: false, view: null }, "one profile");
  /* The team is never an answer — not even to the proven creator: shown, bound with the reason, never paid. */
  const byTeam = await offered(deps({ team: new Set([PARTNER]) }));
  assert.equal(byTeam.candidate.wallet, PARTNER);
  assert.equal((await offered(deps({ team: new Set([PARTNER]) }), { choice: { kind: "code", code: partner.code } })).ok, true);
  const teamBound = await recordPoolPartner(store, deps({ team: new Set([PARTNER]) }), { launch: launch({ pool: POOL_2, creationTx: TX_2 }), partner: byTeam.candidate, now: NOW });
  assert.deepEqual(teamBound.binding.checks.reasons, ["TEAM"]);

  /* A creator on the EVM network whose wallet the partner linked to their own Solana wallet. */
  assert.equal((await linkWallets(store, { solana: PARTNER, evm: CREATOR_EVM, signedAt: NOW, now: NOW })).ok, true);
  assert.deepEqual(await resolvePartner(store, deps(), { network: "arc", creator: CREATOR_EVM, carriedCode: partner.code, proven: true, choice: { kind: "offered" } }), { ok: true, candidate: null, decided: false, view: null });

  /* What is shown is what is bound: the offer that was passed over binds no partner. */
  const dropped = await offered(deps({ profiles: { [CREATOR]: "acct-1", [PARTNER]: "acct-1" } }));
  const bound = await recordPoolPartner(store, deps(), { launch: launch(), partner: dropped.candidate, now: NOW });
  assert.equal(bound.binding.partner, null);
});

test("a proven creator's offer falls through a partner who is themselves to the next one", async () => {
  const { store, partner, other } = await seed();
  await bindReferrer(store, { wallet: CREATOR, code: partner.code, now: NOW });
  const next = await resolvePartner(store, deps({ profiles: { [CREATOR]: "acct-1", [PARTNER]: "acct-1" } }), { network: "solana", creator: CREATOR, carriedCode: other.code, proven: true, choice: { kind: "offered" } });
  assert.deepEqual(next.candidate, { wallet: OTHER, code: other.code, source: "carried" });
});

test("for anybody else the answer never depends on whether two wallets are one person; the binding carries the reasons and is never paid", async () => {
  const { store, partner, creator } = await seed();
  const asked = (d, over = {}) => resolvePartner(store, d, { network: "solana", creator: CREATOR, carriedCode: partner.code, proven: false, choice: { kind: "offered" }, ...over });
  const plain = await asked(deps());
  const sameProfile = deps({ profiles: { [CREATOR]: "acct-1", [PARTNER]: "acct-1" } });
  assert.deepEqual(await asked(sameProfile), plain, "one profile changes nothing a stranger can see");
  assert.deepEqual(await asked(deps({ team: new Set([PARTNER]) })), plain, "nor does the team");
  const ownCode = await asked(sameProfile, { carriedCode: null, choice: { kind: "code", code: partner.code } });
  assert.equal(ownCode.ok, true, "an unproven request is never told a code belongs to a wallet of the creator's");
  /* Not even the given wallet's own code is told apart: that would confirm who owns a code. It binds with SAME_WALLET. */
  assert.equal((await asked(deps(), { carriedCode: null, choice: { kind: "code", code: creator.code } })).candidate.wallet, CREATOR);
  assert.equal((await asked(deps(), { carriedCode: creator.code })).candidate.wallet, CREATOR);

  const kept = await recordPoolPartner(store, sameProfile, { launch: launch(), partner: plain.candidate, now: NOW });
  assert.deepEqual(kept.binding.checks.reasons, ["SAME_PROFILE"], "written for review, never paid");
  const self = await recordPoolPartner(store, deps({ team: new Set([CREATOR]) }), { launch: launch({ pool: POOL_2, creationTx: TX_2 }), partner: { wallet: CREATOR, code: creator.code, source: "carried" }, now: NOW });
  assert.deepEqual(self.binding.checks.reasons, ["SAME_WALLET", "TEAM"], "even a self binding a caller forces in is written with its reasons");

  /* A lookup that did not answer is not a clean bill. */
  const blind = await recordPoolPartner(store, deps({ profiles: { [CREATOR]: undefined } }), { launch: launch({ pool: "Ef6hbGUbG9ETDRTXHwZxmVVs6hcgTpkaCAHAH3i95vu2", creationTx: "3".repeat(88) }), partner: plain.candidate, now: NOW });
  assert.deepEqual(blind.binding.checks, { status: "unavailable", reasons: [], at: NOW });
  const noTeam = selfReferralVerdict({ wallet: CREATOR, linked: [], profiles: [], unavailable: false }, { wallet: PARTNER, linked: [], profiles: [], unavailable: false }, null);
  assert.deepEqual(noTeam, { status: "unavailable", reasons: [] });
});

test("a store that does not answer while an offer is looked for offers nothing; it never fails the launch", async () => {
  const { store, partner } = await seed();
  const broken = { ...store, collection: (name) => (name === "rewardCodes" ? { get: async () => { throw new Error("store down"); } } : store.collection(name)) };
  assert.deepEqual(await resolvePartner(broken, deps(), { network: "solana", creator: CREATOR, carriedCode: "BCDFGHJKLMNP", proven: false, choice: { kind: "offered" } }), { ok: true, candidate: null, decided: false, view: null });

  /* The proven creator's own history failing to read falls back to the link's code, never to nothing. */
  const historyDown = { ...store, collection: (name) => (name === "growthPoolPartners" ? { valuesWithPrefix: async () => { throw new Error("store down"); }, get: async () => undefined } : store.collection(name)) };
  const fallback = await resolvePartner(historyDown, deps(), { network: "solana", creator: CREATOR, carriedCode: partner.code, proven: true, choice: { kind: "offered" } });
  assert.deepEqual(fallback.candidate, { wallet: PARTNER, code: partner.code, source: "carried" });
});

test("a profile proven after the launch adds a reason on the check before paying; it never removes one", async () => {
  const { store, partner } = await seed();
  const written = await recordPoolPartner(store, deps(), { launch: launch(), partner: { wallet: PARTNER, code: partner.code, source: "carried" }, now: NOW });
  assert.deepEqual(written.binding.checks.reasons, []);
  const later = await recheckPoolPartner(store, deps({ profiles: { [CREATOR]: "acct-9", [PARTNER]: "acct-9" } }), written.binding);
  assert.deepEqual(later, { status: "measured", reasons: ["SAME_PROFILE"] });
  assert.deepEqual((await readPoolPartner(store, "solana", POOL)).checks.reasons, [], "the binding itself is not rewritten");
});

test("the next launch of the same creator is offered the same partner, ahead of their inviter and of a newer link", async () => {
  const { store, partner, other } = await seed();
  await recordPoolPartner(store, deps(), { launch: launch(), partner: { wallet: PARTNER, code: partner.code, source: "carried" }, decided: true, now: NOW });
  await bindReferrer(store, { wallet: CREATOR, code: other.code, now: NOW });

  const next = await resolvePartner(store, deps(), { network: "solana", creator: CREATOR, carriedCode: other.code, proven: true, choice: { kind: "offered" } });
  assert.deepEqual(next.candidate, { wallet: PARTNER, code: partner.code, source: "previous" });
  assert.equal(next.view.source, "previous");

  /* Who partnered a wallet's launches is that wallet's business: without its proof only the browser's own code is read. */
  const stranger = await resolvePartner(store, deps(), { network: "solana", creator: CREATOR, carriedCode: null, proven: false, choice: { kind: "offered" } });
  assert.equal(stranger.candidate, null);

  /* A partner the creator removed on their latest launch is not brought back from an earlier one. */
  /* A launch that was not the creator's own decision — no proof, nothing to offer, or only a link — changes nothing. */
  await recordPoolPartner(store, deps(), { launch: launch({ pool: "Ef6hbGUbG9ETDRTXHwZxmVVs6hcgTpkaCAHAH3i95vu2", creationTx: "3".repeat(88), launchedAt: "2026-10-15T12:02:00.000Z" }), partner: null, now: LATER });
  await recordPoolPartner(store, deps(), { launch: launch({ pool: "9qyVyLMRoCwGxDRscUJ6Ae8QV1vUKoQRy8NZch3XvRaX", creationTx: "2".repeat(88), launchedAt: "2026-10-15T12:03:00.000Z" }), partner: { wallet: OTHER, code: other.code, source: "carried" }, now: LATER });
  const still = await resolvePartner(store, deps(), { network: "solana", creator: CREATOR, carriedCode: other.code, proven: true, choice: { kind: "offered" } });
  assert.deepEqual(still.candidate, { wallet: PARTNER, code: partner.code, source: "previous" });

  await recordPoolPartner(store, deps(), { launch: launch({ pool: POOL_2, creationTx: TX_2, launchedAt: LATER }), partner: null, decided: true, now: LATER });
  const afterRemoval = await resolvePartner(store, deps(), { network: "solana", creator: CREATOR, carriedCode: other.code, proven: true, choice: { kind: "offered" } });
  assert.equal(afterRemoval.candidate, null);

  /* A binding with a reason of the creator's own is not carried to the next launch; one with the team alone still decides, so the team is never told. */
  const choose = chooseOffered({
    previous: [{ ...(await readPoolPartner(store, "solana", POOL)), checks: { status: "measured", reasons: ["SAME_PROFILE"], at: NOW } }],
    inviter: null,
    carried: { wallet: OTHER, code: other.code },
  });
  assert.equal(choose.source, "carried");
  const teamOnly = chooseOffered({
    previous: [{ ...(await readPoolPartner(store, "solana", POOL)), checks: { status: "measured", reasons: ["TEAM"], at: NOW } }],
    inviter: null,
    carried: { wallet: OTHER, code: other.code },
  });
  assert.equal(teamOnly.source, "previous");

  /* With no decision yet, a partner an earlier launch was bound to from a link still comes before the inviter. */
  const undecided = chooseOffered({
    previous: [{ ...(await readPoolPartner(store, "solana", POOL)), decided: false, partner: OTHER, partnerCode: other.code }],
    inviter: { wallet: PARTNER, code: partner.code },
    carried: null,
  });
  assert.deepEqual(undecided, { wallet: OTHER, code: other.code, source: "previous" });
});

test("the EVM network binds the same way, its addresses in one spelling; the linked Solana wallet's inviter is offered", async () => {
  const { store, partner } = await seed();
  await bindReferrer(store, { wallet: OTHER, code: partner.code, now: NOW });
  await linkWallets(store, { solana: OTHER, evm: CREATOR_EVM, signedAt: NOW, now: NOW });

  const offered = await resolvePartner(store, deps(), { network: "arc", creator: CREATOR_EVM.toUpperCase().replace("0X", "0x"), carriedCode: null, proven: true, choice: { kind: "offered" } });
  assert.deepEqual(offered.candidate, { wallet: PARTNER, code: partner.code, source: "inviter" });
  const written = await recordPoolPartner(store, deps(), {
    launch: { network: "arc", factory: FACTORY_EVM.toUpperCase().replace("0X", "0x"), pool: POOL_ID_EVM, creator: CREATOR_EVM, creationTx: TX_EVM, launchedAt: NOW },
    partner: offered.candidate,
    now: NOW,
  });
  assert.equal(written.ok, true);
  assert.equal(written.binding.factory, FACTORY_EVM);
  assert.equal((await readPoolPartner(store, "arc", POOL_ID_EVM)).partner, PARTNER);
  assert.equal(normalizeLaunch(launch({ network: "arc" })), null, "a Solana address is not an EVM launch");
});

test("the carried code is read from a raw cookie header; a native client carries none", async () => {
  const { carriedCodeFrom } = await import("./partner.ts");
  assert.equal(carriedCodeFrom("theme=dark; rref=BCDFGHJKLMNP; rref_at=1"), "BCDFGHJKLMNP");
  assert.equal(carriedCodeFrom("rref=BCDFGHJKLMNP"), "BCDFGHJKLMNP");
  assert.equal(carriedCodeFrom("xrref=BCDFGHJKLMNP"), null);
  assert.equal(carriedCodeFrom(null), null);
});
