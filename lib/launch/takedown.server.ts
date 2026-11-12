/**
 * MC-1 — taking a launched token's picture, description and links down, and putting them back.
 *
 * The terms say Ryntra may hide them (`lib/legal/texts/launch.ts`); this is how. A token's metadata URI and its
 * picture's address name the same bytes for ever — the mint holds the URI — so nothing is rewritten: Ryntra stops
 * serving them (`metadata.server.ts`: `readLaunchImage`, `metadataOfUri`), and the same picture or details are refused
 * when they come again (the upload, a new launch). The name and the ticker stay: the chain holds them.
 *
 * One row per address and token in `launchTakedowns` — who, when, why — is the record of the decision; putting the token
 * back marks its rows restored, with who and when. Which reports end in a takedown, and when, is the operator's procedure.
 */

import type { GuardStore } from "../guard/store.ts";
import { readEarlyAccessRecord } from "./early-access.server.ts";
import { takedownKey, type Takedown } from "./metadata.server.ts";
import { launchKey } from "./record-key.ts";

type LaunchRow = Readonly<{ token: string; metadataUri: string }>;

const SHA = "([0-9a-f]{64})";

export type TakedownResult =
  | Readonly<{ ok: true; token: string; metadata: string; image: string | null; keys: readonly string[] }>
  | Readonly<{ ok: false; code: "NOT_FOUND" | "NOT_OURS" }>;

/** The addresses a token's own record names: its metadata, and the picture that metadata names, both of Ryntra's. */
async function addressesOf(deps: Readonly<{ store: GuardStore; cluster: string; origin: string }>, token: string): Promise<Readonly<{ metadata: string; image: string | null }> | "NOT_FOUND" | "NOT_OURS"> {
  /* A launch with early access keeps its record apart (`launchEarlyAccess`): the same token, the same metadata — found there too (review 9.11). */
  const record: LaunchRow | null =
    (await deps.store.collection<LaunchRow>("launches").get(launchKey(deps.cluster, token))) ??
    (await readEarlyAccessRecord(deps.store, deps.cluster, token).then((early) => (early ? { token: early.mint, metadataUri: early.metadataUri } : null)));
  if (!record) return "NOT_FOUND";
  const metadata = new RegExp(`^${escape(deps.origin)}/api/launch/metadata/${SHA}$`).exec(record.metadataUri)?.[1];
  if (!metadata) return "NOT_OURS";
  const json = (await deps.store.collection<Readonly<{ json: string }>>("launchMetadata").get(metadata))?.json;
  let image: string | null = null;
  try {
    const named = json ? (JSON.parse(json) as { image?: unknown }).image : null;
    image = typeof named === "string" ? (new RegExp(`^${escape(deps.origin)}/api/launch/image/${SHA}$`).exec(named)?.[1] ?? null) : null;
  } catch {
    image = null;
  }
  return { metadata, image };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Takes a launched token's picture, description and links down: the token, its metadata and its picture, one row each. */
export async function takeDownLaunch(
  deps: Readonly<{ store: GuardStore; cluster: string; origin: string }>,
  input: Readonly<{ token: string; reason: string; by: string; at: string }>,
): Promise<TakedownResult> {
  const found = await addressesOf(deps, input.token);
  if (typeof found === "string") return { ok: false, code: found };
  const rows = store(deps.store);
  const keys = keysOf(input.token, found);
  /* A token taken down again after a restore: its rows are written anew. */
  for (const key of keys) await rows.set(key, { key, token: input.token, reason: input.reason, by: input.by, at: input.at });
  return { ok: true, token: input.token, metadata: found.metadata, image: found.image, keys };
}

/** Puts a token's picture, description and links back: its own rows are marked restored — a picture another token holds down stays down. */
export async function restoreLaunch(deps: Readonly<{ store: GuardStore; cluster: string; origin: string }>, token: string, input: Readonly<{ by: string; at: string }>): Promise<TakedownResult> {
  const found = await addressesOf(deps, token);
  if (typeof found === "string") return { ok: false, code: found };
  const rows = store(deps.store);
  const keys = keysOf(token, found);
  for (const key of keys) {
    const row = await rows.get(key);
    if (row && !row.restoredAt) await rows.set(key, { ...row, restoredBy: input.by, restoredAt: input.at });
  }
  return { ok: true, token, metadata: found.metadata, image: found.image, keys };
}

const keysOf = (token: string, found: Readonly<{ metadata: string; image: string | null }>) => [
  takedownKey("mint", token, token),
  takedownKey("metadata", found.metadata, token),
  ...(found.image ? [takedownKey("image", found.image, token)] : []),
];

/** Every token's takedown, restored ones included, newest first: the admin's list and its record. */
export async function listTakedowns(guard: GuardStore): Promise<readonly Takedown[]> {
  const rows = await store(guard).valuesWithPrefix("mint:");
  return [...rows].sort((a, b) => b.at.localeCompare(a.at));
}

const store = (guard: GuardStore) => guard.collection<Takedown>("launchTakedowns");
