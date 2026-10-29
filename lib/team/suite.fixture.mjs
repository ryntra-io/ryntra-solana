import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { TEAM_PERMISSIONS, TEAM_ROLES, grantOf } from "../core/team/roles.ts";
import { authorizeTeamAction, changeMember, createTeam, inviteMember, linkTreasury, listTeams, readTeam } from "./service.server.ts";

/**
 * The behaviour every team store passes (TEAM-1): the memory adapter in `service.test.mjs`, Postgres in
 * `store-postgres.test.mjs` against a throwaway database the migration ran on. Not a test file by itself.
 */

/* Wallets: base58, the same shape a proven wallet has. */
export const OWNER = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const ADMIN = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const FIN = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
const AGENT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const OTHER = "So11111111111111111111111111111111111111112";
const TREASURY = "AmKrrLoHrYr7EUu5zMzAvYYADCiZ8SNFjd85uwjSSUVo";
const NOT_SQUADS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const SIGNERS = [
  { address: OWNER, initiate: true, vote: true, execute: true },
  { address: FIN, initiate: true, vote: true, execute: false },
  { address: ADMIN, initiate: false, vote: true, execute: false },
];

/** A chain with one multisig on it; anything else reads as Squads' own refusal. */
function chain(signers = SIGNERS) {
  return async (address) => {
    if (address === TREASURY) return signers;
    throw Object.assign(new Error("No multisig"), { code: "TREASURY_NOT_FOUND" });
  };
}

export const depsOf = (store, over = {}) => ({
  store,
  network: "solana:mainnet",
  now: () => new Date("2026-10-25T12:00:00Z"),
  readSigners: chain(),
  env: { NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "mainnet" },
  newId: () => randomBytes(12).toString("hex"),
  ...over,
});

async function teamWith(deps, members = []) {
  const made = await createTeam(deps, { wallet: OWNER, name: "  Kite   Labs ", kind: "PROJECT_TEAM" });
  assert.equal(made.ok, true);
  const id = made.state.team.id;
  for (const [wallet, role] of members) {
    assert.equal((await inviteMember(deps, { id, actor: OWNER, wallet, role })).ok, true);
    assert.equal((await changeMember(deps, { id, actor: wallet, wallet, change: { action: "accept" } })).ok, true);
  }
  return id;
}

