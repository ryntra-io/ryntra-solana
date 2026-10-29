/**
 * A mission's crew on the server (MC-2, decision 68): the creator's invitations, each invitee's own answer, the
 * vault's rows at liftoff and the crews already flying. The rules are `../core/launch/crew.ts`.
 *
 * A crew is made by the creator's proven wallet and answered by each invitee's proven wallet — the route proves both
 * (`requireWalletProof`, a mutation: the wallet's session, opened by its signature). Once made it is fixed: only the
 * answers change, each under compare-and-set, so two invitees answering at once never lose one another's yes. A handle
 * is nobody's proof: anyone who opens the public invitation may say yes as any handle not yet answered, so the creator
 * sees each yes by its wallet and checks it with its person before liftoff, and nothing public names a member by handle.
 * At liftoff the launch's build takes the vault's rows from the record, never from the request (`crewSharesFor`); the
 * submit holds the crew for its token before anything is sent, only while the rows are still the record's
 * (`holdCrew`) — from then on nobody answers it and no other launch takes it — and lets it go when the send is refused
 * (`releaseCrew`). A crew flies on the scene only once its vault holds the curve's creator role on chain — the launch's
 * own record says SHARED — and with the vault's own rows, by wallet.
 *
 * On mainnet every write is closed.
 */

import { randomBytes } from "node:crypto";

import {
  CREW_INVITE_TTL_MS,
  consentWords,
  creatorPartBps,
  crewFeeShares,
  crewOpenOn,
  crewProblems,
  handleOf,
  isCrewPreset,
  sameHandle,
  type CrewInvite,
  type CrewMember,
  type CrewPreset,
} from "../core/launch/crew.ts";
import { isKey } from "../core/launch/creator-split.ts";
import type { FeeShare } from "../core/launch/fee-shares.ts";
import { windowById } from "../core/launch/windows.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { checkLaunchForm } from "./form.ts";
import { launchKey } from "./record-key.ts";

export const LAUNCH_CREWS = "launchCrews" as const;
/** A creator holds at most this many crews waiting for liftoff at once. */
export const CREWS_OPEN_PER_CREATOR = 5;

export type CrewRecord = Readonly<{
  version: number;
  id: string;
  cluster: "mainnet" | "devnet";
  creator: string;
  /** The creator's own X handle, when they gave one — their word, like every handle here. */
  creatorHandle: string | null;
  symbol: string;
  name: string;
  preset: CrewPreset;
  /** The launch window the creator named (`windows.ts`), or null — «now». A time only: nothing waits on it. */
  window: string | null;
  members: readonly CrewMember[];
  createdAt: string;
  expiresAt: string;
  /** The token the crew lifted off with; null until then. */
  token: string | null;
  launchedAt: string | null;
}>;

export type CrewDeps = Readonly<{ store: GuardStore; cluster: "mainnet" | "devnet"; now: () => Date; ownerWord?: boolean }>;

export type CrewFailureCode = "CLOSED" | "INVALID" | "NAME_REFUSED" | "NOT_FOUND" | "NOT_INVITED" | "IS_CREATOR" | "WALLET_TAKEN" | "LAUNCHED" | "EXPIRED" | "LIMIT" | "NOBODY_ABOARD" | "WRONG_CREATOR" | "CHANGED" | "UNAVAILABLE";
export type CrewFailure = Readonly<{ ok: false; code: CrewFailureCode; message: string }>;
const fail = (code: CrewFailureCode, message: string): CrewFailure => ({ ok: false, code, message });

const keyOf = (cluster: string, id: string) => `${cluster}:${id}`;
const CREW_ID = /^[0-9a-f]{24}$/;

export function isCrewId(id: string): boolean {
  return CREW_ID.test(id);
}

export async function readCrew(deps: Pick<CrewDeps, "store" | "cluster">, id: string): Promise<CrewRecord | null> {
  if (!isCrewId(id)) return null;
  return (await deps.store.versioned<CrewRecord>(LAUNCH_CREWS).get(keyOf(deps.cluster, id))) ?? null;
}

