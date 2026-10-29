import assert from "node:assert/strict";
import test from "node:test";

import { AUTHORITY_MATRIX, findAuthority } from "../authority-matrix.ts";
import {
  HIGH_RISK_PERMISSIONS,
  TEAM_MATRIX,
  TEAM_PERMISSIONS,
  TEAM_PERMISSION_AUTHORITY,
  TEAM_PERMISSION_RISK,
  TEAM_ROLES,
  canManageRole,
  decideTeamPermission,
  effectiveGrants,
  grantOf,
  validateTeamMatrix,
} from "./roles.ts";

const TREASURY = "AmKrrLoHrYr7EUu5zMzAvYYADCiZ8SNFjd85uwjSSUVo";
const MAINNET = { NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "mainnet" };
const DEVNET = { NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "devnet" };
const CLOSED = {};

test("the nine roles and the nine rights of spec §9.2, and the list kept", () => {
  assert.deepEqual(TEAM_ROLES, ["OWNER", "ADMIN", "FINANCE", "LAUNCH_OPERATOR", "MARKET_OPERATOR", "DEVELOPER", "ANALYST", "VIEWER", "AGENT"]);
  assert.deepEqual(TEAM_PERMISSIONS, ["view", "draft", "submit", "sign", "deploy", "payout", "withdraw", "policy", "receipts", "members"]);
  assert.deepEqual([...HIGH_RISK_PERMISSIONS].sort(), ["deploy", "payout", "policy", "sign", "withdraw"]);
});

test("the matrix holds its laws", () => {
  assert.deepEqual(validateTeamMatrix(), []);
});

test("no role holds a high-risk right alone: it is the multisig's or nobody's", () => {
  for (const role of TEAM_ROLES) for (const permission of HIGH_RISK_PERMISSIONS) assert.notEqual(grantOf(role, permission), "ALLOW", `${role}.${permission}`);
});

test("the validator refuses a matrix that would let one person move money", () => {
  const broken = { ...TEAM_MATRIX, FINANCE: { ...TEAM_MATRIX.FINANCE, payout: "ALLOW" } };
  assert.ok(validateTeamMatrix(broken).some((line) => line.startsWith("FINANCE.payout")));
  const agent = { ...TEAM_MATRIX, AGENT: { ...TEAM_MATRIX.AGENT, payout: "MULTISIG" } };
  assert.ok(validateTeamMatrix(agent).some((line) => line.startsWith("AGENT.payout")));
  const viewer = { ...TEAM_MATRIX, VIEWER: { ...TEAM_MATRIX.VIEWER, receipts: "ALLOW" } };
  assert.ok(validateTeamMatrix(viewer).includes("VIEWER: views only"));
});

test("one system of rights with EXE-1: every high-risk right runs only through a multisig row of the matrix", () => {
  for (const [permission, ids] of Object.entries(TEAM_PERMISSION_AUTHORITY)) {
    assert.equal(TEAM_PERMISSION_RISK[permission], "HIGH");
    for (const id of ids) assert.equal(findAuthority(id)?.signer, "MULTISIG", id);
  }
  /* A right that names a row signed by one person is refused, whatever the row's state. */
  const personal = AUTHORITY_MATRIX.find((row) => row.signer === "PERSON_EACH");
  const decision = decideTeamPermission({ member: { role: "OWNER", status: "ACTIVE" }, permission: "payout", treasury: TREASURY, authority: personal.id, env: MAINNET });
  assert.equal(decision.allowed, false);
  assert.equal(decision.refusal, "NO_MULTISIG_PATH");
});

/* Every role × every right, decided on mainnet with a treasury linked: the grant is the decision. */
for (const role of TEAM_ROLES) {
  for (const permission of TEAM_PERMISSIONS) {
    test(`decision: ${role} × ${permission}`, () => {
      const grant = grantOf(role, permission);
      const decision = decideTeamPermission({ member: { role, status: "ACTIVE" }, permission, treasury: TREASURY, env: MAINNET });
      assert.equal(decision.grant, grant);
      if (grant === "DENY") {
        assert.equal(decision.allowed, false);
        assert.equal(decision.refusal, "ROLE_DENIES");
      } else if (permission === "deploy") {
        /* `deploy` runs through MOS-2's row `ryntra.team-launch`, closed until the owner's own switch opens it. */
        assert.equal(decision.allowed, false);
        assert.equal(decision.refusal, "AUTHORITY_CLOSED");
        assert.equal(decision.authority.id, "ryntra.team-launch");
        const open = decideTeamPermission({ member: { role, status: "ACTIVE" }, permission, treasury: TREASURY, env: { ...MAINNET, RYNTRA_TEAM_LAUNCH: "open" } });
        assert.equal(open.allowed, true);
        assert.equal(open.requires, "MULTISIG");
        assert.equal(open.squadsPermission, "initiate");
      } else {
        assert.equal(decision.allowed, true);
        assert.equal(decision.refusal, null);
        assert.equal(decision.requires, grant === "MULTISIG" ? "MULTISIG" : "NOTHING");
        if (grant === "MULTISIG") {
          assert.equal(decision.multisig, TREASURY);
          assert.equal(decision.authority.id, "squads.treasury");
          assert.equal(decision.authority.enforcement, "PROGRAM_ENFORCED");
          assert.equal(decision.squadsPermission, permission === "sign" ? "vote" : "initiate");
        }
      }
    });
  }
}

