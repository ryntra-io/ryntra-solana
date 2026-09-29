import { AgentPassportRequestSchema } from "../../../../lib/agent-control/agent-passport.ts";
import {
  AgentverseAdapterError,
  type fetchAgentverseAgentPassport,
} from "../../../../lib/agent-control/adapters/agentverse.ts";
import {
  acquireAgentControlUpstreamReadSlot,
  consumeAgentControlRequest,
} from "../../../../lib/agent-control/http.ts";
import {
  privateNoStoreHeaders,
  rateLimitHeaders,
  type RateLimitDecision,
} from "../../../../lib/http-control.ts";

type PassportFetcher = typeof fetchAgentverseAgentPassport;
type RequestConsumer = typeof consumeAgentControlRequest;
type UpstreamSlotAcquirer = typeof acquireAgentControlUpstreamReadSlot;

type AgentPassportHandlerDependencies = Readonly<{
  fetchPassport: PassportFetcher;
  consumeRequest?: RequestConsumer;
  acquireUpstreamSlot?: UpstreamSlotAcquirer;
}>;

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
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
    { status, headers: { ...responseHeaders(rate), ...extraHeaders } },
  );
}

function parseAddress(request: Request): string | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }

  const entries = [...url.searchParams.entries()];
  if (
    entries.length !== 1
    || entries[0]?.[0] !== "address"
    || url.searchParams.getAll("address").length !== 1
  ) {
    return null;
  }

  const parsed = AgentPassportRequestSchema.safeParse({
    schemaVersion: "1.0.0",
    provider: "AGENTVERSE",
    address: entries[0][1],
  });
  return parsed.success ? parsed.data.address : null;
}

export function createAgentPassportGetHandler({
  fetchPassport,
  consumeRequest = consumeAgentControlRequest,
  acquireUpstreamSlot = acquireAgentControlUpstreamReadSlot,
}: AgentPassportHandlerDependencies) {
  return async function handleAgentPassportGet(request: Request) {
    const rate = consumeRequest(request.headers);
    if (!rate.allowed) {
      return failure(
        429,
        "RATE_LIMITED",
        "Too many Agent Passport requests. Retry after the rate-limit window.",
        rate,
      );
    }

    const address = parseAddress(request);
    if (address === null) {
      return failure(
        400,
        "INVALID_REQUEST",
        "Provide exactly one valid Agentverse address query.",
        rate,
      );
    }

    /*
     * One passport request fans out to up to eight upstream GETs — registry,
     * search and up to six manifests — which made this the highest-
     * amplification route and, until now, the only one skipping the warm-
     * instance upstream gate its own architecture note prescribes.
     */
    const slot = acquireUpstreamSlot();
    if (!slot.allowed) {
      return failure(
        429,
        "RATE_LIMITED",
        "Too many concurrent Agent Passport reads. Retry after the rate-limit window.",
        rate,
        { "Retry-After": String(slot.retryAfterSeconds) },
      );
    }

    try {
      const passport = await fetchPassport(
        { address },
        { signal: request.signal },
      );
      return Response.json(
        { data: passport },
        { headers: responseHeaders(rate) },
      );
    } catch (error: unknown) {
      if (error instanceof AgentverseAdapterError) {
        if (error.code === "INVALID_ADDRESS") {
          return failure(
            400,
            "INVALID_REQUEST",
            "Provide exactly one valid Agentverse address query.",
            rate,
          );
        }
        if (error.code === "ABORTED") {
          return failure(
            499,
            "REQUEST_ABORTED",
            "The Agent Passport request was cancelled.",
            rate,
          );
        }
      }

      return failure(
        502,
        "UPSTREAM_FAILURE",
        "The Agent Passport source read could not be completed.",
        rate,
      );
    } finally {
      slot.release();
    }
  };
}
