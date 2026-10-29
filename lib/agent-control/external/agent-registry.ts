/**
 * Ryntra's place in the Solana Agent Registry — everything prepared, nothing
 * registered.
 *
 * There is an on-chain registry for agents on Solana, interoperable with the
 * EVM draft of the same idea: three registries — identity, reputation,
 * validation — where an agent gets an identifier backed by a program-derived
 * address, and that identifier resolves to a registration file carrying
 * metadata such as A2A agent cards, MCP endpoints, wallet addresses and
 * capability declarations (solana.com/agent-registry, read 2026-10-26).
 *
 * Two decisions follow from that and they point in opposite directions:
 *
 * **We do not build one.** A second registry of agents is a thing this product
 * has already decided against, and the existence of this one removes the last
 * argument for it. What we build is a document good enough to register.
 *
 * **We do not register either.** Registration writes to a chain and pays a
 * fee, which is money moving from a wallet, at a moment, by a signature. That
 * is the product owner's act and nobody else's — not a deployment's, not a
 * session's, not a flag's. So this module assembles the dossier and says what
 * is still missing; `REGISTRATION_IS_SOMEBODY_ELSES_ACT` is a constant with no
 * reader and no override.
 *
 * ## The fee is written down as unconfirmed, on purpose
 *
 * An earlier review of the registry recorded 0.009 SOL as the registration
 * cost. Looking for it again on 2026-10-26 found the registry's own pages
 * describing identity, reputation and validation and **not** naming a price.
 * So the figure is carried as `priceNotConfirmed` with both dates attached
 * rather than printed as fact: a number nobody could re-verify, shown without
 * that caveat, is how a stale figure becomes a budget line.
 *
 * ## What the dossier deliberately leaves empty
 *
 * The registration file may carry wallet addresses. Which wallet of Ryntra's,
 * if any, belongs in a public registry entry is a decision with consequences —
 * a published address is permanently linkable — and it is not one this
 * repository makes. The field is `null`, the blocker says so, and nothing
 * fills it in from configuration.
 */

import { A2A_CARD_PATHS, A2A_INTERFACE_PATH, RYNTRA_AGENT_CARD_VERSION } from "../a2a/card.ts";
import { AGENT_MCP_PATH } from "../oauth/metadata.ts";
import { EXTERNAL_AGENT_CAPABILITIES, EXTERNAL_RUNTIMES } from "./router.ts";

/** Nothing in this repository registers anything. */
export const REGISTRATION_IS_SOMEBODY_ELSES_ACT = true as const;

/** Nor is there a second registry of agents here. */
export const RYNTRA_BUILDS_NO_AGENT_REGISTRY = true as const;

/** What the registry is, as its own pages describe it. */
export const SOLANA_AGENT_REGISTRY = Object.freeze({
  id: "solana-agent-registry",
  label: "Solana Agent Registry",
  /** The three registries the standard defines, kept as its own words. */
  registries: Object.freeze(["identity", "reputation", "validation"]),
  interoperableWith: "the EVM draft of the same three registries",
  /** What an identifier resolves to, as the registry describes it. */
  registrationFileCarries: Object.freeze([
    "A2A agent cards",
    "MCP endpoints",
    "wallet addresses",
    "capability declarations",
  ]),
  identifierBackedBy: "a Solana program-derived address",
  source: Object.freeze({ url: "https://solana.com/agent-registry", observedAt: "2026-10-26" }),
  priceNotConfirmed: Object.freeze({
    figure: "0.009 SOL",
    recordedAt: "2026-10-22",
    recheckedAt: "2026-10-26",
    detail:
      "Recorded by an earlier review of the registry. A re-read of the registry's own pages on the later date did not name a price, so the figure is carried as unconfirmed and is to be read off the registration flow at the time of registering.",
  }),
  limitations: Object.freeze([
    "The reputation registry takes feedback signals about registered agents. Ryntra posts none and reads none into any surface: a score from a registry is somebody else's opinion, and this product shows no single trust number.",
    "The validation registry records independent validator checks. Ryntra claims no validation it has not published the evidence for.",
  ]),
});

/* ── the dossier ──────────────────────────────────────────────────────── */

export type DossierEntry = Readonly<{
  field: string;
  /** The value that would be registered, or null when it is not ours to set. */
  value: string | null;
  /** Where the value comes from, so a reader can check it rather than trust it. */
  from: string;
}>;

export type RegistrationDossier = Readonly<{
  registry: typeof SOLANA_AGENT_REGISTRY;
  agentName: string;
  cardVersion: string;
  entries: readonly DossierEntry[];
  capabilityDeclaration: readonly Readonly<{ id: string; speaks: string; capabilities: readonly string[] }>[];
  /** What a registered entry would never say. */
  claimsNotMade: readonly string[];
}>;