const live = (crew: CrewRecord, now: number) => crew.token !== null || Date.parse(crew.expiresAt) > now;

/* ------------------------------------------------------------ making one */

export type CreateCrewInput = Readonly<{
  creator: string;
  creatorHandle: string | null;
  symbol: string;
  name: string;
  preset: string;
  window: string | null;
  invites: readonly CrewInvite[];
}>;

export async function createCrew(deps: CrewDeps, input: CreateCrewInput): Promise<Readonly<{ ok: true; crew: CrewRecord }> | CrewFailure> {
  if (!crewOpenOn(deps.cluster, deps.ownerWord)) return fail("CLOSED", "Crews are not open on mainnet yet; the devnet stand has them.");
  if (!isKey(input.creator)) return fail("INVALID", "creator: not an address");
  if (!isCrewPreset(input.preset)) return fail("INVALID", "A crew flies on Classic or Protected.");
  const creatorHandle = input.creatorHandle === null ? null : handleOf(input.creatorHandle);
  if (input.creatorHandle !== null && creatorHandle === null) return fail("INVALID", "creatorHandle: not an X handle");
  const invites = input.invites.map((invite) => ({ handle: handleOf(invite.handle) ?? invite.handle, bps: invite.bps }));
  const problems = crewProblems(invites, creatorHandle);
  if (problems.length) return fail("INVALID", `The crew does not hold: ${problems.join(", ")}.`);
  const check = checkLaunchForm({ name: input.name, symbol: input.symbol, description: "", website: "", x: "", telegram: "" });
  if (check.problems.name === "OFFENSIVE" || check.problems.symbol === "OFFENSIVE") return fail("NAME_REFUSED", "Ryntra does not launch a token under this name or ticker.");
  if (check.problems.name || check.problems.symbol) return fail("INVALID", "The name or the ticker does not hold.");
  if (check.hits.length) return fail("NAME_REFUSED", `The name or ticker reads as ${check.hits.map((hit) => hit.label).join(", ")}.`);
  const now = deps.now().getTime();
  if (input.window !== null) {
    const window = windowById(input.window);
    if (!window || window.closesAt <= now) return fail("INVALID", "window: not a launch window still ahead.");
  }
  const crews = deps.store.versioned<CrewRecord>(LAUNCH_CREWS);
  const all = await crews.valuesWithPrefix(`${deps.cluster}:`);
  /* Invitations nobody launched are gone after their week: anyone can make a crew, nobody can fill the store with them. */
  for (const stale of all.filter((crew) => !live(crew, now))) await crews.delete(keyOf(stale.cluster, stale.id));
  if (all.filter((crew) => live(crew, now) && crew.token === null && crew.creator === input.creator).length >= CREWS_OPEN_PER_CREATOR) {
    return fail("LIMIT", `A wallet holds at most ${CREWS_OPEN_PER_CREATOR} crews waiting for liftoff.`);
  }
  const crew: CrewRecord = {
    version: 0,
    id: randomBytes(12).toString("hex"),
    cluster: deps.cluster,
    creator: input.creator,
    creatorHandle,
    symbol: input.symbol.trim().replace(/^\$/, "").toUpperCase(),
    name: input.name.trim().replace(/\s+/g, " "),
    preset: input.preset,
    window: input.window,
    members: invites.map((invite) => ({ handle: invite.handle, bps: invite.bps, state: "INVITED", wallet: null, answeredAt: null })),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CREW_INVITE_TTL_MS).toISOString(),
    token: null,
    launchedAt: null,
  };
  if (!(await crews.compareAndSet(keyOf(crew.cluster, crew.id), null, crew))) return fail("UNAVAILABLE", "The crew could not be stored; try again.");
  return { ok: true, crew };
}

/* ------------------------------------------------------------ an answer */

export type AnswerInput = Readonly<{ id: string; handle: string; wallet: string; answer: "accept" | "decline" }>;

