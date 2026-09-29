import { sendPlainDelivery } from "@/lib/telegram/api";

import { deliveryStateFrom, errorClassFrom } from "@/lib/telegram/delivery";

import { claimBroadcastBatch, dueBroadcasts, rollupBroadcast, setBroadcastDelivery } from "./store";

const BATCH = 25;
const PACE_MS = 1100;

export async function processBroadcastQueue(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  blocked: number;
  retry: number;
} | null> {
  await dueBroadcasts();
  const batch = await claimBroadcastBatch(BATCH);
  if (!batch) return null;
  let sent = 0;
  let failed = 0;
  let blocked = 0;
  let retry = 0;
  const campaigns = new Set<string>();
  for (let i = 0; i < batch.length; i += 1) {
    const item = batch[i];
    campaigns.add(item.campaign_id);
    const result = await sendPlainDelivery(item.telegram_id, item.body);
    const retryAfter =
      result.kind === "retry"
        ? new Date(Date.now() + result.retryAfterSec * 1000).toISOString()
        : null;
    await setBroadcastDelivery({
      id: item.id,
      state: deliveryStateFrom(result.kind),
      errorClass: errorClassFrom(result.kind),
      retryAfter,
    });
    if (result.kind === "sent") sent += 1;
    else if (result.kind === "blocked") blocked += 1;
    else if (result.kind === "retry") retry += 1;
    else failed += 1;
    if ((i + 1) % 25 === 0) await new Promise((resolve) => setTimeout(resolve, PACE_MS));
  }
  for (const id of campaigns) await rollupBroadcast(id);
  return { processed: batch.length, sent, failed, blocked, retry };
}
