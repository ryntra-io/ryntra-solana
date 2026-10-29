// Serializing credential writes ensures a late old-wallet response is followed
// by cleanup before a new wallet can sign in. Cancelling fetch alone cannot
// establish that ordering for Set-Cookie responses.
let generation = 0;
let pending: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result.then(() => undefined, () => undefined);
  return result;
}

export function walletAuthGeneration(): number { return generation; }

export function clearWalletAccount(): Promise<Response> {
  generation += 1;
  return enqueue(() => fetch("/api/auth/solana/session", { method: "DELETE" }));
}

/**
 * A change of wallet the page is not yet sure of (SOL-W2). A wallet restarting
 * or restoring can show another account for a moment and come back, so the
 * clear waits; an address that comes back cancels it. A sign-in that starts
 * meanwhile settles it first (`settleWalletChange`), before it reads the
 * generation, so the clear can neither cancel that sign-in nor delete the
 * session it makes.
 */
let pendingChange: { timer: ReturnType<typeof setTimeout>; run: (settled: boolean) => void } | null = null;

export function clearWalletAccountSoon(ms: number, cleared: (settled: boolean, done: Promise<unknown>) => void): () => void {
  if (pendingChange) clearTimeout(pendingChange.timer);
  const change = {
    timer: setTimeout(() => change.run(false), ms),
    /* `settled`: run early by a sign-in that is starting, not by the wait. */
    run: (settled: boolean) => {
      if (pendingChange !== change) return;
      pendingChange = null;
      /* Queued first, so the generation moves before anything else reads it. */
      cleared(settled, clearWalletAccount().catch(() => undefined));
    },
  };
  pendingChange = change;
  return () => {
    if (pendingChange !== change) return;
    clearTimeout(change.timer);
    pendingChange = null;
  };
}

/** Run a waiting clear now. Called at the start of every sign-in and proof. */
export function settleWalletChange(): void {
  if (!pendingChange) return;
  clearTimeout(pendingChange.timer);
  pendingChange.run(true);
}

export function postWalletProof(body: unknown, expectedGeneration: number): Promise<Response | null> {
  return enqueue(async () => {
    if (generation !== expectedGeneration) return null;
    return fetch("/api/auth/solana", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  });
}

export function announceAccountChange(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("ryntra-account-context");
  channel.postMessage("changed");
  channel.close();
}
