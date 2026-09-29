import type { Instrumentation } from "next";
import { assertAgentControlStartupEnvironment } from "@/lib/agent-control/startup";

// Next.js 15 native instrumentation. onRequestError catches every uncaught server
// error (route handlers, RSC, middleware) in one place and forwards it to our monitor
// (console + Sentry + founder Telegram alert). No SDK, no build changes.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { reportError } = await import("@/lib/monitor");
  // Path only, NEVER the query string: a request that arrives with a secret in its query
  // (legacy monitors, session ?t= links) must not leak it into console/Sentry/Telegram sinks.
  const path = request.path.split("?")[0];
  await reportError(`request:${context.routeType}:${path}`, err, {
    method: request.method,
    router: context.routerKind,
  });
};

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  /* Resolve the environment before this instance accepts traffic. The pure
     assertion has no fs/crypto/pg dependency, while the request runtime still
     validates the constructed adapter before any authorization write. */
  assertAgentControlStartupEnvironment(process.env, process.env.NODE_ENV);
}