/**
 * An invitee's own answer: the wallet the route proved says yes for the handle it was invited by, or takes its own yes
 * back. The creator's wallet never answers, a wallet is aboard once, a no is only a yes taken back by the wallet that
 * gave it (a stranger cannot answer no for anyone), and nothing changes once the crew is held for liftoff or past the week.
 */
export async function answerCrew(deps: CrewDeps, input: AnswerInput): Promise<Readonly<{ ok: true; crew: CrewRecord }> | CrewFailure> {
  if (!crewOpenOn(deps.cluster, deps.ownerWord)) return fail("CLOSED", "Crews are not open on mainnet yet; the devnet stand has them.");
  if (!isCrewId(input.id)) return fail("NOT_FOUND", "No such crew.");
  const handle = handleOf(input.handle);
  if (!handle) return fail("INVALID", "handle: not an X handle");
  const crews = deps.store.versioned<CrewRecord>(LAUNCH_CREWS);
  const key = keyOf(deps.cluster, input.id);
  let outcome: Readonly<{ ok: true; crew: CrewRecord }> | CrewFailure = fail("UNAVAILABLE", "The answer could not be stored; try again.");
  try {
    await withBoundedCasRetry(async () => {
      const crew = await crews.get(key);
      if (!crew) return (outcome = fail("NOT_FOUND", "No such crew."));
      if (crew.token !== null) return (outcome = fail("LAUNCHED", "This crew lifted off; its parts are on chain."));
      const now = deps.now();
      if (Date.parse(crew.expiresAt) <= now.getTime()) return (outcome = fail("EXPIRED", "This invitation's week is over."));
      if (input.wallet === crew.creator) return (outcome = fail("IS_CREATOR", "The creator does not answer for their crew."));
      const at = crew.members.findIndex((member) => sameHandle(member.handle, handle));
      if (at < 0) return (outcome = fail("NOT_INVITED", `@${handle} is not invited to this crew.`));
      const member = crew.members[at]!;
      if (input.answer === "accept") {
        if (crew.members.some((other, index) => index !== at && other.state === "ACCEPTED" && other.wallet === input.wallet)) {
          return (outcome = fail("WALLET_TAKEN", "This wallet already said yes for another handle on this crew."));
        }
        /* A yes stands with the wallet that said it: another wallet for the same handle answers only after a no. */
        if (member.state === "ACCEPTED" && member.wallet !== input.wallet) return (outcome = fail("WALLET_TAKEN", `@${handle} already said yes with another wallet.`));
      } else if (member.state !== "ACCEPTED" || member.wallet !== input.wallet) {
        return (outcome = fail("WALLET_TAKEN", `Only the wallet that said yes for @${handle} takes it back.`));
      }
      const next: CrewMember =
        input.answer === "accept"
          ? { ...member, handle: member.handle, state: "ACCEPTED", wallet: input.wallet, answeredAt: now.toISOString() }
          : { ...member, state: "DECLINED", wallet: null, answeredAt: now.toISOString() };
      const written: CrewRecord = { ...crew, version: crew.version + 1, members: crew.members.map((item, index) => (index === at ? next : item)) };
      if (!(await crews.compareAndSet(key, crew.version, written))) return false;
      return (outcome = { ok: true, crew: written });
    });
  } catch {
    return fail("UNAVAILABLE", "The answer could not be stored; try again.");
  }
  return outcome;
}

/* ------------------------------------------------------------ liftoff */

/**
 * The vault's rows for a launch built with a crew — from the record alone: the crew's creator is the launch's, its
 * preset and ticker the launch's, it has not flown, and someone said yes. A part nobody accepted stays the creator's.
 */
