import {
  AGENT_ENFORCEMENT_GRADES,
  AGENT_MANDATE_STATES,
  AGENT_OWNER_ACTION_CLASSES,
  AGENT_OWNER_AUTHORIZATION_MODES,
} from "../../agent-control/owner-control.ts";

/**
 * Agent Control, projected — and the word is load-bearing.
 *
 * The rule: *Strategy and Agent Control appear as projections, not
 * copies.* A copy is what this surface becomes the moment one tile computes its
 * own answer: two places that must agree about whether a mandate is active, and
 * this repository has recorded what happens to two places that must agree.
 *
 * Three properties make "projection" a property of the code rather than a
 * promise in a comment:
 *
 * 1. **Every tile names the surface that owns its fact and links to it.** A
 *    tile with no owner cannot be built — `buildControlProjection` throws. So a
 *    number cannot appear here without a way to go and check it.
 *
 * 2. **`authority` is the constant `PROJECTION` on every tile.** There is no
 *    input for it and no branch that sets anything else.
 *
 * 3. **Nothing here acts.** There is no `action` field on a tile, no pause, no
 *    revoke, no authorize and no kill switch. Those controls exist in Agent
 *    Control's own workspace, where the authority record they write lives, and
 *    duplicating a control that writes an authorization record is how two
 *    audit trails get created for one decision.
 *
 * The vocabulary is **imported**, not restated: action classes, authorization
 * modes, enforcement grades and mandate states all come from
 * `lib/agent-control/owner-control.ts`. A second copy of those lists is a
 * second definition of what authority means.
 *
 * **What no server can read says so.** Agent Control's own Action Cases live in
 * one browser tab's `sessionStorage`. A server render cannot list them, so the
 * tile carries `NOT_SERVER_READABLE`, the reason, and the way into the
 * workspace that can.
 */

export const CONTROL_AUTHORITY = "PROJECTION" as const;

export const CONTROL_GROUPS = ["AUTHORITY", "COMMITMENTS", "MONITORING", "SOURCES", "RISK", "WAITING"] as const;

export type ControlGroup = (typeof CONTROL_GROUPS)[number];

export type ControlTileState = "OK" | "ATTENTION" | "DEGRADED" | "UNKNOWN" | "NOT_SERVER_READABLE";

export type ControlOwner = Readonly<{ surface: string; href: string }>;

export type ControlTile = Readonly<{
  tileId: string;
  group: ControlGroup;
  label: string;
  state: ControlTileState;
  /**
   * The words on the tile's chip.
   *
   * Separate from `state` because `state` carries the tone and the domain's own
   * word carries the meaning: a risk constraint is `WITHIN` or `EXCEEDED`, a
   * source is `OK` or `FAILED`, and flattening both to the tone's name printed
   * the same word twice on one tile — found by looking, on `LIQUIDITY /
   * UNKNOWN / UNKNOWN`.
   */
  stateLabel: string;
  value: string | null;
  reason: string | null;
  owner: ControlOwner;
  authority: typeof CONTROL_AUTHORITY;
  observedAt: string | null;
}>;

export type ControlProjection = Readonly<{
  asOf: string;
  state: "CALM" | "ATTENTION" | "DEGRADED";
  authority: typeof CONTROL_AUTHORITY;
  tiles: readonly ControlTile[];
  recovery: readonly string[];
}>;

export type ControlInput = Readonly<{
  asOf: string;
  commitments: Readonly<{
    count: number;
    state: ControlTileState;
    value: string | null;
    reason: string | null;
    observedAt: string | null;
  }>;
  monitoring: Readonly<{
    ruleCount: number;
    scheduledCount: number;
    unenrolledCount: number;
    state: ControlTileState;
    reason: string | null;
    observedAt: string | null;
  }>;
  sources: readonly Readonly<{
    sourceId: string;
    label: string;
    state: "OK" | "STALE" | "FAILED";
    reason: string | null;
    observedAt: string | null;
  }>[];
  risk: readonly Readonly<{ id: string; status: string; detailHref: string }>[];
  waiting: Readonly<{ queueCount: number; openActionCount: number }>;
  recovery: readonly string[];
}>;

const AGENT_WORKSPACE: ControlOwner = { surface: "Agent Control", href: "/agents/workspace" };
const AGENT_ACTIONS: ControlOwner = { surface: "Agent Control actions", href: "/agents/workspace/actions" };
const PORTFOLIO: ControlOwner = { surface: "Portfolio", href: "/app/portfolio" };
const RESEARCH: ControlOwner = { surface: "Research", href: "/app/research" };
const DECISIONS: ControlOwner = { surface: "Decisions", href: "/app/action-cases" };

/** The Agent Control vocabulary this surface speaks, imported rather than copied. */
export function controlVocabulary() {
  return {
    actionClasses: AGENT_OWNER_ACTION_CLASSES,
    authorizationModes: AGENT_OWNER_AUTHORIZATION_MODES,
    enforcementGrades: AGENT_ENFORCEMENT_GRADES,
    mandateStates: AGENT_MANDATE_STATES,
    owner: AGENT_WORKSPACE,
  } as const;
}

const STATE_LABEL: Readonly<Record<ControlTileState, string>> = {
  OK: "OK",
  ATTENTION: "Attention",
  DEGRADED: "Degraded",
  UNKNOWN: "Unknown",
  NOT_SERVER_READABLE: "Not server-readable",
};

