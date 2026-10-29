/**
 * The launches' pictures and metadata pinned on IPFS (SOL-L3, audit SOL-L0 finding З19).
 *
 * Each file Ryntra keeps under its sha256 is added to the operator's IPFS provider through the Kubo RPC every pinning
 * service speaks (`POST /api/v0/add`, CID v1, raw leaves, pinned), and the address the provider answers is checked
 * against the one the sha256 already names (`ipfs.ts`): a copy that is not the same bytes is never recorded. The
 * record — the address, the provider's host and the time — is written once, and the token's page links that copy.
 *
 * The provider is the operator's choice and their credential: `LAUNCH_IPFS_RPC_URL` (the provider's Kubo RPC base) and
 * `LAUNCH_IPFS_RPC_TOKEN` (its bearer token), set in the deployment by the owner.
 * Without them nothing is sent anywhere and every page says the copy is on ryntra.io only, by its sha256.
 *
 * Server-only: the Guard store of the deployment and the provider's network.
 */

import { createHash } from "node:crypto";

import type { GuardStore } from "../guard/store.ts";
import type { LaunchRecord } from "./flow.server.ts";
import { IPFS_BLOCK_BYTES, ipfsCidOfSha256 } from "./ipfs.ts";
import { isTakenDown, SHA256_HEX, type StoredImage, type StoredMetadata } from "./metadata.server.ts";

export type IpfsPin = Readonly<{ sha256: string; cid: string; kind: "image" | "metadata"; via: string; pinnedAt: string }>;

export type IpfsProvider = Readonly<{ url: string; token: string; host: string }>;

/** The operator's provider, when both of its settings are there and the URL is https (a local node over http is allowed). */
export function ipfsProvider(env: Readonly<Record<string, string | undefined>>): IpfsProvider | null {
  const url = env.LAUNCH_IPFS_RPC_URL?.trim();
  const token = env.LAUNCH_IPFS_RPC_TOKEN?.trim();
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) return null;
    return { url: url.replace(/\/+$/, ""), token, host: parsed.host };
  } catch {
    return null;
  }
}

const pins = (store: GuardStore) => store.collection<IpfsPin>("launchIpfs");

/** The pins recorded for these files, by sha256; a file not pinned is absent. */
export async function readIpfsPins(store: GuardStore, shas: readonly string[]): Promise<ReadonlyMap<string, IpfsPin>> {
  const found = await Promise.all(shas.filter((sha) => SHA256_HEX.test(sha)).map(async (sha) => [sha, await pins(store).get(sha)] as const));
  return new Map(found.filter((entry): entry is readonly [string, IpfsPin] => entry[1] !== undefined));
}

export type PinRefusal = "TOO_LARGE" | "PROVIDER_REFUSED" | "PROVIDER_ANSWER" | "ADDRESS_MISMATCH";

/**
 * Adds one file to the provider and checks the address it answers against the sha256 of the bytes sent: the same bytes
 * have one address, and a provider that answers another is not recorded.
 */
