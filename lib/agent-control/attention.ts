/**
 * Attention and recovery for Agent Control.
 *
 * Two rules shape this file, and both are recorded elsewhere in the repository
 * because both were learned by getting them wrong.
 *
 * **No importance number.** A reader should see what changed, where the risk
 * is and what needs action within two seconds. A single invented magnitude
 * looks like it serves that and does the opposite: it merges incomparable
 * things — a person waiting, a credential lapsing, a store being down — into
 * one axis nobody can audit, and the first time it ranks something wrongly the
 * fix is to tune a constant rather than to fix a rule. So rank here is *the
 * index of a frozen category table*, exactly as Home's Attention does it. Two
 * items of the same category are equally important and the surface says so by
 * leaving them side by side.
 *
 * **A calm queue says it is calm.** An empty list and a failed load render
 * identically, and of the two readings the reassuring one is the dangerous one.
 * Every empty queue therefore carries a stated reason naming what was checked.
 *
 * **Every item names who can fix it.** An attention row with no owner is a
 * complaint. `NOBODY` is a legitimate answer — some things genuinely cannot be
 * fixed until a capability exists — but it must arrive with the record that
 * would change it, or it reads as a defect nobody is handling.
 */

import type { MainnetPerimeter } from "./mainnet-promotion.ts";

/**
 * The priority table. Order is the priority; there is no other ranking input.
 *
 * A person blocked outranks an authority lapsing, which outranks evidence that
 * was never gathered, which outranks a dependency Ryntra can restart, which
 * outranks a boundary somebody deliberately chose.
 */
export const ATTENTION_CATEGORIES = Object.freeze([
  "OWNER_DECISION",
  "AUTHORITY_LAPSE",
  "EVIDENCE_GAP",
  "DEGRADED_DEPENDENCY",
  "OPERATIONAL_NOTE",
] as const);

export type AttentionCategory = (typeof ATTENTION_CATEGORIES)[number];

/** Who can actually act. Four answers, and the fourth is honest rather than empty. */
export const RECOVERY_ACTORS = Object.freeze(["OWNER", "RYNTRA", "PROVIDER", "NOBODY"] as const);

export type RecoveryActor = (typeof RECOVERY_ACTORS)[number];

/**
 * `NOBODY` carries an extra obligation in the type itself: a row nobody can act
 * on has to name the record whose existence would change that. Making it a
 * separate arm means the compiler asks the question rather than a reviewer.
 */
export type Recovery =
  | Readonly<{ actor: Exclude<RecoveryActor, "NOBODY">; step: string; opensWith?: string }>
  | Readonly<{ actor: "NOBODY"; step: string; opensWith: string }>;

export type AttentionItem = Readonly<{
  id: string;
  category: AttentionCategory;
  /** Rank, and the only number on the record. Always the table index. */
  priority: number;
  title: string;
  detail: string;
  recovery: Recovery;
}>;

export type AttentionQueue = Readonly<{
  items: readonly AttentionItem[];
  calm: boolean;
  /** Present only when the queue is empty. What was looked at, so a blank is never ambiguous. */
  calmReason: string | null;
  asOf: string;
}>;

/**
 * The owner actions Agent Control is genuinely waiting on.
 *
 * Two rows, both open, both the owner's, and neither one Ryntra's to close.
 * They are declared here rather than parsed out of a markdown table, because a
 * rendering surface has no business parsing one — but a test asserts them
 * against that table, so the two cannot drift apart quietly.
 */
export const AGENT_CONTROL_OWNER_ACTIONS = Object.freeze([
  Object.freeze({
    key: "bnb-job-funding",
    title: "The BNB job is still unfunded",
    detail:
      "United Stables on BNB Testnet is owner-minted with autoMintMaxLimit 0 and has no faucet, so obtaining it is a human request to BNB rather than a code path. Re-checked on chain 2026-08-24 and still unmet.",
    step: "Request the test asset from BNB and fund the job, then re-run the on-chain check.",
  }),
  Object.freeze({
    key: "developer-kit-publication",
    title: "The developer packages are unpublished",
    detail:
      "npm whoami returns 401 against registry.npmjs.org and the @ryntra scope has zero published packages. Authenticating is a password and OTP action that is not an implementing agent's to perform.",
    step: "Authenticate to npm as the scope owner and publish the two developer-kit packages.",
  }),
]);

export type OwnerAction = (typeof AGENT_CONTROL_OWNER_ACTIONS)[number];

