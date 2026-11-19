/**
 * What others see — for each private action, which of «who», «to whom» and «how much» the chain shows. Only what the
 * devnet runs confirmed (`docs/research/ryntra-private-2026-11-18/PROBE.md`, `scripts/privacy/inspect.mjs`), never more:
 * - hide (deposit): who and how much are seen — the wallet pays into the ring's vault in the open;
 * - return (withdrawal): to whom and how much are seen — the vault pays the wallet in the open;
 * - send (private transfer): only the sender is seen; recipient and amount are hidden;
 * - link: the sender is seen paying the link's own network fees, so the link's address is tied to the sender. Recipient
 *   and amount stay hidden only while the link is taken into a private balance; taken to a wallet, the link's address
 *   pays the wallet in the open — the chain reads sender → link → recipient and the amount;
 * - claim into a private balance: only the link's address (and through it the sender) is seen;
 * - claim to a wallet: the sender (through the link), the wallet and the amount are seen;
 * - enable: the wallet is seen registering for a private balance; no amount moves.
 * «What for» never goes on chain: a deposit's memo lies there in plain text.
 */

export type PrivateAction = 'enable' | 'hide' | 'return' | 'send' | 'link' | 'claimPrivate' | 'claimWallet';
/** `ifWallet` — hidden while the money stays in private balances, seen once it is taken to a wallet. */
export type Seen = 'seen' | 'hidden' | 'ifWallet' | 'none';

export type Exposure = Readonly<{ who: Seen; to: Seen; amount: Seen }>;

const EXPOSURE: Readonly<Record<PrivateAction, Exposure>> = {
  enable: { who: 'seen', to: 'none', amount: 'none' },
  hide: { who: 'seen', to: 'none', amount: 'seen' },
  return: { who: 'none', to: 'seen', amount: 'seen' },
  send: { who: 'seen', to: 'hidden', amount: 'hidden' },
  link: { who: 'seen', to: 'ifWallet', amount: 'ifWallet' },
  claimPrivate: { who: 'seen', to: 'hidden', amount: 'hidden' },
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
