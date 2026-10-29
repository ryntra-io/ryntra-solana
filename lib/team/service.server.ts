/**
 * A team on the server (TEAM-1; spec §9.1–§9.2): making one, its list of members and their roles, its treasury, and
 * the one check every team action passes — `authorizeTeamAction`. The rules are `../core/team/roles.ts`; the records
 * are `./store.ts`.
 *
 * Every right is checked here, against the stored list, on every request: nothing is cached, so a member removed or
 * demoted holds nothing from the next request on. A high-risk right is allowed only as a proposal on the team's Squads
 * treasury through a multisig row of the EXE-1 matrix, and only for a wallet the treasury itself holds as a member
 * with the Squads permission the right needs, read on chain — the program then holds the threshold. Ryntra signs
 * nothing here and moves nothing.
 *
 * Entry points for the tasks built on a team — TEAM-2 (treasury ledger and payouts), DROP-2 (vesting and Merkle-claim
 * campaigns), DEV-2 (developer console), MOS-2 (Team Launch): call `authorizeTeamAction` with the right the action
 * needs and the EXE-1 row it runs through, before anything is built; refuse on `allowed: false` with its `refusal`.
 *
 * Server only.
 */

import { randomBytes } from "node:crypto";

import {
  TEAM_KINDS,
  TEAM_LIMITS,
  TEAM_ROLES,
  canManageRole,
  decideTeamPermission,
  effectiveGrants,
  isTeamId,
  type TeamDecision,
  type TeamKind,
  type TeamPermission,
  type TeamRole,
} from "../core/team/roles.ts";
import type { TeamResponse, TeamsResponse } from "../api/v1/contract.ts";
import type { TreasuryMember } from "../solana/treasury/contract.ts";
import {
  TeamStoreUnavailable,
  type TeamJournalRecord,
  type TeamMemberRecord,
  type TeamNetwork,
  type TeamRecord,
  type TeamState,
  type TeamStore,
  type TeamWrite,
} from "./store.ts";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isWallet = (value: string): boolean => BASE58.test(value);

/** A multisig's members as Squads holds them; throws `{ code: "TREASURY_NOT_FOUND" | "TREASURY_NOT_SQUADS" }` for an address that is not one. */
export type ReadSigners = (multisig: string) => Promise<readonly TreasuryMember[]>;

export type TeamDeps = Readonly<{
  store: TeamStore;
  network: TeamNetwork;
  now: () => Date;
  /** Null where the chain is not read (a stand without a node): a high-risk right then reads `SIGNERS_UNREAD`. */
  readSigners: ReadSigners | null;
  env?: Readonly<Record<string, string | undefined>>;
  newId?: () => string;
}>;

export const TEAM_FAILURE_CODES = [
  "INVALID",
  "NOT_FOUND",
  "FORBIDDEN",
  "LIMIT",
  "MEMBER_EXISTS",
  "LAST_OWNER",
  "CHANGED",
  "TREASURY_REFUSED",
  "UNAVAILABLE",
] as const;
export type TeamFailureCode = (typeof TEAM_FAILURE_CODES)[number];
export type TeamFailure = Readonly<{ ok: false; code: TeamFailureCode; message: string }>;
const fail = (code: TeamFailureCode, message: string): TeamFailure => ({ ok: false, code, message });

/* ------------------------------------------------------------------ views */

/** The team as a wallet may read it, and a wallet's teams: the contract's own shapes (1.75.0). */
export type TeamView = TeamResponse["team"];
export type TeamSummaryView = TeamsResponse["teams"][number];
type TeamMemberView = NonNullable<TeamView["members"]>[number];

const memberView = (row: TeamMemberRecord): TeamMemberView => ({ wallet: row.wallet, role: row.role, status: row.status, label: row.label, invitedBy: row.invitedBy, invitedAt: row.invitedAt, joinedAt: row.joinedAt });

/* ---------------------------------------------------------------- helpers */

const newTeamId = () => randomBytes(12).toString("hex");