export const REGISTRATION_BLOCKERS = [
  "ORIGIN_UNKNOWN",
  "OWNER_HAS_NOT_SAID_TO_REGISTER",
  "REGISTRATION_WALLET_NOT_CHOSEN",
  "REGISTRATION_FEE_NOT_CONFIRMED",
  "CARD_NOT_SIGNED",
] as const;

export type RegistrationBlocker = (typeof REGISTRATION_BLOCKERS)[number];

export type RegistrationReadiness = Readonly<{
  registerable: false;
  dossier: RegistrationDossier | null;
  blockers: readonly Readonly<{ code: RegistrationBlocker; detail: string }>[];
}>;

const CLAIMS_NOT_MADE = Object.freeze([
  "No trust score, safety badge or single rating of anything.",
  "No skill that signs, sends, trades or spends. A registered capability is a read or a proposal.",
  "No claim to be a facilitator, a custodian, an escrow or a registry.",
]);

function dossierEntries(origin: string): readonly DossierEntry[] {
  return Object.freeze([
    Object.freeze({
      field: "agentCard",
      value: `${origin}${A2A_CARD_PATHS.current}`,
      from: "the card this deployment serves, at the protocol's own well-known path",
    }),
    Object.freeze({
      field: "agentCardLegacyPath",
      value: `${origin}${A2A_CARD_PATHS.legacy}`,
      from: "the same document at the earlier generation's path, for clients that look there first",
    }),
    Object.freeze({
      field: "a2aInterface",
      value: `${origin}${A2A_INTERFACE_PATH}`,
      from: "the one A2A interface served, HTTP+JSON",
    }),
    Object.freeze({
      field: "mcpEndpoint",
      value: `${origin}${AGENT_MCP_PATH}`,
      from: "the hosted MCP endpoint, behind its own authorization server",
    }),
    Object.freeze({
      field: "serviceCatalogue",
      value: `${origin}/api/agents/services`,
      from: "what is free and what is for sale, with the protocol facts a buyer needs",
    }),
    Object.freeze({
      field: "walletAddress",
      value: null,
      from: "not set here: which address of this product's, if any, belongs in a public entry is not a decision this repository makes",
    }),
    Object.freeze({
      field: "cardSignature",
      value: null,
      from: "not set here: signing the card needs a key this deployment does not hold",
    }),
  ]);
}

/**
 * Assemble the dossier and list what is still missing.
 *
 * `registerable` is the literal `false`. There is no input that makes it true,
 * because the thing it would be true about — a transaction paying a fee from a
 * wallet — is not something this code is able to do. A reader looking for the
 * missing step finds it in the blockers rather than in a flag.
 */
export function registrationReadiness({ origin }: { origin: string | null }): RegistrationReadiness {
  const blockers: Array<Readonly<{ code: RegistrationBlocker; detail: string }>> = [];

  if (origin === null || !/^https:\/\/[^/\s]+$/.test(origin)) {
    blockers.push(
      Object.freeze({
        code: "ORIGIN_UNKNOWN" as const,
        detail: "the deployment's own https origin is not known, so no absolute address can be registered",
      }),
    );
  }

  blockers.push(
    Object.freeze({
      code: "OWNER_HAS_NOT_SAID_TO_REGISTER" as const,
      detail:
        "registering writes to a chain and pays a fee from a wallet. That is an act with a signature behind it, and this code has neither the wallet nor the authority.",
    }),
    Object.freeze({
      code: "REGISTRATION_WALLET_NOT_CHOSEN" as const,
      detail:
        "the registration file may carry wallet addresses, and a published address is permanently linkable. Which one, if any, is not set here.",
    }),
    Object.freeze({
      code: "REGISTRATION_FEE_NOT_CONFIRMED" as const,
      detail: SOLANA_AGENT_REGISTRY.priceNotConfirmed.detail,
    }),
    Object.freeze({
      code: "CARD_NOT_SIGNED" as const,
      detail:
        "the card carries no JWS block. An entry pointing at an unsigned card is honest; one pointing at a card signed with a key checked into a deployment would not be.",
    }),
  );

  const dossier: RegistrationDossier | null =
    origin !== null && /^https:\/\/[^/\s]+$/.test(origin)
      ? Object.freeze({
          registry: SOLANA_AGENT_REGISTRY,
          agentName: "Ryntra",
          cardVersion: RYNTRA_AGENT_CARD_VERSION,
          entries: dossierEntries(origin),
          capabilityDeclaration: Object.freeze(
            EXTERNAL_RUNTIMES.map((runtime) =>
              Object.freeze({
                id: runtime.id,
                speaks: runtime.speaks,
                capabilities: Object.freeze([...runtime.capabilities]),
              }),
            ),
          ),
          claimsNotMade: CLAIMS_NOT_MADE,
        })
      : null;

  return Object.freeze({
    registerable: false as const,
    dossier,
    blockers: Object.freeze(blockers),
  });
}

/** The capabilities a registered entry would declare, and there are two. */
export const REGISTERED_CAPABILITIES = EXTERNAL_AGENT_CAPABILITIES;
