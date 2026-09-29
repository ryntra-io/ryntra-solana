import type { RegulatoryPerimeter } from "../regulatory/capability-state.ts";

/**
 * Operations — is the machinery behind these surfaces up, and what happens when
 * it is not.
 *
 * Four operational facts and one perimeter, and the discipline is the same in
 * all five: **this page shows, it never acts.** There is no control here that
 * pauses, resumes, revokes, authorizes or trips anything. Every one of those
 * writes an authorization record, and the surface that owns the record owns the
 * control — Agent Control for a kill switch, Connections for a source. A
 * second button that does the same thing from a different page is a second
 * authorization path, which is exactly the shape this product refuses.
 *
 * **An incident is derived, never authored.** The tempting design is an
 * `incidents` input so an operator can post one; the moment that exists, the
 * page can say *all clear* while a provider is failing, or *incident* while
 * everything answers. So incidents are computed from the observed provider
 * states and nothing else — `buildOperations` accepts no incident list, and a
 * caller that passes one is ignored by construction rather than by convention.
 *
 * **Recovery is a promise about behaviour, not a status.** For each affected
 * capability it states what the product actually does while its provider is
 * down: refuse, serve the last observation with its age, or be unavailable. A
 * reader who cannot see their valuation needs to know which of those three it
 * is, because only one of them means the number they saw earlier is still true.
 *
 * Pure: no clock, no fetch, no randomness. `asOf` arrives from the caller.
 */

export const OPERATION_GROUPS = ["PROVIDERS", "INCIDENTS", "RECOVERY", "KILL_SWITCH", "PERIMETER"] as const;

export type OperationGroup = (typeof OPERATION_GROUPS)[number];

export const OPERATIONS_AUTHORITY = "READ_ONLY" as const;

export const PROVIDER_STATES = ["UP", "DEGRADED", "DOWN", "UNKNOWN"] as const;

export type ProviderState = (typeof PROVIDER_STATES)[number];

export type OperationsOwner = Readonly<{ surface: string; href: string }>;

export type ProviderHealth = Readonly<{
  providerId: string;
  label: string;
  state: ProviderState;
  /** When this provider last answered. `null` when it never has. */
  observedAt: string | null;
  /** When the current failure was first observed. `null` when nothing recorded it. */
  firstFailureAt: string | null;
  reason: string | null;
  /** Which capabilities depend on this provider. */
  affects: readonly string[];
  degradationPolicy: string;
  owner: OperationsOwner;
}>;

export type Incident = Readonly<{
  incidentId: string;
  providerId: string;
  label: string;
  state: "OPEN" | "RECOVERING";
  firstObservedAt: string | null;
  affects: readonly string[];
  reason: string;
  owner: OperationsOwner;
}>;

export type RecoveryStatement = Readonly<{
  capability: string;
  behaviour: "REFUSED" | "SERVED_STALE" | "UNAVAILABLE" | "UNAFFECTED";
  detail: string;
  /**
   * When the served-stale observation was made, as a field rather than inside
   * the sentence.
   *
   * It was interpolated into `detail`, so the line read *"Served from the
   * observation made at 2026-08-24T10:00:00.000Z"* — a machine instant in the
   * middle of a sentence a person is reading. A module this pure has no
   * business formatting a time; carrying the field lets the display layer put
   * it in a `<time>` element where it belongs.
   */
  observedAt: string | null;
  providerId: string;
}>;

export type KillSwitch = Readonly<{
  switchId: string;
  label: string;
  state: "ARMED" | "TRIPPED" | "UNKNOWN";
  /** Which surface may actually throw it. Never this one. */
  authority: string;
  reason: string;
  owner: OperationsOwner;
}>;

export type OperationsProjection = Readonly<{
  asOf: string;
  authority: typeof OPERATIONS_AUTHORITY;
  state: "CALM" | "DEGRADED" | "DOWN" | "UNKNOWN";
  emptyReason: string;
  providers: readonly ProviderHealth[];
  incidents: readonly Incident[];
  recovery: readonly RecoveryStatement[];
  killSwitches: readonly KillSwitch[];
  perimeter: RegulatoryPerimeter;
  counts: Readonly<{ providers: number; up: number; incidents: number; killSwitches: number }>;
}>;

