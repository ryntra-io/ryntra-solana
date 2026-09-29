import { fetchAgentLaunchTestnetTokens } from "../../../../../lib/agent-control/adapters/agent-launch.ts";
import { withAgentControlRoute } from "../../../../../lib/agent-control/route-gate.ts";

import { createAgentLaunchTokenListGetHandler } from "./handler.ts";

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

const tokenListHandler = createAgentLaunchTokenListGetHandler({
  fetchTokens: ({ signal }) =>
    fetchAgentLaunchTestnetTokens({ fetchImpl: fetchBoundToCaller(signal) }),
});

export const GET = withAgentControlRoute<unknown>(
  { route: "/api/agents/agent-launch/tokens" },
  (request) => tokenListHandler(request),
);
