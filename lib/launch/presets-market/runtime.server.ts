/**
 * The sets' answers wired to this deployment: the network Launch serves here and its presets, the database
 * through the server's usual RPC (gated by the app secret, `../../supabase-rpc.ts`), node's own signature check, and a
 * launch's record read from Launch's own store — never the chain, never a key.
 */

import { getGuardRuntime } from "../../guard/runtime.ts";
import { rpcOrNull } from "../../supabase-rpc.ts";
import { launchNetwork } from "../config.server.ts";
import type { LaunchRecord } from "../flow.server.ts";
import { launchKey } from "../record-key.ts";
import { launchPresetsView } from "../runtime.server.ts";
import type { SetsDeps } from "./service.server.ts";
import { createSetStore, type SetStore } from "./store.ts";
import { verifySetSignature } from "./verify.server.ts";

let store: SetStore | null = null;

/** The store over the server's RPC; quiet — a migration not yet applied is an expected state, not an incident. */
export function setStore(): SetStore {
  store ??= createSetStore((fn, args) => rpcOrNull<unknown>("launch-sets", fn, args, { quiet: true }));
  return store;
}

/** Everything the sets' answers need here; null where Launch is not served. */
export function setsDeps(): SetsDeps | null {
  const network = launchNetwork();
  if (!network) return null;
  const view = launchPresetsView(network);
  return {
    network: { chain: network.chain, cluster: network.cluster },
    served: view.presets.filter((preset) => !preset.technicalValidation).map((preset) => preset.id),
    bounds: network.advanced?.bounds ?? null,
    store: setStore(),
    now: () => Date.now(),
    verify: verifySetSignature,
    readLaunch: async (mint) => {
      const record = await getGuardRuntime().store.collection<LaunchRecord>("launches").get(launchKey(network.cluster, mint));
      return record ? { cluster: record.cluster, preset: record.preset, advanced: record.advanced ?? null, launchedAt: record.launchedAt } : null;
    },
  };
}