/**
 * Incidents, computed from what was observed.
 *
 * `DOWN` opens an incident; `DEGRADED` opens one in `RECOVERING`, because a
 * provider answering badly is a provider answering. `UP` and `UNKNOWN` open
 * nothing — `UNKNOWN` in particular is *not* an incident, since "we have not
 * looked" and "it is broken" are different facts and conflating them would fill
 * this surface with incidents for every source nobody has connected.
 */
export function deriveIncidents(input: Readonly<{
  providers: readonly ProviderHealth[];
  asOf: string;
}>): readonly Incident[] {
  return [...input.providers]
    .filter((provider) => provider.state === "DOWN" || provider.state === "DEGRADED")
    .sort((a, b) => (a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0))
    .map<Incident>((provider) => ({
      incidentId: "incident-" + provider.providerId,
      providerId: provider.providerId,
      label: provider.label,
      state: provider.state === "DOWN" ? "OPEN" : "RECOVERING",
      firstObservedAt: provider.firstFailureAt,
      affects: provider.affects,
      reason: provider.firstFailureAt === null
        ? (provider.reason ?? "The provider is not answering.")
          + " When this started is not recorded, so no start time is shown."
        : (provider.reason ?? "The provider is not answering."),
      owner: provider.owner,
    }));
}

function recoveryFor(provider: ProviderHealth): readonly RecoveryStatement[] {
  return provider.affects.map<RecoveryStatement>((capability) => {
    if (provider.state === "UP") {
      return {
        capability,
        behaviour: "UNAFFECTED",
        detail: "The provider is answering; this capability is served normally.",
        observedAt: provider.observedAt,
        providerId: provider.providerId,
      };
    }
    if (provider.state === "DEGRADED") {
      return {
        capability,
        behaviour: "SERVED_STALE",
        detail: provider.observedAt === null
          ? "Served from the last observation. Its time is not recorded, so its age cannot be shown."
          : "Served from the last observation. " + provider.degradationPolicy,
        observedAt: provider.observedAt,
        providerId: provider.providerId,
      };
    }
    if (provider.state === "DOWN") {
      return {
        capability,
        behaviour: "UNAVAILABLE",
        detail: (provider.reason ?? "The provider is not answering.")
          + " Nothing is served for this capability while that holds.",
        observedAt: null,
        providerId: provider.providerId,
      };
    }
    return {
      capability,
      behaviour: "REFUSED",
      detail: "This provider has never been observed, so any calculation needing it is refused rather than estimated.",
      observedAt: null,
      providerId: provider.providerId,
    };
  });
}

export function buildOperations(input: Readonly<{
  asOf: string;
  providers: readonly ProviderHealth[];
  killSwitches: readonly KillSwitch[];
  perimeter: RegulatoryPerimeter;
}>): OperationsProjection {
  const providers = [...input.providers].sort((a, b) => (a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0));

  for (const provider of providers) {
    if (!provider.owner.surface || !provider.owner.href) {
      throw new TypeError("Provider " + provider.providerId + " has no owning surface.");
    }
  }
  const killSwitches = [...input.killSwitches].sort((a, b) => (a.switchId < b.switchId ? -1 : a.switchId > b.switchId ? 1 : 0));
  for (const entry of killSwitches) {
    if (!entry.owner.surface || !entry.owner.href) {
      throw new TypeError(
        "Kill switch " + entry.switchId + " has no owning surface. A switch this page cannot point at is a switch this page must not show.",
      );
    }
  }

  const incidents = deriveIncidents({ providers, asOf: input.asOf });
  const recovery = providers.flatMap(recoveryFor);

  const down = providers.some((provider) => provider.state === "DOWN");
  const degraded = providers.some((provider) => provider.state === "DEGRADED");
  const up = providers.filter((provider) => provider.state === "UP").length;

  return {
    asOf: input.asOf,
    authority: OPERATIONS_AUTHORITY,
    state: providers.length === 0 ? "UNKNOWN" : down ? "DOWN" : degraded ? "DEGRADED" : "CALM",
    emptyReason: "No provider is declared for this account. Connect a source in Connections and declare a mandate in Research.",
    providers,
    incidents,
    recovery,
    killSwitches,
    perimeter: input.perimeter,
    counts: {
      providers: providers.length,
      up,
      incidents: incidents.length,
      killSwitches: killSwitches.length,
    },
  };
}
