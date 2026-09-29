"use client";

/**
 * One read of a wallet's balances, for every card that offers MAX.
 *
 * `/api/solana/holdings` answers with `tokenRead`: `COMPLETE` when both token
 * programs answered, `PARTIAL` when one did, `UNAVAILABLE` when neither did.
 * Swap and Spot read the rows and dropped the word — so on 2026-09-12 the Swap
 * card on production held eight rows (SOL and seven Token-2022 tokens) for a
 * wallet of seventy, the USDC leg had no *Available* and no MAX, and nothing
 * on screen said why. Send had already learned this the day before. A partial
 * answer is read again, twice, a little apart; what is still partial after
 * that is shown as partial, never as the wallet.
 */

export type HoldingsTokenRead = "COMPLETE" | "PARTIAL" | "UNAVAILABLE";

export type WalletHoldingsRead<T> =
  | Readonly<{ ok: true; rows: readonly T[]; tokenRead: HoldingsTokenRead; status: number }>
  | Readonly<{ ok: false; status: number; code: string | null; reason: string }>;

/** Wait this long before asking again after a partial answer, then this long. */
export const HOLDINGS_PARTIAL_RETRY_DELAYS_MS: readonly number[] = [1_500, 4_000];

/** After a fill: the chain is usually readable at once; a public RPC can lag a few seconds. */
export const HOLDINGS_AFTER_FILL_DELAYS_MS: readonly number[] = [1_500, 7_000];

export async function readWalletHoldings<T>(owner: string, network = "mainnet", signal?: AbortSignal): Promise<WalletHoldingsRead<T>> {
  let response: Response;
  try {
    response = await fetch("/api/solana/holdings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner, network }),
      signal,
    });
  } catch (failure) {
    return { ok: false, status: 0, code: "NETWORK", reason: failure instanceof Error ? failure.message : "The request did not complete." };
  }
  const body = (await response.json().catch(() => ({}))) as {
    data?: { holdings?: readonly T[]; tokenRead?: HoldingsTokenRead };
    holdings?: readonly T[];
    tokenRead?: HoldingsTokenRead;
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    return { ok: false, status: response.status, code: body.error?.code ?? `HTTP_${response.status}`, reason: body.error?.message ?? `HTTP ${response.status}` };
  }
  /* The route answers inside a `data` envelope; both depths are read so a
     later envelope change cannot silently blank a balance again. */
  const rows = body.data?.holdings ?? body.holdings ?? [];
  const tokenRead = body.data?.tokenRead ?? body.tokenRead ?? "COMPLETE";
  return { ok: true, rows, tokenRead, status: response.status };
}

/**
 * Read until the answer is whole, or until the retries run out.
 *
 * `onRead` receives every answer as it arrives — a partial list is better on
 * screen than nothing while the next read is in flight — and the last answer
 * is the one returned. A failed read stops the loop: the route refusing is not
 * the same as the chain answering by halves.
 */
export async function readWalletHoldingsUntilComplete<T>(args: {
  owner: string;
  network?: string;
  signal?: AbortSignal;
  delaysMs?: readonly number[];
  onRead?: (read: WalletHoldingsRead<T>, attempt: number) => void;
}): Promise<WalletHoldingsRead<T>> {
  const delays = args.delaysMs ?? HOLDINGS_PARTIAL_RETRY_DELAYS_MS;
  let attempt = 0;
  for (;;) {
    const read = await readWalletHoldings<T>(args.owner, args.network, args.signal);
    if (args.signal?.aborted) return read;
    args.onRead?.(read, attempt);
    if (!read.ok || read.tokenRead === "COMPLETE" || attempt >= delays.length) return read;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delays[attempt]);
      args.signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    if (args.signal?.aborted) return read;
    attempt += 1;
  }
}
