import { after, type NextRequest, type NextResponse } from "next/server";

import { secureCookies } from "../auth/cookie-policy.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import { clientIp } from "../http-control.ts";
import { isLinkPreview, openCountAllowed } from "./link-opens.ts";
import { decideVisit, decodeTouch, encodeTouch, touchKeyFrom, TOUCH_COOKIE, TOUCH_MAX_AGE_SECONDS, TOUCH_PENDING_COOKIE, type TouchSource } from "./touch.ts";
import { recordVisit } from "./touch-store.ts";

/**
 * A tagged arrival on one of the Growth line's link routes (`/r/<code>`, `/r/p/<code>`, `/r/t`): keep the first
 * touch in the browser and count the visit — after the redirect is sent, so a store that does not answer loses the
 * count, never the visit. A link preview, a script, more than a few arrivals a minute from one network address
 * (kept in this instance's memory for a minute, never stored) and a reload of the same source on the same day are
 * not visits. `allowed` lets the route add its own reason not to count (the friend link's owner opening it).
 */
export function keepTouch(
  req: NextRequest,
  response: NextResponse,
  arrived: TouchSource,
  options: Readonly<{ ipChecked?: boolean | null; countUnless?: () => Promise<boolean> }> = {},
): void {
  const key = touchKeyFrom(process.env);
  const nowMs = Date.now();
  const carried = decodeTouch(req.cookies.get(TOUCH_COOKIE)?.value, key, nowMs);
  const decision = decideVisit(carried, arrived, nowMs);
  if (key) {
    const cookie = { httpOnly: true, sameSite: "lax" as const, secure: secureCookies(), path: "/", maxAge: TOUCH_MAX_AGE_SECONDS };
    /* The first touch keeps its own thirty days: a later visit rewrites only which source was counted last. */
    const maxAge = carried ? Math.max(60, Math.floor((carried.at + TOUCH_MAX_AGE_SECONDS * 1000 - nowMs) / 1000)) : TOUCH_MAX_AGE_SECONDS;
    response.cookies.set({ name: TOUCH_COOKIE, value: encodeTouch(decision.touch, key), ...cookie, maxAge });
    if (decision.first) response.cookies.set({ name: TOUCH_PENDING_COOKIE, value: "1", ...cookie, httpOnly: false, maxAge });
  }
  if (!decision.count || isLinkPreview(req.headers.get("user-agent"))) return;
  const allowed = options.ipChecked ?? openCountAllowed(clientIp(req.headers), nowMs);
  if (!allowed) return;
  const at = new Date(nowMs).toISOString();
  after(async () => {
    try {
      if (options.countUnless && (await options.countUnless())) return;
      await recordVisit(getGuardRuntime().store, arrived, at);
    } catch {
      /* A count, never a reason a visit fails. */
    }
  });
}