export async function crewSharesFor(
  deps: CrewDeps,
  input: Readonly<{ id: string; creator: string; preset: string; symbol: string; name: string }>,
): Promise<Readonly<{ ok: true; crew: CrewRecord; shares: readonly FeeShare[] }> | CrewFailure> {
  if (!crewOpenOn(deps.cluster, deps.ownerWord)) return fail("CLOSED", "Crews are not open on mainnet yet; the devnet stand has them.");
  const crew = await readCrew(deps, input.id);
  if (!crew) return fail("NOT_FOUND", "No such crew.");
  if (crew.creator !== input.creator) return fail("WRONG_CREATOR", "This crew is another creator's.");
  if (crew.token !== null) return fail("LAUNCHED", "This crew already lifted off.");
  if (Date.parse(crew.expiresAt) <= deps.now().getTime()) return fail("EXPIRED", "This crew's week is over; make a new one.");
  if (crew.preset !== input.preset) return fail("INVALID", `This crew flies on ${crew.preset}.`);
  if (crew.symbol !== input.symbol.trim().replace(/^\$/, "").toUpperCase()) return fail("INVALID", `This crew said yes to $${crew.symbol}.`);
  if (crew.name !== input.name.trim().replace(/\s+/g, " ")) return fail("INVALID", `This crew said yes to «${crew.name}».`);
  const shares = crewFeeShares(crew.creator, crew.members);
  if (!shares) return fail("NOBODY_ABOARD", "Nobody on this crew said yes yet.");
  return { ok: true, crew, shares };
}

const sameRows = (a: readonly FeeShare[], b: readonly FeeShare[]) => a.length === b.length && a.every((row, index) => row.address === b[index]!.address && row.bps === b[index]!.bps);

/**
 * The submit holds the crew for its token before anything is sent — only while the record's rows are still the build's
 * (no yes taken back, no other launch holding it, its week not over). From then on the crew is the token's: nobody
 * answers it and no other build takes it. The same token holding it again is the same submit, and holds — `fresh`
 * false: only a hold this call made is let go when its send does not go.
 */
export async function holdCrew(
  store: GuardStore,
  cluster: "mainnet" | "devnet",
  input: Readonly<{ id: string; token: string; shares: readonly FeeShare[]; at: string }>,
): Promise<Readonly<{ ok: true; fresh: boolean }> | CrewFailure> {
  const crews = store.versioned<CrewRecord>(LAUNCH_CREWS);
  const key = keyOf(cluster, input.id);
  let outcome: Readonly<{ ok: true; fresh: boolean }> | CrewFailure = fail("UNAVAILABLE", "The crew could not be held; try again.");
  try {
    await withBoundedCasRetry(async () => {
      const crew = await crews.get(key);
      if (!crew) return (outcome = fail("NOT_FOUND", "No such crew."));
      if (crew.token === input.token) return (outcome = { ok: true, fresh: false });
      if (crew.token !== null) return (outcome = fail("LAUNCHED", "This crew already lifted off with another token."));
      if (Date.parse(crew.expiresAt) <= Date.parse(input.at)) return (outcome = fail("EXPIRED", "This crew's week is over; make a new one."));
      const rows = crewFeeShares(crew.creator, crew.members);
      if (!rows || !sameRows(rows, input.shares)) return (outcome = fail("CHANGED", "The crew's answers changed since the launch was built; build it again."));
      if (!(await crews.compareAndSet(key, crew.version, { ...crew, version: crew.version + 1, token: input.token, launchedAt: input.at }))) return false;
      return (outcome = { ok: true, fresh: true });
    });
  } catch {
    return fail("UNAVAILABLE", "The crew could not be held; try again.");
  }
  return outcome;
}

/** A send the network refused lets its crew go: the crew waits again, its answers as they were. */
export async function releaseCrew(store: GuardStore, cluster: "mainnet" | "devnet", id: string, token: string): Promise<void> {
  const crews = store.versioned<CrewRecord>(LAUNCH_CREWS);
  const key = keyOf(cluster, id);
  await withBoundedCasRetry(async () => {
    const crew = await crews.get(key);
    if (!crew || crew.token !== token) return true;
    return (await crews.compareAndSet(key, crew.version, { ...crew, version: crew.version + 1, token: null, launchedAt: null })) ? true : false;
  }).catch(() => undefined);
}

/* ------------------------------------------------------------ the crews in flight */

