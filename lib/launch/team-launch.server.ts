/**
 * Team Launch on the server (MOS-2): the one check and the one record every step of the wizard passes through.
 *
 * A step of Team Launch happens only when three things hold, in this order, and the refusal names which one did not:
 * 1. **the deployment serves it** — `RYNTRA_TEAM_LAUNCH` is open, or a canary whose list names this wallet (D6: the
 *    owner's own canary and whitelist first). Closed is the default on every deployment and is not announced;
 * 2. **the team's rights allow it** — `authorizeTeamAction` of TEAM-1, for every right the step needs, checked on the
 *    server on every request against the stored list; a high-risk right only as a proposal on the team's Squads
 *    treasury, with the wallet's own Squads permission read on chain;
 * 3. **the step itself holds** — the same rules the form checked (`lib/core/launch/team-launch.ts`), checked again here.
 *
 * Then, and only then, the step is recorded: one EXE-2 action, so every step of the wizard carries an `actionId` and
 * nothing in the wizard happens unrecorded. The record is keyed by the part of the draft the step owns, so pressing
 * «Далі» twice replays the one action instead of opening a second one.
 *
 * Nothing here builds a transaction, signs, sends or deploys: step 08 ends at the review, and what it would sign is
 * named to the person before any wallet is asked. The money path stays Quick Launch's own
 * (`./flow.server.ts`), untouched.
 *
 * Server only.
 */

import { openAction } from "../core/actions/ledger.ts";
import { DBC_PROGRAM } from "../core/launch/constitution.ts";
import {
  TEAM_LAUNCH_AUTHORITY,
  teamLaunchReview,
  teamLaunchServedFor,
  teamLaunchStepProblems,
  teamLaunchStepSubject,
  stepSpendRaw,
  type TeamLaunchDraft,
  type TeamLaunchReview,
  type TeamLaunchStep,
} from "../core/launch/team-launch.ts";
import type { TeamDecision, TeamPermission } from "../core/team/roles.ts";
import type { GuardStore } from "../guard/store.ts";
import { hashCanonical } from "../guard/canonical.ts";
import { FixedWindowLimiter, clientIp } from "../http-control.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import { teamsServed } from "../team/runtime.server.ts";
import { authorizeTeamAction, type TeamDeps } from "../team/service.server.ts";
import { launchNetwork, launchPair, type LaunchNetwork } from "./config.server.ts";

export const TEAM_LAUNCH_REFUSALS = ["CLOSED", "NOT_WHITELISTED", "FORBIDDEN", "NOT_FOUND", "INVALID", "UNAVAILABLE"] as const;
export type TeamLaunchRefusal = (typeof TEAM_LAUNCH_REFUSALS)[number];

export type TeamLaunchFailure = Readonly<{
  ok: false;
  code: TeamLaunchRefusal;
  message: string;
  /** The TEAM-1 decision, where the refusal is a right: what the wallet holds and what it would need. */
  decision: TeamDecision | null;
  /** The step's own problems, where the refusal is the draft. */
  problems: readonly string[];
}>;

const fail = (code: TeamLaunchRefusal, message: string, over: Partial<TeamLaunchFailure> = {}): TeamLaunchFailure =>
  Object.freeze({ ok: false as const, code, message, decision: null, problems: [], ...over });

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Said to every wallet Team Launch does not serve, whatever the reason: a canary is not announced. */
export const TEAM_LAUNCH_CLOSED_MESSAGE = "Team Launch is not open on this deployment yet.";

/**
 * The wizard's own limiter, not Launch's `metadata` one: a whole pass is eight steps, and a team walking back over a
 * step it changed is the wizard working as drawn. A hundred and twenty an hour from one address is a team at work and
 * nothing like a loop. The steps build nothing and spend nothing, so the heavier limits stay with the build and the
 * send.
 */
const STEP_LIMITER = new FixedWindowLimiter({ limit: 120, windowMs: 60 * 60 * 1000, maxKeys: 5_000 });

export function consumeTeamLaunchStep(headers: Headers) {
  return STEP_LIMITER.consume(`team-launch-step:${clientIp(headers)}`);
}

export type TeamLaunchCommitted = Readonly<{
  ok: true;
  /** The one `actionId` of this step in the EXE-2 journal; the same step and the same fields again replay it. */
  actionId: string;
  /** True when the step was already recorded with these fields: nothing was written a second time. */
  replay: boolean;
  /** Every right the step needed, with the decision the server made for each. */
  decisions: Readonly<Record<string, TeamDecision>>;
  /** Step 08 only: the simulation, the fees row by row, the budget, the Constitution and the chronicle. */
  review: TeamLaunchReview | null;
}>;

