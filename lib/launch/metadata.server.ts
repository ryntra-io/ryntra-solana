/**
 * A token's picture and metadata, kept by Ryntra at addresses that cannot
 * change what they serve.
 *
 * The mint names its metadata URI for ever. So the picture and the metadata
 * are each stored once under the sha256 of their own bytes, and served from
 * `/api/launch/image/<sha256>` and `/api/launch/metadata/<sha256>`: the
 * address is the content, a second write of the same bytes is the same
 * address, and no write can replace what an address serves.
 *
 * Server-only: the Guard store of the deployment.
 */

import { createHash } from "node:crypto";

import type { GuardStore } from "../guard/store.ts";
import { IMAGE_MAX_BYTES, TokenMetadataSchema, imageTypeOf, type ImageType, type TokenMetadata } from "./form.ts";

export type StoredImage = Readonly<{ sha256: string; contentType: ImageType; base64: string; bytes: number; storedAt: string }>;
export type StoredMetadata = Readonly<{ sha256: string; json: string; storedAt: string }>;

export const SHA256_HEX = /^[0-9a-f]{64}$/;

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

export type ImageRefusal = "IMAGE_TYPE" | "IMAGE_TOO_LARGE" | "IMAGE_EMPTY";

/** A picture as it would be stored — its type read from its own bytes, its size within the limit — or why not. */
export function launchImageOf(bytes: Uint8Array, now: string): { ok: true; image: StoredImage } | { ok: false; code: ImageRefusal } {
  if (bytes.length === 0) return { ok: false, code: "IMAGE_EMPTY" };
  if (bytes.length > IMAGE_MAX_BYTES) return { ok: false, code: "IMAGE_TOO_LARGE" };
  const contentType = imageTypeOf(bytes);
  if (!contentType) return { ok: false, code: "IMAGE_TYPE" };
  return { ok: true, image: { sha256: sha256(bytes), contentType, base64: Buffer.from(bytes).toString("base64"), bytes: bytes.length, storedAt: now } };
}

/** Stores a picture once; the same bytes give the same address. */
export async function storeLaunchImage(store: GuardStore, bytes: Uint8Array, now: string): Promise<{ ok: true; image: StoredImage } | { ok: false; code: ImageRefusal }> {
  const read = launchImageOf(bytes, now);
  if (!read.ok) return read;
  const image = read.image;
  const images = store.collection<StoredImage>("launchImages");
  await images.insertIfAbsent(image.sha256, image);
  return { ok: true, image: (await images.get(image.sha256)) ?? image };
}

export async function readLaunchImage(store: GuardStore, id: string): Promise<StoredImage | null> {
  if (!SHA256_HEX.test(id)) return null;
  /* A picture Ryntra took down is served by nobody: the page, the share card and every wallet that asks. */
  if (await isTakenDown(store, "image", id)) return null;
  return (await store.collection<StoredImage>("launchImages").get(id)) ?? null;
}

/*
 * MC-1 — what Ryntra took down (`app/legal/terms/launch.ts`: Ryntra may hide a token's picture, description and links).
 * The addresses still name the same bytes; Ryntra stops serving them. One row per address and per token that holds it,
 * keyed `<kind>:<address>:<token>` in `launchTakedowns` — two tokens sharing a picture each hold it down on their own.
 * Putting back marks the row restored, never deletes it: who took down, who put back, when and why stay.
 */
export type TakedownKind = "image" | "metadata" | "mint";
export type Takedown = Readonly<{ key: string; token: string; reason: string; by: string; at: string; restoredBy?: string; restoredAt?: string }>;

export const takedownKey = (kind: TakedownKind, id: string, token: string) => `${kind}:${id}:${token}`;

/** Whether any token still holds this address down. */
export async function isTakenDown(store: GuardStore, kind: TakedownKind, id: string): Promise<boolean> {
  return (await store.collection<Takedown>("launchTakedowns").valuesWithPrefix(`${kind}:${id}:`)).some((row) => !row.restoredAt);
}

/** The metadata's own bytes: its keys in one order, so the same metadata is always the same address. */
export function metadataJson(metadata: TokenMetadata): string {
  const ordered: Record<string, string> = {};
  for (const key of ["name", "symbol", "description", "image", "website", "twitter", "telegram", "createdOn"] as const) {
    const value = metadata[key];
    if (value !== undefined) ordered[key] = value;
  }
  return JSON.stringify(ordered);
}

export async function storeLaunchMetadata(store: GuardStore, metadata: TokenMetadata, now: string): Promise<StoredMetadata> {
  const json = metadataJson(TokenMetadataSchema.parse(metadata));
  const record: StoredMetadata = { sha256: sha256(json), json, storedAt: now };
  const collection = store.collection<StoredMetadata>("launchMetadata");
  await collection.insertIfAbsent(record.sha256, record);
  return (await collection.get(record.sha256)) ?? record;
}

export async function readLaunchMetadata(store: GuardStore, id: string): Promise<StoredMetadata | null> {
  if (!SHA256_HEX.test(id)) return null;
  return (await store.collection<StoredMetadata>("launchMetadata").get(id)) ?? null;
}

/** The metadata a URI of ours serves, parsed; null for a URI that is not ours or not stored. */
export async function metadataOfUri(store: GuardStore, uri: string, origin: string): Promise<{ id: string; metadata: TokenMetadata; takenDown: boolean } | null> {
  const prefix = `${origin}/api/launch/metadata/`;
  if (!uri.startsWith(prefix)) return null;
  const id = uri.slice(prefix.length);
  const stored = await readLaunchMetadata(store, id);
  if (!stored) return null;
  const parsed = TokenMetadataSchema.safeParse(JSON.parse(stored.json));
  if (!parsed.success) return null;
  /* Taken down: the name and ticker stay (the chain holds them), the picture, the description and the links are not shown. */
  if (await isTakenDown(store, "metadata", id)) {
    const { name, symbol, image, createdOn } = parsed.data;
    return { id, metadata: { name, symbol, description: "", image, createdOn }, takenDown: true };
  }
  return { id, metadata: parsed.data, takenDown: false };
}
