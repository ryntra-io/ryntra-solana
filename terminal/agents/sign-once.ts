/**
 * «Sign once to see your agents»: on a device that has not proven the wallet, the engine answers the wallet's
 * agents with 401 (`/api/bots/agents`, `lib/bots/agents-door.server.ts`) and the lists would stand empty. In their place,
 * one quiet card; its tap asks the wallet for one signed message — Ryntra's own sign-in, no transaction, nothing moves
 * (`city/lib/trade/proof.ts`) — and reads the list again. Never asked at a visit, only on the tap. Pure: the screens and
 * the tests read it as it is.
 */

export type SignSaid = 'idle' | 'asking' | 'declined' | 'failed';

/**
 * Whether the card stands: the person's own connected wallet, agents served on this deployment, and the engine's last
 * answer for it a 401 with nothing of it answered since. Without a wallet the screen keeps its «Connect» as before.
 */
export function signOnceShown(at: Readonly<{ owner: string | null; served: boolean; locked: boolean; answered: boolean }>): boolean {
  return at.owner !== null && at.served && at.locked && !at.answered;
}

/** What the tap needs: the wallet's one signed message, and the reads it opens. */
export type SignOnceDeps = Readonly<{
  /** The server's word on this browser's proof, read afresh: a proof this tab remembers may have run out. */
  refresh: () => Promise<unknown>;
  prove: () => Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; state: 'declined' | 'failed' }>>;
  /** Forget the last refusal, so the next read asks the engine again at once. */
  forget: () => void;
  /** The wallet's agents, read again; null — the engine still said nothing. */
  read: () => Promise<unknown>;
}>;

/**
 * The tap: the proof read afresh, one signed message, then the wallet's agents read again. «declined» — the person closed
 * the wallet or said no, nothing changed; «failed» — the wallet or the engine did not answer, try again; «idle» — read.
 */
export async function signOnce(deps: SignOnceDeps): Promise<Exclude<SignSaid, 'asking'>> {
  await deps.refresh().catch(() => null);
  const proof = await deps.prove().catch(() => ({ ok: false, state: 'failed' }) as const);
  if (!proof.ok) return proof.state === 'declined' ? 'declined' : 'failed';
  deps.forget();
  const read = await deps.read().catch(() => null);
  return read ? 'idle' : 'failed';
}
