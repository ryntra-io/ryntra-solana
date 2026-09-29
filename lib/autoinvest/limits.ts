/**
 * «Автоінвест»'s bounds (`RYN-INVEST-SIMPLE-001`, sessions 3–4) — the contract
 * re-exports them (1.12.0 and 1.13.0, `capabilities.rules`), and a page reads
 * them from here so it carries no schema library. Pure and client-safe.
 */

/** How many rules one wallet may hold, paused ones included. */
export const RULE_LIST_LIMIT = 20;
/** How many occurrences a rule keeps, newest first on the wire. */
export const RULE_OCCURRENCES_KEPT = 12;
/**
 * The least a rule's purchase is — a dollar (canon v5.5 В35: «Кожний день по
 * долару»; 1.16.0, it was $10 from the v5.0 draft) — and the most. A company
 * whose live route starts above a dollar says its own minimum from the quote
 * before a rule is turned on.
 */
export const RULE_MINIMUM_USD = 1;
export const RULE_MAXIMUM_USD = 100_000;
/** The sum a new rule's sheet opens on — $10 (the Owner's word, 2026-09-25); a default, not advice: the sum and how often are the person's own, from a dollar. */
export const RULE_DEFAULT_USD = 10;

/** «Якщо впаде» (1.13.0): how far below its reference point a price must fall, in whole per cent, and the falls the sheet offers. */
export const RULE_DIP_MIN_PCT = 1;
export const RULE_DIP_MAX_PCT = 50;
export const RULE_DIP_PRESETS_PCT = [5, 10, 15, 20] as const;

/**
 * «Умова ціни» (1.18.0, canon v5.5 В37): how far above its reference a price
 * may stand for a rule to offer its purchase, in whole per cent — the limit a
 * new rule's sheet opens on (the canon's «типово 5 %»), the least and the
 * most, and the limits the sheet offers — and how old the price and its
 * reference may be, in minutes.
 */
export const PRICE_CONDITION_DEFAULT_PCT = 5;
export const PRICE_CONDITION_MIN_PCT = 1;
export const PRICE_CONDITION_MAX_PCT = 50;
export const PRICE_CONDITION_PRESETS_PCT = [2, 5, 10] as const;
export const PRICE_CONDITION_MAX_AGE_MINUTES = 30;

/**
 * «З кожної оплати» (1.19.0, canon v5.5 В38): round every payment up to the
 * next $1 or $5; a fixed sum from every payment — the least, the most and the
 * sums the sheet offers; a per cent of every USDC that comes in — the least,
 * the most and the per cents the sheet offers; how many counted events a rule
 * keeps to show; and the least a movement is to be an event at all — a cent.
 */
export const PAYMENT_ROUNDUP_STEPS_USD = [1, 5] as const;
export const PAYMENT_FIXED_MIN_USD = 0.1;
export const PAYMENT_FIXED_MAX_USD = 100;
export const PAYMENT_FIXED_PRESETS_USD = [1, 2, 5] as const;
export const PAYMENT_PERCENT_MIN = 1;
export const PAYMENT_PERCENT_MAX = 50;
export const PAYMENT_PERCENT_PRESETS = [5, 10, 20] as const;
export const PAYMENT_EVENTS_KEPT = 12;
/** How many events waiting for a reminder a rule lists — beyond it the oldest still count in the sum, unlisted. */
export const PAYMENT_QUEUE_LISTED = 100;
export const PAYMENT_EVENT_MIN_USD = 0.01;
/** How many of the person's own other accounts a wallet may name, so a transfer to or from them is never counted. */
export const PAYMENT_OWN_ACCOUNTS_LIMIT = 20;

/**
 * «Бюджет місяця» (1.13.0): the least and the most a month's ceiling is (a
 * dollar since 1.16.0, canon v5.5 В35), and the ceilings the sheets offer —
 * the first is «щодня по $1» for the longest month, so a dollar a day is never
 * held on the 31st.
 */
export const BUDGET_MINIMUM_USD = 1;
export const BUDGET_MAXIMUM_USD = 1_000_000;
export const BUDGET_PRESETS_USD = [31, 50, 100, 200] as const;
