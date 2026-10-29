/**
 * A team's roles and rights (TEAM-1; spec §9.1–§9.2): who in a team may do what, and how a high-risk action is
 * allowed at all. One system of rights with the capability and authority matrix (EXE-1, `../authority-matrix.ts`):
 * the matrix says whether an action is live on this deployment and what binds it; this file says which member of a
 * team may ask for it. A team adds a *who* to the matrix's *whether* — it never makes a row live, never widens a row's
 * eligibility and never signs.
 *
 * - **Roles** (spec §9.2): Owner · Admin · Finance · Launch Operator · Market Operator · Developer · Analyst · Viewer ·
 *   Agent.
 * - **Rights** — the nine of spec §9.2 (view, draft, submit, sign, deploy, payouts, withdraw, change rules, read
 *   receipts) and one more a team needs to exist at all: keeping its list of members (`members`).
 * - **A grant** is `ALLOW`, `MULTISIG` or `DENY`. `MULTISIG` is the only grant a high-risk right ever has: the member
 *   may *propose* it, and it happens only as a proposal on the team's Squads treasury (SOL-4), approved by the
 *   treasury's own members up to the threshold the program holds. No role — Owner included — moves money, deploys,
 *   signs for the team or changes its treasury's rules on one person's word.
 *
 * The server checks every right (`lib/team/service.server.ts`): a hidden button is not a refusal. Pure: no I/O.
 */

import { findAuthority, resolveAuthority, type AuthorityRow, type Enforcement, type HonestState, type Signer } from "../authority-matrix.ts";

/** Spec §9.1. */
export const TEAM_KINDS = ["SOLO_CREATOR", "PROJECT_TEAM", "DAO_COMMUNITY", "AGENCY", "ENTERPRISE"] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];

