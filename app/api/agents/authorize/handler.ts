import { z } from "zod";

import { verifyAgentAuthorization } from "../../../../lib/agent-control/authorization.ts";
import {
  AGENT_HASH_DOMAINS_V2,
  hashAgentPayloadV2,
} from "../../../../lib/agent-control/canonical.ts";
import {
  consumeAgentControlRequest,
  readAgentControlJson,
} from "../../../../lib/agent-control/http.ts";
import type { AgentControlRuntime } from "../../../../lib/agent-control/runtime.ts";
import {
  privateNoStoreHeaders,
  rateLimitHeaders,
  type RateLimitDecision,
} from "../../../../lib/http-control.ts";

const BNB_TESTNET_CHAIN_ID = 97;

const RequestSchema = z
  .object({
    contentHash: z.string().regex(/^0x[0-9a-f]{64}$/),
    proof: z
      .object({
        subjectRef: z.string().min(3).max(64),
        contentHash: z.string().min(3).max(128),
        nonce: z.string().min(8).max(128),
        expiresAt: z.string().min(3).max(64),
        signature: z.string().min(3).max(512),
      })
      .strict(),
  })
  .strict();

type RequestConsumer = typeof consumeAgentControlRequest;
type JsonReader = typeof readAgentControlJson;

type AgentAuthorizeHandlerDependencies = Readonly<{
  getRuntime: () => AgentControlRuntime;
  consumeRequest?: RequestConsumer;
  readJson?: JsonReader;
  now?: () => Date;
}>;

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, rate: RateLimitDecision) {
  return Response.json(
    { error: { code, message: "The authorization request is not accepted." } },
    { status, headers: responseHeaders(rate) },
  );
}

export function authorizationNonceStorageId(nonce: string): string {
  if (nonce.length < 8 || nonce.length > 128) {
    throw new TypeError("An authorization nonce must be 8-128 characters.");
  }
  return hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.authorizationProof, {
    kind: "AUTHORIZATION_NONCE_STORAGE_REFERENCE",
    nonce,
  }).slice(2);
}

export function createAgentAuthorizePostHandler({
  getRuntime,
  consumeRequest = consumeAgentControlRequest,
  readJson = readAgentControlJson,
  now = () => new Date(),
}: AgentAuthorizeHandlerDependencies) {
  return async function handleAgentAuthorizePost(request: Request) {
    /* Resolve before reading untrusted input. In production this is also a
       request-time backstop to the startup gate in instrumentation.ts: an
       unsafe adapter never produces even a validation response that could be
       mistaken for an operational authorization service. */
    const agentRuntime = getRuntime();
    const rate = consumeRequest(request.headers);
    if (!rate.allowed) return failure(429, "RATE_LIMITED", rate);
    const body = await readJson(request);
    if (!body.ok) return failure(body.status, body.code, rate);
    const parsed = RequestSchema.safeParse(body.value);
    if (!parsed.success) return failure(400, "VALIDATION_ERROR", rate);

    const result = await verifyAgentAuthorization({
      proof: parsed.data.proof,
      contentHash: parsed.data.contentHash,
      chainId: BNB_TESTNET_CHAIN_ID,
      now: now(),
      /* A claim rather than a check: nonce, lifecycle and first audit entry
         commit together through GuardStore.compareAndSetMany. */
      claimNonce: async (nonce) => {
        const nonceId = authorizationNonceStorageId(nonce);
        const { created } = await agentRuntime.lifecycles.openLifecycle({
          lifecycleId: `authorization_${nonceId}`,
          idempotencyKey: `authz:${nonceId}`,
          intentHash: parsed.data.contentHash,
          contentHash: parsed.data.contentHash,
          initialState: "AUTHORIZED",
          initialEvent: "AUTHORIZATION_ACCEPTED",
          now: now(),
        });
        return created;
      },
    });

    return Response.json(
      {
        data: {
          ...(result.ok
            ? { authorized: true as const, subject: result.subject }
            : {
                authorized: false as const,
                reasonCode: result.reasonCode,
                detail: result.detail,
              }),
          chainId: BNB_TESTNET_CHAIN_ID,
          nonceDurability: agentRuntime.persistence.durability,
          limitations: [
            "Ryntra verified a signature. It did not create, fund, submit or execute anything.",
            ...agentRuntime.persistence.limitations,
          ],
        },
      },
      { headers: responseHeaders(rate) },
    );
  };
}
