/**
 * What the procurement surface can honestly show today.
 *
 * Every row below is produced by running the hub's own code: the mandate table
 * is the gate's verdicts on fixture reads, not a hand-written table beside it,
 * so a change to the rule changes the page. The registry is the live one, which
 * means it is empty until the owner sets four values — and the page says that
 * rather than drawing an example and hoping nobody reads it as real.
 *
 * Computed on the server because the hub reaches `node:crypto` for its digests.
 * The browser gets the answers, not the ability to produce new ones.
 */

import { X402_SOLANA_NETWORKS, splAssetRef } from "./protocol.ts";
import {
  FACILITATOR_DECLARATIONS,
  X402_CLIENT_PACKAGES,
  X402_HEADERS,
  X402_SCHEMES,
  X402_VERSION,
} from "./protocol.ts";
import {
  BLUESHIFT_PULL_PROGRAM,
  PROGRAM_MANDATE_KINDS,
  evaluateProgramMandate,
  type ProgramMandateKind,
  type ProgramMandateRead,
} from "./mandate.ts";
import { AGENT_PROCUREMENT_CAPS, HUB_ENV_NAMES, buildHubState } from "./hub.ts";
import { FREE_RISK_FACTS, NEVER_MONETISED, TOKEN_DEEP_REPORT } from "./seller.ts";
import { registeredServices } from "./provider-registry.ts";

const MAINNET = X402_SOLANA_NETWORKS.mainnet;
const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/* Addresses used only to ask the gate a question. They belong to nobody and
   nothing is read from a chain to produce this table. */
const SAMPLE_SPENDER = "Aq3TSFzkYFfFHscuWyX4dnNxi77aEM4iYdSqBhCnoZho";
const SAMPLE_RECIPIENT = "CwiqtA5LdGPRydNX48GkCjyrJw6udZpfgQoUCnQDCHs6";

/** One read per kind, each as favourable as its program allows. */
function sampleRead(kind: ProgramMandateKind, nowMs: number): ProgramMandateRead {
  const common = {
    state: "ACTIVE" as const,
    account: SAMPLE_SPENDER,
    network: MAINNET,
    mint: USDC_MAINNET,
    spender: SAMPLE_SPENDER,
    availableBaseUnits: AGENT_PROCUREMENT_CAPS.perCallBaseUnits,
  };
  switch (kind) {
    case "SQUADS_SMART_ACCOUNT_SPENDING_LIMIT":
      return Object.freeze({
        kind,
        ...common,
        destinations: Object.freeze([SAMPLE_RECIPIENT]),
        expiresAtMs: nowMs + 24 * 60 * 60 * 1_000,
      });
    case "SUBSCRIPTIONS_MERCHANT_PLAN":
      return Object.freeze({
        kind,
        ...common,
        destinations: Object.freeze([SAMPLE_RECIPIENT]),
        expiresAtMs: nowMs + 30 * 24 * 60 * 60 * 1_000,
      });
    case "SQUADS_V4_SPENDING_LIMIT":
      return Object.freeze({ kind, ...common, destinations: Object.freeze([SAMPLE_RECIPIENT]) });
    case "BLUESHIFT_PULL_DELEGATION":
      return Object.freeze({ kind, ...common });
    default:
      return Object.freeze({ kind, ...common, expiresAtMs: nowMs + 24 * 60 * 60 * 1_000 });
  }
}

export type MandateRow = Readonly<{
  kind: ProgramMandateKind;
  /** Whether the program itself holds each fact. */
  holdsRecipient: boolean;
  holdsExpiry: boolean;
  authorization: "AGENT_ALONE" | "HUMAN_CONFIRMATION" | "HUMAN_SIGNATURE";
  reasonCode: string | null;
  detail: string | null;
}>;

/** The table, produced by asking the gate rather than by writing it down. */
export function mandateRows(nowMs: number): readonly MandateRow[] {
  return Object.freeze(
    PROGRAM_MANDATE_KINDS.map((kind) => {
      const read = sampleRead(kind, nowMs);
      const decision = evaluateProgramMandate({
        read,
        request: {
          network: MAINNET,
          mint: USDC_MAINNET,
          payTo: SAMPLE_RECIPIENT,
          amountBaseUnits: AGENT_PROCUREMENT_CAPS.agentBoundBaseUnits,
          spender: SAMPLE_SPENDER,
          agentBoundBaseUnits: AGENT_PROCUREMENT_CAPS.agentBoundBaseUnits,
        },
        nowMs,
      });
      return Object.freeze({
        kind,
        holdsRecipient: "destinations" in read,
        holdsExpiry: "expiresAtMs" in read,
        authorization: decision.authorization,
        reasonCode: decision.authorization === "AGENT_ALONE" ? null : decision.reasonCode,
        detail: decision.authorization === "AGENT_ALONE" ? null : decision.detail,
      });
    }),
  );
}

