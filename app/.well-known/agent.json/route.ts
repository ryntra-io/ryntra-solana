import { cardOptions, cardResponse } from "../agent-card.json/handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The earlier generation's well-known path, answering the 1.0 card.
 *
 * Kept because it is the address most clients and most write-ups reach for
 * first. One document, two addresses.
 */
export function GET(request: Request) {
  return cardResponse(request);
}

export function OPTIONS() {
  return cardOptions();
}
