/**
 * The address an agent that is not Ryntra's asks about money.
 *
 * `GET` is the tariff: every flow the fee table names, the lane each fee
 * travels by, the launch presets open to people, and — stated rather than
 * discovered — what this surface will not do. `POST` is one quotation.
 *
 * ## It returns no transaction, and it could not
 *
 * The quotation comes from `lib/agent-control/external/router.ts`, whose
 * answer has a `transaction` field whose only value is `null`. There is no
 * builder behind this route, no signer and no account. What a caller receives
 * is a rate and, where the arithmetic is exact before any route is asked, an
 * amount.
 *
 * ## The sides are read from Ryntra's own catalogue
 *
 * A fee depends on what each side of the pair is, and that is a read of the
 * product's own spot catalogue and stock universe — the same read the person's
 * own quote does, through the same function. A side that could not be read
 * makes the pair the lane production ran before the policy, never the dearest
 * flow: quoting upwards on missing information would be charging a caller for
 * our own ignorance.
 *
 * ## An action is refused with what it would take
 *
 * A named intent this surface does not serve is `400`, and the body carries the
 * execution record — a program-held mandate and the wallet owner's signature.
 * A refusal that only said no would leave a caller guessing at a path that does
 * not exist.
 */

import { z } from "zod";

import { readAgentControlJson } from "../../../../lib/agent-control/http.ts";
import {
  EXTERNAL_AGENT_CAPABILITIES,
  EXTERNAL_EXECUTION_CLOSED,
  EXTERNAL_ROUTER_SKILLS,
  EXTERNAL_RUNTIMES,
  ROUTER_INTENT_KINDS,
  RouterError,
  quoteLaunchFee,
  quoteTradeFee,
  readTariff,
} from "../../../../lib/agent-control/external/router.ts";
import type { SideFacts } from "../../../../lib/core/fee-policy.ts";
import { readSideFacts } from "../../../../lib/core/solana-swap/fee-route.server.ts";
import { privateNoStoreHeaders } from "../../../../lib/http-control.ts";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RAW_AMOUNT = /^(?:0|[1-9]\d*)$/;

const RequestSchema = z
  .object({
    intent: z.string().min(1).max(64),
    inputMint: z.string().regex(BASE58).optional(),
    outputMint: z.string().regex(BASE58).optional(),
    amountRaw: z.string().regex(RAW_AMOUNT).max(32).optional(),
    presetId: z.string().min(1).max(32).optional(),
  })
  .strict();

/** Reads what the catalogue says of one side. Ryntra reading its own data. */
export type SideReader = (mint: string) => Promise<SideFacts | null>;

export type RouterDependencies = Readonly<{
  readSide?: SideReader;
  now?: () => Date;
}>;

function failure(status: number, code: string, message: string, data?: unknown): Response {
  return Response.json(
    { error: { code, message }, ...(data === undefined ? {} : { data }) },
    { status, headers: privateNoStoreHeaders() },
  );
}

export function buildRouterRead() {
  return {
    capabilities: [...EXTERNAL_AGENT_CAPABILITIES],
    servedIntents: [...ROUTER_INTENT_KINDS],
    skills: EXTERNAL_ROUTER_SKILLS.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      intent: skill.intent,
      tags: [...skill.tags],
    })),
    runtimes: EXTERNAL_RUNTIMES.map((runtime) => ({
      id: runtime.id,
      label: runtime.label,
      speaks: runtime.speaks,
      reaches: [...runtime.reaches],
      capabilities: [...runtime.capabilities],
      limitations: [...runtime.limitations],
    })),
    tariff: readTariff(),
    execution: EXTERNAL_EXECUTION_CLOSED,
  };
}

export function createRouterReadHandler() {
  return function handle(): Response {
    return Response.json({ data: buildRouterRead() }, { headers: privateNoStoreHeaders() });
  };
}

export function createRouterQuoteHandler(dependencies: RouterDependencies = {}) {
  const readSide: SideReader = dependencies.readSide ?? ((mint) => readSideFacts(mint));
  const now = dependencies.now ?? (() => new Date());

  return async function handle(request: Request): Promise<Response> {
    const body = await readAgentControlJson(request);
    if (!body.ok) return failure(body.status, body.code, "The request body is not accepted.");

    const parsed = RequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return failure(400, "VALIDATION_ERROR", "The request does not name one intent of this surface.");
    }
    const input = parsed.data;

    if (!(ROUTER_INTENT_KINDS as readonly string[]).includes(input.intent)) {
      /* The execution record travels with the refusal: a caller asking to act
         learns what acting needs rather than which word to try next. */
      return failure(
        400,
        "INTENT_KIND_NOT_SERVED",
        "This surface serves reads and quotes.",
        { servedIntents: [...ROUTER_INTENT_KINDS], execution: EXTERNAL_EXECUTION_CLOSED },
      );
    }

    try {
      if (input.intent === "READ_TARIFF") {
        return Response.json({ data: readTariff() }, { headers: privateNoStoreHeaders() });
      }
      if (input.intent === "QUOTE_LAUNCH_BUY") {
        if (!input.presetId) {
          return failure(400, "INTENT_MALFORMED", "A launch quote names the preset it is about.");
        }
        return Response.json({ data: quoteLaunchFee(input.presetId) }, { headers: privateNoStoreHeaders() });
      }

      if (!input.inputMint || !input.outputMint || !input.amountRaw) {
        return failure(
          400,
          "INTENT_MALFORMED",
          "A trade quote names both mints and the amount, in whole base units of the input.",
        );
      }
      const [inputFacts, outputFacts] = await Promise.all([
        readSide(input.inputMint).catch(() => null),
        readSide(input.outputMint).catch(() => null),
      ]);
      const quotation = quoteTradeFee({
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        amountRaw: input.amountRaw,
        input: inputFacts,
        output: outputFacts,
        nowMs: now().getTime(),
      });
      return Response.json({ data: quotation }, { headers: privateNoStoreHeaders() });
    } catch (error) {
      if (error instanceof RouterError) {
        return failure(400, error.reasonCode, "The request could not be quoted.");
      }
      throw error;
    }
  };
}
