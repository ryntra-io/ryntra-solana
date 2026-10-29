/**
 * The catalogue an external agent reads before it tries to pay.
 *
 * Three things, and nothing that costs anything: what is free, what is for
 * sale, and — when it is not for sale — exactly what is missing. The protocol
 * facts come with it, so a client does not have to guess which header to read,
 * which scheme to sign under or which chain id this hub means by "Solana".
 *
 * It is a read with no payment path. Nothing here issues a quote, claims a
 * nonce or touches the ledger.
 */

import {
  FACILITATOR_DECLARATIONS,
  X402_CLIENT_PACKAGES,
  X402_HEADERS,
  X402_PACKAGE_SOURCE,
  X402_SCHEMES,
  X402_SOLANA_NETWORKS,
  X402_V1_AUTHORIZATION_HEADER,
  X402_VERSION,
} from "../../../../lib/agent-control/procurement/protocol.ts";
import {
  FREE_RISK_FACTS,
  NEVER_MONETISED,
  sellerCatalogue,
} from "../../../../lib/agent-control/procurement/seller.ts";
import { privateNoStoreHeaders } from "../../../../lib/http-control.ts";

export type ServicesCatalogueDependencies = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
}>;

export function buildServicesCatalogue(env: Readonly<Record<string, string | undefined>>) {
  return {
    protocol: {
      name: "x402",
      version: X402_VERSION,
      schemes: [...X402_SCHEMES],
      /* Sold under `exact`. `upto` is named because the protocol has it, never
         because this seller offers a range. */
      soldUnder: "exact",
      headers: { ...X402_HEADERS },
      refusedHeader: {
        name: X402_V1_AUTHORIZATION_HEADER,
        reason: "V1. This seller reads PAYMENT-SIGNATURE and refuses a request that carries the V1 header.",
      },
      networks: { ...X402_SOLANA_NETWORKS },
      clientPackages: X402_CLIENT_PACKAGES.map((entry) => ({ ...entry })),
      clientPackageSource: { ...X402_PACKAGE_SOURCE },
      facilitators: FACILITATOR_DECLARATIONS.map((declaration) => ({
        id: declaration.id,
        label: declaration.label,
        operator: declaration.operator,
        schemes: [...declaration.schemes],
        networks: [...declaration.networks],
        ryntraCredential: declaration.ryntraCredential,
        source: { ...declaration.source },
        limitations: [...declaration.limitations],
      })),
      ownFacilitator: false,
    },
    free: {
      facts: FREE_RISK_FACTS.map((fact) => ({ ...fact })),
      note: "Every material risk fact is free and stays free. A paid report adds depth and withholds nothing.",
      neverMonetised: [...NEVER_MONETISED],
    },
    services: sellerCatalogue(env).map((readiness) => ({
      serviceId: readiness.service.serviceId,
      label: readiness.service.label,
      path: readiness.service.path,
      scheme: readiness.service.scheme,
      mimeType: readiness.service.mimeType,
      adds: [...readiness.service.adds],
      excludes: [...readiness.service.excludes],
      maxTimeoutSeconds: readiness.service.maxTimeoutSeconds,
      quoteValidForSeconds: readiness.service.validForSeconds,
      sellable: readiness.sellable,
      /* The price, the chain and the recipient only once the owner set them.
         A null price is the honest answer to D22, not a missing field. */
      price: readiness.config
        ? {
            network: readiness.config.network,
            asset: readiness.config.mint,
            assetRef: readiness.config.assetRef,
            assetSymbol: readiness.config.assetSymbol,
            decimals: readiness.config.decimals,
            baseUnits: readiness.config.priceBaseUnits,
            payTo: readiness.config.payTo,
            facilitator: readiness.config.facilitator,
          }
        : null,
      blockers: readiness.sellable
        ? []
        : readiness.blockers.map((blocker) => ({ code: blocker.code, detail: blocker.detail })),
      limitations: [...readiness.service.limitations],
    })),
  };
}

export function createServicesCatalogueHandler(dependencies: ServicesCatalogueDependencies = {}) {
  const env = dependencies.env ?? process.env;
  return function handle(): Response {
    return Response.json({ data: buildServicesCatalogue(env) }, { headers: privateNoStoreHeaders() });
  };
}