export type ProcurementSurface = Readonly<{
  protocol: Readonly<{
    version: number;
    schemes: readonly string[];
    soldUnder: string;
    headers: readonly Readonly<{ role: string; name: string }>[];
    refusedHeader: string;
    networks: readonly Readonly<{ label: string; id: string }>[];
    packages: readonly Readonly<{ name: string; version: string; role: string }>[];
    facilitators: readonly Readonly<{
      id: string;
      label: string;
      operator: string;
      schemes: readonly string[];
      networks: readonly string[];
      limitations: readonly string[];
    }>[];
    ownFacilitator: false;
  }>;
  free: Readonly<{
    facts: readonly Readonly<{ id: string; label: string; readBy: string }>[];
    neverMonetised: readonly string[];
  }>;
  sale: Readonly<{
    label: string;
    path: string;
    scheme: string;
    adds: readonly string[];
    excludes: readonly string[];
    sellable: boolean;
    blockers: readonly Readonly<{ code: string; detail: string }>[];
    envNames: readonly string[];
  }>;
  registry: Readonly<{
    id: string;
    version: number;
    services: readonly Readonly<{
      provider: string;
      service: string;
      resource: string;
      priceBaseUnits: string;
      assetSymbol: string;
      network: string;
      reach: string;
      refund: string;
    }>[];
  }>;
  policy: Readonly<{
    id: string;
    version: number;
    schemes: readonly string[];
    facilitators: readonly string[];
    assets: readonly Readonly<{ network: string; assetRefs: readonly string[] }>[];
    perCallBaseUnits: string;
    dailyBaseUnits: string;
    agentBoundBaseUnits: string;
    nonceMaxAgeSeconds: number;
    receipt: string;
    refund: string;
  }>;
  mandates: readonly MandateRow[];
  pullProgram: Readonly<{
    label: string;
    audit: string;
    mayBeTriedOn: readonly string[];
    reachesPeople: boolean;
    limitations: readonly string[];
  }>;
  blockers: readonly Readonly<{ title: string; detail: string }>[];
}>;

export const PROCUREMENT_BLOCKERS: readonly Readonly<{ title: string; detail: string }>[] = Object.freeze([
  Object.freeze({
    title: "No facilitator credential",
    detail:
      "Ryntra holds no key for Coinbase CDP or PayAI, and there is no facilitator client in this build. The credential is the owner's, and no quote is issued without it.",
  }),
  Object.freeze({
    title: "No deliverable yet",
    detail:
      "The deep token report is AGH-1 and is not built. A quote for an answer that does not exist is a payment nobody can serve, so the seller refuses to quote.",
  }),
  Object.freeze({
    title: "No price",
    detail:
      "The price of a deep check is set after the cost of thirty to fifty real jobs is measured. Nothing in this build carries one.",
  }),
  Object.freeze({
    title: "No mandate is read",
    detail:
      "Reading a Squads smart account or a Subscriptions plan needs a node, and nothing here is wired to one. Until something reads a mandate, every action is one a person signs.",
  }),
  Object.freeze({
    title: "Nothing ran on a network",
    detail:
      "Nothing here has run against a node. Devnet and a first payment with real money are a separate, later step; every verdict on this page is the hub's own code over fixtures.",
  }),
]);

