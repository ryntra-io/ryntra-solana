import { cardOptions, cardResponse } from "./handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The 1.0 well-known path. */
export function GET(request: Request) {
  return cardResponse(request);
}

export function OPTIONS() {
  return cardOptions();
}
