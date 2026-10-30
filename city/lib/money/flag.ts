/**
 * Money in the city (CITY-63): five tabs on Ryntra's own money engine. Three paths move money — Send, Bridge, and Top
 * up's address on another network (a deposit Relay fills into this wallet) — and open to people only where the
 * deployment's switch says `open` (`NEXT_PUBLIC_RYNTRA_CITY_MONEY`), after the owner's canary with a small amount
 * (spec §18.3). Until then Send and Bridge say they open soon, Top up shows only the wallet's own Solana address, and
 * none of the three asks the engine anything. Activity and Portfolio only read: they are open with the window itself.
 */

/**
 * The tabs: Top up and Send each have two ways — Solana and another network —
 * so the Bridge is Send's second way, not a tab; Pay link asks for a payment.
 */
export const MONEY_TABS = ['topup', 'send', 'paylink', 'activity', 'portfolio'] as const;
export type MoneyTab = (typeof MONEY_TABS)[number];

/** What may ask for a tab: the tabs, and «bridge» — an old address of Send's way to another network. */
export type MoneyAsk = MoneyTab | 'bridge';

/** The tabs that move money: behind the switch. */
export const MONEY_PATHS: ReadonlySet<MoneyTab> = new Set<MoneyTab>(['send']);

export function moneyOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

export const MONEY_OPEN = moneyOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_MONEY);

/** Whether a tab works here: a tab that moves money only with the switch open; the rest always. */
export function tabLive(tab: MoneyTab, open: boolean = MONEY_OPEN): boolean {
  return !MONEY_PATHS.has(tab) || open;
}

/** Every path that moves money, behind the one switch: the two tabs, and a deposit from another network on Top up. */
export const MONEY_FLOWS = ['send', 'bridge', 'deposit'] as const;
export type MoneyFlow = (typeof MONEY_FLOWS)[number];

/** Whether a money path works here: only with the switch open. */
export function flowLive(flow: MoneyFlow, open: boolean = MONEY_OPEN): boolean {
  return (MONEY_FLOWS as readonly string[]).includes(flow) && open;
}

export function isMoneyTab(value: unknown): value is MoneyTab {
  return typeof value === 'string' && (MONEY_TABS as readonly string[]).includes(value);
}

export function isMoneyAsk(value: unknown): value is MoneyAsk {
  return value === 'bridge' || isMoneyTab(value);
}