function tile(input: Omit<ControlTile, "authority" | "stateLabel"> & Partial<Pick<ControlTile, "stateLabel">>): ControlTile {
  if (input.owner.surface.trim().length === 0 || input.owner.href.trim().length === 0) {
    throw new Error("A control tile must name the surface that owns its fact: " + input.tileId);
  }
  return {
    ...input,
    stateLabel: input.stateLabel ?? STATE_LABEL[input.state],
    authority: CONTROL_AUTHORITY,
  };
}

function sourceState(state: "OK" | "STALE" | "FAILED"): ControlTileState {
  if (state === "OK") return "OK";
  return state === "STALE" ? "ATTENTION" : "DEGRADED";
}

export function buildControlProjection(input: ControlInput): ControlProjection {
  const tiles: ControlTile[] = [];

  tiles.push(
    tile({
      tileId: "authority-model",
      group: "AUTHORITY",
      label: "Authorization modes",
      state: "OK",
      value: AGENT_OWNER_AUTHORIZATION_MODES.join(" · "),
      reason: null,
      owner: AGENT_WORKSPACE,
      observedAt: null,
    }),
    tile({
      tileId: "authority-enforcement",
      group: "AUTHORITY",
      label: "Enforcement grades",
      state: "OK",
      value: String(AGENT_ENFORCEMENT_GRADES.length),
      reason: null,
      owner: AGENT_WORKSPACE,
      observedAt: null,
    }),
    tile({
      tileId: "agent-cases",
      group: "AUTHORITY",
      label: "Agent Control cases",
      state: "NOT_SERVER_READABLE",
      value: null,
      reason:
        "Agent Control keeps its cases in one browser tab's session storage, so no server render can list them. Open the workspace in the tab that holds them.",
      owner: AGENT_ACTIONS,
      observedAt: null,
    }),
    tile({
      tileId: "commitments",
      group: "COMMITMENTS",
      label: "Agent commitments",
      state: input.commitments.state,
      value: input.commitments.value,
      reason: input.commitments.reason,
      owner: PORTFOLIO,
      observedAt: input.commitments.observedAt,
    }),
    tile({
      tileId: "monitoring-rules",
      group: "MONITORING",
      label: "Monitor rules",
      state: input.monitoring.state,
      value: String(input.monitoring.ruleCount),
      reason: input.monitoring.reason,
      owner: RESEARCH,
      observedAt: input.monitoring.observedAt,
    }),
    tile({
      tileId: "monitoring-scheduled",
      group: "MONITORING",
      label: "Scheduled",
      state: input.monitoring.unenrolledCount > 0 ? "ATTENTION" : input.monitoring.state,
      value: String(input.monitoring.scheduledCount),
      reason: input.monitoring.unenrolledCount > 0
        ? String(input.monitoring.unenrolledCount) + " rule(s) declare a schedule that nothing is enrolled to run."
        : input.monitoring.reason,
      owner: RESEARCH,
      observedAt: input.monitoring.observedAt,
    }),
  );

  for (const source of input.sources) {
    if (source.sourceId.trim().length === 0) {
      throw new Error("A source tile needs a source id to name its owner.");
    }
    tiles.push(
      tile({
        tileId: "source-" + source.sourceId,
        group: "SOURCES",
        label: source.label,
        state: sourceState(source.state),
        /* The provider's own word on the chip, and no value beneath it: the
           tile used to print `OK` twice. */
        stateLabel: source.state,
        value: null,
        reason: source.reason,
        owner: RESEARCH,
        observedAt: source.observedAt,
      }),
    );
  }

  for (const category of input.risk) {
    tiles.push(
      tile({
        tileId: "risk-" + category.id,
        group: "RISK",
        label: category.id,
        state: category.status === "WITHIN"
          ? "OK"
          : category.status === "UNKNOWN"
            ? "UNKNOWN"
            : category.status === "DEGRADED"
              ? "DEGRADED"
              : "ATTENTION",
        stateLabel: category.status,
        value: null,
        reason: null,
        owner: { surface: "Portfolio risk", href: category.detailHref },
        observedAt: null,
      }),
    );
  }

  tiles.push(
    tile({
      tileId: "waiting-queue",
      group: "WAITING",
      label: "Waiting on you",
      state: input.waiting.queueCount > 0 ? "ATTENTION" : "OK",
      value: String(input.waiting.queueCount),
      reason: null,
      owner: DECISIONS,
      observedAt: null,
    }),
    tile({
      tileId: "waiting-actions",
      group: "WAITING",
      label: "Open exact actions",
      state: "OK",
      value: String(input.waiting.openActionCount),
      reason: null,
      owner: DECISIONS,
      observedAt: null,
    }),
  );

  /* The surface state is read off the tiles, so it cannot disagree with what a
     reader sees. `NOT_SERVER_READABLE` is deliberately not degraded: it is a
     boundary of this product, not a failure of a source. */
  const degraded = tiles.some((entry) => entry.state === "DEGRADED") || input.recovery.length > 0;
  const attention = tiles.some((entry) => entry.state === "ATTENTION");

  return {
    asOf: input.asOf,
    state: degraded ? "DEGRADED" : attention ? "ATTENTION" : "CALM",
    authority: CONTROL_AUTHORITY,
    tiles,
    recovery: input.recovery,
  };
}
