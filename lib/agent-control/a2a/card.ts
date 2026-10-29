/**
 * Ryntra's own A2A Agent Card, and the two addresses it answers at.
 *
 * `./inbound.ts` reads somebody else's card. This module writes ours, which is
 * a different job with a different danger: an inbound card is a claim to be
 * recorded, while an outbound card is a promise other people's software will
 * hold us to. So every field below is either a fact this repository can point
 * at or it is absent, and the absences are named rather than filled with
 * something plausible.
 *
 * ## What was read, and when
 *
 * The shape, the version string, the path and the bindings were read from the
 * protocol's own TypeScript surface — `@a2a-js/sdk` 1.3.0, read 2026-10-26 —
 * because the published prose and the secondary write-ups disagree about the
 * 1.0 card and the package does not. Four findings changed what this module
 * does:
 *
 * 1. **A 1.0 card has no top-level `url` and no top-level `protocolVersion`.**
 *    Both moved into `supportedInterfaces[]`, one entry per address, each
 *    carrying its own `protocolBinding` and `protocolVersion`. A card written
 *    from memory of the earlier generation would be rejected by a 1.0 reader
 *    for missing the one required list.
 * 2. **The wire version is `"1.0"`, major and minor only** — not `"1.0.0"`.
 *    It travels in `A2A-Version` and in each interface entry.
 * 3. **The 1.0 well-known path is `/.well-known/agent-card.json`.** The earlier
 *    generation served `/.well-known/agent.json`, and that is still the address
 *    most clients and most write-ups reach for, so both are served and both
 *    return this same 1.0 document. Serving one would make the product
 *    undiscoverable to half its readers; serving two different documents would
 *    be worse than either.
 * 4. **Empty strings are omitted by the protocol's own JSON encoder**, so a
 *    field we have nothing true to put in is left out instead of being sent as
 *    `""`.
 *
 * ## The card promises reads and proposals, because that is all there is
 *
 * Every skill below resolves to something already built and already bounded: a
 * read of Ryntra's own facts, or one record at `PROPOSE` awaiting a person. No
 * skill signs, sends, trades or spends, and there is no skill shape that could
 * — a skill is derived from the tool inventory, and the write side of that
 * inventory has exactly one effect value, `PROPOSAL_ONLY`.
 *
 * `signatures` is an empty list. A2A §8.4 lets a card carry a JWS over an
 * RFC 8785 canonicalization of itself, and signing ours needs a key that is not
 * this repository's to hold. An unsigned card is the honest state; a card
 * carrying a signature block computed with a key checked into a deployment
 * would be worse than unsigned, because it would look verified.
 */

import { HOSTED_LOCAL_READ_TOOLS } from "../mcp/hosted.ts";
import { MCP_WRITE_TOOLS } from "../mcp/write-tools.ts";
import { EXTERNAL_ROUTER_SKILLS } from "../external/router.ts";

/** The protocol generation this card declares, in the form the wire uses. */
export const A2A_WIRE_VERSION = "1.0" as const;

/** The header that carries the wire version over HTTP. */
export const A2A_VERSION_HEADER = "A2A-Version" as const;

/** The header that carries the extension URIs in play on a request. */
export const A2A_EXTENSIONS_HEADER = "A2A-Extensions" as const;

/** The media type the HTTP+JSON binding answers with. */
export const A2A_CONTENT_TYPE = "application/a2a+json" as const;

/**
 * The bindings the protocol names, and the one Ryntra serves.
 *
 * `protocolBinding` is an open-form string, so a mirror could put anything
 * there. The three the protocol itself names are pinned so that a test fails if
 * this card ever declares a binding nobody else will recognise — a card is a
 * document strangers parse, and inventing a value in it is inventing an
 * interface.
 */
export const A2A_PROTOCOL_BINDINGS = ["JSONRPC", "GRPC", "HTTP+JSON"] as const;

export type A2aProtocolBinding = (typeof A2A_PROTOCOL_BINDINGS)[number];

export const A2A_SERVED_BINDING: A2aProtocolBinding = "HTTP+JSON";

/**
 * Where the card is served.
 *
 * Two entries, one meaning. `current` is the 1.0 address; `legacy` is the
 * earlier generation's, which the product's own record names and which most
 * clients still try first.
 */
export const A2A_CARD_PATHS = Object.freeze({
  current: "/.well-known/agent-card.json",
  legacy: "/.well-known/agent.json",
});

/**
 * The base path of the one A2A interface Ryntra serves.
 *
 * **Without the version segment, and that is the whole subtlety.** A client
 * takes the URL out of `supportedInterfaces[]`, uses it as its endpoint
 * unchanged, and appends the protocol's own method paths — which already begin
 * `/v1/`. Publishing `…/a2a/v1` here would send every call to `…/a2a/v1/v1/…`,
 * so the declared base is the folder the versioned methods live under, and a
 * test holds the two together.
 */
export const A2A_INTERFACE_PATH = "/api/agents/a2a" as const;