function cleanName(raw: string): string | null {
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > TEAM_LIMITS.nameMax) return null;
  if (/[\u0000-\u001f\u007f<>]/.test(name)) return null;
  return name;
}

function cleanLabel(raw: string | null | undefined): string | null | false {
  if (raw === null || raw === undefined) return null;
  const label = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (label.length === 0) return null;
  if (label.length > TEAM_LIMITS.labelMax || /[\u0000-\u001f\u007f<>]/.test(label)) return false;
  return label;
}

const isRole = (value: string): value is TeamRole => (TEAM_ROLES as readonly string[]).includes(value);
const isKind = (value: string): value is TeamKind => (TEAM_KINDS as readonly string[]).includes(value);

const INVITE_MS = TEAM_LIMITS.inviteDays * 86_400_000;
/** A member, or an invitation still inside its week: an older one holds no place anywhere and may be made again. */
const standing = (row: TeamMemberRecord, now: number) => row.status === "ACTIVE" || Date.parse(row.invitedAt) + INVITE_MS > now;

/** The team as the rules read it: without the invitations whose week has passed. */
async function readLive(deps: TeamDeps, id: string): Promise<TeamState | null> {
  const state = await deps.store.read(id);
  if (!state) return null;
  const now = deps.now().getTime();
  return { team: state.team, members: state.members.filter((row) => standing(row, now)) };
}

/** The wallet's teams and invitations still standing. */
async function openMemberships(deps: TeamDeps, wallet: string) {
  const now = deps.now().getTime();
  return (await deps.store.memberships(deps.network, wallet)).filter(({ member }) => standing(member, now));
}

const activeCount = (rows: readonly Readonly<{ member: TeamMemberRecord }>[]) => rows.filter(({ member }) => member.status === "ACTIVE").length;

const activeOwners = (members: readonly TeamMemberRecord[]) => members.filter((row) => row.role === "OWNER" && row.status === "ACTIVE").length;

/** The store's own refusal to answer becomes UNAVAILABLE; nothing reads it as «no team». */
async function guarded<T>(work: () => Promise<T | TeamFailure>): Promise<T | TeamFailure> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TeamStoreUnavailable) return fail("UNAVAILABLE", error.reason === "NOT_PROVISIONED" ? "Teams are not provisioned on this deployment yet." : "The team store did not answer; try again.");
    throw error;
  }
}

/**
 * A change decided on the team as read and committed only while it is still that version; read again and decided
 * again when another change came first. Three rounds, then `CHANGED`.
 */
async function change(
  deps: TeamDeps,
  id: string,
  decide: (state: TeamState, at: string) => Readonly<{ writes: readonly TeamWrite[]; journal: readonly TeamJournalRecord[] }> | TeamFailure,
): Promise<Readonly<{ ok: true; state: TeamState }> | TeamFailure> {
  if (!isTeamId(id)) return fail("NOT_FOUND", "No such team.");
  for (let round = 0; round < 3; round += 1) {
    const state = await readLive(deps, id);
    if (!state || state.team.network !== deps.network) return fail("NOT_FOUND", "No such team.");
    const decided = decide(state, deps.now().toISOString());
    if ("ok" in decided) return decided;
    if (await deps.store.commit(id, state.team.version, decided.writes, decided.journal)) {
      const after = await readLive(deps, id);
      if (after) return { ok: true, state: after };
    }
  }
  return fail("CHANGED", "The team changed while this was decided; read it again.");
}

/** The acting member, or the refusal that does not tell a stranger whether the team exists. */
function actorOf(state: TeamState, wallet: string): TeamMemberRecord | TeamFailure {
  const member = state.members.find((row) => row.wallet === wallet);
  if (!member) return fail("NOT_FOUND", "No such team.");
  return member;
}

/* -------------------------------------------------------------- making one */

export type CreateTeamInput = Readonly<{ wallet: string; name: string; kind: string }>;