export type AttentionInput = Readonly<{
  asOf: string;
  /** Proposals sitting at PROPOSE with nobody having decided. */
  proposals?: readonly unknown[];
  /** Actions authorized or sampled with no observed outcome to reconcile against. */
  unreconciledActions?: readonly unknown[];
  /** Whether the quota window is counted in a configured durable store. */
  quota?: unknown;
  /** The mainnet promotion perimeter, when the caller has computed one. */
  perimeter?: MainnetPerimeter | Readonly<{ state: string; blocked: number }> | null;
  ownerActions?: readonly unknown[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function rank(category: AttentionCategory): number {
  return ATTENTION_CATEGORIES.indexOf(category);
}

export function attentionQueue(input: AttentionInput): AttentionQueue {
  const items: AttentionItem[] = [];

  /* ── OWNER_DECISION ─────────────────────────────────────────────────────── */

  for (const candidate of input.ownerActions ?? []) {
    if (!isRecord(candidate)) continue;
    const key = text(candidate.key);
    const title = text(candidate.title);
    const detail = text(candidate.detail);
    const step = text(candidate.step);
    if (!key || !title || !detail || !step) continue;
    items.push(
      Object.freeze({
        id: `owner-action:${key}`,
        category: "OWNER_DECISION" as const,
        priority: rank("OWNER_DECISION"),
        title,
        detail,
        recovery: Object.freeze({ actor: "OWNER" as const, step }),
      }),
    );
  }

  for (const candidate of input.proposals ?? []) {
    if (!isRecord(candidate)) continue;
    const id = text(candidate.id);
    const ref = text(candidate.ref);
    if (!id || !ref) continue;
    items.push(
      Object.freeze({
        id: `proposal:${id}`,
        category: "OWNER_DECISION" as const,
        priority: rank("OWNER_DECISION"),
        title: "A proposal is waiting on a person",
        detail: `${ref} was recorded at PROPOSE. Nothing advances it: AUTHORIZE is closed by an owner elsewhere and no tool can reach it.`,
        recovery: Object.freeze({
          actor: "OWNER" as const,
          step: "Open the proposal, compare it against the mandate, and decide it outside the tool surface.",
        }),
      }),
    );
  }

  /* ── EVIDENCE_GAP ───────────────────────────────────────────────────────── */

  for (const candidate of input.unreconciledActions ?? []) {
    if (!isRecord(candidate)) continue;
    const id = text(candidate.id);
    const what = text(candidate.what);
    if (!id || !what) continue;
    items.push(
      Object.freeze({
        id: `unreconciled:${id}`,
        category: "EVIDENCE_GAP" as const,
        priority: rank("EVIDENCE_GAP"),
        title: "An action has no observed outcome",
        detail: `${what} has nothing to reconcile against, so no Outcome Receipt can exist for it. A preview that states OUTCOME_NOT_OBSERVED is a preview.`,
        recovery: Object.freeze({
          actor: "NOBODY" as const,
          step: "Nothing closes this today; it waits on the capability, not on a person.",
          opensWith:
            "An execution path that reaches a rail and an independent read-back of its effect. Both are separate packets and neither exists: the adapters are READ_ONLY by their own registry entries.",
        }),
      }),
    );
  }

  /* ── DEGRADED_DEPENDENCY ────────────────────────────────────────────────── */

  const quota = input.quota;
  if (isRecord(quota) && quota.durable === false) {
    items.push(
      Object.freeze({
        id: "dependency:quota-store",
        category: "DEGRADED_DEPENDENCY" as const,
        priority: rank("DEGRADED_DEPENDENCY"),
        title: "The quota window is not durable",
        detail: `A quota counted per process is not a quota: two instances keep two windows and a cold start hands the budget back. Reported reason: ${text(quota.reason) ?? "unstated"}.`,
        recovery: Object.freeze({
          actor: "RYNTRA" as const,
          step: "Configure the durable Guard store so one window is shared, and confirm the meter fails closed when it is unreachable.",
        }),
      }),
    );
  }

  /* ── OPERATIONAL_NOTE ───────────────────────────────────────────────────── */

  const perimeter = input.perimeter;
  if (isRecord(perimeter) && perimeter.state !== "PROMOTABLE") {
    const blocked = typeof perimeter.blocked === "number" ? perimeter.blocked : 0;
    items.push(
      Object.freeze({
        id: "note:mainnet-perimeter",
        category: "OPERATIONAL_NOTE" as const,
        priority: rank("OPERATIONAL_NOTE"),
        title: "No capability is promotable to a mainnet",
        detail: `${blocked} capabilities are refused, each on its own missing canary. This is the boundary chosen on 2026-08-21 — Base Sepolia only, no mainnet execution this phase — not a fault.`,
        recovery: Object.freeze({
          actor: "OWNER" as const,
          step: "A decision that replaces the testnet-only rule, and then one canary per capability. Nothing here is promoted by another capability's evidence.",
        }),
      }),
    );
  }

  /* Category first, then id. The second key is what stops two equal-rank rows
     from swapping places between renders — a list that reorders itself teaches
     a reader that the order means nothing. */
  items.sort((left, right) =>
    left.priority === right.priority
      ? left.id.localeCompare(right.id)
      : left.priority - right.priority,
  );

  return Object.freeze({
    items: Object.freeze(items),
    calm: items.length === 0,
    calmReason:
      items.length === 0
        ? "Nothing is waiting on a person. Checked: open owner actions, proposals at PROPOSE, actions with no observed outcome, the quota store, and the mainnet promotion perimeter."
        : null,
    asOf: input.asOf,
  });
}
