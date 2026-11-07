import { create } from 'zustand';
import { citySigner } from '../app-bridge/route.ts';
import { langNow } from '../i18n/lang.ts';

/**
 * «Your agent looks after it» on a SOL pier (CITY-203): the person says it once, signs once, and walks away — the agent
 * claims the fees, keeps the range around the price and leaves at the person's stop. The engine is `lib/care/**`; this
 * file is the window's half: the switch, the stop, the one approval, the cares the wallet has. Safety stays under the
 * hood in one line; the rest is behind «Details».
 */

export type CareMode = 'devnet' | 'mainnet' | 'closed';

export function careMode(value: string | undefined): CareMode {
  const v = value?.trim().toLowerCase();
  return v === 'devnet' || v === 'mainnet' ? v : 'closed';
}

export const CARE_MODE: CareMode = careMode(process.env.NEXT_PUBLIC_RYNTRA_AGENT_CARE);

/** The stops a person picks with one tap: none, or leave when the price falls this far. */
export const CARE_STOPS = [0, 10, 25] as const;
export type CareStop = (typeof CARE_STOPS)[number];

export type CareWords = Readonly<{
  title: string;
  line: string;
  safety: string;
  stop: string;
  stops: Readonly<Record<CareStop, string>>;
  give: string;
  building: string;
  wallet: string;
  sending: string;
  done: string;
  doneLine: string;
  cancelled: string;
  failed: string;
  mine: string;
  inRange: string;
  outOfRange: string;
  working: string;
  stopped: string;
  today: (claimed: string) => string;
  stopAction: string;
  details: string;
  detailsBody: readonly string[];
}>;

const EN: CareWords = {
  title: 'Your agent looks after it',
  line: 'Claims fees, pays out only to you.',
  safety: 'Funds leave only to your wallet. Stop any time.',
  stop: 'Leave if the price falls',
  stops: { 0: 'Off', 10: '−10%', 25: '−25%' },
  give: 'Give it to my agent',
  building: 'Getting it ready…',
  wallet: 'Approve in your wallet',
  sending: 'Sending…',
  done: 'Your agent is on it',
  doneLine: 'It opens the position now and looks after it every few minutes.',
  cancelled: 'Cancelled in your wallet. Nothing was sent.',
  failed: 'It did not go through. Nothing moved.',
  mine: 'Looked after by your agent',
  inRange: 'Earning',
  outOfRange: 'Moving the range',
  working: 'On it',
  stopped: 'Stopped',
  today: (claimed) => `Today ${claimed} SOL`,
  stopAction: 'Stop and take it back',
  details: 'Details',
  detailsBody: [
    'Funds leave only to your wallet. Stop any time.',
    'One approval sets it up: your SOL goes into your own smart account, and two rules on it name the one key that may act — your agent’s.',
    'The key can claim the fees, put the position back around the price in this one pool, or send everything back to your wallet. Nothing else: no swaps, no transfers, no other pool.',
    'Stop and take it back is yours alone and needs no agent. Ryntra takes no fee for looking after a position.',
  ],
};

const UK: CareWords = {
  title: 'Твій агент доглядає',
  line: 'Забирає комісії, виводить лише тобі.',
  safety: 'Кошти виходять лише на твій гаманець. Зупиниш будь-коли.',
  stop: 'Вийти, якщо ціна впаде',
  stops: { 0: 'Ні', 10: '−10%', 25: '−25%' },
  give: 'Віддати агентові',
  building: 'Готуємо…',
  wallet: 'Підтвердь у гаманці',
  sending: 'Надсилаємо…',
  done: 'Агент уже працює',
  doneLine: 'Зараз відкриє позицію й доглядатиме її кожні кілька хвилин.',
  cancelled: 'Скасовано в гаманці. Нічого не надіслано.',
  failed: 'Не вийшло. Нічого не рушило.',
  mine: 'Доглядає твій агент',
  inRange: 'Заробляє',
  outOfRange: 'Переставляє діапазон',
  working: 'Працює',
  stopped: 'Зупинено',
  today: (claimed) => `Сьогодні ${claimed} SOL`,
  stopAction: 'Зупинити й забрати',
  details: 'Деталі',
  detailsBody: [
    'Кошти виходять лише на твій гаманець. Зупиниш будь-коли.',
    'Одне схвалення все налаштовує: твої SOL ідуть на твій власний смарт-рахунок, а два правила на ньому називають один ключ, що може діяти, — ключ твого агента.',
    'Ключ може забрати комісії, поставити позицію назад біля ціни в цьому одному пулі або повернути все на твій гаманець. Більше нічого: ні обмінів, ні переказів, ні інших пулів.',
    '«Зупинити й забрати» — лише твоє, агент для цього не потрібен. Ryntra не бере комісії за догляд позиції.',
  ],
};

