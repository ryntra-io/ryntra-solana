/**
 * What the Operations surface draws.
 *
 * The analytics module does the arithmetic and the counting-boundary work; this
 * one binds it to the process's own observer and adds the two things a page
 * needs beside the numbers: the mainnet promotion perimeter, and the list of
 * things this surface deliberately does not measure.
 *
 * The second list matters more than it looks. An operations page that shows
 * four real numbers and stays silent about everything else reads as complete,
 * and the reader supplies the missing certainty themselves. Naming what is not
 * counted is what stops a per-instance request counter from being read as fleet
 * traffic.
 */

import { operationsAnalytics, type OperationsAnalytics } from "./analytics/operations.ts";
import { getAgentControlObserver } from "./observability.ts";
import { mainnetPerimeter, type MainnetPerimeter } from "./mainnet-promotion.ts";

export type NotMeasured = Readonly<{ what: string; why: string }>;

export type OperationsSurface = Readonly<{
  analytics: OperationsAnalytics;
  perimeter: MainnetPerimeter;
  notMeasured: readonly NotMeasured[];
}>;

export function buildOperationsSurface(asOf: string): OperationsSurface {
  return Object.freeze({
    analytics: operationsAnalytics({ observer: getAgentControlObserver(), asOf }),
    perimeter: mainnetPerimeter({ asOf }),
    notMeasured: Object.freeze([
      Object.freeze({
        what: "Fleet totals across instances",
        why: "Every counter belongs to the process that answered the request. Aggregating is a provider concern, and a total computed here would be the fourth number this repository shipped that nobody measured.",
      }),
      Object.freeze({
        what: "Anything before this instance woke",
        why: "A cold start restarts the count. The snapshot carries observedFromMs so that zero requests can be told apart from a one-second-old instance.",
      }),
      Object.freeze({
        what: "Availability, uptime or a health verdict",
        why: "Four counters on one instance cannot support a judgement about the service, and a judgement computed from them would be a guess wearing a badge.",
      }),
      Object.freeze({
        what: "Business data of any kind",
        why: "The observer records route, method, status, outcome and duration. No balance, position, amount or counterparty passes through it, and a credential never reaches a log line at all.",
      }),
      Object.freeze({
        what: "Per-tenant usage",
        why: "Counters are keyed by route rather than by principal. Attributing traffic to a tenant would put an identity in a counter map that a hostile caller can grow.",
      }),
    ]),
  });
}