type SharedLaunch = Readonly<{ creator: string; launchedAt?: string; feeSharing?: Readonly<{ state: string; shares: readonly FeeShare[] }> | null }>;

export type FlyingCrew = Readonly<{
  token: string;
  symbol: string;
  creator: string;
  creatorBps: number;
  /** The vault's rows beside the creator's, by wallet — what the program pays, never a handle nobody checked. */
  members: readonly Readonly<{ wallet: string; bps: number }>[];
  window: string | null;
  launchedAt: string | null;
}>;

/**
 * Every crew whose launch's vault holds the curve's creator role — the launch's record SHARED, settled from the chain —
 * with that vault's own rows. A crew whose sharing failed or is still pending flies as its creator alone.
 */
export async function readFlyingCrews(deps: Pick<CrewDeps, "store" | "cluster">): Promise<readonly FlyingCrew[]> {
  const crews = (await deps.store.versioned<CrewRecord>(LAUNCH_CREWS).valuesWithPrefix(`${deps.cluster}:`)).filter((crew) => crew.token !== null);
  const launches = deps.store.collection<SharedLaunch>("launches");
  const flying: FlyingCrew[] = [];
  for (const crew of crews) {
    const launch = await launches.get(launchKey(deps.cluster, crew.token!));
    if (!launch || launch.creator !== crew.creator || launch.feeSharing?.state !== "SHARED") continue;
    const rows = launch.feeSharing.shares;
    const members = rows.filter((row) => row.address !== crew.creator).map((row) => ({ wallet: row.address, bps: row.bps }));
    if (!members.length) continue;
    flying.push({
      token: crew.token!,
      symbol: crew.symbol,
      creator: crew.creator,
      creatorBps: rows.find((row) => row.address === crew.creator)?.bps ?? 0,
      members,
      window: crew.window,
      launchedAt: crew.launchedAt,
    });
  }
  return flying.sort((a, b) => Date.parse(b.launchedAt ?? "") - Date.parse(a.launchedAt ?? ""));
}

/** A crew as anyone may read it: no wallet beyond the ones that said yes — they will be the vault's rows on chain. */
export function crewView(crew: CrewRecord, now: number) {
  return {
    id: crew.id,
    creator: crew.creator,
    creatorHandle: crew.creatorHandle,
    symbol: crew.symbol,
    name: crew.name,
    preset: crew.preset,
    window: crew.window,
    members: crew.members.map((member) => ({ handle: member.handle, bps: member.bps, state: member.state, wallet: member.state === "ACCEPTED" ? member.wallet : null, answeredAt: member.answeredAt, consent: [...consentWords(crew, member)] })),
    creatorBps: creatorPartBps(crew.members),
    createdAt: crew.createdAt,
    expiresAt: crew.expiresAt,
    expired: crew.token === null && Date.parse(crew.expiresAt) <= now,
    token: crew.token,
    launchedAt: crew.launchedAt,
  };
}

/** A crew's refusal in the contract's codes — no new ones (1.74.0). */
export const CREW_FAILURE_CODES = {
  CLOSED: "CAPABILITY_UNAVAILABLE",
  INVALID: "VALIDATION_ERROR",
  NAME_REFUSED: "LAUNCH_NAME_BORROWED",
  NOT_FOUND: "LAUNCH_NOT_FOUND",
  NOT_INVITED: "WALLET_MISMATCH",
  IS_CREATOR: "WALLET_MISMATCH",
  WALLET_TAKEN: "WALLET_MISMATCH",
  WRONG_CREATOR: "WALLET_MISMATCH",
  CHANGED: "LAUNCH_SHARES_INVALID",
  LAUNCHED: "LAUNCH_SHARES_INVALID",
  EXPIRED: "LAUNCH_SHARES_INVALID",
  NOBODY_ABOARD: "LAUNCH_SHARES_INVALID",
  LIMIT: "LAUNCH_LIMIT",
  UNAVAILABLE: "UNAVAILABLE",
} as const satisfies Record<CrewFailureCode, import("../api/v1/contract.ts").ApiErrorCode>;