/** The suite every store passes: memory here, Postgres below when a database is named. */
export function teamSuite(name, makeStore) {
  test(`${name}: a team is made with its maker as the only Owner, and the name is cleaned`, async () => {
    const deps = depsOf(await makeStore());
    const id = await teamWith(deps);
    const read = await readTeam(deps, id, OWNER);
    assert.equal(read.ok, true);
    assert.equal(read.team.name, "Kite Labs");
    assert.equal(read.team.you.role, "OWNER");
    assert.deepEqual(read.team.members.map((row) => [row.wallet, row.role, row.status]), [[OWNER, "OWNER", "ACTIVE"]]);
    assert.deepEqual(read.team.journal.map((row) => row.action), ["TEAM_CREATED"]);
    assert.equal(read.team.signers, null);
  });

  test(`${name}: one wallet in several teams, with a different role in each`, async () => {
    const deps = depsOf(await makeStore());
    const first = await teamWith(deps, [[FIN, "FINANCE"]]);
    const second = await teamWith(deps, [[FIN, "VIEWER"]]);
    const mine = await listTeams(deps, FIN);
    const byId = (a, b) => a[0].localeCompare(b[0]);
    assert.deepEqual(mine.teams.map((row) => [row.id, row.role, row.status]).sort(byId), [[first, "FINANCE", "ACTIVE"], [second, "VIEWER", "ACTIVE"]].sort(byId));
    assert.equal((await authorizeTeamAction(deps, { teamId: first, wallet: FIN, permission: "draft" })).decision.allowed, true);
    assert.equal((await authorizeTeamAction(deps, { teamId: second, wallet: FIN, permission: "draft" })).decision.refusal, "ROLE_DENIES");
  });

  test(`${name}: every role × every right is checked on the server from the stored list`, async () => {
    const deps = depsOf(await makeStore());
    const id = await teamWith(deps);
    await linkTreasury(deps, { id, actor: OWNER, multisig: TREASURY });
    for (const role of TEAM_ROLES) {
      /* The member's role is changed on the stored list; each check reads it there. */
      if (role !== "OWNER") {
        await inviteMember(deps, { id, actor: OWNER, wallet: FIN, role });
        await changeMember(deps, { id, actor: FIN, wallet: FIN, change: { action: "accept" } });
      }
      const wallet = role === "OWNER" ? OWNER : FIN;
      for (const permission of TEAM_PERMISSIONS) {
        const { decision } = await authorizeTeamAction(deps, { teamId: id, wallet, permission });
        const grant = grantOf(role, permission);
        /* `deploy` runs through MOS-2's row `ryntra.team-launch`, closed until the owner's own switch opens it. */
        const expected = grant === "DENY" ? "ROLE_DENIES" : permission === "deploy" ? "AUTHORITY_CLOSED" : null;
        assert.equal(decision.refusal, expected, `${role} × ${permission}`);
        assert.equal(decision.allowed, expected === null, `${role} × ${permission}`);
      }
      if (role !== "OWNER") await changeMember(deps, { id, actor: OWNER, wallet: FIN, change: { action: "remove" } });
    }
  });

  test(`${name}: a high-risk right needs the wallet's own Squads permission on the treasury, read on chain`, async () => {
    const deps = depsOf(await makeStore());
    const id = await teamWith(deps, [[ADMIN, "ADMIN"], [FIN, "FINANCE"]]);
    assert.equal((await authorizeTeamAction(deps, { teamId: id, wallet: FIN, permission: "payout" })).decision.refusal, "NO_TREASURY");
    await linkTreasury(deps, { id, actor: OWNER, multisig: TREASURY });
    const fin = await authorizeTeamAction(deps, { teamId: id, wallet: FIN, permission: "payout" });
    assert.equal(fin.decision.allowed, true);
    assert.equal(fin.decision.requires, "MULTISIG");
    assert.equal(fin.decision.multisig, TREASURY);
    /* The Admin's role proposes a payout; their key only votes on the multisig — the chain says no. */
    assert.equal((await authorizeTeamAction(deps, { teamId: id, wallet: ADMIN, permission: "payout" })).decision.refusal, "NOT_A_SIGNER");
    assert.equal((await authorizeTeamAction(deps, { teamId: id, wallet: ADMIN, permission: "sign" })).decision.allowed, true);
    /* The chain unread: nothing on a guess. */
    const blind = { ...deps, readSigners: async () => Promise.reject(new Error("node down")) };
    assert.equal((await authorizeTeamAction(blind, { teamId: id, wallet: FIN, permission: "payout" })).decision.refusal, "SIGNERS_UNREAD");
    assert.equal((await authorizeTeamAction({ ...deps, readSigners: null }, { teamId: id, wallet: FIN, permission: "payout" })).decision.refusal, "SIGNERS_UNREAD");
    /* The row closed on this deployment: refused before the chain is read. */
    assert.equal((await authorizeTeamAction({ ...deps, env: {} }, { teamId: id, wallet: FIN, permission: "payout" })).decision.refusal, "AUTHORITY_CLOSED");
  });

  test(`${name}: removal closes access from the next request, and the signer left on chain is shown`, async () => {
    const deps = depsOf(await makeStore());
    const id = await teamWith(deps, [[FIN, "FINANCE"]]);
    await linkTreasury(deps, { id, actor: OWNER, multisig: TREASURY });
    assert.equal((await authorizeTeamAction(deps, { teamId: id, wallet: FIN, permission: "payout" })).decision.allowed, true);
    assert.equal((await changeMember(deps, { id, actor: OWNER, wallet: FIN, change: { action: "remove" } })).ok, true);
    assert.equal((await authorizeTeamAction(deps, { teamId: id, wallet: FIN, permission: "payout" })).code, "NOT_FOUND");
    assert.equal((await readTeam(deps, id, FIN)).code, "NOT_FOUND");
    const owner = await readTeam(deps, id, OWNER);
    assert.equal(owner.team.signers.read, "OK");
    assert.deepEqual(owner.team.signers.rows.filter((row) => !row.inTeam).map((row) => row.address).sort(), [ADMIN, FIN].sort());
  });

  test(`${name}: an invitation holds nothing until the wallet itself says yes`, async () => {
    const deps = depsOf(await makeStore());
    const id = await teamWith(deps);
    await inviteMember(deps, { id, actor: OWNER, wallet: FIN, role: "FINANCE", label: "Олена" });
    assert.equal((await authorizeTeamAction(deps, { teamId: id, wallet: FIN, permission: "view" })).decision.refusal, "NOT_JOINED");
    const invited = await readTeam(deps, id, FIN);
    assert.equal(invited.team.members, null);
    assert.equal(invited.team.journal, null);
    assert.equal((await changeMember(deps, { id, actor: OWNER, wallet: FIN, change: { action: "accept" } })).code, "FORBIDDEN");
    assert.equal((await changeMember(deps, { id, actor: FIN, wallet: FIN, change: { action: "accept" } })).ok, true);
    assert.equal((await authorizeTeamAction(deps, { teamId: id, wallet: FIN, permission: "view" })).decision.allowed, true);
    assert.equal((await inviteMember(deps, { id, actor: OWNER, wallet: FIN, role: "VIEWER" })).code, "MEMBER_EXISTS");
  });

  test(`${name}: a member keeps only the places below their own`, async () => {
    const deps = depsOf(await makeStore());
    const id = await teamWith(deps, [[ADMIN, "ADMIN"], [FIN, "FINANCE"]]);
    assert.equal((await inviteMember(deps, { id, actor: ADMIN, wallet: AGENT, role: "ADMIN" })).code, "FORBIDDEN");
    assert.equal((await inviteMember(deps, { id, actor: ADMIN, wallet: AGENT, role: "OWNER" })).code, "FORBIDDEN");
    assert.equal((await inviteMember(deps, { id, actor: ADMIN, wallet: AGENT, role: "AGENT" })).ok, true);
    assert.equal((await inviteMember(deps, { id, actor: FIN, wallet: OTHER, role: "VIEWER" })).code, "FORBIDDEN");
    assert.equal((await changeMember(deps, { id, actor: ADMIN, wallet: OWNER, change: { action: "remove" } })).code, "FORBIDDEN");
    assert.equal((await changeMember(deps, { id, actor: ADMIN, wallet: FIN, change: { action: "role", role: "ADMIN" } })).code, "FORBIDDEN");
    assert.equal((await changeMember(deps, { id, actor: ADMIN, wallet: FIN, change: { action: "role", role: "ANALYST" } })).ok, true);
    assert.equal((await changeMember(deps, { id, actor: FIN, wallet: ADMIN, change: { action: "remove" } })).code, "FORBIDDEN");
    /* An agent never keeps the list. */
    await changeMember(deps, { id, actor: AGENT, wallet: AGENT, change: { action: "accept" } });
    assert.equal((await inviteMember(deps, { id, actor: AGENT, wallet: OTHER, role: "VIEWER" })).code, "FORBIDDEN");
    /* A stranger learns nothing of the team. */
    assert.equal((await inviteMember(deps, { id, actor: OTHER, wallet: OTHER, role: "VIEWER" })).code, "NOT_FOUND");
  });

  test(`${name}: the last Owner stays until ownership has passed`, async () => {
    const deps = depsOf(await makeStore());
    const id = await teamWith(deps, [[ADMIN, "ADMIN"]]);
    assert.equal((await changeMember(deps, { id, actor: OWNER, wallet: OWNER, change: { action: "remove" } })).code, "LAST_OWNER");
    assert.equal((await changeMember(deps, { id, actor: OWNER, wallet: OWNER, change: { action: "role", role: "ADMIN" } })).code, "LAST_OWNER");
    /* Ownership passes first. */
    await changeMember(deps, { id, actor: OWNER, wallet: ADMIN, change: { action: "role", role: "OWNER" } });
    assert.equal((await changeMember(deps, { id, actor: OWNER, wallet: OWNER, change: { action: "remove" } })).ok, true);
    const read = await readTeam(deps, id, ADMIN);
    assert.deepEqual(read.team.members.map((row) => [row.wallet, row.role]), [[ADMIN, "OWNER"]]);
    assert.deepEqual(read.team.journal.map((row) => row.action).slice(0, 2), ["MEMBER_LEFT", "ROLE_CHANGED"]);
  });

  test(`${name}: only an Owner whose wallet is on the multisig links it as the treasury, and only once`, async () => {
    const deps = depsOf(await makeStore());
    const id = await teamWith(deps, [[ADMIN, "ADMIN"]]);
    assert.equal((await linkTreasury(deps, { id, actor: ADMIN, multisig: TREASURY })).code, "FORBIDDEN");
    assert.equal((await linkTreasury(deps, { id, actor: OWNER, multisig: NOT_SQUADS })).code, "TREASURY_REFUSED");
    const stranger = { ...deps, readSigners: chain([{ address: FIN, initiate: true, vote: true, execute: true }]) };
    assert.equal((await linkTreasury(stranger, { id, actor: OWNER, multisig: TREASURY })).code, "TREASURY_REFUSED");
    /* A member of the multisig who may not propose does not link it. */
    const voter = { ...deps, readSigners: chain([{ address: OWNER, initiate: false, vote: true, execute: false }]) };
    assert.equal((await linkTreasury(voter, { id, actor: OWNER, multisig: TREASURY })).code, "TREASURY_REFUSED");
    /* The caller is checked before the chain is read. */
    let reads = 0;
    const counted = { ...deps, readSigners: async (address) => ((reads += 1), chain()(address)) };
    assert.equal((await linkTreasury(counted, { id, actor: ADMIN, multisig: TREASURY })).code, "FORBIDDEN");
    assert.equal((await linkTreasury(counted, { id, actor: FIN, multisig: TREASURY })).code, "NOT_FOUND");
    assert.equal(reads, 0);
    const linked = await linkTreasury(deps, { id, actor: OWNER, multisig: TREASURY });
    assert.equal(linked.team.treasury, TREASURY);
    /* Linked, it is the rules money obeys: one Owner — a second one too — neither repoints nor drops it. */
    await changeMember(deps, { id, actor: OWNER, wallet: ADMIN, change: { action: "role", role: "OWNER" } });
    const own = { ...deps, readSigners: chain([{ address: ADMIN, initiate: true, vote: true, execute: true }]) };
    assert.equal((await linkTreasury(own, { id, actor: ADMIN, multisig: TREASURY })).code, "FORBIDDEN");
    assert.equal((await linkTreasury(deps, { id, actor: OWNER, multisig: null })).code, "FORBIDDEN");
    assert.equal((await readTeam(deps, id, OWNER)).team.treasury, TREASURY);
  });

  test(`${name}: an invitation lasts a week, and others' invitations never lock a wallet out`, async () => {
    const store = await makeStore();
    let now = Date.parse("2026-10-25T12:00:00Z");
    const deps = depsOf(store, { now: () => new Date(now) });
    const id = await teamWith(deps);
    await inviteMember(deps, { id, actor: OWNER, wallet: FIN, role: "FINANCE" });
    assert.equal((await listTeams(deps, FIN)).teams.length, 1);
    /* While invited, the wallet is shown no right of the role: nothing is held before its yes. */
    const invited = await readTeam(deps, id, FIN);
    assert.ok(Object.values(invited.team.you.grants).every((grant) => grant === "DENY"));
    now += 8 * 86_400_000;
    assert.equal((await listTeams(deps, FIN)).teams.length, 0);
    assert.equal((await changeMember(deps, { id, actor: FIN, wallet: FIN, change: { action: "accept" } })).code, "NOT_FOUND");
    /* The place is free again: the same wallet is invited anew, and its yes now holds. */
    assert.equal((await inviteMember(deps, { id, actor: OWNER, wallet: FIN, role: "VIEWER" })).ok, true);
    assert.equal((await changeMember(deps, { id, actor: FIN, wallet: FIN, change: { action: "accept" } })).ok, true);
    assert.equal((await readTeam(deps, id, FIN)).team.you.role, "VIEWER");
    /* An invitation open to a wallet never stops it making its own team. */
    await inviteMember(deps, { id, actor: OWNER, wallet: AGENT, role: "VIEWER" });
    assert.equal((await createTeam(deps, { wallet: AGENT, name: "Own", kind: "SOLO_CREATOR" })).ok, true);
  });

  test(`${name}: two changes decided on the same version never both land`, async () => {
    const store = await makeStore();
    const deps = depsOf(store);
    const id = await teamWith(deps);
    const state = await store.read(id);
    const at = "2026-10-25T12:00:00.000Z";
    const invite = (wallet) => ({ kind: "member", member: { teamId: id, wallet, role: "VIEWER", status: "INVITED", label: null, invitedBy: OWNER, invitedAt: at, joinedAt: null } });
    const row = (wallet) => ({ teamId: id, at, actor: OWNER, action: "MEMBER_INVITED", subject: wallet, role: "VIEWER", previousRole: null });
    const [a, b] = await Promise.all([store.commit(id, state.team.version, [invite(FIN)], [row(FIN)]), store.commit(id, state.team.version, [invite(AGENT)], [row(AGENT)])]);
    assert.equal([a, b].filter(Boolean).length, 1);
    assert.equal((await store.read(id)).members.length, 2);
    /* A commit that would leave no active Owner is refused by the store itself. */
    const now = await store.read(id);
    assert.equal(await store.commit(id, now.team.version, [{ kind: "remove", wallet: OWNER }], []), false);
  });

  test(`${name}: the input is checked before anything is stored`, async () => {
    const deps = depsOf(await makeStore());
    assert.equal((await createTeam(deps, { wallet: OWNER, name: "<b>x</b>", kind: "PROJECT_TEAM" })).code, "INVALID");
    assert.equal((await createTeam(deps, { wallet: OWNER, name: "Kite", kind: "GUILD" })).code, "INVALID");
    const id = await teamWith(deps);
    assert.equal((await inviteMember(deps, { id, actor: OWNER, wallet: "nope", role: "VIEWER" })).code, "INVALID");
    assert.equal((await inviteMember(deps, { id, actor: OWNER, wallet: FIN, role: "GOD" })).code, "INVALID");
    assert.equal((await readTeam(deps, "not-an-id", OWNER)).code, "NOT_FOUND");
    assert.equal((await readTeam({ ...deps, network: "solana:devnet" }, id, OWNER)).code, "NOT_FOUND");
  });
}
