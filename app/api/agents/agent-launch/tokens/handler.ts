import type { AgentLaunchTokenListObservation } from "../../../../../lib/agent-control/adapters/agent-launch.ts";
import { AgentLaunchAdapterError } from "../../../../../lib/agent-control/adapters/agent-launch.ts";
import {
  acquireAgentControlUpstreamReadSlot,
  consumeAgentControlRequest,
} from "../../../../../lib/agent-control/http.ts";
import {
  privateNoStoreHeaders,
  rateLimitHeaders,
  type RateLimitDecision,
} from "../../../../../lib/http-control.ts";

type TokenListReader = (input: Readonly<{ signal: AbortSignal }>) => Promise<AgentLaunchTokenListObservation>;
type RequestConsumer = typeof consumeAgentControlRequest;
type UpstreamSlotAcquirer = typeof acquireAgentControlUpstreamReadSlot;

type AgentLaunchTokenListHandlerDependencies = Readonly<{
  fetchTokens: TokenListReader;
  consumeRequest?: RequestConsumer;
  acquireUpstreamSlot?: UpstreamSlotAcquirer;
}>;

function responseHeaders(
  rate: RateLimitDecision,
  extra: Readonly<Record<string, string>> = {},
) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate), ...extra };
}

function failure(
  status: number,
  code: string,
  message: string,
  rate: RateLimitDecision,
  extraHeaders: Readonly<Record<string, string>> = {},
) {
  return Response.json(
    { error: { code, message } },
    { status, headers: responseHeaders(rate, extraHeaders) },
  );
}

function hasNoQuery(request: Request): boolean {
  try {
    return [...new URL(request.url).searchParams].length === 0;
  } catch {
    return false;
  }
}

export function createAgentLaunchTokenListGetHandler({
  fetchTokens,
  consumeRequest = consumeAgentControlRequest,
  acquireUpstreamSlot = acquireAgentControlUpstreamReadSlot,
}: AgentLaunchTokenListHandlerDependencies) {
  return async function handleAgentLaunchTokenListGet(request: Request) {
    const rate = consumeRequest(request.headers);
    if (!rate.allowed) {
      return failure(
        429,
        "RATE_LIMITED",
        "Too many Agent Launch token requests. Retry after the rate-limit window.",
        rate,
      );
    }

    if (!hasNoQuery(request)) {
      return failure(
        400,
        "VALIDATION_ERROR",
        "The Agent Launch token-list request is not accepted.",
        rate,
      );
    }

    const slot = acquireUpstreamSlot();
    if (!slot.allowed) {
      return failure(
        429,
        "RATE_LIMITED",
        "Too many Agent Launch token requests. Retry after the rate-limit window.",
        rate,
        { "Retry-After": String(slot.retryAfterSeconds) },
      );
    }

    try {
      const observation = await fetchTokens({ signal: request.signal });
      return Response.json(
        { data: observation },
        { headers: responseHeaders(rate) },
      );
    } catch (error: unknown) {
      if (request.signal.aborted) {
        return failure(
          499,
          "REQUEST_ABORTED",
          "The Agent Launch token-list request was cancelled.",
          rate,
        );
      }

      // Adapter errors are intentionally collapsed at the public boundary.
      // Their messages can contain provider response details and never cross it.
      if (error instanceof AgentLaunchAdapterError) {
        return failure(
          502,
          "UPSTREAM_FAILURE",
          "The Agent Launch token-list read could not be completed.",
          rate,
        );
      }

      return failure(
        502,
        "UPSTREAM_FAILURE",
        "The Agent Launch token-list read could not be completed.",
        rate,
      );
    } finally {
      slot.release();
    }
  };
}