export type TeamLaunchDeps = Readonly<{
  team: TeamDeps;
  store: GuardStore;
  network: LaunchNetwork;
  now: () => Date;
  env?: Readonly<Record<string, string | undefined>>;
  /**
   * Whether Ryntra's executor claims the market's budget on people's markets on this network now (SOL-L6, the
   * operator's switch, `launchPeopleServed`). Unknown is read as «not now»: the review never promises a ladder on a guess.
   */
  peopleServed?: boolean;
}>;

export type CommitTeamLaunchStepInput = Readonly<{
  wallet: string;
  step: TeamLaunchStep;
  draft: TeamLaunchDraft;
}>;

/**
 * One step of the wizard: served, allowed, holding — then recorded. The decisions are returned whether the step passed
 * or not, so the wizard can say «this step waits for the treasury» instead of «something went wrong».
 */
export async function commitTeamLaunchStep(deps: TeamLaunchDeps, input: CommitTeamLaunchStepInput): Promise<TeamLaunchCommitted | TeamLaunchFailure> {
  const env = deps.env ?? {};
  const served = teamLaunchServedFor(input.wallet, env);
  /* A canary is not announced: a wallet the whitelist does not name reads word for word what a closed deployment
     says, so the refusal never tells a stranger that a canary is running. */
  if (!served.served) return fail(served.reason === "CLOSED" ? "CLOSED" : "NOT_WHITELISTED", TEAM_LAUNCH_CLOSED_MESSAGE);
  if (input.draft.teamId.length === 0) return fail("INVALID", "teamId: no team named.");

  /* TEAM-1, every right the step needs — not the first: a step that needs two is allowed only when both are. The
     treasury's members are read from the chain once for the whole step, however many rights ask for them. */
  const team = withOneTreasuryRead(deps.team);
  const decisions: Record<string, TeamDecision> = {};
  for (const permission of input.step.permissions) {
    const authority = authorityFor(permission);
    const checked = await authorizeTeamAction(team, { teamId: input.draft.teamId, wallet: input.wallet, permission, authority });
    if (!checked.ok) return fail(checked.code === "NOT_FOUND" ? "NOT_FOUND" : checked.code === "FORBIDDEN" ? "FORBIDDEN" : checked.code === "INVALID" ? "INVALID" : "UNAVAILABLE", checked.message);
    decisions[permission] = checked.decision;
  }
  const refused = input.step.permissions.find((permission) => !decisions[permission]!.allowed);
  if (refused !== undefined) {
    const decision = decisions[refused]!;
    return fail("FORBIDDEN", `${refused}: ${decision.refusal ?? "refused"}.`, { decision, problems: [] });
  }

  /* The same rules the form checked, checked again here: a form is never the check. */
  const problems = teamLaunchStepProblems(input.step.key, input.draft);
  if (problems.length > 0) return fail("INVALID", `${input.step.key}: the step does not hold.`, { problems });

  /* One EXE-2 action for the step. A draft spends nothing; step 08 names what the signature would spend, so the
     action's bound is never open, and what it names is the pair currency of the team's own first purchase. */
  let pair;
  try {
    pair = launchPair(deps.network, input.draft.curve.preset);
  } catch {
    /* A preset with no config on this network is not a fault to retry: the step says the preset is not offered here. */
    return fail("INVALID", `preset: ${input.draft.curve.preset} is not offered on ${deps.network.cluster}.`, { problems: ["PRESET"] });
  }
  const spendRaw = stepSpendRaw(input.step.key, input.draft);
  /* The team's own treasury: the account the launch is made from, and the only one a draft ever names. A draft still
     being filled may hold no treasury, or not an address yet — step 06 is where that is refused, not the journal. */
  const recipient = input.draft.rights.treasury !== null && BASE58.test(input.draft.rights.treasury) ? input.draft.rights.treasury : input.wallet;
  const opened = await openAction(deps.store, {
    cluster: deps.network.cluster,
    authorityId: TEAM_LAUNCH_AUTHORITY,
    mode: "MANUAL",
    orgId: input.draft.teamId,
    actor: { kind: "TEAM_MEMBER", id: input.wallet },
    venue: "meteora-dbc",
    programIds: [DBC_PROGRAM],
    spend: { mint: pair.mint, decimals: pair.decimals, amountRaw: spendRaw },
    payer: input.wallet,
    recipient,
    idempotencyKey: stepIdempotencyKey({ step: input.step, draft: input.draft, wallet: input.wallet, recipient, spendRaw }),
    now: deps.now().toISOString(),
  });
  if (!opened.ok) {
    /* The journal's refusal said as what it is: a step the journal cannot accept, or a journal that did not answer. */
    const code = opened.code === "VALIDATION_ERROR" || opened.code === "IDEMPOTENCY_CONFLICT" ? "INVALID" : "UNAVAILABLE";
    return fail(code, `The journal refused the step: ${opened.code}.`, { problems: opened.reasons ?? [] });
  }

  return Object.freeze({
    ok: true as const,
    actionId: opened.action.actionId,
    replay: opened.replay,
    decisions: Object.freeze(decisions),
    review: input.step.key === "review" ? teamLaunchReview(input.draft, { peopleServed: deps.peopleServed }) : null,
  });
}

