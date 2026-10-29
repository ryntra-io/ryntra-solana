/**
 * What the developer console is made of, before anything is made in it (DEV-2): the public read every integrator
 * starts from. Every figure is taken from the module that owns it — the rules from `../core/developer/console.ts`,
 * the signing scheme from `./webhooks.ts`, the quota numbers from this deployment's own environment — so nothing
 * here is a second copy of a fact.
 *
 * `pricing` is the one place a tariff would live, and it is empty on purpose: the fields a tariff has are named, and
 * no number fills them, because a price is set outside this repository.
 *
 * Server only (it reads the deployment).
 */

import type { DevPlanResponse } from "../api/v1/contract.ts";
import { DEV_CREDENTIAL_KINDS, DEV_ENVIRONMENTS, DEV_LIMITS, DEV_PLAN_FIELDS, DEV_QUOTA_WINDOWS, DEV_SCOPES, DEV_WEBHOOK_EVENTS } from "../core/developer/console.ts";
import { DEV_KEY_HEADER } from "./http.server.ts";
import { devConsoleServed, devQuotaLimits } from "./runtime.server.ts";
import { WEBHOOK_ID_HEADER, WEBHOOK_REFUSALS, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_SIGNATURE_VERSION, WEBHOOK_TIMESTAMP_HEADER } from "./webhooks.ts";

export function buildDevPlan(env: Readonly<Record<string, string | undefined>> = process.env): DevPlanResponse {
  const served = devConsoleServed(env);
  const limits = devQuotaLimits(env);
  return {
    open: served.served,
    network: served.served ? served.deps.network : null,
    environments: [...DEV_ENVIRONMENTS],
    kinds: DEV_CREDENTIAL_KINDS.map((kind) =>
      kind === "SECRET"
        ? ({ kind, sentAs: "id.secret", shownOnce: true, browser: "REFUSED" } as const)
        : ({ kind, sentAs: "id", shownOnce: false, browser: "ORIGIN_BOUND" } as const),
    ),
    scopes: [...DEV_SCOPES],
    events: [...DEV_WEBHOOK_EVENTS],
    limits: {
      projectsPerTeam: DEV_LIMITS.projectsPerTeam,
      keysPerEnvironment: DEV_LIMITS.keysPerEnvironment,
      endpointsPerProject: DEV_LIMITS.endpointsPerProject,
      originsPerKey: DEV_LIMITS.originsPerKey,
      rotationGraceHoursMax: DEV_LIMITS.rotationGraceHoursMax,
      webhookWindowSeconds: DEV_LIMITS.webhookWindowSeconds,
      deliveriesKept: DEV_LIMITS.deliveriesKept,
      deliveryAttempts: DEV_LIMITS.deliveryAttempts,
    },
    quota: DEV_QUOTA_WINDOWS.map((window) => ({ window, limit: limits[window] })),
    webhooks: {
      idHeader: WEBHOOK_ID_HEADER,
      timestampHeader: WEBHOOK_TIMESTAMP_HEADER,
      signatureHeader: WEBHOOK_SIGNATURE_HEADER,
      version: WEBHOOK_SIGNATURE_VERSION,
      algorithm: "HMAC-SHA256",
      signedPayload: "{id}.{timestamp}.{body}",
      windowSeconds: DEV_LIMITS.webhookWindowSeconds,
      refusals: [...WEBHOOK_REFUSALS],
    },
    pricing: { fields: [...DEV_PLAN_FIELDS], plans: [], stated: false },
    keyHeader: DEV_KEY_HEADER,
  };
}