export async function pinBytes(
  provider: IpfsProvider,
  bytes: Uint8Array,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<{ ok: true; cid: string; sha256: string } | { ok: false; code: PinRefusal }> {
  if (bytes.length > IPFS_BLOCK_BYTES) return { ok: false, code: "TOO_LARGE" };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expected = ipfsCidOfSha256(sha256);
  if (!expected) return { ok: false, code: "PROVIDER_ANSWER" };
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes)]), sha256);
  const response = await fetchImpl(`${provider.url}/api/v0/add?cid-version=1&raw-leaves=true&pin=true&quieter=true`, {
    method: "POST",
    headers: { authorization: `Bearer ${provider.token}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);
  if (!response?.ok) return { ok: false, code: "PROVIDER_REFUSED" };
  /* Kubo answers one JSON line per file added; the last names the file. */
  const text = await response.text().catch(() => "");
  const last = text.trim().split("\n").at(-1) ?? "";
  let hash: unknown = null;
  try {
    hash = (JSON.parse(last) as { Hash?: unknown }).Hash;
  } catch {
    return { ok: false, code: "PROVIDER_ANSWER" };
  }
  if (typeof hash !== "string") return { ok: false, code: "PROVIDER_ANSWER" };
  if (hash !== expected) return { ok: false, code: "ADDRESS_MISMATCH" };
  return { ok: true, cid: hash, sha256 };
}

/** The sha256 a URI of ours names under `<origin>/api/launch/<kind>/`; null for any other URI. */
export function shaOfOurUri(uri: string, origin: string, kind: "image" | "metadata"): string | null {
  const prefix = `${origin}/api/launch/${kind}/`;
  if (!uri.startsWith(prefix)) return null;
  const sha = uri.slice(prefix.length);
  return SHA256_HEX.test(sha) ? sha : null;
}

export type IpfsPass = Readonly<{ configured: boolean; launches: number; pinned: number; already: number; failed: readonly string[] }>;

/**
 * One pass: every launch the chain confirmed on this network, its metadata and its picture, pinned where they are not
 * yet — inside the budget, the rest left for the next pass. Reads the store and sends to the provider; signs nothing.
 */
export async function runIpfsPass(
  deps: Readonly<{ store: GuardStore; cluster: string; origin: string; env: Readonly<Record<string, string | undefined>>; now: () => Date }>,
  options: Readonly<{ budgetMs: number; fetchImpl?: typeof fetch }>,
): Promise<IpfsPass> {
  const provider = ipfsProvider(deps.env);
  if (!provider) return { configured: false, launches: 0, pinned: 0, already: 0, failed: [] };
  const deadline = Date.now() + options.budgetMs;
  const records = (await deps.store.collection<LaunchRecord>("launches").valuesWithPrefix(`solana:${deps.cluster}:`)).filter(
    (record) => record.state !== "PENDING" && (record.cluster ?? deps.cluster) === deps.cluster,
  );
  let pinned = 0;
  let already = 0;
  const failed: string[] = [];
  const pin = async (sha: string, kind: "image" | "metadata", bytes: () => Promise<Uint8Array | null>) => {
    if (await pins(deps.store).get(sha)) {
      already += 1;
      return;
    }
    const body = await bytes();
    if (!body) return;
    const result = await pinBytes(provider, body, options.fetchImpl);
    if (!result.ok || result.sha256 !== sha) {
      failed.push(`${kind}:${sha.slice(0, 12)}:${result.ok ? "SHA_MISMATCH" : result.code}`);
      return;
    }
    await pins(deps.store).insertIfAbsent(sha, { sha256: sha, cid: result.cid, kind, via: provider.host, pinnedAt: deps.now().toISOString() });
    pinned += 1;
  };
  for (const record of records) {
    if (Date.now() > deadline) break;
    const metadataSha = shaOfOurUri(record.metadataUri, deps.origin, "metadata");
    if (!metadataSha) continue;
    /* MC-1: details Ryntra took down are not pinned anywhere. */
    if (await isTakenDown(deps.store, "metadata", metadataSha)) continue;
    const metadata = await deps.store.collection<StoredMetadata>("launchMetadata").get(metadataSha);
    if (!metadata) continue;
    await pin(metadataSha, "metadata", async () => new TextEncoder().encode(metadata.json));
    let image: unknown = null;
    try {
      image = (JSON.parse(metadata.json) as { image?: unknown }).image;
    } catch {
      image = null;
    }
    const imageSha = typeof image === "string" ? shaOfOurUri(image, deps.origin, "image") : null;
    if (imageSha && !(await isTakenDown(deps.store, "image", imageSha))) {
      await pin(imageSha, "image", async () => {
        const stored = await deps.store.collection<StoredImage>("launchImages").get(imageSha);
        return stored ? new Uint8Array(Buffer.from(stored.base64, "base64")) : null;
      });
    }
  }
  return { configured: true, launches: records.length, pinned, already, failed };
}
