import { create } from 'zustand';

/**
 * The person's trading choices, kept on this device (CITY-87, `docs/research/ryntra-city-helm-2026-10-29/SPEC.md`
 * §8, §10): the ⚡ amount — what a buy paid in SOL starts at — the four sale chips, and the style. Only the trade
 * window's own figures change: the amount on the ticket and its chips. What is signed is still exactly what the
 * ticket shows, built by the engine, as before; nothing here signs or sends.
 *
 * The style is «Safe» — the engine's own slippage, priority and protection. «Fast» and «Sniper» ask the swap engine
 * for its own settings, which it does not take from the city yet; the window shows them closed.
 */

/** The ⚡ amounts the window offers, in SOL. */
export const BOLT_STEPS = ['0.05', '0.1', '0.25', '0.5', '1'] as const;
export const BOLT_START = '0.1';

/** The sale chips until the person changes them: a quarter, a half, three quarters, all. */
export const SELL_START = [25, 50, 75, 100] as const;

export const STYLES = ['safe', 'fast', 'sniper'] as const;
export type Style = (typeof STYLES)[number];
/** The styles the engine takes today. */
export const OPEN_STYLES: readonly Style[] = ['safe'];

export type TradePrefs = Readonly<{
  /** SOL, as the person reads it: «0.1». */
  bolt: string;
  /** Four whole percentages, smallest first, all different; the last is 100, «MAX». */
  sells: readonly number[];
  style: Style;
}>;

export const TRADE_KEY = 'ryntra.city.trade';
export const TRADE_VERSION = 1;

const LAMPORTS = 1_000_000_000n;
/** The least and the most a ⚡ amount may be, in lamports: 0.001 SOL to 1,000 SOL. */
const BOLT_MIN = 1_000_000n;
const BOLT_MAX = 1_000n * LAMPORTS;

export function defaultTrade(): TradePrefs {
  return { bolt: BOLT_START, sells: [...SELL_START], style: 'safe' };
}

/** A SOL amount as lamports; null when it is not a plain decimal of at most nine places. */
export function lamportsOf(text: string): bigint | null {
  const match = /^(\d{1,4})(?:\.(\d{1,9}))?$/.exec(text.trim());
  if (!match) return null;
  return BigInt(match[1]!) * LAMPORTS + BigInt((match[2] ?? '').padEnd(9, '0'));
}

/** A ⚡ amount the window can keep: a plain decimal between 0.001 and 1,000 SOL, written without trailing zeros. */
export function cleanBolt(text: string): string | null {
  const raw = lamportsOf(text);
  if (raw === null || raw < BOLT_MIN || raw > BOLT_MAX) return null;
  const whole = raw / LAMPORTS;
  const part = (raw % LAMPORTS).toString().padStart(9, '0').replace(/0+$/, '');
  return part ? `${whole}.${part}` : whole.toString();
}

/**
 * Four sale chips the card can show: three whole percentages 1–99 of the person's own, all different, smallest first,
 * and MAX — 100 — always last, so a sale that starts at all of it has its chip lit. Null otherwise.
 */
export function cleanSells(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== SELL_START.length) return null;
  if (!value.every((n) => Number.isInteger(n) && n >= 1 && n <= 100)) return null;
  const sorted = [...(value as number[])].sort((a, b) => a - b);
  if (sorted[sorted.length - 1] !== 100 || sorted.filter((n) => n === 100).length !== 1) return null;
  return new Set(sorted).size === sorted.length ? sorted : null;
}

/** How many of the sale chips the person sets: all but MAX. */
export const OWN_SELLS = SELL_START.length - 1;

export function sanitizeTrade(raw: unknown): TradePrefs {
  const kept = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const base = defaultTrade();
  const bolt = typeof kept.bolt === 'string' ? cleanBolt(kept.bolt) : null;
  const style = (OPEN_STYLES as readonly unknown[]).includes(kept.style) ? (kept.style as Style) : base.style;
  return { bolt: bolt ?? base.bolt, sells: cleanSells(kept.sells) ?? base.sells, style };
}

type StorageLike = Readonly<{ getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }>;

export function readTrade(storage: StorageLike | null | undefined): TradePrefs {
  try {
    const raw = storage?.getItem(TRADE_KEY);
    return raw ? sanitizeTrade(JSON.parse(raw)) : defaultTrade();
  } catch {
    return defaultTrade();
  }
}

export function writeTrade(storage: StorageLike | null | undefined, prefs: TradePrefs): boolean {
  if (!storage) return false;
  try {
    storage.setItem(TRADE_KEY, JSON.stringify({ v: TRADE_VERSION, ...prefs }));
    return true;
  } catch {
    return false;
  }
}

/* ---------- The store: read once on the device, every change kept at once ---------- */

type TradeStore = {
  prefs: TradePrefs;
  ready: boolean;
  /** A new ⚡ amount; false when it is not one the window can keep. */
  setBolt: (text: string) => boolean;
  /** One sale chip changed; false when the four would not be four different whole percentages. */
  setSell: (index: number, value: number) => boolean;
  setStyle: (style: Style) => boolean;
};

let storage: StorageLike | null = null;

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const useTradePrefs = create<TradeStore>((set, get) => {
  const keep = (prefs: TradePrefs) => {
    writeTrade(storage, prefs);
    set({ prefs });
  };
  return {
    prefs: defaultTrade(),
    ready: false,
    setBolt: (text) => {
      const bolt = cleanBolt(text);
      if (!bolt) return false;
      keep({ ...get().prefs, bolt });
      return true;
    },
    setSell: (index, value) => {
      const next = [...get().prefs.sells];
      if (index < 0 || index >= OWN_SELLS) return false;
      next[index] = value;
      const sells = cleanSells(next);
      if (!sells) return false;
      keep({ ...get().prefs, sells });
      return true;
    },
    setStyle: (style) => {
      if (!OPEN_STYLES.includes(style)) return false;
      keep({ ...get().prefs, style });
      return true;
    },
  };
});

/** Reads the kept choices once; later calls do nothing. Tests hand in their own storage. */
export function hydrateTrade(given?: StorageLike | null): void {
  if (useTradePrefs.getState().ready && given === undefined) return;
  storage = given === undefined ? browserStorage() : given;
  useTradePrefs.setState({ prefs: readTrade(storage), ready: true });
}

/** The choices as they stand, read once from the device the first time the trade card asks. */
export function tradePrefsNow(): TradePrefs {
  if (!useTradePrefs.getState().ready && typeof window !== 'undefined') hydrateTrade();
  return useTradePrefs.getState().prefs;
}

/** The ⚡ amount in lamports: where a buy paid in SOL starts. */
export function boltLamports(prefs: TradePrefs = tradePrefsNow()): bigint {
  return lamportsOf(prefs.bolt) ?? lamportsOf(BOLT_START)!;
}
