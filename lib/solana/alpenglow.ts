/**
 * Is mainnet on Alpenglow yet? Asked of the chain, never of a date.
 *
 * Alpenglow activates with epoch 1064 (slot 459 648 000, 2026-10-21); TowerBFT
 * keeps running for the first 5 000 slots and Votor takes over at slot
 * 459 653 000. solana.com/upgrades/alpenglow asks every client to gate
 * Alpenglow behaviour on `getAgGenesisCert` rather than on a date or a client
 * version, and that is the only question this module answers.
 *
 * `@solana/kit` 7.1 (pinned here) has no `getAgGenesisCert` — the method
 * arrives in 8.3 — so it is sent as raw JSON-RPC. Three answers, and they are
 * kept apart on purpose:
 *
 * - `result: null` → **TowerBFT**. The node knows the method and the
 *   certificate does not exist yet.
 * - a certificate object → **Alpenglow**. It certifies the last TowerBFT
 *   block as Alpenglow's genesis; Votor builds on top of it.
 * - error `-32601` (method not found) → **unknown**: the node runs a version
 *   older than 4.3. It says nothing about the cluster, and it is never read
 *   as "not yet".
 *
 * What changes on the certificate, and what does not:
 *
 * - The blockhash stays on `confirmed` — before and after. Under Alpenglow
 *   `confirmed` and `finalized` are the same state.
 * - New reads that want `finalized` take it only once the certificate is
 *   there ({@link commitmentForNewReads}); before it, `finalized` is still a
 *   12.8-second wait under TowerBFT.
 *
 * The live shape (mainnet, solana-core 4.3.0 and 4.3.2, 2026-10-21 and 22):
 * `{ block: { slot: 459652999, blockId: [56, 223, …] }, signature: { bitmap,
 * signature } }` — `blockId` is 32 bytes as an array of numbers, not a
 * string. It is Alpenglow's block id, not the block's blockhash (slot
 * 459 652 999: block id `4q1ScaDS…`, blockhash `GAR8EmHh…`), so it is never
 * compared with one. It is kept here as base58; a string `blockId` (a client
 * that already decoded it) is taken only when it is base58 of exactly 32 bytes.
 *
 * Client-safe: `fetch` and a base58 codec only.
 */

import { getBase58Decoder, getBase58Encoder } from "@solana/kit";

export const ALPENGLOW_EPOCH = 1064;
export const ALPENGLOW_EPOCH_FIRST_SLOT = 459_648_000;
/** TowerBFT runs the first 5 000 slots of epoch 1064; Votor from here. */
export const ALPENGLOW_VOTOR_SLOT = 459_653_000;
/** The block mainnet's genesis certificate names (read from the chain, 2026-10-21): the last TowerBFT block. */
export const MAINNET_AG_GENESIS_CERT_SLOT = 459_652_999;
/** Older than 4.3: the node does not know the method. */
export const JSON_RPC_METHOD_NOT_FOUND = -32601;

/** The blockhash commitment, before and after Alpenglow. */
export const BLOCKHASH_COMMITMENT = "confirmed" as const;

/** `slot` — the certified block (the last TowerBFT one); `blockId` — its Alpenglow block id (not the blockhash), base58. */
export type AlpenglowCert = Readonly<{ slot: number; blockId: string }>;

export type AlpenglowReading = Readonly<
  | { state: "TOWER_BFT"; host: string }
  | { state: "ALPENGLOW"; host: string; cert: AlpenglowCert }
  | { state: "UNKNOWN"; host: string; reason: "OLD_NODE" | "UNREADABLE" | "TRANSPORT" }
>;

export type AlpenglowVerdict = Readonly<{
  state: "TOWER_BFT" | "ALPENGLOW" | "UNKNOWN";
  cert: AlpenglowCert | null;
  readings: readonly AlpenglowReading[];
}>;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-endpoint";
  }
}

const BLOCK_ID_BYTES = 32;

