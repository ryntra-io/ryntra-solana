/* The one effectful layer in this package (RYN-RH-MCP-001).

   Three GETs to three pinned URLs on one pinned host, with no credential, no
   caller input and no body. It asks a single question — *does this door open
   from where Ryntra actually runs* — and records the answer in the venue's own
   words.

   **Why it exists at all.** `RYN-RHC-001` closed with an explicit unknown:
   `api.robinhood.com` refuses this development machine, `/app/research` is
   account-gated, and so whether the deployment's egress receives 200 where this
   environment receives 403 was never measured. `docs/STATE.md` named it as the
   first question the next packet should answer. It is a different question from
   *is Robinhood up*, and only the deployment can answer it.

   **Why it cannot be abused.** The URLs are module constants in
   `reachability.ts`; nothing is read from the request. Results are memoized per
   instance for five minutes, so a thousand callers produce the same three
   upstream calls one caller does. Each response is capped, each request is
   bounded by a timeout, and the only thing returned is a status, a state and the
   provider's own sentence.

   **What it deliberately does not do.** It does not retry, does not follow the
   refusal anywhere, and offers no way to change where the request comes from. */

import { extractOAuthMetadata } from "./oauth-metadata.ts";
import {
  MCP_INITIALIZE_BODY,
  PROBE_TARGETS,
  probeVerdict,
  type ProbeObservation,
  type ProbeTarget,
  type ProbeVerdict,
} from "./reachability.ts";

const TIMEOUT_MS = 6_000;
const MEMO_TTL_MS = 300_000;
const MAX_BODY_BYTES = 512;
/** Enough for either discovery document and far short of anything worth relaying. */
const MAX_METADATA_BYTES = 16_384;
const MAX_CHALLENGE = 300;

export type ProbeReport = ProbeVerdict & {
  observedAt: string;
  /** True when this report was served from the instance memo rather than freshly measured. */
  cached: boolean;
};

export type ProbeInit = {
  signal: AbortSignal;
  redirect: "manual";
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
};

export type ProbeDeps = {
  fetcher: (url: string, init: ProbeInit) => Promise<Response>;
  now: () => number;
  nowIso: () => string;
};

const defaultDeps: ProbeDeps = {
  fetcher: (url, init) => fetch(url, init),
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};

let memo: { at: number; report: ProbeReport } | null = null;

/** Exported for tests. A memo that cannot be cleared makes the second test lie. */
export function resetProbeMemo(): void {
  memo = null;
}

function initFor(target: ProbeTarget, signal: AbortSignal): ProbeInit {
  if (target.method === "POST") {
    return {
      signal,
      redirect: "manual",
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: MCP_INITIALIZE_BODY,
    };
  }
  return { signal, redirect: "manual", method: "GET", headers: { accept: "application/json" } };
}

async function probeOne(target: ProbeTarget, deps: ProbeDeps): Promise<ProbeObservation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await deps.fetcher(target.url, initFor(target, controller.signal));
    const challenge = (response.headers.get("www-authenticate") ?? "").slice(0, MAX_CHALLENGE) || null;
    let providerMessage: string | null = null;
    let metadata: ProbeObservation["metadata"] = null;
    try {
      const text = (await response.text()).slice(0, MAX_METADATA_BYTES);
      const trimmed = text.trim().slice(0, MAX_BODY_BYTES);
      /* Only a refusal's own sentence is kept. A 200 body would be the venue's
         actual data, and this probe is not a reader of it. */
      providerMessage = response.ok || trimmed.length === 0 ? null : trimmed;
      /* The one exception, and it is an exception the standards created: the two
         discovery documents exist to be read unauthenticated, and their fields
         are the only OAuth lifecycle a packet without an account can establish.
         Even so, only the fields RFC 8414 and RFC 9728 define survive. */
      if (target.kind === "oauth-metadata" && response.ok) {
        try {
          const facts = extractOAuthMetadata(JSON.parse(text));
          metadata = Object.keys(facts).length > 0 ? facts : null;
        } catch {
          /* A document that is not JSON yields no facts rather than a guess. */
          metadata = null;
        }
      }
    } catch {
      providerMessage = null;
    }
    return { id: target.id, url: target.url, httpStatus: response.status, providerMessage, challenge, metadata };
  } catch {
    /* No answer is `null`, which `classifyReachability` reads as UNREACHABLE.
       There is no branch here that turns a failure into a status. */
    return { id: target.id, url: target.url, httpStatus: null, providerMessage: null, challenge: null, metadata: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeRobinhoodMcp(deps: ProbeDeps = defaultDeps): Promise<ProbeReport> {
  const at = deps.now();
  if (memo && at - memo.at < MEMO_TTL_MS) return { ...memo.report, cached: true };

  const observations = await Promise.all(PROBE_TARGETS.map((target) => probeOne(target, deps)));

  const report: ProbeReport = {
    ...probeVerdict(observations),
    observedAt: deps.nowIso(),
    cached: false,
  };
  memo = { at, report };
  return report;
}
