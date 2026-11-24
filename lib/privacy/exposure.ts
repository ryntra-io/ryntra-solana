/**
 * What others see — for each private action, which of «who», «to whom» and «how much» the chain shows. Only what the
 * devnet runs confirmed (`docs/research/ryntra-private-2026-11-18/PROBE.md`, `scripts/privacy/inspect.mjs`), never more:
 * - hide (deposit): who and how much are seen — the wallet pays into the ring's vault in the open;
 * - return (withdrawal): to whom and how much are seen — the vault pays the wallet in the open;
 * - send (private transfer): both addresses are seen (each output carries its recipient's tag in the open); the amount
 *   and the coin are hidden;
 * - link: the sender is seen paying the link's own network fees, so the link's address is tied to the sender. Recipient
 *   and amount stay hidden only while the link is taken into a private balance; taken to a wallet, the link's address
 *   pays the wallet in the open — the chain reads sender → link → recipient and the amount;
 * - claim into a private balance: the link's address (and through it the sender) and the recipient are seen; the amount
 *   is hidden;
 * - claim to a wallet: the sender (through the link), the wallet and the amount are seen;
 * - enable: the wallet is seen registering for a private balance; no amount moves.
 * «What for» never goes on chain: a deposit's memo lies there in plain text.
 *
 * This is the private balance's one line, read from the transaction's addresses alone. The band below
 * (`bandOf`) supersedes it before a signature: it adds the coin, the three viewers, and counts the recipient
 * of a transfer as seen — Helius's documents keep the recipient public on the default ring. The line stays until the
 * band is mounted in its place.
 */

export type PrivateAction = 'enable' | 'hide' | 'return' | 'send' | 'link' | 'claimPrivate' | 'claimWallet';
/** `ifWallet` — hidden while the money stays in private balances, seen once it is taken to a wallet. */
export type Seen = 'seen' | 'hidden' | 'ifWallet' | 'none';

export type Exposure = Readonly<{ who: Seen; to: Seen; amount: Seen }>;

const EXPOSURE: Readonly<Record<PrivateAction, Exposure>> = {
  enable: { who: 'seen', to: 'none', amount: 'none' },
  hide: { who: 'seen', to: 'none', amount: 'seen' },
  return: { who: 'none', to: 'seen', amount: 'seen' },
  send: { who: 'seen', to: 'seen', amount: 'hidden' },
  link: { who: 'seen', to: 'ifWallet', amount: 'ifWallet' },
  claimPrivate: { who: 'seen', to: 'seen', amount: 'hidden' },
  claimWallet: { who: 'seen', to: 'seen', amount: 'seen' },
};

export function exposureOf(action: PrivateAction): Exposure {
  return EXPOSURE[action];
}

/** The parts the line names, in reading order, without the ones the action has nothing to say about. */
export function exposureParts(action: PrivateAction): readonly (readonly ['who' | 'to' | 'amount', Exclude<Seen, 'none'>])[] {
  const e = EXPOSURE[action];
  return (['who', 'to', 'amount'] as const).flatMap((part) => (e[part] === 'none' ? [] : [[part, e[part]] as const]));
}

/* ── The band «what others see» ──────────────────────────────────────────────────────────────────────────

   Four cells before every private signature — who, to whom, what (the coin), how much — each «seen» or «hidden»; behind
   the band's disclosure, the same four for each of three viewers. Facts, never more than they are:

   Everyone — anyone who reads the chain and the ring's public index.
   - Hide (deposit) and Return (withdrawal) cross the ring's edge: all four are seen. On devnet the depositor pays the
     ring's SOL vault in the open, the deposit names whose balance it lands in, and the vault pays the wallet back in
     the open (PROBE.md, «Депозит A», «Вихід B»).
   - Send, Payout, Invoice — one private transfer inside the ring (a payout is one transfer to up to 15, an invoice is
     paid by one): the coin and the amount are hidden (devnet: neither sum nor coin in the bytes, PROBE.md «Переказ»).
     The sender is seen — they sign it. The recipient is not in the transaction's addresses, yet it is counted «seen»:
     Helius's own documents say the default ring keeps sender and recipient public, and the SDK tags the first transfer
     to someone with that person's public key (`recipientBootstrapViewTag`), so the recipient can be matched. The honest
     line of 19.11 holds: «the amount and the coin hidden, the addresses seen, in and out seen».
   - Swap with the private desk: both addresses sign (the person and the desk's one-time address); the coins and the
     amounts are hidden. Checked locally only (PROBE.md, L2), not yet on devnet — `checked: 'local'`.
   - Swap from the private balance by a market route (`lib/privacy/swap/**`): out of the ring to the person's own wallet,
     the route, back into the ring — the ring's edge twice and an ordinary swap between: all four are seen (who, the
     coins and the amounts of the trade). What stays hidden is the rest of the private balance, and the coin bought
     lands back in it. Checked locally only (PROBE-2.md, point 6) — `checked: 'local'`. Like Hide and Return, it has no
     open twin: the mode does not change it.
   - In the open mode (ordinary Solana) everyone sees all four.

   Those you gave a view — whoever holds your viewing key reads your private history: all four.
   The proof server — Helius's prover, in its enclave, gets the whole transfer to prove it: all four (PROBE.md, L2: «each
   link sees both inputs: amounts, coins, owners»). The open mode has neither: no view to give, nothing to prove.

   Nothing here says «anonymous»: on the current ring the parties are seen. */

