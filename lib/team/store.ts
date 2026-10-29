/**
 * Where a team lives (TEAM-1): the port and the memory adapter. Production is Postgres (`./store-postgres.server.ts`)
 * — three tables a separately authorized migration provisions (`db/migrations/20261025120000_team_1_roles.sql`); the
 * memory adapter serves the tests and a local stand on one instance, and says so (`durability`).
 *
 * A team changes under compare-and-set: every change names the team's version it was decided on, and is applied with
 * its journal rows only while the version is still that one — two Admins changing the list at once never lose one
 * another's change, and a role taken away is never given back by a change decided before. The journal is append-only.
 */

import type { TeamJournalAction, TeamKind, TeamMemberStatus, TeamRole } from "../core/team/roles.ts";

export type TeamNetwork = "solana:mainnet" | "solana:devnet";

export type TeamRecord = Readonly<{
  id: string;
  network: TeamNetwork;
  name: string;
  kind: TeamKind;
  /** The team's Squads v4 multisig (SOL-4), or null: high-risk rights run only through it. */
  treasury: string | null;
  createdBy: string;
  createdAt: string;
  version: number;
}>;

export type TeamMemberRecord = Readonly<{
  teamId: string;
  wallet: string;
  role: TeamRole;
  status: TeamMemberStatus;
  /** The team's own name for the member («Олена, фінанси»): its word, never checked. */
  label: string | null;
  invitedBy: string;
  invitedAt: string;
  joinedAt: string | null;
}>;

export { TEAM_JOURNAL_ACTIONS, type TeamJournalAction } from "../core/team/roles.ts";

export type TeamJournalRecord = Readonly<{
  teamId: string;
  at: string;
  actor: string;
  action: TeamJournalAction;
  /** The wallet or multisig the row is about; null for the team itself. */
  subject: string | null;
  role: TeamRole | null;
  previousRole: TeamRole | null;
}>;

export type TeamWrite =
  | Readonly<{ kind: "member"; member: TeamMemberRecord }>
  | Readonly<{ kind: "remove"; wallet: string }>
  | Readonly<{ kind: "team"; name?: string; treasury?: string | null }>;

export type TeamState = Readonly<{ team: TeamRecord; members: readonly TeamMemberRecord[] }>;

export type TeamStoreDurability = "EPHEMERAL_SINGLE_INSTANCE" | "DURABLE_MULTI_WRITER";

export interface TeamStore {
  readonly durability: TeamStoreDurability;
  /** A new team with its first Owner. False when the id is taken. */
  create(team: TeamRecord, owner: TeamMemberRecord, journal: TeamJournalRecord): Promise<boolean>;
  read(id: string): Promise<TeamState | null>;
  /** The teams a wallet is in on a network, invitations included. */
  memberships(network: TeamNetwork, wallet: string): Promise<readonly Readonly<{ team: TeamRecord; member: TeamMemberRecord }>[]>;
  /** How many teams a wallet created on a network. */
  createdBy(network: TeamNetwork, wallet: string): Promise<number>;
  /** The writes and their journal rows, applied together while the team is at `expectedVersion`; false when it moved. */
  commit(id: string, expectedVersion: number, writes: readonly TeamWrite[], journal: readonly TeamJournalRecord[]): Promise<boolean>;
  /** The newest rows first. */
  journal(id: string, limit: number): Promise<readonly TeamJournalRecord[]>;
}

/** The store could not answer: not provisioned, or not reachable. Never read as «no team». */
export class TeamStoreUnavailable extends Error {
  readonly reason: "NOT_PROVISIONED" | "UNREACHABLE";
  constructor(reason: "NOT_PROVISIONED" | "UNREACHABLE", message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.reason = reason;
  }
}

/** Per-process memory: tests and a local stand on one instance only. */
export function createMemoryTeamStore(): TeamStore {
  const teams = new Map<string, TeamRecord>();
  const members = new Map<string, Map<string, TeamMemberRecord>>();
  const journals = new Map<string, TeamJournalRecord[]>();
  const membersOf = (id: string) => [...(members.get(id)?.values() ?? [])].sort((a, b) => a.invitedAt.localeCompare(b.invitedAt) || a.wallet.localeCompare(b.wallet));
  return {
    durability: "EPHEMERAL_SINGLE_INSTANCE",
    async create(team, owner, journal) {
      if (teams.has(team.id)) return false;
      teams.set(team.id, team);
      members.set(team.id, new Map([[owner.wallet, owner]]));
      journals.set(team.id, [journal]);
      return true;
    },
    async read(id) {
      const team = teams.get(id);
      return team ? { team, members: membersOf(id) } : null;
    },
    async memberships(network, wallet) {
      const rows: { team: TeamRecord; member: TeamMemberRecord }[] = [];
      for (const team of teams.values()) {
        const member = members.get(team.id)?.get(wallet);
        if (team.network === network && member) rows.push({ team, member });
      }
      return rows.sort((a, b) => a.team.createdAt.localeCompare(b.team.createdAt));
    },
    async createdBy(network, wallet) {
      return [...teams.values()].filter((team) => team.network === network && team.createdBy === wallet).length;
    },
    async commit(id, expectedVersion, writes, journal) {
      const team = teams.get(id);
      if (!team || team.version !== expectedVersion) return false;
      const list = new Map(members.get(id));
      let next: TeamRecord = { ...team, version: team.version + 1 };
      for (const write of writes) {
        if (write.kind === "member") list.set(write.member.wallet, write.member);
        else if (write.kind === "remove") list.delete(write.wallet);
        else next = { ...next, ...(write.name !== undefined ? { name: write.name } : {}), ...(write.treasury !== undefined ? { treasury: write.treasury } : {}) };
      }
      /* The same law the database's trigger holds: a team never stands without an active Owner. */
      if (![...list.values()].some((member) => member.role === "OWNER" && member.status === "ACTIVE")) return false;
      teams.set(id, next);
      members.set(id, list);
      journals.set(id, [...(journals.get(id) ?? []), ...journal]);
      return true;
    },
    async journal(id, limit) {
      return [...(journals.get(id) ?? [])].reverse().slice(0, limit);
    },
  };
}