export async function createTeam(deps: TeamDeps, input: CreateTeamInput): Promise<Readonly<{ ok: true; state: TeamState }> | TeamFailure> {
  return guarded(async () => {
    if (!isWallet(input.wallet)) return fail("INVALID", "wallet: not an address");
    const name = cleanName(input.name);
    if (!name) return fail("INVALID", `name: one to ${TEAM_LIMITS.nameMax} characters, no markup.`);
    if (!isKind(input.kind)) return fail("INVALID", "kind: not a team kind.");
    if ((await deps.store.createdBy(deps.network, input.wallet)) >= TEAM_LIMITS.teamsCreatedPerWallet) return fail("LIMIT", `A wallet makes at most ${TEAM_LIMITS.teamsCreatedPerWallet} teams on a network.`);
    /* Only the teams the wallet joined count: invitations from others never stop it making its own. */
    if (activeCount(await openMemberships(deps, input.wallet)) >= TEAM_LIMITS.membershipsPerWallet) return fail("LIMIT", `A wallet is in at most ${TEAM_LIMITS.membershipsPerWallet} teams on a network.`);
    const at = deps.now().toISOString();
    const id = (deps.newId ?? newTeamId)();
    const team: TeamRecord = { id, network: deps.network, name, kind: input.kind, treasury: null, createdBy: input.wallet, createdAt: at, version: 0 };
    const owner: TeamMemberRecord = { teamId: id, wallet: input.wallet, role: "OWNER", status: "ACTIVE", label: null, invitedBy: input.wallet, invitedAt: at, joinedAt: at };
    const made = await deps.store.create(team, owner, { teamId: id, at, actor: input.wallet, action: "TEAM_CREATED", subject: null, role: "OWNER", previousRole: null });
    if (!made) return fail("CHANGED", "The team could not be made; try again.");
    const state = await readLive(deps, id);
    return state ? { ok: true as const, state } : fail("UNAVAILABLE", "The team was made but could not be read back; open your teams.");
  });
}

/* ------------------------------------------------------------------ reads */

export async function listTeams(deps: TeamDeps, wallet: string): Promise<Readonly<{ ok: true; teams: readonly TeamSummaryView[] }> | TeamFailure> {
  return guarded(async () => {
    if (!isWallet(wallet)) return fail("INVALID", "wallet: not an address");
    const rows = await openMemberships(deps, wallet);
    const views: TeamSummaryView[] = [];
    for (const { team, member } of rows) {
      const state = member.status === "ACTIVE" ? await readLive(deps, team.id) : null;
      views.push({ id: team.id, name: team.name, kind: team.kind, treasury: team.treasury, role: member.role, status: member.status, members: state ? state.members.length : 0 });
    }
    return { ok: true as const, teams: views };
  });
}

export async function readTeam(deps: TeamDeps, id: string, wallet: string): Promise<Readonly<{ ok: true; team: TeamView }> | TeamFailure> {
  return guarded(async () => {
    if (!isTeamId(id)) return fail("NOT_FOUND", "No such team.");
    const state = await readLive(deps, id);
    if (!state || state.team.network !== deps.network) return fail("NOT_FOUND", "No such team.");
    const you = actorOf(state, wallet);
    if ("ok" in you) return you;
    return { ok: true as const, team: await teamView(deps, state, you) };
  });
}

async function teamView(deps: TeamDeps, state: TeamState, you: TeamMemberRecord): Promise<TeamView> {
  const active = you.status === "ACTIVE";
  const grants = effectiveGrants(you);
  const readsReceipts = active && grants.receipts === "ALLOW";
  let signers: TeamView["signers"] = null;
  if (active && state.team.treasury) {
    signers = { read: "UNREAD" };
    if (deps.readSigners) {
      try {
        const rows = await deps.readSigners(state.team.treasury);
        signers = {
          read: "OK",
          rows: rows.map((row) => {
            const member = state.members.find((entry) => entry.wallet === row.address && entry.status === "ACTIVE") ?? null;
            return { address: row.address, initiate: row.initiate, vote: row.vote, execute: row.execute, inTeam: member !== null, role: member?.role ?? null };
          }),
        };
      } catch {
        signers = { read: "UNREAD" };
      }
    }
  }
  return {
    id: state.team.id,
    network: state.team.network,
    name: state.team.name,
    kind: state.team.kind,
    treasury: state.team.treasury,
    createdBy: state.team.createdBy,
    createdAt: state.team.createdAt,
    version: state.team.version,
    you: { wallet: you.wallet, role: you.role, status: you.status, grants: { ...grants } },
    members: active ? state.members.map(memberView) : null,
    journal: readsReceipts ? (await deps.store.journal(state.team.id, TEAM_LIMITS.journalShown)).map(({ teamId: _team, ...row }) => row) : null,
    signers,
  };
}

