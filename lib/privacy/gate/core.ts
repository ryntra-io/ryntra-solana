/**
 * Ryntra Private — the rules before people's money. One pure decision per move, the same on the server, in
 * the browser and in the test-network pass: «pass», «refuse», or «back» — only back to the person's own wallet.
 *
 * Why: the ring's protocol checks no address at all, and the largest private pool on Solana took stolen funds after an
 * exchange hack and had to stop deposits (`docs/research/private-payments-2026-11-19/SOLANA.md`, 3.3–3.4). So Ryntra
 * keeps its own rules in front of the ring:
 * - «Hide» (into the ring): refused while deposits are paused, from a flagged address, when the list source did not
 *   answer, and above the starting cap of a person's private balance.
 * - «Return» to the person's own wallet: always open — paused, flagged or unanswered. Nothing is asked for it.
 * - Out to anyone else (a private send, a link, a withdrawal to another address): a flagged owner may only go back to
 *   their own wallet; a flagged recipient is refused; an unanswered check holds the move — the own wallet stays open.
 *
 * Silence is never a silent yes or a silent no: an unanswered check refuses the move with its own line («the check is
 * not answering — nothing moved, try again in a minute»), and returning to one's own wallet never waits for it.
 *
 * The rules look at addresses only — never at a country or a place.
 * They hold on Ryntra's screens; the ring itself stays open to anyone with the SDK, which is why a ring of Ryntra's
 * own with lists at the protocol level is a separate step.
 */

/** What the list source says about one address. `unchecked` — it did not answer in time, or no answer came at all. */
export type Mark = 'clear' | 'flagged' | 'unchecked';

/** пропустити · відмовити · лише назад на свою адресу */
export type Verdict = 'pass' | 'refuse' | 'back';

/** Why a move did not pass — each has one line for the person (`terminal/portfolio/private/words.ts`). */
export type GateCode =
  | 'GATE_FLAGGED' // «Hide» from a flagged address
  | 'GATE_FLAGGED_TO' // out to a flagged address
  | 'GATE_BACK_ONLY' // a flagged owner, out to anyone but themselves
  | 'GATE_PAUSED' // new deposits are paused
  | 'GATE_UNCHECKED' // the check did not answer
  | 'GATE_OVER_CAP'; // above the starting cap

export type Decision =
  | Readonly<{ verdict: 'pass' }>
  /** `room` — for `GATE_OVER_CAP` only: how much more may still be hidden, in lamports. */
  | Readonly<{ verdict: 'refuse' | 'back'; code: GateCode; room?: bigint }>;

/**
 * The starting cap of a person's private balance, in lamports at today's price. `null` — no cap is set; `lamports: null`
 * — a cap is set but could not be priced now (no price, or a setting that does not read as an amount).
 */
export type Cap = Readonly<{ lamports: bigint | null }> | null;

/** What the gate answers: the pause, the cap, and a mark for each address asked. It never says which list marked one. */
export type GateAnswer = Readonly<{ paused: boolean; cap: Cap; marks: Readonly<Record<string, Mark>> }>;

/**
 * A move as the gate sees it. `to` is where the money goes: the owner's own address for «Return», another wallet for a
 * private send, `null` for a link (whoever opens it is not known when it is made).
 */
export type GateMove =
  | Readonly<{ kind: 'hide'; owner: string; amount: bigint }>
  | Readonly<{ kind: 'return' | 'send'; owner: string; to: string | null }>;

/** A Solana address as text: base58, 32–44 characters. */
export const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The most addresses one question carries: the owner and one recipient. */
export const MAX_ADDRESSES = 2;

const PASS: Decision = Object.freeze({ verdict: 'pass' });

function no(verdict: 'refuse' | 'back', code: GateCode, room?: bigint): Decision {
  return room === undefined ? { verdict, code } : { verdict, code, room };
}

/** The addresses a move needs marked. Back to the owner's own wallet needs none: it is always open. */
export function addressesOf(move: GateMove): readonly string[] {
  if (move.kind === 'hide') return [move.owner];
  if (move.to === move.owner) return [];
  return move.to === null ? [move.owner] : [move.owner, move.to];
}

function markOf(answer: GateAnswer | null, address: string): Mark {
  return answer?.marks[address] ?? 'unchecked';
}

/**
 * The decision for one move. `answer` — the gate's answer, `null` when it gave none; `held` — what the person's private
 * balance holds now, in lamports, read only when a cap is set (the server never learns it).
 */
export function decide(move: GateMove, answer: GateAnswer | null, held: bigint | null = null): Decision {
  if (move.kind === 'hide') {
    if (!answer) return no('refuse', 'GATE_UNCHECKED');
    if (answer.paused) return no('refuse', 'GATE_PAUSED');
    const mark = markOf(answer, move.owner);
    if (mark === 'flagged') return no('refuse', 'GATE_FLAGGED');
    if (mark !== 'clear') return no('refuse', 'GATE_UNCHECKED');
    if (answer.cap) {
      if (answer.cap.lamports === null || held === null) return no('refuse', 'GATE_UNCHECKED');
      const room = answer.cap.lamports > held ? answer.cap.lamports - held : 0n;
      if (move.amount > room) return no('refuse', 'GATE_OVER_CAP', room);
    }
    return PASS;
  }
  // Back to the person's own wallet: always open — paused, flagged or unanswered.
  if (move.to === move.owner) return PASS;
  const from = markOf(answer, move.owner);
  const to: Mark = move.to === null ? 'clear' : markOf(answer, move.to);
  if (to === 'flagged') return no('refuse', 'GATE_FLAGGED_TO');
  if (from === 'flagged') return no('back', 'GATE_BACK_ONLY');
  if (from !== 'clear' || to !== 'clear') return no('back', 'GATE_UNCHECKED');
  return PASS;
}

/** The answer's own words for the addresses asked: anything missing or unknown reads `unchecked`, never `clear`. */
export function readAnswer(body: unknown, asked: readonly string[]): GateAnswer | null {
  if (typeof body !== 'object' || body === null) return null;
  const { paused, cap, marks } = body as { paused?: unknown; cap?: unknown; marks?: unknown };
  if (typeof paused !== 'boolean') return null;
  let readCap: Cap;
  if (cap === null) readCap = null;
  else if (typeof cap === 'object' && cap !== null && 'lamports' in cap) {
    const lamports = (cap as { lamports: unknown }).lamports;
    readCap = { lamports: typeof lamports === 'string' && /^\d{1,19}$/.test(lamports) ? BigInt(lamports) : null };
  } else return null;
  const given = typeof marks === 'object' && marks !== null ? (marks as Record<string, unknown>) : {};
  const out: Record<string, Mark> = {};
  for (const address of asked) {
    const mark = given[address];
    out[address] = mark === 'clear' || mark === 'flagged' ? mark : 'unchecked';
  }
  return { paused, cap: readCap, marks: out };
}

/** The answer as JSON: amounts as decimal text, so nothing is rounded on the way. */
export function answerJson(answer: GateAnswer): Readonly<{ paused: boolean; cap: { lamports: string | null } | null; marks: Readonly<Record<string, Mark>> }> {
  return {
    paused: answer.paused,
    cap: answer.cap ? { lamports: answer.cap.lamports === null ? null : answer.cap.lamports.toString() } : null,
    marks: answer.marks,
  };
}
