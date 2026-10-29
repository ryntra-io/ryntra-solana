/**
 * A mission's crew (MC-2, decision 68): two to five people who share the creator's fees on chain — Meteora's Dynamic
 * Fee Sharing, the same vault «Спільнота» writes (`./fee-shares.ts`, `../venues/meteora-dbc/fee-sharing.server.ts`).
 *
 * How it holds:
 * - The creator invites up to four people by their X handle and names each one's part of the creator's fees.
 * - Each invitee answers themselves, with their own wallet proven to this site. Nobody's wallet is put on a crew
 *   without its own yes — the creator cannot answer for anyone — and the wallet that said yes can take it back until
 *   the launch is sent.
 * - At liftoff the vault is written once with the creator and every member who said yes; a part nobody accepted stays
 *   with the creator. The program has no instruction that changes the parts afterwards.
 * - The vault holds each member's fees until that member claims them with their own wallet: the share waits.
 *
 * Ryntra does not read X: a handle is nobody's proof — whoever opens the public invitation may say yes as a handle
 * nobody answered yet. So the creator sees each yes by its wallet and checks it with its person before liftoff, and
 * nothing public (the sky, the cards, the list of crews) names a member by handle: the vault's rows are wallets. The
 * crew is fixed once made — a creator who wants other parts makes a new crew, so nobody's yes is ever to terms they
 * did not see.
 *
 * Pure and client-safe. The records and the routes are `../../launch/crew.server.ts`.
 */

import { FEE_SHARE_MAX_RECIPIENTS, FEE_SHARE_MIN_BPS, FEE_SHARE_MIN_RECIPIENTS, FEE_SHARE_TOTAL_BPS, type FeeShare } from "./fee-shares.ts";

/** A crew is the creator and one to four members: the program's two to five wallets. */
export const CREW_MIN_MEMBERS = FEE_SHARE_MIN_RECIPIENTS - 1;
export const CREW_MAX_MEMBERS = FEE_SHARE_MAX_RECIPIENTS - 1;
/** The least part of the creator's fees a member, and the creator, takes: one per cent. */
export const CREW_MIN_BPS = FEE_SHARE_MIN_BPS;
/** How long invitations wait for their answers and the launch. */
export const CREW_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** The presets a crew flies on: the ones whose creator's fees are the creator's alone. «Спільнота» keeps its own rows. */
export const CREW_PRESETS = ["classic", "protected"] as const;
export type CrewPreset = (typeof CREW_PRESETS)[number];

/**
 * False: closed there — a crew moves a part of the creator's money to other
 * wallets through a program, and that opens to people on mainnet alone, after the
 * devnet pass and the canary (`docs/research/ryntra-launch-2026-10-25/MC-2.md`). The devnet stand is open. Flipped here, then — the
 * server, the form and the crew's page read this one value.
 */
export const CREW_OWNER_WORD = false;

/** Whether crews may be made and answered on a network: the devnet stand. */
export function crewOpenOn(cluster: "mainnet" | "devnet", ownerWord: boolean = CREW_OWNER_WORD): boolean {
  return cluster === "devnet" || ownerWord === true;
}

export function isCrewPreset(id: string): id is CrewPreset {
  return (CREW_PRESETS as readonly string[]).includes(id);
}

/* ------------------------------------------------------------ handles */

/** X's own handle rule: one to fifteen letters, digits and underscores. */
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** A handle as typed — «@Ada_R», «x.com/Ada_R» — without its decorations; null when it is not one X allows. */
export function handleOf(text: string): string | null {
  const bare = text
    .trim()
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/$/, "");
  return X_HANDLE.test(bare) ? bare : null;
}