/* ---------------------------------------------------------------- members */

export type InviteInput = Readonly<{ id: string; actor: string; wallet: string; role: string; label?: string | null }>;

export async function inviteMember(deps: TeamDeps, input: InviteInput): Promise<Readonly<{ ok: true; team: TeamView }> | TeamFailure> {
  return guarded(async () => {
    if (!isWallet(input.wallet)) return fail("INVALID", "wallet: not an address");
    if (!isRole(input.role)) return fail("INVALID", "role: not a team role.");
    const role = input.role;
    const label = cleanLabel(input.label);
    if (label === false) return fail("INVALID", `label: at most ${TEAM_LIMITS.labelMax} characters, no markup.`);
    /* The invitee's other teams are counted before the change: their own list is not this team's to lock. A soft
       bound: two teams inviting at the same moment may pass it by one each. */
    const theirs = await openMemberships(deps, input.wallet);
    const changed = await change(deps, input.id, (state, at) => {
      const actor = actorOf(state, input.actor);
      if ("ok" in actor) return actor;
      if (actor.status !== "ACTIVE" || !canManageRole(actor.role, role)) return fail("FORBIDDEN", "Your role does not give this role.");
      if (state.members.some((row) => row.wallet === input.wallet)) return fail("MEMBER_EXISTS", "This wallet is already in the team or invited.");
      if (state.members.length >= TEAM_LIMITS.membersPerTeam) return fail("LIMIT", `A team holds at most ${TEAM_LIMITS.membersPerTeam} members.`);
      if (activeCount(theirs) >= TEAM_LIMITS.membershipsPerWallet) return fail("LIMIT", `This wallet is in ${TEAM_LIMITS.membershipsPerWallet} teams already.`);
      if (theirs.length - activeCount(theirs) >= TEAM_LIMITS.invitationsPerWallet) return fail("LIMIT", `This wallet has ${TEAM_LIMITS.invitationsPerWallet} invitations open already.`);
      const member: TeamMemberRecord = { teamId: state.team.id, wallet: input.wallet, role, status: "INVITED", label, invitedBy: actor.wallet, invitedAt: at, joinedAt: null };
      return { writes: [{ kind: "member", member }], journal: [{ teamId: state.team.id, at, actor: actor.wallet, action: "MEMBER_INVITED", subject: input.wallet, role, previousRole: null }] };
    });
    if (!changed.ok) return changed;
    return viewFor(deps, changed.state, input.actor);
  });
}

export type MemberChange = Readonly<{ action: "accept" }> | Readonly<{ action: "role"; role: string }> | Readonly<{ action: "remove" }>;

/**
 * One member's place: their own yes (`accept`, the invited wallet only), a new role, or removal — by a member who may
 * keep that place, or by the wallet itself (leaving, or saying no to an invitation). The last active Owner neither
 * leaves nor is demoted: ownership passes first.
 */
