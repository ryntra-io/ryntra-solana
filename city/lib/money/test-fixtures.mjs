// Shared fixtures for the Money window's tests: a scripted engine on the routes the window calls, and a Review bundle
// shaped as `/api/solana/transfer/plan` answers it. No network, no wallet, no keys.

export const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
export const FRIEND = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SIGNATURE = "5".repeat(88);
export const EVM = "0x1111111111111111111111111111111111111111";
export const DIGEST = `0x${"ab".repeat(32)}`;

/** One engine answer. */
export const ok = (body, status = 200) => ({ status, body });
export const no = (status, code, extra = {}) => ({ status, body: { error: { code, message: code, ...extra } } });

/**
 * A fetch that answers each route from its own queue, in order, and records what it was asked. The route is the path
 * without the query; a route with nothing left in its queue fails the test loudly.
 */
export function scriptedFetch(script) {
  const queues = new Map(Object.entries(script).map(([route, answers]) => [route, [...answers]]));
  const calls = [];
  const fetch = async (url, init) => {
    const route = url.split("?")[0];
    calls.push({ route, url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const queue = queues.get(route);
    if (!queue || queue.length === 0) throw new Error(`no scripted answer for ${route}`);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  };
  return { fetch, calls, asked: (route) => calls.filter((call) => call.route === route) };
}

/** A Review bundle the engine would let the wallet open — or not, with `signable: false`. */
export function bundle({ native = false, amountRaw = "2500000", recipient = FRIEND, signable = true, host = "rpc.one", hash = "aa", warnings = [], blocked = null, setup = null } = {}) {
  return {
    passport: null,
    preflight: { simulation: { status: "PRESENT", succeeded: true, error: null, unitsConsumed: "1200" }, estimatedReceivedRaw: amountRaw },
    verdict: { verdict: "NO_KNOWN_BLOCKER" },
    plan: {
      network: "mainnet",
      actionKind: native ? "NATIVE_SOL" : "SPL_TRANSFER",
      sender: OWNER,
      recipient,
      mint: native ? null : USDC,
      amountRaw,
      decimals: native ? 9 : 6,
      baseFeeLamports: "5000",
      priorityFeeLamports: "1000",
      unsignedWireBase64: `unsigned-${hash}`,
      fingerprint: { messageHash: `0x${hash.repeat(32)}`, feePayer: OWNER },
    },
    provider: { role: "primary", host },
    support: { decision: "SUPPORTED", findings: [] },
    safety: { decision: signable ? "ALLOW" : "BLOCK", findings: [] },
    canaryIntent: {},
    canaryVerdict: {},
    reviewProof: { status: "SIGNED" },
    check: {
      asset: { mint: native ? null : USDC, decimals: native ? 9 : 6 },
      from: OWNER,
      to: { address: recipient, kind: "wallet", owner: recipient, account: recipient, opensAccount: setup !== null },
      send: { raw: amountRaw, amount: native ? "0.0025" : "2.5" },
      issuerFee: null,
      receive: { raw: amountRaw, amount: native ? "0.0025" : "2.5", less: false },
      networkFee: { lamports: "6000", sol: "0.000006" },
      setup,
      minimum: null,
      signable,
      blocked,
      warnings,
    },
  };
}

/** A clock that moves only when the code sleeps. */
export function clock(start = Date.parse("2026-10-28T12:00:00Z")) {
  let now = start;
  return { now: () => now, sleep: async (ms) => void (now += ms), advance: (ms) => void (now += ms) };
}

/** A storage that keeps what it is given, like the browser's. */
export function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => void values.set(key, String(value)),
    removeItem: (key) => void values.delete(key),
    values,
  };
}
