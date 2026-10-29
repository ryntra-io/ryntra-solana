/**
 * The buying side: would this hub let an agent pay this URL?
 *
 * A caller hands in a quote it received from somewhere and gets back one
 * decision with the stage it stopped at and the reason. The answer an agent
 * most often needs is the dull one: the URL is not a registered provider's, so
 * nothing about it is payable.
 *
 * ## It authorizes nothing and signs nothing
 *
 * There is no signer behind this route and no key anywhere near it. `allowed`
 * means the hub's registry and policy would permit the purchase and names who
 * must authorize it — the agent alone, under a program-enforced mandate, or a
 * person. The payment itself happens in the agent's own wallet, which is not
 * Ryntra's.
 *
 * ## The mandate is read, never supplied
 *
 * A caller cannot hand in its own mandate: that would let the thing being
 * bounded describe its own bound. The read comes from a reader port over the
 * two programs that hold a recipient and an end date, and no reader is
 * configured here — reading a Squads smart account or a Subscriptions plan
 * needs a node, which this task does not wire. So the mandate stage answers
 * `MANDATE_READ_UNKNOWN` and the authorization is a person's signature, which
 * is the correct fail-closed answer to "nobody read it".
 */

import { z } from "zod";

import { readAgentControlJson } from "../../../../lib/agent-control/http.ts";
import {
  AGENT_PROCUREMENT_CAPS,
  buildHubState,
} from "../../../../lib/agent-control/procurement/hub.ts";
import { evaluateProcurement } from "../../../../lib/agent-control/procurement/policy.ts";
import { X402_SCHEMES, X402_FACILITATORS } from "../../../../lib/agent-control/procurement/protocol.ts";
import type { ProgramMandateRead } from "../../../../lib/agent-control/procurement/mandate.ts";
import { privateNoStoreHeaders } from "../../../../lib/http-control.ts";

const BASE_UNITS = /^(?:0|[1-9]\d*)$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const RequestSchema = z
  .object({
    resourceUrl: z.string().min(1).max(2048),
    scheme: z.enum(X402_SCHEMES),
    facilitator: z.enum(X402_FACILITATORS),
    network: z.string().min(1).max(128),
    assetRef: z.string().min(1).max(256),
    mint: z.string().regex(BASE58),
    payTo: z.string().regex(BASE58),
    quotedBaseUnits: z.string().regex(BASE_UNITS).max(32),
    capBaseUnits: z.string().regex(BASE_UNITS).max(32).nullable().default(null),
    maxTimeoutSeconds: z.number().int().positive().max(600),
    nonce: z.string().min(1).max(128),
    quoteIssuedAt: z.string().datetime({ offset: true }),
    spender: z.string().regex(BASE58),
    /** What this agent has already spent today, in the same base units. */
    spentTodayBaseUnits: z.string().regex(BASE_UNITS).max(32).default("0"),
  })
  .strict();

/** Reads one agent's mandate from the chain. Not configured in this task. */
export type MandateReader = Readonly<{
  read(input: { spender: string; network: string; mint: string }): Promise<ProgramMandateRead | null>;
}>;

export type ProcurementDependencies = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  /** `null` while nothing reads a mandate from a node. */
  mandateReader?: () => MandateReader | null;
  now?: () => Date;
}>;

function failure(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: privateNoStoreHeaders() });
}

export function createProcurementHandler(dependencies: ProcurementDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  const readerFor = dependencies.mandateReader ?? (() => null);

  return async function handle(request: Request): Promise<Response> {
    const body = await readAgentControlJson(request);
    if (!body.ok) return failure(body.status, body.code, "The request body is not accepted.");

    const parsed = RequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return failure(400, "VALIDATION_ERROR", "The request does not describe one x402 quote.");
    }
    const input = parsed.data;

    const origin = new URL(request.url).origin;
    const hub = buildHubState({ env, origin: /^https:\/\/[^/]+$/.test(origin) ? origin : null });

    const reader = readerFor();
    const mandateRead = reader
      ? await reader.read({ spender: input.spender, network: input.network, mint: input.mint })
      : null;

    const decision = evaluateProcurement({
      registry: hub.registry,
      policy: hub.policy,
      request: {
        resourceUrl: input.resourceUrl,
        scheme: input.scheme,
        facilitator: input.facilitator,
        network: input.network,
        assetRef: input.assetRef,
        mint: input.mint,
        payTo: input.payTo,
        quotedBaseUnits: input.quotedBaseUnits,
        capBaseUnits: input.capBaseUnits,
        maxTimeoutSeconds: input.maxTimeoutSeconds,
        nonce: input.nonce,
        quoteIssuedAtMs: Date.parse(input.quoteIssuedAt),
        spender: input.spender,
        agentBoundBaseUnits: AGENT_PROCUREMENT_CAPS.agentBoundBaseUnits,
      },
      mandateRead,
      /* The durable single-use claim is taken when a payment is made, not when
         a decision is asked for: a decision that burnt a nonce would spend the
         quote on every refusal. */
      nonceAlreadyUsed: false,
      spentTodayBaseUnits: input.spentTodayBaseUnits,
      nowMs: now().getTime(),
    });

    if (!decision.allowed) {
      return Response.json(
        {
          data: {
            allowed: false,
            stage: decision.stage,
            reasonCode: decision.reasonCode,
            detail: decision.detail,
            policy: { id: hub.policy.id, version: hub.policy.version },
            registry: { id: hub.registry.id, version: hub.registry.version, providers: hub.registry.providers.length },
            mandateRead: mandateRead !== null,
          },
        },
        { headers: privateNoStoreHeaders() },
      );
    }

    return Response.json(
      {
        data: {
          allowed: true,
          stage: decision.stage,
          authorization: decision.authorization,
          enforcement: decision.mandate.enforcement,
          provider: { id: decision.provider.providerId, label: decision.provider.label },
          service: { id: decision.service.serviceId, label: decision.service.label },
          amountBaseUnits: decision.amountBaseUnits,
          policy: decision.policyRef,
          limitations: [...decision.limitations],
        },
      },
      { headers: privateNoStoreHeaders() },
    );
  };
}