export async function changeMember(deps: TeamDeps, input: Readonly<{ id: string; actor: string; wallet: string; change: MemberChange }>): Promise<Readonly<{ ok: true; team: TeamView | null }> | TeamFailure> {
  return guarded(async () => {
    if (!isWallet(input.wallet)) return fail("NOT_FOUND", "No such member.");
    const { change: asked } = input;
    if (asked.action === "role" && !isRole(asked.role)) return fail("INVALID", "role: not a team role.");
    const self = input.actor === input.wallet;
    /* A yes joins a team: the wallet's own active teams are counted, as at an invitation. */
    const joined = asked.action === "accept" && self ? activeCount(await openMemberships(deps, input.wallet)) : 0;
    const changed = await change(deps, input.id, (state, at) => {
      const actor = actorOf(state, input.actor);
      if ("ok" in actor) return actor;
      const target = state.members.find((row) => row.wallet === input.wallet);
      if (!target) return fail("NOT_FOUND", "No such member.");
      const journal = (action: TeamJournalRecord["action"], role: TeamRole | null, previousRole: TeamRole | null): TeamJournalRecord => ({ teamId: state.team.id, at, actor: actor.wallet, action, subject: target.wallet, role, previousRole });

      if (asked.action === "accept") {
        if (!self) return fail("FORBIDDEN", "Only the invited wallet says yes for itself.");
        if (target.status === "ACTIVE") return fail("MEMBER_EXISTS", "This wallet is in the team already.");
        if (joined >= TEAM_LIMITS.membershipsPerWallet) return fail("LIMIT", `A wallet is in at most ${TEAM_LIMITS.membershipsPerWallet} teams on a network.`);
        return { writes: [{ kind: "member", member: { ...target, status: "ACTIVE", joinedAt: at } }], journal: [journal("MEMBER_JOINED", target.role, null)] };
      }

      if (asked.action === "remove") {
        if (!self && (actor.status !== "ACTIVE" || !canManageRole(actor.role, target.role))) return fail("FORBIDDEN", "Your role does not remove this member.");
        const after = state.members.filter((row) => row.wallet !== target.wallet);
        if (activeOwners(after) === 0) return fail("LAST_OWNER", "The last Owner stays until another Owner has joined.");
        return { writes: [{ kind: "remove", wallet: target.wallet }], journal: [journal(self ? "MEMBER_LEFT" : "MEMBER_REMOVED", null, target.role)] };
      }

      const role = asked.role as TeamRole;
      if (actor.status !== "ACTIVE" || !canManageRole(actor.role, target.role) || !canManageRole(actor.role, role)) return fail("FORBIDDEN", "Your role does not give this role.");
      if (target.role === role) return fail("INVALID", "The member holds this role already.");
      const after = state.members.map((row) => (row.wallet === target.wallet ? { ...row, role } : row));
      if (activeOwners(after) === 0) return fail("LAST_OWNER", "The last Owner stays until another Owner has joined.");
      return { writes: [{ kind: "member", member: { ...target, role } }], journal: [journal("ROLE_CHANGED", role, target.role)] };
    });
    if (!changed.ok) return changed;
    /* A wallet that left reads its team no more. */
    if (!changed.state.members.some((row) => row.wallet === input.actor)) return { ok: true as const, team: null };
    return viewFor(deps, changed.state, input.actor);
  });
}

async function viewFor(deps: TeamDeps, state: TeamState, wallet: string): Promise<Readonly<{ ok: true; team: TeamView }> | TeamFailure> {
  const you = actorOf(state, wallet);
  if ("ok" in you) return you;
  return { ok: true, team: await teamView(deps, state, you) };
}

/* --------------------------------------------------------------- treasury */

/**
 * The team's treasury: a Squads v4 multisig (SOL-4) an Owner links once — only an active Owner, and only a multisig
 * whose members on chain include that Owner's own wallet. Once linked it is fixed here: changing or dropping it is a
 * change of the rules money obeys, the multisig's own (TEAM-2). The link names where high-risk rights are proposed; it
 * gives nobody a key: the multisig's members and threshold are the chain's.
 */