test("a stranger and an invitation hold nothing, not even a view", () => {
  for (const permission of TEAM_PERMISSIONS) {
    assert.equal(decideTeamPermission({ member: null, permission, treasury: TREASURY, env: MAINNET }).refusal, "NOT_A_MEMBER");
    assert.equal(decideTeamPermission({ member: { role: "OWNER", status: "INVITED" }, permission, treasury: TREASURY, env: MAINNET }).refusal, "NOT_JOINED");
  }
});

test("a high-risk right without a treasury, or with the treasury's row closed, is refused", () => {
  const owner = { role: "OWNER", status: "ACTIVE" };
  assert.equal(decideTeamPermission({ member: owner, permission: "payout", treasury: null, env: MAINNET }).refusal, "NO_TREASURY");
  const closed = decideTeamPermission({ member: owner, permission: "payout", treasury: TREASURY, env: CLOSED });
  assert.equal(closed.refusal, "AUTHORITY_CLOSED");
  assert.equal(closed.authority.state, "DISABLED");
  /* Devnet: test money — the row reads PREVIEW and the proposal is allowed. */
  const devnet = decideTeamPermission({ member: owner, permission: "payout", treasury: TREASURY, env: DEVNET });
  assert.equal(devnet.allowed, true);
  assert.equal(devnet.authority.state, "PREVIEW");
  /* A lower right does not depend on the treasury. */
  assert.equal(decideTeamPermission({ member: owner, permission: "draft", treasury: null, env: CLOSED }).allowed, true);
});

test("who keeps whose place: an Owner everyone's, others only below them", () => {
  for (const target of TEAM_ROLES) assert.equal(canManageRole("OWNER", target), true, target);
  assert.equal(canManageRole("ADMIN", "OWNER"), false);
  assert.equal(canManageRole("ADMIN", "ADMIN"), false);
  assert.equal(canManageRole("ADMIN", "FINANCE"), true);
  assert.equal(canManageRole("ADMIN", "AGENT"), true);
  for (const role of TEAM_ROLES.filter((role) => role !== "OWNER" && role !== "ADMIN")) for (const target of TEAM_ROLES) assert.equal(canManageRole(role, target), false, `${role} → ${target}`);
});

test("a team never widens an EXE-1 row: a row open to a pilot is not every member's", () => {
  const owner = { role: "OWNER", status: "ACTIVE" };
  const treasury = findAuthority("squads.treasury");
  /* The same row behind a pilot's switch, as a later row might be: on, it reads PREVIEW for the pilot's wallets only. */
  const pilot = { ...treasury, eligibility: "PILOT", gate: { kind: "PILOT", key: "PREDICTIONS_LIVE_FUNDING" } };
  const decision = decideTeamPermission({ member: owner, permission: "payout", treasury: TREASURY, env: { PREDICTIONS_LIVE_FUNDING: "on" }, rows: [pilot] });
  assert.equal(decision.authority.state, "PREVIEW");
  assert.equal(decision.allowed, false);
  assert.equal(decision.refusal, "AUTHORITY_CLOSED");
  assert.equal(decideTeamPermission({ member: owner, permission: "payout", treasury: TREASURY, env: MAINNET, rows: [treasury] }).allowed, true);
});

test("an invited member is shown no right before its own yes", () => {
  for (const role of TEAM_ROLES) for (const permission of TEAM_PERMISSIONS) assert.equal(effectiveGrants({ role, status: "INVITED" })[permission], "DENY");
  assert.deepEqual(effectiveGrants({ role: "FINANCE", status: "ACTIVE" }), TEAM_MATRIX.FINANCE);
});

