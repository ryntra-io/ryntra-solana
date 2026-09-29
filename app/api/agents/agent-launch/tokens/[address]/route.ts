import { fetchAgentLaunchTestnetToken } from "../../../../../../lib/agent-control/adapters/agent-launch.ts";
import { withAgentControlRoute } from "../../../../../../lib/agent-control/route-gate.ts";

import { createAgentLaunchTokenDetailGetHandler } from "./handler.ts";

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

const tokenDetailHandler = createAgentLaunchTokenDetailGetHandler({
  fetchToken: (address, { signal }) =>
    fetchAgentLaunchTestnetToken(address, {
      fetchImpl: fetchBoundToCaller(signal),
    }),
});

export const GET = withAgentControlRoute<{ params: Promise<{ address: string }> }>(
  { route: "/api/agents/agent-launch/tokens/[address]" },
  (request, context) => tokenDetailHandler(request, context),
);
