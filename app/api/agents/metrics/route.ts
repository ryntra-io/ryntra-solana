import { getAgentControlObserver } from "../../../../lib/agent-control/observability.ts";
import { withAgentControlRoute } from "../../../../lib/agent-control/route-gate.ts";
import { privateNoStoreHeaders } from "../../../../lib/http-control.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The counters, behind a scope.
 *
 * Four numbers per route — requests, outcomes, status classes and a mean
 * duration — and nothing else. Anything richer is a metrics product; these are
 * the four that answer *is it up, is it refusing, what is it refusing, and is
 * it slow*.
 *
 * **It requires `metrics:read`, and that scope grants no tool.** An endpoint
 * that reports which refusal codes are firing tells a caller which of their
 * probes are landing, which is a reconnaissance surface if it is public. So it
 * is authenticated like everything else, and the scope that opens it is
 * deliberately the one with no tool behind it: an operator's key can watch
 * without also being able to write.
 *
 * **The snapshot is one instance's, and says so.** `observedFromMs` is when
 * this warm instance started counting, so a reader can tell "no requests" from
 * "this instance is one second old". Summing across instances is the platform's
 * job; inventing a fleet total here would be a number nobody measured.
 */
export const GET = withAgentControlRoute<unknown>(
  { route: "/api/agents/metrics", requiredScopes: ["metrics:read"], allowAnonymous: false },
  async () => {
    const snapshot = getAgentControlObserver().snapshot();
    return Response.json(
      {
        data: {
          ...snapshot,
          scope: "ONE_WARM_INSTANCE",
          limitations: [
            "Counters are per warm instance and reset on a cold start.",
            "No fleet total is computed here; aggregating across instances is a platform concern.",
            snapshot.truncated
              ? "Per-route detail is capped, so some routes or outcomes are counted only in the totals."
              : "No cap was reached, so every route and outcome observed is itemized.",
          ],
        },
      },
      { headers: privateNoStoreHeaders() },
    );
  },
);
