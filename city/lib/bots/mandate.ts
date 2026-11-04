import { create } from 'zustand';
import { BUDGET_PRESETS, PRESETS_ON, type BudgetPresetId } from '../../../lib/mandate/presets.ts';

/**
 * The agent with a budget in the bots window (CITY-174): one tap picks the budget, the limits stand in one line, and
 * the person's wallet signs once — her smart account, the budget in its vault and the agent's policy, held on chain.
 * «Stop» is one more signature, and the rest comes back to her wallet.
 *
 * The window shows this only when the deployment says `NEXT_PUBLIC_RYNTRA_CITY_MANDATE=devnet` or `=mainnet`; the
 * engine's routes answer 404 while their own switch (`RYNTRA_AGENT_MANDATE`) is closed. Mainnet opened to everyone of 4.11.2026 (CITY-186) with one budget, 0.1 SOL a day; there the person names the coin the agent buys.
 *
 * The mandate is kept in this browser — its public addresses and numbers, never a key, apart for each network — and
 * read back from the chain while the window is open. The signing is `mandate-sign.ts` and its checks `mandate-check.ts`, loaded on the tap: the
 * frame's first load carries no transaction code.
 */

export type MandateNetwork = 'devnet' | 'mainnet';

/** The network a switch's value opens: `devnet`, `mainnet`, or nothing. */
export function mandateNetwork(value: string | undefined): MandateNetwork | null {
  const said = value?.trim();
  return said === 'devnet' || said === 'mainnet' ? said : null;
}

export const MANDATE_NET: MandateNetwork | null = mandateNetwork(process.env.NEXT_PUBLIC_RYNTRA_CITY_MANDATE);
/** The Wallet Standard chain the wallet signs for. */
export const MANDATE_CHAIN: 'solana:devnet' | 'solana:mainnet' = MANDATE_NET === 'mainnet' ? 'solana:mainnet' : 'solana:devnet';

/** The budgets this deployment's network offers: all three on devnet, 0.1 SOL a day on mainnet. */
export const MANDATE_PRESETS: readonly BudgetPresetId[] = PRESETS_ON[MANDATE_NET ?? 'devnet'];

/** The coin the agent buys on mainnet, as the person named it: a tower of the city, never SOL or USDC. */
export type MandateCoin = Readonly<{ mint: string; symbol: string; icon: string | null }>;

export type MandateRecord = Readonly<{
  owner: string;
  settings: string;
  vault: string;
  policy: string;
  budget: string;
  perTrade: string;
  perDay: string;
  expiresAt: string;
}>;

export type MandateStatus = Readonly<{ active: boolean; budgetLamports: string | null }>;
export type MandateNote = Readonly<{ kind: 'on' | 'stopped' | 'walletNo' | 'refused' | 'unreachable'; at: number }> | null;

/** Devnet keeps the key it always had; mainnet's mandates are never read as devnet's, nor devnet's as mainnet's. */
export const keyFor = (network: MandateNetwork | null): string => (network === 'mainnet' ? 'ryntra.city.mandate.mainnet.v1' : 'ryntra.city.mandate.v1');
const KEY = keyFor(MANDATE_NET);
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DIGITS = /^\d{1,20}$/;

export const isMandateRecord = (value: unknown): value is MandateRecord => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (['owner', 'settings', 'vault', 'policy', 'budget'] as const).every((k) => typeof v[k] === 'string' && ADDRESS.test(v[k] as string)) && (['perTrade', 'perDay', 'expiresAt'] as const).every((k) => typeof v[k] === 'string' && DIGITS.test(v[k] as string));
};

type Kept = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const kept = (): Kept | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

type MandateState = {
  preset: BudgetPresetId;
  /** Mainnet: the coin the agent buys; null — not named yet. */
  coin: MandateCoin | null;
  /** Kept per wallet: a wallet sees its own mandate only. */
  records: Readonly<Record<string, MandateRecord>>;
  status: Readonly<Record<string, MandateStatus>>;
  busy: 'enable' | 'stop' | null;
  note: MandateNote;
  hydrated: boolean;
  setPreset: (preset: BudgetPresetId) => void;
  setCoin: (coin: MandateCoin | null) => void;
  hydrate: () => void;
  keep: (record: MandateRecord) => void;
  setStatus: (policy: string, status: MandateStatus) => void;
  setBusy: (busy: MandateState['busy']) => void;
  say: (note: MandateNote) => void;
};

export function createMandateStore(options: Readonly<{ storage?: () => Kept | null }> = {}) {
  const store = options.storage ?? kept;
  return create<MandateState>((set, get) => ({
    preset: MANDATE_PRESETS.includes('medium') ? 'medium' : MANDATE_PRESETS[0]!,
    coin: null,
    records: {},
    status: {},
    busy: null,
    note: null,
    hydrated: false,
    setPreset: (preset) => set({ preset: MANDATE_PRESETS.includes(preset) ? preset : MANDATE_PRESETS[0]! }),
    setCoin: (coin) => set({ coin }),
    hydrate: () => {
      if (get().hydrated) return;
      let records: Record<string, MandateRecord> = {};
      try {
        const parsed: unknown = JSON.parse(store()?.getItem(KEY) ?? '{}');
        if (typeof parsed === 'object' && parsed !== null) records = Object.fromEntries(Object.entries(parsed).filter(([owner, record]) => isMandateRecord(record) && record.owner === owner)) as Record<string, MandateRecord>;
      } catch {
        records = {};
      }
      set({ hydrated: true, records });
    },
    keep: (record) => {
      const records = { ...get().records, [record.owner]: record };
      set({ records });
      try {
        store()?.setItem(KEY, JSON.stringify(records));
      } catch {
        /* Not kept: the mandate stands on chain all the same; this browser forgets where. */
      }
    },
    setStatus: (policy, status) => set({ status: { ...get().status, [policy]: status } }),
    setBusy: (busy) => set({ busy }),
    say: (note) => set({ note }),
  }));
}

export const useMandate = createMandateStore();

/** The limits of a preset, as the one line shows them (lamports → SOL). */
export function presetLimits(id: BudgetPresetId): Readonly<{ budget: number; perTrade: number; perDay: number; days: number }> {
  const preset = BUDGET_PRESETS[id];
  return { budget: Number(preset.budget) / 1e9, perTrade: Number(preset.perTrade) / 1e9, perDay: Number(preset.perDay) / 1e9, days: preset.days };
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __mandate: useMandate });
