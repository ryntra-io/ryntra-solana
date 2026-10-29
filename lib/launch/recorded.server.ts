import type { GuardStore } from "../guard/store.ts";
import { launchKey } from "./record-key.ts";

/**
 * Whether the token was launched here, by Ryntra's own record alone — one read of the store, never the chain: Spot asks
 * it to link a launched token to its launch page (SOL-C10, UX-403). A launch the store lost is not found here. A light
 * module of its own, so Spot's page carries the store and the record's key, not Launch's builders.
 */
export async function launchRecordedHere(store: GuardStore, cluster: string, token: string): Promise<boolean> {
  return (await store.collection<{ state?: string }>("launches").get(launchKey(cluster, token)))?.state === "LAUNCHED";
}