/** Spec §9.2, in the order a reader meets them. */
export const TEAM_ROLES = ["OWNER", "ADMIN", "FINANCE", "LAUNCH_OPERATOR", "MARKET_OPERATOR", "DEVELOPER", "ANALYST", "VIEWER", "AGENT"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** The nine rights of spec §9.2 and `members` — keeping the team's own list. */
export const TEAM_PERMISSIONS = ["view", "draft", "submit", "sign", "deploy", "payout", "withdraw", "policy", "receipts", "members"] as const;
export type TeamPermission = (typeof TEAM_PERMISSIONS)[number];

export const TEAM_GRANTS = ["ALLOW", "MULTISIG", "DENY"] as const;
export type TeamGrant = (typeof TEAM_GRANTS)[number];

export const TEAM_RISKS = ["LOW", "MEDIUM", "HIGH"] as const;
export type TeamRisk = (typeof TEAM_RISKS)[number];

/** A member is `INVITED` until their own wallet says yes; only an `ACTIVE` member holds any right. */
export const TEAM_MEMBER_STATUSES = ["INVITED", "ACTIVE"] as const;
export type TeamMemberStatus = (typeof TEAM_MEMBER_STATUSES)[number];

/**
 * How much each right can cost. `LOW` reads or prepares, `MEDIUM` changes the team's own records and moves nothing,
 * `HIGH` moves money, deploys or changes the rules money obeys — the multisig's only.
 */
export const TEAM_PERMISSION_RISK: Readonly<Record<TeamPermission, TeamRisk>> = Object.freeze({
  view: "LOW",
  draft: "LOW",
  receipts: "LOW",
  submit: "MEDIUM",
  members: "MEDIUM",
  sign: "HIGH",
  deploy: "HIGH",
  payout: "HIGH",
  withdraw: "HIGH",
  policy: "HIGH",
});

export const HIGH_RISK_PERMISSIONS = TEAM_PERMISSIONS.filter((permission) => TEAM_PERMISSION_RISK[permission] === "HIGH");
export type HighRiskPermission = "sign" | "deploy" | "payout" | "withdraw" | "policy";

const A = "ALLOW" as const;
const M = "MULTISIG" as const;
const D = "DENY" as const;

/**
 * The matrix: role × right. Read across a row for what a role may do. The validator below holds its laws: a high-risk
 * right is `MULTISIG` or `DENY`, never `ALLOW`; a lower right is never `MULTISIG`; every role views; the agent holds no
 * high-risk right and no say over members (spec §9.5); an Owner holds every right.
 */
export const TEAM_MATRIX: Readonly<Record<TeamRole, Readonly<Record<TeamPermission, TeamGrant>>>> = Object.freeze({
  /*                  view draft submit sign deploy payout withdraw policy receipts members */
  OWNER:           { view: A, draft: A, submit: A, sign: M, deploy: M, payout: M, withdraw: M, policy: M, receipts: A, members: A },
  ADMIN:           { view: A, draft: A, submit: A, sign: M, deploy: M, payout: M, withdraw: D, policy: M, receipts: A, members: A },
  FINANCE:         { view: A, draft: A, submit: A, sign: M, deploy: D, payout: M, withdraw: M, policy: D, receipts: A, members: D },
  LAUNCH_OPERATOR: { view: A, draft: A, submit: A, sign: M, deploy: M, payout: D, withdraw: D, policy: D, receipts: A, members: D },
  MARKET_OPERATOR: { view: A, draft: A, submit: A, sign: M, deploy: D, payout: D, withdraw: D, policy: D, receipts: A, members: D },
  DEVELOPER:       { view: A, draft: A, submit: A, sign: D, deploy: M, payout: D, withdraw: D, policy: D, receipts: A, members: D },
  ANALYST:         { view: A, draft: D, submit: D, sign: D, deploy: D, payout: D, withdraw: D, policy: D, receipts: A, members: D },
  VIEWER:          { view: A, draft: D, submit: D, sign: D, deploy: D, payout: D, withdraw: D, policy: D, receipts: D, members: D },
  AGENT:           { view: A, draft: A, submit: A, sign: D, deploy: D, payout: D, withdraw: D, policy: D, receipts: A, members: D },
});

export function grantOf(role: TeamRole, permission: TeamPermission): TeamGrant {
  return TEAM_MATRIX[role][permission];
}

/** What one role may do, right by right. */
export function grantsOf(role: TeamRole): Readonly<Record<TeamPermission, TeamGrant>> {
  return TEAM_MATRIX[role];
}

const NOTHING: Readonly<Record<TeamPermission, TeamGrant>> = Object.freeze(Object.fromEntries(TEAM_PERMISSIONS.map((permission) => [permission, "DENY"])) as Record<TeamPermission, TeamGrant>);

/** What a member holds now: the role's row once active, nothing while only invited — what a member is shown as their own rights. */
export function effectiveGrants(member: Readonly<{ role: TeamRole; status: TeamMemberStatus }>): Readonly<Record<TeamPermission, TeamGrant>> {
  return member.status === "ACTIVE" ? TEAM_MATRIX[member.role] : NOTHING;
}

/**
 * The EXE-1 rows a high-risk right runs through: each one's signer is the multisig (`MULTISIG`), so the program holds
 * the threshold. Since MOS-2 `deploy` has its row — `ryntra.team-launch`, a team's launch through its treasury; the
 * row is closed on every deployment until its switch is open, so the right reads `AUTHORITY_CLOSED` until then.
 */
export const TEAM_PERMISSION_AUTHORITY: Readonly<Record<HighRiskPermission, readonly string[]>> = Object.freeze({
  sign: ["squads.treasury"],
  payout: ["squads.treasury"],
  withdraw: ["squads.treasury"],
  policy: ["squads.treasury"],
  deploy: ["ryntra.team-launch"],
});

/** The Squads permission the acting wallet must hold on the treasury for a high-risk right: to propose, or to vote. */
export const TEAM_SQUADS_PERMISSION: Readonly<Record<HighRiskPermission, "initiate" | "vote">> = Object.freeze({
  sign: "vote",
  payout: "initiate",
  withdraw: "initiate",
  policy: "initiate",
  deploy: "initiate",
});

/**
 * Who may keep whose place in the list. An Owner keeps everyone's, other Owners' too; any other member with `members`
 * only those below them, and never into a place at or above their own. An agent and a viewer are the lowest.
 */
const RANK: Readonly<Record<TeamRole, number>> = Object.freeze({
  OWNER: 5,
  ADMIN: 4,
  FINANCE: 3,
  LAUNCH_OPERATOR: 3,
  MARKET_OPERATOR: 3,
  DEVELOPER: 3,
  ANALYST: 2,
  VIEWER: 1,
  AGENT: 1,
});

export function roleRank(role: TeamRole): number {
  return RANK[role];
}

/** Whether a member in `actor`'s role may give, change or take away `target` (a role held now, or one given). */
export function canManageRole(actor: TeamRole, target: TeamRole): boolean {
  if (grantOf(actor, "members") !== "ALLOW") return false;
  return actor === "OWNER" || RANK[target] < RANK[actor];
}

/** What the append-only journal records: every change of the list, the name and the treasury link. */
export const TEAM_JOURNAL_ACTIONS = [
  "TEAM_CREATED",
  "TEAM_RENAMED",
  "MEMBER_INVITED",
  "MEMBER_JOINED",
  "ROLE_CHANGED",
  "MEMBER_REMOVED",
  "MEMBER_LEFT",
  "TREASURY_LINKED",
  "TREASURY_UNLINKED",
] as const;
export type TeamJournalAction = (typeof TEAM_JOURNAL_ACTIONS)[number];

export const TEAM_LIMITS = Object.freeze({
  /** Members of one team, invitations still open included. */
  membersPerTeam: 50,
  /** Teams one wallet creates on one network. */
  teamsCreatedPerWallet: 10,
  /** Teams one wallet is an active member of on one network. */
  membershipsPerWallet: 50,
  /** Invitations still open to one wallet on one network: others' invitations never stop a wallet making or joining its own. */
  invitationsPerWallet: 50,
  /** An invitation nobody answered is gone after a week: it holds no place in the team or in the wallet's list. */
  inviteDays: 7,
  nameMax: 64,
  labelMax: 40,
  /** Journal rows a team read carries. */
  journalShown: 50,
});

export const TEAM_ID = /^[0-9a-f]{24}$/;
export function isTeamId(id: string): boolean {
  return TEAM_ID.test(id);
}

/* --------------------------------------------------------------- decision */

export const TEAM_REFUSALS = [
  /** The wallet is not in this team. */
  "NOT_A_MEMBER",
  /** Invited and not yet answered with its own wallet. */
  "NOT_JOINED",
  /** The member's role does not hold this right. */
  "ROLE_DENIES",
  /** A high-risk right with no treasury linked to the team: there is nothing to approve it. */
  "NO_TREASURY",
  /** A high-risk right with no multisig row in the matrix to run through (or one not named for it). */
  "NO_MULTISIG_PATH",
  /** The row is closed or not built on this deployment (its honest state is not LIVE or PREVIEW). */
  "AUTHORITY_CLOSED",
  /** The wallet does not hold the Squads permission the right needs on the team's treasury, read on chain. */
  "NOT_A_SIGNER",
  /** The treasury could not be read on chain now: nothing is allowed on a guess. */
  "SIGNERS_UNREAD",
] as const;
export type TeamRefusal = (typeof TEAM_REFUSALS)[number];

export type TeamAuthorityView = Readonly<{ id: string; state: HonestState; enforcement: Enforcement; signer: Signer }>;

export type TeamDecision = Readonly<{
  allowed: boolean;
  permission: TeamPermission;
  role: TeamRole | null;
  grant: TeamGrant;
  risk: TeamRisk;
  /** `MULTISIG` — the action happens only as a proposal on `multisig`, approved by its members on chain. */
  requires: "NOTHING" | "MULTISIG";
  refusal: TeamRefusal | null;
  /** The EXE-1 row a high-risk right runs through, resolved on this deployment; null for a lower right. */
  authority: TeamAuthorityView | null;
  multisig: string | null;
  /** The Squads permission the wallet must hold on `multisig`; null for a lower right. */
  squadsPermission: "initiate" | "vote" | null;
}>;

export type TeamDecisionInput = Readonly<{
  member: Readonly<{ role: TeamRole; status: TeamMemberStatus }> | null;
  permission: TeamPermission;
  /** The team's linked Squads multisig, or null. */
  treasury: string | null;
  /** The EXE-1 row the action runs through; for a high-risk right, the first of its rows when not named. */
  authority?: string | null;
  env?: Readonly<Record<string, string | undefined>>;
  /** The matrix rows to resolve against: the matrix itself, unless a test names others. */
  rows?: readonly AuthorityRow[];
}>;

/**
 * The decision before the chain: role, membership, treasury, and the EXE-1 row's state. A high-risk right that passes
 * here still needs the wallet's Squads permission on the treasury, which the server reads on chain
 * (`authorizeTeamAction`) — `NOT_A_SIGNER` and `SIGNERS_UNREAD` are said there.
 */
export function decideTeamPermission(input: TeamDecisionInput): TeamDecision {
  const { member, permission } = input;
  const risk = TEAM_PERMISSION_RISK[permission];
  const role = member?.role ?? null;
  const grant: TeamGrant = role ? grantOf(role, permission) : "DENY";
  const high = risk === "HIGH";
  const base = {
    permission,
    role,
    grant,
    risk,
    requires: high ? ("MULTISIG" as const) : ("NOTHING" as const),
    multisig: high ? input.treasury : null,
    squadsPermission: high ? TEAM_SQUADS_PERMISSION[permission as HighRiskPermission] : null,
  };
  const refuse = (refusal: TeamRefusal, authority: TeamAuthorityView | null = null): TeamDecision => ({ ...base, allowed: false, refusal, authority });
  if (!member) return refuse("NOT_A_MEMBER");
  if (member.status !== "ACTIVE") return refuse("NOT_JOINED");
  if (grant === "DENY") return refuse("ROLE_DENIES");
  if (!high) return { ...base, allowed: true, refusal: null, authority: null };

  /* High risk: only through a multisig row of the matrix, on the team's own treasury, while the row is open. */
  const rows = TEAM_PERMISSION_AUTHORITY[permission as HighRiskPermission];
  const id = input.authority ?? rows[0] ?? null;
  if (id === null || !rows.includes(id)) return refuse("NO_MULTISIG_PATH");
  const row = input.rows ? (input.rows.find((entry) => entry.id === id) ?? null) : findAuthority(id);
  if (!row || row.signer !== "MULTISIG") return refuse("NO_MULTISIG_PATH");
  const resolved = resolveAuthority(row, input.env ?? process.env);
  const authority: TeamAuthorityView = { id: row.id, state: resolved.state, enforcement: row.enforcement, signer: row.signer };
  if (input.treasury === null) return refuse("NO_TREASURY", authority);
  if (resolved.state !== "LIVE" && resolved.state !== "PREVIEW") return refuse("AUTHORITY_CLOSED", authority);
  /* A team never widens a row: a pilot's, a canary's or an operator's row is not every member's. */
  if (resolved.eligibility !== "EVERYONE") return refuse("AUTHORITY_CLOSED", authority);
  return { ...base, allowed: true, refusal: null, authority };
}

/* ------------------------------------------------------------- validation */

/** The matrix's laws, checked by the tests: an empty list is a matrix that holds. */
export function validateTeamMatrix(matrix: Readonly<Record<TeamRole, Readonly<Record<TeamPermission, TeamGrant>>>> = TEAM_MATRIX): readonly string[] {
  const problems: string[] = [];
  for (const role of TEAM_ROLES) {
    const row = matrix[role];
    if (!row) {
      problems.push(`${role}: no row`);
      continue;
    }
    for (const permission of TEAM_PERMISSIONS) {
      const grant = row[permission];
      if (!TEAM_GRANTS.includes(grant)) problems.push(`${role}.${permission}: no grant`);
      const risk = TEAM_PERMISSION_RISK[permission];
      if (risk === "HIGH" && grant === "ALLOW") problems.push(`${role}.${permission}: a high-risk right is the multisig's, never one person's`);
      if (risk !== "HIGH" && grant === "MULTISIG") problems.push(`${role}.${permission}: only a high-risk right goes through the multisig`);
    }
    if (row.view !== "ALLOW") problems.push(`${role}: every member views`);
  }
  for (const permission of TEAM_PERMISSIONS) if (matrix.OWNER?.[permission] === "DENY") problems.push(`OWNER.${permission}: an Owner holds every right`);
  for (const permission of HIGH_RISK_PERMISSIONS) if (matrix.AGENT?.[permission] !== "DENY") problems.push(`AGENT.${permission}: an agent holds no high-risk right (spec §9.5)`);
  if (matrix.AGENT?.members !== "DENY") problems.push("AGENT.members: an agent never keeps the list (spec §9.5)");
  if (matrix.VIEWER && TEAM_PERMISSIONS.some((permission) => permission !== "view" && matrix.VIEWER[permission] !== "DENY")) problems.push("VIEWER: views only");
  for (const [permission, ids] of Object.entries(TEAM_PERMISSION_AUTHORITY)) {
    for (const id of ids) {
      const row = findAuthority(id);
      if (!row) problems.push(`${permission}: no authority row ${id}`);
      else if (row.signer !== "MULTISIG") problems.push(`${permission}: ${id} is not signed by a multisig`);
    }
  }
  return problems;
}
