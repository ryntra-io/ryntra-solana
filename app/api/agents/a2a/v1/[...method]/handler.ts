/**
 * The A2A interface the card points at: one catch-all, one served method.
 *
 * A catch-all rather than a folder per method, for two reasons. The protocol's
 * HTTP+JSON paths carry colons — `message:send`, `tasks/{id}:cancel` — and more
 * importantly the five methods this product does not serve have to be refused
 * **by name**. A folder per served method would answer the rest with a bare
 * not-found, and a caller cannot tell a path it got wrong from a method nobody
 * serves. The second is a product fact worth publishing.
 *
 * ## What it does
 *
 * `GET /card` answers the same document as the well-known paths. `POST
 * /message:send` answers one task: a read or a quote completes, and anything
 * that would act is rejected terminally with the reason.
 *
 * ## What it does not do
 *
 * It signs nothing, builds nothing and reaches no provider on a caller's
 * behalf. The one read it makes is of Ryntra's own catalogue, for the two sides
 * of a pair, through the same function the person's own quote uses.
 */

import {
  A2A_CONTENT_TYPE,
  A2A_EXTENSIONS_HEADER,
  A2A_VERSION_HEADER,
  A2A_WIRE_VERSION,
  RYNTRA_A2A_EXTENSION,
  buildRyntraAgentCard,
} from "../../../../../../lib/agent-control/a2a/card.ts";
import {
  acceptsWireVersion,
  answerSendMessage,
  resolveA2aMethod,
} from "../../../../../../lib/agent-control/a2a/interface.ts";
import { createA2aTaskLedger, type A2aTaskLedger } from "../../../../../../lib/agent-control/a2a/task-ledger.ts";
import { requestOrigin } from "../../../../../../lib/agent-control/oauth/metadata.ts";
import { readAgentControlJson } from "../../../../../../lib/agent-control/http.ts";
import { getAgentControlRuntime } from "../../../../../../lib/agent-control/runtime.ts";
import type { SideFacts } from "../../../../../../lib/core/fee-policy.ts";
import { readSideFacts } from "../../../../../../lib/core/solana-swap/fee-route.server.ts";
import { privateNoStoreHeaders } from "../../../../../../lib/http-control.ts";

export type A2aDependencies = Readonly<{
  ledger?: () => A2aTaskLedger;
  readSide?: (mint: string) => Promise<SideFacts | null>;
  now?: () => Date;
}>;

export type A2aRouteContext = Readonly<{ params: Promise<{ method?: string[] }> }>;

function protocolHeaders(): Record<string, string> {
  return {
    ...privateNoStoreHeaders(),
    "content-type": A2A_CONTENT_TYPE,
    [A2A_VERSION_HEADER]: A2A_WIRE_VERSION,
    [A2A_EXTENSIONS_HEADER]: RYNTRA_A2A_EXTENSION.uri,
  };
}

function refusal(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: protocolHeaders(),
  });
}

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: protocolHeaders() });
}

export function createA2aInterfaceHandler(dependencies: A2aDependencies = {}) {
  const ledgerFor =
    dependencies.ledger ?? (() => createA2aTaskLedger(getAgentControlRuntime().guardStore));
  const readSide = dependencies.readSide ?? ((mint: string) => readSideFacts(mint));
  const now = dependencies.now ?? (() => new Date());

  return async function handle(request: Request, context: A2aRouteContext): Promise<Response> {
    const params = await context.params;
    const segments = params.method ?? [];

    if (!acceptsWireVersion(request.headers.get(A2A_VERSION_HEADER))) {
      return refusal(
        400,
        "A2A_VERSION_UNSUPPORTED",
        `This interface speaks ${A2A_WIRE_VERSION}. Reading another generation's request with these semantics is how two parties come to disagree about what was said.`,
      );
    }

    const resolution = resolveA2aMethod(segments, request.method);
    if (!resolution.served) {
      return refusal(resolution.status, resolution.reasonCode, resolution.detail);
    }

    if (resolution.method === "card") {
      const origin = requestOrigin(request);
      if (!/^https:\/\/[^/]+$/.test(origin)) {
        return refusal(
          503,
          "CARD_ORIGIN_NOT_ABSOLUTE_HTTPS",
          "This deployment's own https origin is not known, so no card with absolute interface URLs can be published.",
        );
      }
      return answer(buildRyntraAgentCard({ origin }));
    }

    const body = await readAgentControlJson(request);
    if (!body.ok) {
      return refusal(body.status, "A2A_REQUEST_MALFORMED", "The request body is not accepted.");
    }

    const result = await answerSendMessage(body.value, {
      ledger: ledgerFor(),
      readSide,
      now: now(),
    });
    /* One shape for every outcome: the protocol's own `SendMessageResponse`
       carries the task, including when the task is a rejection. A client asked
       in the protocol's terms and is answered in them. */
    return answer({ task: result.task });
  };
}
