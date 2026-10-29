import { reconnectWallet, registeredWallet, subscribeWallets, type ConnectResult, type WalletConnection } from "./wallet.client.ts";

/**
 * The silent restore, asked again until the wallet answers.
 *
 * It used to be asked once. A wallet that injected itself a moment late, was
 * still unlocking, or answered «no account» before it was ready got one
 * question, and the person who had connected on Home found «Підключити» on
 * the next page: «злітає… сразу користувач
 * тікає». Worse, the one question was cancelled whenever a second wallet
 * registered while the first was answering, and nothing asked again.
 *
 * Now: once at once, then on a widening delay (about 25 s in all), and — after
 * that — whenever a wallet registers or the tab comes back (`again`). Every
 * question is `connect({ silent: true })`, which must not prompt: asking again
 * is never a popup. A second wallet registering never cancels an answer in
 * flight; only `stop` does, when the connection is there or the page is gone.
 */

/** The widening retries, about 25 s in all. */
export const RESTORE_DELAYS_MS: readonly number[] = [250, 500, 1000, 2000, 4000, 8000, 10000];

export type RestoreDeps = Readonly<{
  /** The wallet the page remembers, read fresh each time: Disconnect clears it, here or in another tab. */
  hint: () => string | null;
  reconnect: (name: string) => Promise<ConnectResult>;
  registered: (name: string) => boolean;
  subscribe: (listener: () => void) => () => void;
  delays: readonly number[];
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
}>;

const DEFAULTS: Omit<RestoreDeps, "hint"> = {
  reconnect: reconnectWallet,
  registered: (name) => registeredWallet(name) !== null,
  subscribe: subscribeWallets,
  delays: RESTORE_DELAYS_MS,
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function restoreUntilAnswered(
  restored: (connection: WalletConnection) => void,
  overrides: Partial<RestoreDeps> & Pick<RestoreDeps, "hint">,
): Readonly<{ again: () => void; stop: () => void }> {
  const deps: RestoreDeps = { ...DEFAULTS, ...overrides };
  let live = true;
  let inFlight = false;
  let attempt = 0;
  let timer: unknown = null;

  const schedule = () => {
    if (!live || attempt >= deps.delays.length) return;
    if (timer !== null) deps.clearTimer(timer);
    timer = deps.setTimer(() => {
      timer = null;
      void ask();
    }, deps.delays[attempt++]);
  };

  const ask = async () => {
    if (!live || inFlight) return;
    /* Read each time: another tab may have connected another wallet, or
       disconnected, and the person's own Connect may be open (no hint then). */
    const name = deps.hint();
    if (!name) {
      schedule();
      return;
    }
    if (!deps.registered(name)) {
      schedule();
      return;
    }
    inFlight = true;
    let result: ConnectResult;
    try {
      result = await deps.reconnect(name);
    } catch {
      result = { ok: false, state: "FAILED", reason: `${name} did not restore.` };
    } finally {
      inFlight = false;
    }
    if (!live) return;
    /* Disconnected meanwhile, here or in another tab: the answer is dropped. */
    if (deps.hint() !== name) {
      schedule();
      return;
    }
    /* A silent «no» is never shown: it is asked again, quietly, a few times. */
    if (result.ok) {
      live = false;
      restored(result.connection);
    } else schedule();
  };

  void ask();
  const unsubscribe = deps.subscribe(() => void ask());

  return {
    again: () => void ask(),
    stop: () => {
      live = false;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
      unsubscribe();
    },
  };
}
