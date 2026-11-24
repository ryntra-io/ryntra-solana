import { proveWallet } from '@/city/lib/trade/proof';
import { useWallet } from '@/city/lib/trade/wallet';
import type { DriveTopic } from '@/lib/agent-drive/settings';
import type { WeekSummary } from '@/lib/agent-drive/week';

/**
 * What the drive's screens read and keep, the city's way: the week is public, as the agent's own view is; her settings
 * are hers — read and kept under her wallet's proof, one signed message asked for once, never a transaction. Nothing
 * here signs a transaction, builds one or moves money.
 */

export type { DriveTopic };

export type DriveSettingsView = Readonly<{ topics: Readonly<Record<DriveTopic, boolean>>; telegram: boolean; push: boolean; locale: 'en' | 'uk'; timezone: string; kept: boolean }>;

export type CardItem = Readonly<{
  id: string;
  coin: Readonly<{ mint: string; symbol: string | null }>;
  entryRaw: string;
  exitRaw: string;
  x: number | null;
  openedAt: number | null;
  closedAt: number;
  page: string;
  image: string;
  post: string;
  up: boolean;
}>;

export type WeekView = Readonly<{ week: WeekSummary | null; cards: readonly CardItem[] }>;

export type Failure = 'walletNo' | 'refused' | 'unreachable';
export type Kept<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; why: Failure }>;

const SETTINGS = '/api/v1/agent-drive/settings';

/** Her agents' week; null — not read, or the drive is not open here. */
export async function readWeekOf(owner: string, lang: 'en' | 'uk'): Promise<WeekView | null> {
  try {
    const response = await fetch(`/api/v1/agent-drive/week?owner=${owner}&lang=${lang}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const value = (await response.json()) as WeekView;
    return value && Array.isArray(value.cards) ? value : null;
  } catch {
    return null;
  }
}

/** A call under her wallet's proof: asked once, from her tap, when the server says it has none. */
async function proven<T>(call: () => Promise<Response>, ask: boolean): Promise<Kept<T> | null> {
  try {
    let response = await call();
    if (response.status === 401) {
      const connection = useWallet.getState().connection;
      if (!ask || !connection) return null;
      const proof = await proveWallet(connection);
      if (!proof.ok) return { ok: false, why: proof.state === 'declined' ? 'walletNo' : 'refused' };
      response = await call();
    }
    if (!response.ok) return { ok: false, why: response.status >= 500 ? 'unreachable' : 'refused' };
    return { ok: true, value: (await response.json()) as T };
  } catch {
    return { ok: false, why: 'unreachable' };
  }
}

/** Her settings; null — the wallet has not proved itself yet (and `ask` is off), or the drive is closed. */
export function readSettings(ask = false): Promise<Kept<DriveSettingsView> | null> {
  return proven<DriveSettingsView>(() => fetch(SETTINGS, { cache: 'no-store', credentials: 'same-origin' }), ask);
}

/** Keeps one change of hers. */
export async function keepSettings(change: Readonly<{ topics?: Partial<Record<DriveTopic, boolean>>; telegram?: boolean; push?: boolean; locale?: 'en' | 'uk'; timezone?: string }>): Promise<Kept<DriveSettingsView>> {
  const kept = await proven<DriveSettingsView>(
    () => fetch(SETTINGS, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) }),
    true,
  );
  return kept ?? { ok: false, why: 'refused' };
}

/** Her browser's clock, for the week to come at her hour. */
export function clockHere(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