/**
 * The HTTP+JSON method paths the protocol defines, relative to an interface's
 * base, as its own client builds them.
 *
 * Listed in full including the five Ryntra does not serve, because
 * `./interface.ts` has to refuse those by name and a refusal for a method
 * nobody has heard of is indistinguishable from a typo.
 */
export const A2A_HTTP_JSON_METHODS = Object.freeze({
  card: "/v1/card",
  messageSend: "/v1/message:send",
  messageStream: "/v1/message:stream",
  taskGet: "/v1/tasks/{id}",
  taskCancel: "/v1/tasks/{id}:cancel",
  taskSubscribe: "/v1/tasks/{id}:subscribe",
  pushNotificationConfigs: "/v1/tasks/{id}/pushNotificationConfigs",
});

/** Where the facts in this module came from, for anybody checking them. */
export const A2A_CARD_SOURCE = Object.freeze({
  package: "@a2a-js/sdk",
  version: "1.3.0",
  observedAt: "2026-10-26",
  note: "Read from the package's published TypeScript surface and its JSON encoder, not from secondary write-ups.",
});

/* ── the card's own shape ──────────────────────────────────────────────── */

export type A2aAgentInterface = Readonly<{
  url: string;
  protocolBinding: string;
  protocolVersion: string;
}>;

export type A2aAgentProvider = Readonly<{ organization: string; url: string }>;

export type A2aAgentCapabilities = Readonly<{
  streaming: boolean;
  pushNotifications: boolean;
  extensions: readonly A2aAgentExtension[];
  extendedAgentCard: boolean;
}>;

export type A2aAgentExtension = Readonly<{
  uri: string;
  description: string;
  required: boolean;
}>;

export type A2aSecurityRequirement = Readonly<{
  schemes: Readonly<Record<string, Readonly<{ list: readonly string[] }>>>;
}>;

export type A2aHttpAuthScheme = Readonly<{
  httpAuthSecurityScheme: Readonly<{ description: string; scheme: string; bearerFormat: string }>;
}>;

export type A2aAgentSkill = Readonly<{
  id: string;
  name: string;
  description: string;
  tags: readonly string[];
  examples: readonly string[];
  inputModes: readonly string[];
  outputModes: readonly string[];
  securityRequirements: readonly A2aSecurityRequirement[];
}>;

export type RyntraAgentCard = Readonly<{
  name: string;
  description: string;
  supportedInterfaces: readonly A2aAgentInterface[];
  provider: A2aAgentProvider;
  version: string;
  documentationUrl: string;
  capabilities: A2aAgentCapabilities;
  securitySchemes: Readonly<Record<string, A2aHttpAuthScheme>>;
  securityRequirements: readonly A2aSecurityRequirement[];
  defaultInputModes: readonly string[];
  defaultOutputModes: readonly string[];
  skills: readonly A2aAgentSkill[];
  /** A2A §8.4 JWS blocks. Empty: no key here signs this document. */
  signatures: readonly never[];
}>;

/**
 * The card's own version, moved by hand.
 *
 * Not the product's release number and not a build hash: a reader uses it to
 * tell whether the skills they cached are the skills being served, and a value
 * that changed on every deployment would make that question unanswerable.
 */
export const RYNTRA_AGENT_CARD_VERSION = "1.0.0" as const;

/** The scheme name the card's security requirements point at. */
export const A2A_BEARER_SCHEME = "ryntraAgentKey" as const;

const BEARER_REQUIREMENT: A2aSecurityRequirement = Object.freeze({
  schemes: Object.freeze({ [A2A_BEARER_SCHEME]: Object.freeze({ list: Object.freeze([]) }) }),
});

/**
 * One extension URI, declared `required`.
 *
 * It states the one thing a client must understand before it sends anything:
 * this agent answers reads and records proposals, and it will not perform a
 * financial action however the request is phrased. `required: true` means a
 * client that does not understand the URI must not proceed — which is the
 * correct outcome, because a client that ignores it will send an action request
 * and get a rejected task back.
 */
export const RYNTRA_A2A_EXTENSION: A2aAgentExtension = Object.freeze({
  uri: "https://ryntra.io/a2a/extensions/read-and-propose/v1",
  description:
    "Every skill is a read of Ryntra's own facts or one proposal awaiting a person. No request performs a transfer, a trade or a signature, and a request for one ends as a rejected task.",
  required: true,
});

const TEXT = "text/plain";
const JSON_MODE = "application/json";

/** The skills the hosted tool inventory already carries, as card skills. */
function toolSkills(): readonly A2aAgentSkill[] {
  const reads = HOSTED_LOCAL_READ_TOOLS.map(
    (name): A2aAgentSkill =>
      Object.freeze({
        id: name,
        name: name.replace(/_/g, " "),
        description:
          "Bounded local computation over Ryntra's own contracts. Reaches no provider, chain, wallet or facilitator.",
        tags: Object.freeze(["read", "mcp"]),
        examples: Object.freeze([]),
        inputModes: Object.freeze([JSON_MODE]),
        outputModes: Object.freeze([JSON_MODE]),
        securityRequirements: Object.freeze([BEARER_REQUIREMENT]),
      }),
  );

  const proposals = MCP_WRITE_TOOLS.map(
    (tool): A2aAgentSkill =>
      Object.freeze({
        id: tool.name,
        name: tool.title,
        description: `${tool.summary} ${tool.limitations.join(" ")}`,
        tags: Object.freeze(["propose", "mcp"]),
        examples: Object.freeze([]),
        inputModes: Object.freeze([JSON_MODE]),
        outputModes: Object.freeze([JSON_MODE]),
        securityRequirements: Object.freeze([BEARER_REQUIREMENT]),
      }),
  );

  return Object.freeze([...reads, ...proposals]);
}

