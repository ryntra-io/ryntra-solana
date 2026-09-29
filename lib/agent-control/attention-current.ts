/**
 * What the Attention surface draws.
 *
 * The queue itself is pure — `attention.ts` takes records and returns rows. This
 * module is the one place that decides *which* records this product actually
 * has today, so a page never assembles its own view of the world and two pages
 * can never assemble two different ones.
 *
 * The unreconciled entry is the honest one and the easiest to get wrong. The
 * Golden RWA sample is a real Action Case with no observed outcome, because no
 * execution path exists to produce one. Omitting it would make the queue look
 * complete; inventing an outcome for it would be the exact claim canon v5.2 §24
 * forbids. It appears, and its recovery actor is `NOBODY`, with the record that
 * would change that named.
 */

import { AGENT_CONTROL_OWNER_ACTIONS, attentionQueue, type AttentionQueue } from "./attention.ts";
import { mainnetPerimeter } from "./mainnet-promotion.ts";

export type AttentionSurface = Readonly<{
  queue: AttentionQueue;
  /** What was looked at, listed so the queue's completeness is auditable. */
  checked: readonly Readonly<{ what: string; source: string }>[];
  blockers: readonly string[];
}>;

export function buildAttentionSurface(asOf: string): AttentionSurface {
  const queue = attentionQueue({
    asOf,
    ownerActions: AGENT_CONTROL_OWNER_ACTIONS,
    /* No durable proposal queue exists: the ledger lives in the MCP server
       process and a rendering surface cannot reach it. Passing an empty list is
       the truthful input, and the blocker below says why rather than letting an
       empty section read as "nothing pending". */
    proposals: [],
    unreconciledActions: [
      {
        id: "golden-rwa",
        what: "The Golden RWA sample action",
      },
    ],
    /* The quota window is counted in the configured Guard store, which is what
       `RYN-AGENT-CONTROL-008` shipped and `RYN-HEALTH-001` verified live as
       DURABLE_MULTI_WRITER. */
    quota: { durable: true },
    perimeter: mainnetPerimeter({ asOf }),
  });

  return Object.freeze({
    queue,
    checked: Object.freeze([
      Object.freeze({
        what: "Open founder actions on the Agent Control queue",
        source: "lib/agent-control/attention.ts — AGENT_CONTROL_OWNER_ACTIONS",
      }),
      Object.freeze({
        what: "Actions with no observed outcome to reconcile against",
        source: "lib/agent-control/reconcile.ts",
      }),
      Object.freeze({
        what: "Whether the quota window is durable or per process",
        source: "lib/agent-control/quota.ts",
      }),
      Object.freeze({
        what: "The mainnet promotion perimeter, capability by capability",
        source: "lib/agent-control/mainnet-promotion.ts",
      }),
    ]),
    blockers: Object.freeze([
      "Proposals are not counted here. The ledger lives in the MCP server process, so a rendering surface cannot read it and an empty proposal section would be a guess rather than a fact.",
      "There is no notification, escalation or channel: this queue is looked at, never delivered.",
      "Nothing on this surface can act. Every recovery step is taken somewhere else, by the actor the row names.",
    ]),
  });
}
