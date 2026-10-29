/**
 * The dossier for the on-chain agent registry, and nothing that registers.
 *
 * A read. It assembles what a registry entry for this deployment would say —
 * the card's two addresses, the one A2A interface, the MCP endpoint, the
 * service catalogue, the capability declaration — and lists what is still
 * missing, including the two fields nobody here may fill in: which wallet
 * address, if any, belongs in a public entry, and a signature over the card.
 *
 * Registering writes to a chain and pays a fee. This route has no wallet, no
 * key and no transaction, and `registerable` is a literal `false` with no input
 * that changes it.
 */

import {
  REGISTRATION_IS_SOMEBODY_ELSES_ACT,
  RYNTRA_BUILDS_NO_AGENT_REGISTRY,
  registrationReadiness,
} from "../../../../lib/agent-control/external/agent-registry.ts";
import { requestOrigin } from "../../../../lib/agent-control/oauth/metadata.ts";
import { privateNoStoreHeaders } from "../../../../lib/http-control.ts";

export function buildRegistrationRead(request: Request) {
  const origin = requestOrigin(request);
  const readiness = registrationReadiness({
    origin: /^https:\/\/[^/]+$/.test(origin) ? origin : null,
  });
  return {
    registerable: readiness.registerable,
    registrationIsSomebodyElsesAct: REGISTRATION_IS_SOMEBODY_ELSES_ACT,
    ryntraBuildsNoAgentRegistry: RYNTRA_BUILDS_NO_AGENT_REGISTRY,
    dossier: readiness.dossier,
    blockers: readiness.blockers.map((blocker) => ({ code: blocker.code, detail: blocker.detail })),
  };
}

export function createRegistrationHandler() {
  return function handle(request: Request): Response {
    return Response.json(
      { data: buildRegistrationRead(request) },
      { headers: privateNoStoreHeaders() },
    );
  };
}
