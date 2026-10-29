import { isAddress } from "@solana/kit";
import { z } from "zod";

import { consumeSkrNameRequest } from "@/lib/agent-control/http";
import { BASE58, SkrNameReadSchema, type SkrNameReadDto } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { rateLimitHeaders } from "@/lib/http-control";
import { skrNameOf } from "@/lib/solana/skr-name";
import { readSkrName, resolveSkrForward } from "@/lib/solana/skr.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * `GET /api/v1/research/skr-name` — a Seeker owner's `.skr` name (contract 1.65.0, SKR-4).
 *
 * `?name=alice.skr` — the address that owns the name now. Read from the chain on every request and never cached, here
 * or at the edge: it is the address money goes to, and «Надіслати» asks again right before the wallet opens.
 * `?address=` — the wallet's primary name, the one it chose; `&self=1`, when the request proves that very wallet, also the
 * first of the names it holds when it chose none (`getSkrDomains`, server only). Cached an hour on the server.
 *
 * Public and bounded like the recipient check beside it. Every well-formed request is a 200 with its state —
 * `UNAVAILABLE` when the chain did not answer, never read as «no name» — because a form must say what it knows.
 */

const QuerySchema = z.union([
  z.object({ name: z.string().min(1).max(80) }).strict(),
  z.object({ address: z.string().regex(BASE58), self: z.enum(["1"]).optional() }).strict(),
]);

async function provesWallet(request: Request, address: string): Promise<boolean> {
  try {
    const proof = await requireWalletProof(request, "read");
    return proof.ok && proof.address === address;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  const direction = !parsed.success ? "address" : "name" in parsed.data ? "name" : parsed.data.self === "1" ? "owned" : "address";
  const rate = consumeSkrNameRequest(request.headers, direction);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many name reads from this address; wait a minute.", { headers: rateLimitHeaders(rate) });
  /* Base58 of the right length is not yet an address: it must decode to 32 bytes. */
  if (!parsed.success || ("address" in parsed.data && !isAddress(parsed.data.address))) {
    return apiFailure("VALIDATION_ERROR", "The request needs a .skr name or a base58 Solana address.", { headers: rateLimitHeaders(rate) });
  }

  let body: SkrNameReadDto;
  if ("name" in parsed.data) {
    const name = skrNameOf(parsed.data.name);
    if (!name) return apiFailure("VALIDATION_ERROR", "A .skr name is one label of letters, digits, - and _ before .skr.", { headers: rateLimitHeaders(rate) });
    const read = await resolveSkrForward(name);
    body = { direction: "name", state: read.state, name: read.name, address: read.state === "FOUND" ? read.address : null };
  } else {
    /* `self` counts only for the wallet this request proves (the web's proof cookie or the phone's bearer): the names a
       wallet holds prove nothing, so nobody lists them for someone else's address. Without the proof it is the plain read. */
    const self = parsed.data.self === "1" && (await provesWallet(request, parsed.data.address));
    const read = await readSkrName(parsed.data.address, { self });
    body =
      read.state === "FOUND"
        ? { direction: "address", state: "FOUND", address: read.address, name: read.name, source: read.source }
        : { direction: "address", state: read.state === "NONE" ? "NOT_FOUND" : "UNAVAILABLE", address: read.address, name: null, source: null };
  }
  return apiJson(SkrNameReadSchema.parse(body), 200, rateLimitHeaders(rate));
}
