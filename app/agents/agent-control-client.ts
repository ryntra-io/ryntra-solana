import {
  RyntraAgentControlClient,
  RyntraAgentControlError,
} from "@/packages/agent-control-sdk/src/index";
import type { AgentActionIntent } from "@/lib/agent-control/contracts";
import type { AgentPassport } from "@/lib/agent-control/agent-passport";

import type { AgentDemoData, ArtifactVerificationView } from "./types";

/**
 * The product's one Agent Control client — the published SDK, not a second
 * implementation of it.
 *
 * `app/agents/api-client.ts` used to sit here: a hand-rolled `fetch` wrapper
 * that read `body.data` and trusted whatever was inside it. Two clients for one
 * contract is the shape this repository has recorded as always disagreeing
 * silently, and it did: the SDK once required an `action-passport_` identifier
 * prefix the API never minted, and nothing noticed because the product was not
 * using the SDK to find out.
 *
 * Every call the product makes now goes through the same code an external
 * builder gets, which means the product exercises the published contract on
 * every page load. The SDK also validates each response at runtime, which the
 * old client did not do at all.
 */

export const ACTION_PASSPORT_HANDOFF_KEY = "ryntra:action-passport-preview:handoff";

/** The SDK's error type, re-exported under the name the surfaces already use. */
export { RyntraAgentControlError as AgentApiError };

let client: RyntraAgentControlClient | null = null;

function agentControl(): RyntraAgentControlClient {
  /* Same-origin by construction. The SDK requires an explicit base URL rather
     than defaulting to one, so a browser build cannot silently point at
     somebody else's deployment. */
  client ??= new RyntraAgentControlClient({ baseUrl: window.location.origin });
  return client;
}

export async function loadAgentPassport(address: string, signal?: AbortSignal): Promise<AgentPassport> {
  /* The SDK validated the response shape before returning it; the cast is the
     app's own view type, which is structurally the same record. */
  return (await agentControl().agentPassport(address, { signal })) as unknown as AgentPassport;
}

export async function loadAgentDemo(signal?: AbortSignal): Promise<AgentDemoData> {
  return (await agentControl().demo({ signal })) as unknown as AgentDemoData;
}

export async function runAgentPreflight(
  intent: AgentActionIntent,
  recordDemoDecision: boolean,
  signal?: AbortSignal,
): Promise<AgentDemoData> {
  return (await agentControl().preflight(
    { intent: intent as unknown as Parameters<RyntraAgentControlClient["preflight"]>[0]["intent"], recordDemoDecision },
    { signal },
  )) as unknown as AgentDemoData;
}

export async function verifyArtifact(
  artifact: unknown,
  signal?: AbortSignal,
): Promise<ArtifactVerificationView> {
  return (await agentControl().verifyArtifact(artifact, { signal })) as unknown as ArtifactVerificationView;
}
