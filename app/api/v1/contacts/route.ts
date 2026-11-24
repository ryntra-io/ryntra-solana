import { z } from "zod";

import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { CHANGE_ACTIONS } from "@/lib/contacts/model";
import { changeContact, contactsOpen, readContacts, type ChangeCode } from "@/lib/contacts/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ChangeSchema = z.object({
  change: z.object({
    action: z.enum(CHANGE_ACTIONS),
    wallet: z.string().max(64),
    id: z.string().max(64),
    name: z.string().max(200).nullable(),
    to: z.string().max(80).nullable(),
    note: z.string().max(600).nullable(),
    nonce: z.string().max(64),
    issuedAt: z.string().max(40),
  }),
  signature: z.string().max(128),
});

/** The engine's refusals that the contract has no code of its own for travel as a validation error naming the field. */
const ISSUE_PATH: Partial<Record<ChangeCode, string>> = { NOT_FOUND: "change.id", FULL: "contacts", TAKEN: "change.to" };

/**
 * `/api/v1/contacts` — the proven wallet's address book: `GET` lists it, `POST` makes one change the wallet
 * signed as a message (`lib/contacts/model.ts` `changeText`). A read takes the wallet's proof; a change takes the proof
 * and the wallet's own signature over exactly that change, fresh and once (`lib/contacts/service.server.ts`). A contact
 * is only a name for an address — nothing here moves money. Closed unless the server's switch `RYNTRA_CONTACTS` is on.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  if (!contactsOpen()) return apiFailure("CAPABILITY_UNAVAILABLE", "Contacts are not open here.");
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const read = await readContacts(proof.address).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const }));
  if (!read.ok) return apiFailure("UNAVAILABLE", "The contacts could not be read. Try again.");
  return apiJson({ address: proof.address, contacts: [...read.contacts] });
}

export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  if (!contactsOpen()) return apiFailure("CAPABILITY_UNAVAILABLE", "Contacts are not open here.");
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, ChangeSchema, 4_096);
  if (!read.ok) return read.response;
  const result = await changeContact({ proven: proof.address, change: read.body.change, signature: read.body.signature }).catch(
    () => ({ ok: false, code: "UNAVAILABLE", reason: "The contacts could not be saved. Try again." }) as const,
  );
  if (result.ok) return apiJson({ address: proof.address, contact: result.contact });
  const path = ISSUE_PATH[result.code];
  if (path) return apiFailure("VALIDATION_ERROR", result.reason, { issues: [{ path, message: result.reason }] });
  return apiFailure(result.code === "NOT_FOUND" || result.code === "FULL" || result.code === "TAKEN" ? "VALIDATION_ERROR" : result.code, result.reason);
}