export function buildProcurementSurface({
  env,
  origin,
  nowMs,
}: {
  env: Readonly<Record<string, string | undefined>>;
  origin: string | null;
  nowMs: number;
}): ProcurementSurface {
  const hub = buildHubState({ env, origin });
  const readiness = hub.ownService;

  return Object.freeze({
    protocol: Object.freeze({
      version: X402_VERSION,
      schemes: Object.freeze([...X402_SCHEMES]),
      soldUnder: TOKEN_DEEP_REPORT.scheme,
      headers: Object.freeze([
        Object.freeze({ role: "requirements", name: X402_HEADERS.requirements }),
        Object.freeze({ role: "authorization", name: X402_HEADERS.authorization }),
        Object.freeze({ role: "response", name: X402_HEADERS.response }),
      ]),
      refusedHeader: "X-PAYMENT",
      networks: Object.freeze([
        Object.freeze({ label: "Solana Mainnet Beta", id: X402_SOLANA_NETWORKS.mainnet }),
        Object.freeze({ label: "Solana Devnet", id: X402_SOLANA_NETWORKS.devnet }),
      ]),
      packages: Object.freeze(X402_CLIENT_PACKAGES.map((entry) => Object.freeze({ ...entry }))),
      facilitators: Object.freeze(
        FACILITATOR_DECLARATIONS.map((declaration) =>
          Object.freeze({
            id: declaration.id,
            label: declaration.label,
            operator: declaration.operator,
            schemes: Object.freeze([...declaration.schemes]),
            networks: Object.freeze([...declaration.networks]),
            limitations: Object.freeze([...declaration.limitations]),
          }),
        ),
      ),
      ownFacilitator: false as const,
    }),
    free: Object.freeze({
      facts: Object.freeze(FREE_RISK_FACTS.map((fact) => Object.freeze({ ...fact }))),
      neverMonetised: Object.freeze([...NEVER_MONETISED]),
    }),
    sale: Object.freeze({
      label: TOKEN_DEEP_REPORT.label,
      path: TOKEN_DEEP_REPORT.path,
      scheme: TOKEN_DEEP_REPORT.scheme,
      adds: Object.freeze([...TOKEN_DEEP_REPORT.adds]),
      excludes: Object.freeze([...TOKEN_DEEP_REPORT.excludes]),
      sellable: readiness.sellable,
      blockers: readiness.sellable
        ? Object.freeze([])
        : Object.freeze(readiness.blockers.map((blocker) => Object.freeze({ ...blocker }))),
      envNames: Object.freeze(Object.values(HUB_ENV_NAMES)),
    }),
    registry: Object.freeze({
      id: hub.registry.id,
      version: hub.registry.version,
      services: Object.freeze(
        registeredServices(hub.registry).map((entry) =>
          Object.freeze({
            provider: entry.provider.label,
            service: entry.service.label,
            resource: entry.service.resource,
            priceBaseUnits: entry.service.priceBaseUnits,
            assetSymbol: entry.service.assetSymbol,
            network: entry.service.network,
            reach: entry.service.reach,
            refund: entry.service.refund,
          }),
        ),
      ),
    }),
    policy: Object.freeze({
      id: hub.policy.id,
      version: hub.policy.version,
      schemes: Object.freeze([...hub.policy.allowedSchemes]),
      facilitators: Object.freeze([...hub.policy.allowedFacilitators]),
      assets: Object.freeze(
        hub.policy.allowedAssets.map((entry) =>
          Object.freeze({ network: entry.network, assetRefs: Object.freeze([...entry.assetRefs]) }),
        ),
      ),
      perCallBaseUnits: hub.policy.perCallCeilingBaseUnits,
      dailyBaseUnits: hub.policy.dailyCeilingBaseUnits,
      agentBoundBaseUnits: AGENT_PROCUREMENT_CAPS.agentBoundBaseUnits,
      nonceMaxAgeSeconds: hub.policy.nonceMaxAgeSeconds,
      receipt: hub.policy.receipt,
      refund: hub.policy.refund,
    }),
    mandates: mandateRows(nowMs),
    pullProgram: Object.freeze({
      label: BLUESHIFT_PULL_PROGRAM.label,
      audit: BLUESHIFT_PULL_PROGRAM.audit,
      mayBeTriedOn: Object.freeze([...BLUESHIFT_PULL_PROGRAM.mayBeTriedOn]),
      reachesPeople: BLUESHIFT_PULL_PROGRAM.reachesPeople,
      limitations: Object.freeze([...BLUESHIFT_PULL_PROGRAM.limitations]),
    }),
    blockers: PROCUREMENT_BLOCKERS,
  });
}

/** USDC base units as a readable amount. Six decimals, trimmed. */
export function usdc(baseUnits: string): string {
  const whole = baseUnits.padStart(7, "0");
  const head = whole.slice(0, -6).replace(/^0+(?=\d)/, "");
  const tail = whole.slice(-6).replace(/0+$/, "");
  return tail.length > 0 ? `${head}.${tail}` : head;
}

/** The one asset reference the policy's mainnet entry carries, for the surface. */
export const USDC_MAINNET_ASSET_REF = splAssetRef(MAINNET, USDC_MAINNET);
