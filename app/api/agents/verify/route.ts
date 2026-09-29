import { z } from "zod";

import { readAgentControlJson } from "@/lib/agent-control/http";
import { loadIssuerKey, publishedIssuerKey } from "@/lib/agent-control/issuer";
import { withAgentControlRoute } from "@/lib/agent-control/route-gate";
import { verifyAgentArtifact } from "@/lib/agent-control/verify";
import { privateNoStoreHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `artifact` at 2.0.0, where `passport` used to be. The field was named after
 * the only artifact that existed; there are three now and one of them is not a
 * passport. The spec-to-SDK parity gate keeps the four surfaces agreeing.
 */
const RequestSchema = z.object({ artifact: z.unknown() }).strict();

function failure(status: number, code: string) {
  return Response.json(
    { error: { code, message: "The verification request is not accepted." } },
    { status, headers: privateNoStoreHeaders() },
  );
}

export const POST = withAgentControlRoute<unknown>(
  { route: "/api/agents/verify" },
  async (request) => {
    const body = await readAgentControlJson(request);
    if (!body.ok) return failure(body.status, body.code);
    const parsed = RequestSchema.safeParse(body.value);
    if (!parsed.success) return failure(400, "VALIDATION_ERROR");

    /* The published key narrows the issuer axis from a sound signature to
       Ryntra's own. With none configured the axis reports UNSIGNED rather than
       silently accepting anyone's key. */
    const published = publishedIssuerKey(loadIssuerKey());
    const trusted = published.publicKey ? [published.publicKey] : undefined;

    return Response.json(
      { data: verifyAgentArtifact(parsed.data.artifact, { trustedPublicKeys: trusted }) },
      { headers: privateNoStoreHeaders() },
    );
  },
);