/** The actions a band stands before. */
export type BandAction = 'hide' | 'return' | 'send' | 'payout' | 'invoice' | 'swap' | 'routeSwap';
/** The band's four cells, in reading order. */
export type BandPart = 'who' | 'to' | 'what' | 'amount';
/** Who looks: everyone, whoever holds a view you gave, the server that computes the proof. */
export type Viewer = 'everyone' | 'viewers' | 'prover';
export type Shown = 'seen' | 'hidden';
/** The page's mode, as the toggle «Public ⇄ Private» sets it. */
export type BandMode = 'open' | 'private';
/** Where the «everyone» row was confirmed: on devnet, in a local run of the SDK only, or plain Solana. */
export type Checked = 'devnet' | 'local' | 'chain';

export type BandCell = Readonly<{ part: BandPart; shown: Shown }>;
export type BandRow = Readonly<{ viewer: Viewer; cells: readonly BandCell[] }>;
export type Band = Readonly<{
  action: BandAction;
  mode: BandMode;
  /** What everyone sees: the four cells the band shows. */
  cells: readonly BandCell[];
  /** Behind the disclosure: one row per viewer, «everyone» first. */
  rows: readonly BandRow[];
  /** Nothing is hidden from anyone: the band has nothing to tell beyond «all seen». */
  allSeen: boolean;
  checked: Checked;
}>;

export const BAND_ACTIONS: readonly BandAction[] = ['hide', 'return', 'send', 'payout', 'invoice', 'swap', 'routeSwap'];
export const BAND_PARTS: readonly BandPart[] = ['who', 'to', 'what', 'amount'];
export const VIEWERS: readonly Viewer[] = ['everyone', 'viewers', 'prover'];

type Four = Readonly<Record<BandPart, Shown>>;

const ALL_SEEN: Four = { who: 'seen', to: 'seen', what: 'seen', amount: 'seen' };
/** Inside the ring: the parties seen, the coin and the amount hidden. */
const INSIDE: Four = { who: 'seen', to: 'seen', what: 'hidden', amount: 'hidden' };

/** What everyone sees of each private action, and where that was confirmed. */
const EVERYONE: Readonly<Record<BandAction, Readonly<{ four: Four; checked: Exclude<Checked, 'chain'> }>>> = {
  hide: { four: ALL_SEEN, checked: 'devnet' },
  return: { four: ALL_SEEN, checked: 'devnet' },
  send: { four: INSIDE, checked: 'devnet' },
  payout: { four: INSIDE, checked: 'devnet' },
  invoice: { four: INSIDE, checked: 'devnet' },
  swap: { four: INSIDE, checked: 'local' },
  routeSwap: { four: ALL_SEEN, checked: 'local' },
};

/** Hide, Return and a route swap cross the private balance's edge: they have no open twin, the mode does not change them. */
const EDGE: ReadonlySet<BandAction> = new Set(['hide', 'return', 'routeSwap']);

const cellsOf = (four: Four): readonly BandCell[] => BAND_PARTS.map((part) => ({ part, shown: four[part] }));

/** The band before an action, in the page's mode. */
export function bandOf(action: BandAction, mode: BandMode = 'private'): Band {
  const open = mode === 'open' && !EDGE.has(action);
  const everyone = open ? ALL_SEEN : EVERYONE[action].four;
  const rows: BandRow[] = [{ viewer: 'everyone', cells: cellsOf(everyone) }];
  if (!open) rows.push({ viewer: 'viewers', cells: cellsOf(ALL_SEEN) }, { viewer: 'prover', cells: cellsOf(ALL_SEEN) });
  return {
    action,
    mode: open ? 'open' : 'private',
    cells: cellsOf(everyone),
    rows,
    allSeen: BAND_PARTS.every((part) => everyone[part] === 'seen'),
    checked: open ? 'chain' : EVERYONE[action].checked,
  };
}

export function isBandAction(value: unknown): value is BandAction {
  return typeof value === 'string' && (BAND_ACTIONS as readonly string[]).includes(value);
}
