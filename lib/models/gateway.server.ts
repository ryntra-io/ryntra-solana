/**
 * The model gateway on a deployment (CITY-45): the server's environment, the
 * runtime's `fetch`, one catalog per instance. Server-only — the keys are read
 * here and nowhere a browser can reach.
 */

import "server-only";

import { createModelCatalog, type ModelCatalog } from "./catalog.ts";
import { createModelGateway } from "./call.ts";
import { createKeyManager, type ModelKeyManager } from "./keys.ts";
import type { ModelGateway } from "./types.ts";

let shared: Readonly<{ catalog: ModelCatalog; gateway: ModelGateway; keys: ModelKeyManager }> | null = null;

function instance() {
  if (!shared) {
    const catalog = createModelCatalog();
    shared = { catalog, gateway: createModelGateway({ env: process.env, catalog }), keys: createKeyManager({ env: process.env }) };
  }
  return shared;
}

/** The catalog, endpoints, providers and prices, cached for ten minutes per instance — the same copy every call is checked against. */
export function modelCatalog(): ModelCatalog {
  return instance().catalog;
}

/** The one gateway a Vault's guard and a Ring's agent call. */
export function modelGateway(): ModelGateway {
  return instance().gateway;
}

/** Each subject's own key with its dollar limit. */
export function modelKeys(): ModelKeyManager {
  return instance().keys;
}
