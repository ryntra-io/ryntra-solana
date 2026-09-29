import { observeBnbApexKnownJobTransaction } from "../../../../../lib/agent-control/adapters/bnb-apex.ts";
import { withAgentControlRoute } from "../../../../../lib/agent-control/route-gate.ts";
import { privateNoStoreHeaders } from "../../../../../lib/http-control.ts";

import { createBnbApexObservePostHandler } from "./handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fetchBoundToCaller(callerSignal: AbortSignal): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const adapterSignal = init?.signal;
    const signal = adapterSignal
      ? AbortSignal.any([callerSignal, adapterSignal])
      : callerSignal;
    return fetch(input, { ...init, signal });
  }) as typeof fetch;
}

const observeHandler = createBnbApexObservePostHandler({
  observeJob: (reference, { signal }) =>
    observeBnbApexKnownJobTransaction(reference, {
      fetchImpl: fetchBoundToCaller(signal),
    }),
});

export const POST = withAgentControlRoute<unknown>(
  { route: "/api/agents/bnb-apex/observe" },
  (request) => observeHandler(request),
);

/*
 * Without this, a GET fell through to the framework default: an empty 405
 * with no Allow header and a public cache policy — three contract breaks on
 * one response. The refusal now speaks the API's own envelope.
 */
export function GET() {
  return Response.json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Use POST with an exact jobId and txHash body for the known-reference observation.",
      },
    },
    { status: 405, headers: { ...privateNoStoreHeaders(), Allow: "POST" } },
  );
}
