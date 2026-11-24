/**
 * The start of a paper week from the screen, as the door asks it (`lib/mandate/paper/door.server.ts`): the
 * paper week is the proven wallet's, so a wallet not proven yet signs one message first — the server's text, no
 * transaction — and then the start is asked. A proof the server no longer takes (it lapsed, or the wallet app switched
 * accounts since) is asked for once more, fresh, and the start once more; never a third time. Pure: the store hands in
 * the proof and the request (`./store.ts`), the tests their own.
 */

/** What the wallet answered the one signature (`proveWallet`'s own outcome, narrowed). */
export type ProofAnswer = Readonly<{ ok: true }> | Readonly<{ ok: false; state: 'declined' | 'failed' }>;

export type StartAnswerLike = Readonly<{ status: number; json: () => Promise<unknown> }>;

export type ProvenStartDeps = Readonly<{
  /** Whether this browser already holds the wallet's own proof (no signature needed). */
  proven: () => boolean;
  /** The one signature; `fresh` — the server refused the proof this browser thought it held: read it again first. */
  prove: (fresh: boolean) => Promise<ProofAnswer>;
  /** The wallet is about to be asked: the card says so in one line. */
  proving: () => void;
  /** The start itself. */
  post: () => Promise<StartAnswerLike>;
}>;

export type ProvenStart =
  | Readonly<{ kind: 'answer'; answer: StartAnswerLike }>
  /** The person closed the wallet or said no: nothing was asked of paper. */
  | Readonly<{ kind: 'declined' }>
  /** The wallet could not sign, or the server still took no proof. */
  | Readonly<{ kind: 'proof' }>;

/** Whether an answer of the door says «prove the wallet» (and not some other refusal). */
export async function asksProof(answer: StartAnswerLike): Promise<boolean> {
  if (answer.status === 401) return true;
  if (answer.status !== 403) return false;
  const body = (await answer.json().catch(() => null)) as { error?: { code?: unknown } } | null;
  return body?.error?.code === 'WALLET_MISMATCH';
}

export async function provenStart(deps: ProvenStartDeps): Promise<ProvenStart> {
  const sign = async (fresh: boolean): Promise<ProvenStart | null> => {
    deps.proving();
    const proof = await deps.prove(fresh).catch((): ProofAnswer => ({ ok: false, state: 'failed' }));
    if (proof.ok) return null;
    return { kind: proof.state === 'declined' ? 'declined' : 'proof' };
  };
  if (!deps.proven()) {
    const refused = await sign(false);
    if (refused) return refused;
  }
  const first = await deps.post();
  if (!(await asksProof(first))) return { kind: 'answer', answer: first };
  const refused = await sign(true);
  if (refused) return refused;
  const second = await deps.post();
  return (await asksProof(second)) ? { kind: 'proof' } : { kind: 'answer', answer: second };
}