/**
 * The same team deps with one read of the chain per multisig: a step that needs `sign` and `deploy` asks the same
 * treasury twice, and the answer cannot change inside one step. A failed read is not remembered — the next right asks
 * again rather than inheriting a refusal.
 */
export function withOneTreasuryRead(team: TeamDeps): TeamDeps {
  if (!team.readSigners) return team;
  const read = team.readSigners;
  const seen = new Map<string, Promise<Awaited<ReturnType<typeof read>>>>();
  return {
    ...team,
    readSigners: (multisig) => {
      const held = seen.get(multisig);
      if (held) return held;
      const asked = read(multisig);
      seen.set(
        multisig,
        asked.catch((error: unknown) => {
          seen.delete(multisig);
          throw error;
        }),
      );
      return seen.get(multisig)!;
    },
  };
}

/** The EXE-1 row a high-risk right of the wizard runs through: `deploy` through Team Launch's own, the rest through the treasury's. */
function authorityFor(permission: TeamPermission): string | null {
  return permission === "deploy" ? TEAM_LAUNCH_AUTHORITY : null;
}

/**
 * The step's idempotency key: the step, the team, and the digest of everything the action's own digest is made of that
 * can change — the member, what the action would spend, where it would send it, and the fields the step owns. Pressing
 * «Далі» twice, or a lost answer retried, replays that member's one action; a step whose own fields changed opens its
 * own. Nothing the action's digest covers may be left out of the key: a key reused for a different action is an
 * `IDEMPOTENCY_CONFLICT`, so naming the treasury at step 06 must not turn step 02's record into one.
 */
export function stepIdempotencyKey(of: Readonly<{ step: TeamLaunchStep; draft: TeamLaunchDraft; wallet: string; recipient: string; spendRaw: string }>): string {
  const digest = hashCanonical({ wallet: of.wallet, recipient: of.recipient, spendRaw: of.spendRaw, subject: teamLaunchStepSubject(of.step.key, of.draft) }).slice(2, 26);
  return `tl.${of.draft.teamId}.${of.step.key}.${digest}`;
}

/* ----------------------------------------------------------------- the deps */

export type TeamLaunchServedHere = Readonly<{ ok: true; deps: TeamLaunchDeps }> | Readonly<{ ok: false; reason: "NO_LAUNCH" | "NO_TEAMS"; message: string }>;

/**
 * What Team Launch needs on this deployment, or why it is not served at all: Launch itself and TEAM-1's own store, both
 * read from the one `process.env` the switches live in. Whether the wizard is *open* is a separate question, asked per
 * wallet (`teamLaunchServedFor`): a deployment can serve Launch and teams and still keep Team Launch closed.
 */
export function teamLaunchDeps(env: NodeJS.ProcessEnv = process.env): TeamLaunchServedHere {
  const network = launchNetwork(env);
  if (!network) return { ok: false, reason: "NO_LAUNCH", message: "Launch is not served here." };
  const teams = teamsServed(env);
  if (!teams.served) {
    const message =
      teams.reason === "NOT_SERVED"
        ? "Teams are not served here: the treasury's network is not named."
        : teams.reason === "CLOSED"
          ? "Teams are not open on this deployment yet."
          : "Teams need a store every instance shares.";
    return { ok: false, reason: "NO_TEAMS", message };
  }
  return { ok: true, deps: { team: teams.deps, store: getGuardRuntime().store, network, now: () => new Date(), env } };
}
