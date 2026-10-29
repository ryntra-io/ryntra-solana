/**
 * SOL-S1 — the same signed bytes, sent again until the chain shows them.
 *
 * «дуже швидко робиться обмін. Не з 5 разу».
 * A transaction this deployment broadcasts itself (`/build`'s bytes, or a
 * wallet's guarded change of the venue's) used to go out once, with the RPC's
 * own retries off, and then wait 30 s for an operator to see it — so a single
 * dropped packet between the RPC and the leader became a manual «Перевірити
 * транзакцію». Validators drop transactions under load; re-sending the same
 * bytes every couple of seconds until they land is how every Solana wallet
 * lands them.
 *
 * Why this is not a second send: the bytes are byte-for-byte the ones already
 * signed, so they carry the same signature, and the chain processes a
 * signature at most once. Nothing here can create a second transaction, move
 * a second amount, or extend the bytes' life — they still die with their
 * blockhash. The re-send keeps preflight on, so a transaction the cluster
 * would refuse is refused by the RPC and never forwarded.
 *
 * Pure apart from the four functions it is handed, so the loop is tested
 * without a network (`landing.test.mjs`).
 */

export type LandingSeen<T> = Readonly<{ seen: true; settlement: T }> | Readonly<{ seen: false; settlement: T }>;

export type LandingDeps<T> = Readonly<{
  /** The independent operator's read of the signature. */
  observe(): Promise<LandingSeen<T>>;
  /** One more send of the same signed bytes; its answer is not read. */
  resend(): Promise<unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}>;

export type LandingOptions = Readonly<{
  /** How long to keep reading and re-sending, from the first read. */
  deadlineMs: number;
  /** How often the signature is read. */
  observeEveryMs?: number;
  /** How often the same bytes go out again. */
  resendEveryMs?: number;
  /** A read the caller already made a moment ago; the loop then waits before its first own read. */
  initial?: LandingSeen<unknown>;
}>;

/** Read every 0.5 s: a 200 ms slot cluster confirms in about 1–2 s, and a 1.5 s read pace added up to 1.5 s to every swap. */
export const LANDING_OBSERVE_EVERY_MS = 500;
/** Re-send every 2 s, the pace wallets use; the leader schedule turns over every ~1.6 s. */
export const LANDING_RESEND_EVERY_MS = 2_000;

/**
 * Read, and re-send on a slower pace, until the signature is seen or the
 * deadline passes. Returns the last read and how many re-sends went out.
 */
export async function awaitLanding<T>(deps: LandingDeps<T>, options: LandingOptions): Promise<Readonly<{ last: LandingSeen<T>; resends: number }>> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const observeEvery = options.observeEveryMs ?? LANDING_OBSERVE_EVERY_MS;
  const resendEvery = options.resendEveryMs ?? LANDING_RESEND_EVERY_MS;
  const deadline = now() + options.deadlineMs;
  let resends = 0;
  let lastResendAt = now();
  let last = (options.initial as LandingSeen<T> | undefined) ?? (await deps.observe());
  while (!last.seen && now() < deadline) {
    await sleep(observeEvery);
    if (now() - lastResendAt >= resendEvery && now() < deadline) {
      lastResendAt = now();
      resends += 1;
      /* A re-send that throws changes nothing: the first send's fate is what the read below reports. */
      await deps.resend().catch(() => undefined);
    }
    last = await deps.observe();
  }
  return { last, resends };
}
