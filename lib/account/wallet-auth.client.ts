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