export const careWords = (lang: 'en' | 'uk' = langNow()): CareWords => (lang === 'uk' ? UK : EN);

/* ------------------------------------------------------------------ the store */

export type CarePhase = 'idle' | 'building' | 'wallet' | 'sending' | 'done';
export type CareNotice = 'cancelled' | 'failed' | null;

export type CareRow = Readonly<{
  key: string;
  pool: string;
  status: 'signing' | 'working' | 'stopped';
  inRange: boolean | null;
  day: Readonly<{ claimedInY: number; reinvestedInY: number; rebalances: number }>;
  /** CITY-207: the position at the venue's prices, USD — the engine's; null or absent — not priced, shown «—». */
  valueUsd?: number | null;
  unclaimedUsd?: number | null;
}>;

type Connection = Readonly<{ wallet: unknown; address: string }>;

type Store = {
  on: boolean;
  stop: CareStop;
  phase: CarePhase;
  notice: CareNotice;
  cares: readonly CareRow[] | null;
  /** The last status read did not answer: `cares` is what was read before it (or none), not a fresh «none» (CITY-209). */
  caresFailed: boolean;
  setOn: (on: boolean) => void;
  setStop: (stop: CareStop) => void;
  reset: () => void;
  give: (connection: Connection, input: Readonly<{ pool: string; lamports: bigint; width: number; shape?: string }>) => Promise<void>;
  load: (owner: string) => Promise<void>;
  takeBack: (connection: Connection, key: string) => Promise<void>;
};

const chain = () => (CARE_MODE === 'devnet' ? 'solana:devnet' : 'solana:mainnet');

async function post<T>(body: Record<string, unknown>): Promise<(T & { ok: true }) | null> {
  try {
    const response = await fetch('/api/city/earn/care', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return null;
    const json = (await response.json()) as T & { ok?: boolean };
    return json.ok ? (json as T & { ok: true }) : null;
  } catch {
    return null;
  }
}

async function signAll(connection: Connection, unsigned: readonly string[]): Promise<readonly string[] | 'cancelled'> {
  const signed = await citySigner.signTransactions({ wallet: connection.wallet as never, address: connection.address, unsignedWireBase64: [...unsigned], chain: chain() } as never);
  return signed.ok ? (signed as { signedWireBase64: readonly string[] }).signedWireBase64 : 'cancelled';
}

export const useCare = create<Store>((set, get) => ({
  on: true,
  stop: 0,
  phase: 'idle',
  notice: null,
  cares: null,
  caresFailed: false,
  setOn: (on) => set({ on, notice: null }),
  setStop: (stop) => set({ stop, notice: null }),
  reset: () => set({ phase: 'idle', notice: null }),
  async give(connection, input) {
    if (get().phase !== 'idle') return;
    set({ phase: 'building', notice: null });
    const review = await post<{ key: string; transactions: string[] }>({ action: 'review', owner: connection.address, pool: input.pool, lamports: input.lamports.toString(), ...(input.shape ? { shape: input.shape } : {}), width: input.width, stopPct: get().stop });
    if (!review) return set({ phase: 'idle', notice: 'failed' });
    set({ phase: 'wallet' });
    const signed = await signAll(connection, review.transactions);
    if (signed === 'cancelled') return set({ phase: 'idle', notice: 'cancelled' });
    set({ phase: 'sending' });
    const sent = await post<{ signatures: string[] }>({ action: 'submit', owner: connection.address, key: review.key, signed });
    if (!sent) return set({ phase: 'idle', notice: 'failed' });
    set({ phase: 'done' });
    void get().load(connection.address);
  },
  async load(owner) {
    const status = await post<{ cares: CareRow[] }>({ action: 'status', owner });
    set(status ? { cares: status.cares, caresFailed: false } : { cares: get().cares ?? [], caresFailed: true });
  },
  async takeBack(connection, key) {
    const built = await post<{ transactions: string[] }>({ action: 'stop', owner: connection.address, key });
    if (!built) return set({ notice: 'failed' });
    const signed = await signAll(connection, built.transactions);
    if (signed === 'cancelled') return set({ notice: 'cancelled' });
    /* The person's own transactions: relayed by the wallet bridge's submit, one after another. */
    for (const wire of signed) await post({ action: 'relay', owner: connection.address, key, signed: [wire] });
    void get().load(connection.address);
  },
}));

/* The dev hook the screens are taken through (`care-shots.mjs`); never in a production build. */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __care: useCare });