/** Handles are one person whatever their case. */
export function sameHandle(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/* ------------------------------------------------------------ the crew */

export const CREW_MEMBER_STATES = ["INVITED", "ACCEPTED", "DECLINED"] as const;
export type CrewMemberState = (typeof CREW_MEMBER_STATES)[number];

export type CrewMember = Readonly<{
  handle: string;
  /** The member's part of the creator's fees, whole basis points. */
  bps: number;
  state: CrewMemberState;
  /** The wallet that said yes — the one the vault pays; null until then, and again after a no. */
  wallet: string | null;
  answeredAt: string | null;
}>;

export type CrewInvite = Readonly<{ handle: string; bps: number }>;

export type CrewProblem = "TOO_FEW" | "TOO_MANY" | "HANDLE_INVALID" | "HANDLE_REPEATED" | "HANDLE_IS_CREATOR" | "SHARE_NOT_WHOLE" | "SHARE_TOO_SMALL" | "CREATOR_SHARE_TOO_SMALL";

/** What breaks the invitations, each once; empty when they hold. `creatorHandle` — the creator's own, when they gave one. */
export function crewProblems(invites: readonly CrewInvite[], creatorHandle: string | null = null): readonly CrewProblem[] {
  const problems = new Set<CrewProblem>();
  if (invites.length < CREW_MIN_MEMBERS) problems.add("TOO_FEW");
  if (invites.length > CREW_MAX_MEMBERS) problems.add("TOO_MANY");
  const seen: string[] = [];
  let given = 0;
  for (const invite of invites) {
    const handle = handleOf(invite.handle);
    if (!handle || handle !== invite.handle) problems.add("HANDLE_INVALID");
    else {
      if (seen.some((other) => sameHandle(other, handle))) problems.add("HANDLE_REPEATED");
      if (creatorHandle && sameHandle(creatorHandle, handle)) problems.add("HANDLE_IS_CREATOR");
      seen.push(handle);
    }
    if (!Number.isInteger(invite.bps)) problems.add("SHARE_NOT_WHOLE");
    else {
      if (invite.bps < CREW_MIN_BPS) problems.add("SHARE_TOO_SMALL");
      given += invite.bps;
    }
  }
  if (!problems.has("SHARE_NOT_WHOLE") && FEE_SHARE_TOTAL_BPS - given < CREW_MIN_BPS) problems.add("CREATOR_SHARE_TOO_SMALL");
  return [...problems];
}

/** The creator's own part: everything the members do not take — the parts of those who did not say yes included. */
export function creatorPartBps(members: readonly Pick<CrewMember, "bps" | "state">[], onlyAccepted = true): number {
  return FEE_SHARE_TOTAL_BPS - members.filter((member) => !onlyAccepted || member.state === "ACCEPTED").reduce((total, member) => total + member.bps, 0);
}

/**
 * The vault's rows at liftoff: the creator first, then every member who said yes, by their wallet. Null while nobody
 * said yes — the program takes two wallets at least, and a crew of one is the creator alone.
 */
export function crewFeeShares(creator: string, members: readonly CrewMember[]): readonly FeeShare[] | null {
  const aboard = members.filter((member): member is CrewMember & { wallet: string } => member.state === "ACCEPTED" && member.wallet !== null && member.wallet !== creator);
  if (aboard.length === 0) return null;
  const wallets = new Set(aboard.map((member) => member.wallet));
  if (wallets.size !== aboard.length) return null;
  return [{ address: creator, bps: creatorPartBps(aboard) }, ...aboard.map((member) => ({ address: member.wallet, bps: member.bps }))];
}

/** A part as people read it: «20%», «12.5%». */
export function partWords(bps: number): string {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/**
 * What an invitee says yes to, word for word — the page shows it above the button and the record keeps the yes to
 * these terms. No promise of income: what the part is a part of, where it waits and who can change it.
 */
export function consentWords(crew: Readonly<{ symbol: string; creator: string }>, member: Pick<CrewMember, "handle" | "bps">): readonly string[] {
  return [
    `I am @${member.handle} on X and I join the crew of $${crew.symbol}.`,
    `At liftoff Meteora's Dynamic Fee Sharing vault is written with my wallet and ${partWords(member.bps)} of the creator's fees on this token: its share of the curve's fees, of the graduation fee and of its locked liquidity's fees. The parts are fixed for ever once written; nobody — not the creator, not Ryntra — can change them.`,
    `My fees wait in the vault until I claim them with this wallet. They may be nothing: they come only from trades of the token.`,
    `I can take this back until liftoff. After liftoff my part is on chain.`,
  ];
}

/** The post that invites the crew on X — the creator posts it themselves; Ryntra never posts and never rewards a post. */
export function crewInviteWords(symbol: string, handles: readonly string[]): string {
  return `${handles.map((handle) => `@${handle}`).join(" ")} join my crew for $${symbol} on Ryntra — your part of the creator's fees is waiting for your yes.`;
}