export async function linkTreasury(deps: TeamDeps, input: Readonly<{ id: string; actor: string; multisig: string | null }>): Promise<Readonly<{ ok: true; team: TeamView }> | TeamFailure> {
  return guarded(async () => {
    const multisig = input.multisig;
    if (multisig !== null && !isWallet(multisig)) return fail("INVALID", "multisig: not an address");
    /* Who asks, before the chain is read: only an active Owner of a team with no treasury yet costs a read. */
    const decideLink = (state: TeamState): TeamMemberRecord | TeamFailure => {
      const actor = actorOf(state, input.actor);
      if ("ok" in actor) return actor;
      if (actor.status !== "ACTIVE" || actor.role !== "OWNER") return fail("FORBIDDEN", "Only an Owner links the team's treasury.");
      /* Once linked, the link is the treasury's rules — `policy`, the multisig's alone. One Owner neither repoints nor
         drops it: a co-Owner's lost key would otherwise send every payout to a multisig of its own. A change approved by
         the linked multisig is TEAM-2's. */
      if (state.team.treasury !== null) return fail("FORBIDDEN", "The team's treasury is linked; it changes only by a proposal of that multisig.");
      return actor;
    };
    if (!isTeamId(input.id)) return fail("NOT_FOUND", "No such team.");
    const before = await readLive(deps, input.id);
    if (!before || before.team.network !== deps.network) return fail("NOT_FOUND", "No such team.");
    const asked = decideLink(before);
    if ("ok" in asked) return asked;
    if (multisig === null) return fail("INVALID", "No treasury is linked.");
    if (!deps.readSigners) return fail("UNAVAILABLE", "The chain is not read here; the treasury cannot be checked.");
    let signers: readonly TreasuryMember[];
    try {
      signers = await deps.readSigners(multisig);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === "TREASURY_NOT_FOUND" || code === "TREASURY_NOT_SQUADS") return fail("TREASURY_REFUSED", "This address is not a Squads v4 multisig on this network.");
      return fail("UNAVAILABLE", "The multisig could not be read now; try again.");
    }
    /* The operator links a treasury they can propose on: a member who may initiate, read on chain. */
    if (!signers.some((row) => row.address === input.actor && row.initiate)) return fail("TREASURY_REFUSED", "Your wallet is not a member of this multisig who may propose.");
    const changed = await change(deps, input.id, (state, at) => {
      const actor = decideLink(state);
      if ("ok" in actor) return actor;
      return {
        writes: [{ kind: "team", treasury: multisig }],
        journal: [{ teamId: state.team.id, at, actor: actor.wallet, action: "TREASURY_LINKED", subject: multisig, role: null, previousRole: null }],
      };
    });
    if (!changed.ok) return changed;
    return viewFor(deps, changed.state, input.actor);
  });
}

/* ------------------------------------------------------------ the check */

export type TeamActionInput = Readonly<{ teamId: string; wallet: string; permission: TeamPermission; authority?: string | null }>;

/**
 * May this wallet do this in this team, now. Read from the stored list on every call; a high-risk right also reads
 * the treasury's members on chain. The decision says why when it says no.
 */
export async function authorizeTeamAction(deps: TeamDeps, input: TeamActionInput): Promise<Readonly<{ ok: true; decision: TeamDecision }> | TeamFailure> {
  return guarded(async () => {
    if (!isTeamId(input.teamId)) return fail("NOT_FOUND", "No such team.");
    const state = await readLive(deps, input.teamId);
    if (!state || state.team.network !== deps.network) return fail("NOT_FOUND", "No such team.");
    const member = state.members.find((row) => row.wallet === input.wallet) ?? null;
    /* A stranger learns nothing of the team: the same refusal as a team that is not there. */
    if (!member) return fail("NOT_FOUND", "No such team.");
    const decision = decideTeamPermission({ member, permission: input.permission, treasury: state.team.treasury, authority: input.authority ?? null, env: deps.env });
    if (!decision.allowed || decision.requires !== "MULTISIG" || !decision.multisig || !decision.squadsPermission) return { ok: true as const, decision };
    if (!deps.readSigners) return { ok: true as const, decision: { ...decision, allowed: false, refusal: "SIGNERS_UNREAD" } };
    let signers: readonly TreasuryMember[];
    try {
      signers = await deps.readSigners(decision.multisig);
    } catch {
      return { ok: true as const, decision: { ...decision, allowed: false, refusal: "SIGNERS_UNREAD" } };
    }
    const signer = signers.find((row) => row.address === input.wallet);
    if (!signer || !signer[decision.squadsPermission]) return { ok: true as const, decision: { ...decision, allowed: false, refusal: "NOT_A_SIGNER" } };
    return { ok: true as const, decision };
  });
}