/** The block id as the node sends it — 32 bytes as numbers — or as base58 of 32 bytes from a client that decoded it already; else null. */
function blockIdOf(value: unknown): string | null {
  if (typeof value === "string") {
    if (value.length === 0 || value.length > 44) return null;
    try {
      return getBase58Encoder().encode(value).length === BLOCK_ID_BYTES ? value : null;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || value.length !== BLOCK_ID_BYTES) return null;
  if (!value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null;
  return getBase58Decoder().decode(Uint8Array.from(value as number[]));
}

/** Pure: one JSON-RPC body → one reading. */
export function readAgGenesisCertBody(body: unknown, host: string): AlpenglowReading {
  if (!body || typeof body !== "object") return { state: "UNKNOWN", host, reason: "UNREADABLE" };
  const record = body as Record<string, unknown>;
  if ("error" in record && record.error && typeof record.error === "object") {
    const code = (record.error as Record<string, unknown>).code;
    return { state: "UNKNOWN", host, reason: code === JSON_RPC_METHOD_NOT_FOUND ? "OLD_NODE" : "UNREADABLE" };
  }
  if (!("result" in record)) return { state: "UNKNOWN", host, reason: "UNREADABLE" };
  if (record.result === null) return { state: "TOWER_BFT", host };
  const result = record.result as Record<string, unknown> | undefined;
  const block = result && typeof result === "object" ? (result.block as Record<string, unknown> | undefined) : undefined;
  const slot = typeof block?.slot === "number" ? block.slot : Number(block?.slot);
  const blockId = blockIdOf(block?.blockId);
  if (!Number.isSafeInteger(slot) || slot < ALPENGLOW_EPOCH_FIRST_SLOT || blockId === null) {
    return { state: "UNKNOWN", host, reason: "UNREADABLE" };
  }
  return { state: "ALPENGLOW", host, cert: { slot, blockId } };
}

/**
 * Pure: several readings → one verdict. A certificate from any node is the
 * cluster's (it is read from the finalized bank); TowerBFT needs a node that
 * knows the method and answered `null`; anything else is unknown — never
 * "not yet".
 */
export function combineAlpenglowReadings(readings: readonly AlpenglowReading[]): AlpenglowVerdict {
  const certified = readings.find((reading) => reading.state === "ALPENGLOW");
  if (certified && certified.state === "ALPENGLOW") return { state: "ALPENGLOW", cert: certified.cert, readings };
  if (readings.some((reading) => reading.state === "TOWER_BFT")) return { state: "TOWER_BFT", cert: null, readings };
  return { state: "UNKNOWN", cert: null, readings };
}

/** One endpoint, raw JSON-RPC. Never throws. */
export async function fetchAgGenesisCert(
  endpointUrl: string,
  options: Readonly<{ fetchImpl?: typeof fetch; timeoutMs?: number }> = {},
): Promise<AlpenglowReading> {
  const host = hostOf(endpointUrl);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAgGenesisCert" }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    if (Number(response.headers.get("content-length") ?? 0) > 64 * 1024) return { state: "UNKNOWN", host, reason: "UNREADABLE" };
    const text = await response.text();
    if (text.length > 64 * 1024) return { state: "UNKNOWN", host, reason: "UNREADABLE" };
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      return { state: "UNKNOWN", host, reason: response.ok ? "UNREADABLE" : "TRANSPORT" };
    }
    return readAgGenesisCertBody(body, host);
  } catch {
    return { state: "UNKNOWN", host, reason: "TRANSPORT" };
  }
}

/** Ask every endpoint given (two independent operators in practice). */
export async function readAlpenglow(
  endpointUrls: readonly string[],
  options: Readonly<{ fetchImpl?: typeof fetch; timeoutMs?: number }> = {},
): Promise<AlpenglowVerdict> {
  const readings = await Promise.all(endpointUrls.map((url) => fetchAgGenesisCert(url, options)));
  return combineAlpenglowReadings(readings);
}

/**
 * The commitment a new place in the code that wants finality should read at:
 * `finalized` only after the certificate; `confirmed` on TowerBFT and when the
 * answer is unknown. The blockhash is not such a place — it stays on
 * {@link BLOCKHASH_COMMITMENT}.
 */
export function commitmentForNewReads(verdict: Pick<AlpenglowVerdict, "state">): "confirmed" | "finalized" {
  return verdict.state === "ALPENGLOW" ? "finalized" : "confirmed";
}
