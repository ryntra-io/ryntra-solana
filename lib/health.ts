import { decideBearerAuth, LEGACY_KEY_ERROR } from "./security.ts";

export type HealthChecks = {
  db: () => Promise<boolean>;
  arcus: () => Promise<boolean>;
  telegram: () => Promise<boolean>;
};

export type HealthHandlerOptions = {
  healthSecret?: string;
  cronSecret?: string;
  checks: HealthChecks;
  timeoutMs?: number;
  now?: () => Date;
};

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE_HEADERS });
}

async function timed(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  try {
    return await Promise.race([
      check(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
  } catch {
    return false;
  }
}

export function createHealthHandler(options: HealthHandlerOptions) {
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
      ? (options.timeoutMs as number)
      : 6_000;
  const now = options.now ?? (() => new Date());

  return async function handleHealth(request: Request): Promise<Response> {
    // An explicitly configured but empty HEALTH_SECRET fails closed instead of widening to cron.
    const secret = options.healthSecret ?? options.cronSecret;
    const decision = decideBearerAuth(
      {
        authorization: request.headers.get("authorization"),
        legacyKeyPresent: new URL(request.url).searchParams.has("key"),
      },
      secret
    );

    if (decision === "legacy-rejected") {
      return json({ status: "error", error: LEGACY_KEY_ERROR }, 401);
    }
    if (decision === "unauthorized") {
      return json({ status: "error", error: "invalid credentials" }, 401);
    }
    if (decision === "public") {
      return json({ status: "ok", scope: "liveness", ts: now().toISOString() });
    }

    const [db, arcus, telegram] = await Promise.all([
      timed(options.checks.db, timeoutMs),
      timed(options.checks.arcus, timeoutMs),
      timed(options.checks.telegram, timeoutMs),
    ]);
    const critical = db && telegram;
    const status = critical ? (arcus ? "ok" : "degraded") : "down";

    return json(
      {
        status,
        scope: "deep",
        checks: { db, arcus, telegram },
        ts: now().toISOString(),
      },
      critical ? 200 : 503
    );
  };
}
