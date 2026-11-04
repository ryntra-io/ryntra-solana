import { createHash } from "node:crypto";

import { z } from "zod";

import type { GuardStore } from "../guard/store.ts";

/**
 * The connector's two durable books (CITY-154): each wallet's quota window, and one receipt per tool call.
 *
 * **Quota by wallet, not by address.** Every user of one AI chat reaches `/mcp` from that chat's few egress addresses, so a
 * per-address window would make all of them one caller. The grant names the wallet that signed, and that wallet is the
 * principal: one row per wallet, its window rewritten in place under compare-and-set, so the table does not grow with
 * time.
 *
 * **A receipt for every call, admitted or refused**, carrying the tool, the outcome, the exact reason and a digest of
 * the arguments — never the arguments, which are the caller's business. Written with `insertIfAbsent`, so the trail is
 * append-only by construction.
 */

export const CONNECTOR_QUOTA_PER_MINUTE = 60;
const WINDOW_MS = 60_000;
const CAS_ATTEMPTS = 5;

const QuotaRecordSchema = z
  .object({ version: z.number().int().nonnegative(), windowStartMs: z.number().int().nonnegative(), count: z.number().int().nonnegative() })
  .strict();
type QuotaRecord = z.output<typeof QuotaRecordSchema>;

export type QuotaDecision = Readonly<{ allowed: boolean; limit: number; remaining: number; retryAfterSeconds: number }>;

export async function consumeConnectorQuota(
  store: GuardStore,
  input: Readonly<{ wallet: string; nowMs: number; limit?: number }>,
): Promise<QuotaDecision> {
  const limit = input.limit ?? CONNECTOR_QUOTA_PER_MINUTE;
  const windowStartMs = input.nowMs - (input.nowMs % WINDOW_MS);
  const quotas = store.versioned<QuotaRecord>("connectorQuotas");
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    const current = await quotas.get(input.wallet);
    const fresh = !current || current.windowStartMs !== windowStartMs;
    const count = fresh ? 0 : current.count;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + WINDOW_MS - input.nowMs) / 1_000));
    if (count >= limit) return { allowed: false, limit, remaining: 0, retryAfterSeconds };
    const next = QuotaRecordSchema.parse({ version: current ? current.version + 1 : 0, windowStartMs, count: count + 1 });
    if (await quotas.compareAndSet(input.wallet, current ? current.version : null, next)) {
      return { allowed: true, limit, remaining: limit - next.count, retryAfterSeconds };
    }
  }
  throw new Error("CONNECTOR_QUOTA_CONTENDED");
}

const timestamp = z.string().datetime({ offset: true });

export const ConnectorReceiptSchema = z
  .object({
    version: z.number().int().nonnegative(),
    receiptId: z.string().min(8).max(128),
    wallet: z.string().min(32).max(44),
    clientId: z.string().min(1).max(512),
    grantId: z.string().min(1).max(64),
    toolName: z.string().min(1).max(96),
    outcome: z.enum(["ACCEPTED", "REFUSED"]),
    /** The exact refusal, or null when the call was answered. */
    reasonCode: z.string().min(1).max(64).nullable(),
    argumentsDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    at: timestamp,
  })
  .strict();
export type ConnectorReceipt = z.output<typeof ConnectorReceiptSchema>;

export function digestArguments(value: unknown): string {
  return `0x${createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex")}`;
}

export async function recordConnectorReceipt(
  store: GuardStore,
  input: Readonly<{ receiptId: string; wallet: string; clientId: string; grantId: string; toolName: string; admitted: boolean; reasonCode: string | null; args: unknown; atMs: number }>,
): Promise<ConnectorReceipt> {
  const receipt = ConnectorReceiptSchema.parse({
    version: 0,
    receiptId: input.receiptId,
    wallet: input.wallet,
    clientId: input.clientId,
    grantId: input.grantId,
    toolName: input.toolName.slice(0, 96) || "-",
    outcome: input.admitted && input.reasonCode === null ? "ACCEPTED" : "REFUSED",
    reasonCode: input.reasonCode,
    argumentsDigest: digestArguments(input.args),
    at: new Date(input.atMs).toISOString(),
  });
  await store.collection<ConnectorReceipt>("connectorReceipts").insertIfAbsent(`${input.wallet}:${input.receiptId}`, receipt);
  return receipt;
}

export function readConnectorReceipts(store: GuardStore, wallet: string): Promise<readonly ConnectorReceipt[]> {
  return store.collection<ConnectorReceipt>("connectorReceipts").valuesWithPrefix(`${wallet}:`);
}

/**
 * The address the engine's per-address read window sees for one wallet's calls: a unique-local IPv6 address derived
 * from the wallet, never a real client's. The engine routes keep their floor, keyed per wallet instead of per egress.
 */
export function walletReadKey(wallet: string): string {
  const hex = createHash("sha256").update(`connector:${wallet}`).digest("hex");
  const groups = [0, 4, 8, 12, 16, 20, 24].map((at) => hex.slice(at, at + 4));
  return `fdc0:${groups.join(":")}`;
}
