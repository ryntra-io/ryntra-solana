/**
 * Build, then sign — and if the bytes aged out while the wallet was open,
 * build once more and sign the fresh bytes instead of sending dead ones.
 *
 * For the places that build and open the wallet in one press (a launch, a
 * trade or an entry on a launch's pool, a creator's claim, a payment link):
 * there is no Review screen for the bytes to age on, only the wallet. Bytes
 * live ~30 s (`blockhash-life.ts`); a person who takes longer than that in
 * their wallet used to meet the network's refusal. Now the page builds again
 * and asks the wallet once more, and the old signature — never sent, held by
 * nobody else — dies with its blockhash.
 *
 * Bounded: two builds at most by default, so a slow wallet cannot turn this
 * into a loop of prompts.
 */

import { MAX_SIGNABLE_WINDOW_MS, mayOpenWallet, signableWindowClosed } from "./blockhash-life.ts";

export type FreshSign<S> = Readonly<{ ok: true; value: S }> | Readonly<{ ok: false; reason: string }>;

export type FreshSigned<B, S, F> =
  | Readonly<{ ok: true; built: B; signed: S; builds: number }>
  | Readonly<{ ok: false; stage: "build"; failure: F }>
  | Readonly<{ ok: false; stage: "sign"; reason: string }>
  /* Every build aged out before or while the wallet answered: nothing was sent. */
  | Readonly<{ ok: false; stage: "aged" }>;

export async function signFreshBytes<B, S, F extends Readonly<{ ok: false }>>(args: Readonly<{
  build: () => Promise<Readonly<{ ok: true; data: B }> | F>;
  /** How long from arriving the build may still be signed; absent from an older server — one ~30 s life. */
  signableMsOf: (built: B) => number | null | undefined;
  sign: (built: B) => Promise<FreshSign<S>>;
  /**
   * Told before a second build, so the screen can say why: `"late"` — the wallet answered after the bytes' window and
   * will be asked again; `"short"` — the bytes arrived with too little of their life for a wallet, none was asked.
   */
  onRebuild?: (reason: "late" | "short") => void;
  builds?: number;
  now?: () => number;
}>): Promise<FreshSigned<B, S, F>> {
  const now = args.now ?? Date.now;
  const limit = Math.max(1, Math.floor(args.builds ?? 2));
  let why: "late" | "short" | null = null;
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    if (why) args.onRebuild?.(why);
    const built = await args.build();
    if (!built.ok) return { ok: false, stage: "build", failure: built };
    /* The server measured the window at the end of its build, so it counts from the answer's arrival — the round trip
       is not taken off twice. */
    const receivedAtMs = now();
    const given = args.signableMsOf(built.data);
    const signableMs = typeof given === "number" && Number.isFinite(given) ? given : MAX_SIGNABLE_WINDOW_MS;
    if (!mayOpenWallet({ receivedAtMs, signableMs, nowMs: now() })) {
      why = "short";
      continue;
    }
    const signed = await args.sign(built.data);
    if (!signed.ok) return { ok: false, stage: "sign", reason: signed.reason };
    if (signableWindowClosed({ receivedAtMs, signableMs, nowMs: now() })) {
      why = "late";
      continue;
    }
    return { ok: true, built: built.data, signed: signed.value, builds: attempt };
  }
  return { ok: false, stage: "aged" };
}