/** The skills this interface serves directly, over A2A rather than over MCP. */
function routerSkills(): readonly A2aAgentSkill[] {
  return Object.freeze(
    EXTERNAL_ROUTER_SKILLS.map(
      (skill): A2aAgentSkill =>
        Object.freeze({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          tags: Object.freeze([...skill.tags]),
          examples: Object.freeze([...skill.examples]),
          inputModes: Object.freeze([JSON_MODE]),
          outputModes: Object.freeze([JSON_MODE]),
          securityRequirements: Object.freeze([BEARER_REQUIREMENT]),
        }),
    ),
  );
}

export const CARD_REFUSALS = ["CARD_ORIGIN_NOT_ABSOLUTE_HTTPS"] as const;

export type CardRefusal = (typeof CARD_REFUSALS)[number];

export class CardError extends Error {
  readonly reasonCode: CardRefusal;

  constructor(reasonCode: CardRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "CardError";
    this.reasonCode = reasonCode;
  }
}

/**
 * Build the card for one deployment.
 *
 * `origin` is that deployment's own absolute https origin. It is a parameter
 * rather than a constant for the reason the x402 hub gives: an address that has
 * to be kept true across preview deployments is an address that stops being
 * true. A relative interface URL is refused outright — the protocol asks for an
 * absolute one, and a client that joined a relative path against the wrong base
 * would send Ryntra's traffic somewhere else.
 */
export function buildRyntraAgentCard({ origin }: { origin: string }): RyntraAgentCard {
  if (!/^https:\/\/[^/\s]+$/.test(origin)) {
    throw new CardError(
      "CARD_ORIGIN_NOT_ABSOLUTE_HTTPS",
      "an interface URL in a published card is absolute https; a relative path points wherever the reader's base happens to be",
    );
  }

  return Object.freeze({
    name: "Ryntra",
    description:
      "Solana-native financial operations platform for people, teams and autonomous agents. This agent answers reads and quotes and records proposals; a person signs anything that moves money.",
    supportedInterfaces: Object.freeze([
      Object.freeze({
        url: `${origin}${A2A_INTERFACE_PATH}`,
        protocolBinding: A2A_SERVED_BINDING,
        protocolVersion: A2A_WIRE_VERSION,
      }),
    ]),
    provider: Object.freeze({ organization: "Ryntra", url: origin }),
    version: RYNTRA_AGENT_CARD_VERSION,
    documentationUrl: `${origin}/developers/agent-control`,
    capabilities: Object.freeze({
      /* Both false because neither is built. `message:stream` and the push
         notification configs are refused by name in `./interface.ts`, and a
         capability flag that promised them would be a promise the refusal
         breaks. */
      streaming: false,
      pushNotifications: false,
      extensions: Object.freeze([RYNTRA_A2A_EXTENSION]),
      /* No second, richer card for an authenticated reader: there is one card,
         and a reader holding a key sees the same skills as a reader without
         one. */
      extendedAgentCard: false,
    }),
    securitySchemes: Object.freeze({
      [A2A_BEARER_SCHEME]: Object.freeze({
        httpAuthSecurityScheme: Object.freeze({
          description:
            "An agent key issued by Ryntra, presented as a bearer credential. A request with no key is read at the anonymous rate; a key that is wrong is refused rather than downgraded.",
          scheme: "Bearer",
          bearerFormat: "opaque",
        }),
      }),
    }),
    securityRequirements: Object.freeze([BEARER_REQUIREMENT]),
    defaultInputModes: Object.freeze([JSON_MODE, TEXT]),
    defaultOutputModes: Object.freeze([JSON_MODE, TEXT]),
    skills: Object.freeze([...routerSkills(), ...toolSkills()]),
    signatures: Object.freeze([]),
  });
}

/**
 * What the card does not say, in the words a reader needs.
 *
 * Served beside the card on Ryntra's own routes rather than inside it: the card
 * is a protocol document and a field of our own in it would be a field nobody
 * else reads.
 */
export const CARD_LIMITATIONS = Object.freeze([
  "The card carries no JWS signature. Signing it needs a key this deployment does not hold, and an unsigned card is the honest state.",
  "Streaming and push notifications are not served, and the capability flags say so rather than being left to a refusal to discover.",
  "Every skill is a read or a proposal. No skill performs a transfer, a trade, an approval or a signature.",
  "The same document answers at the 1.0 path and at the earlier generation's path; there is one card, not two.",
]);
