/**
 * The person's Predictions profile in their account: the settings
 * (`preferences.ts`) and the market page's layouts, one record per proven
 * wallet, compare-and-set. Of two copies of the settings, or of one page's
 * layout, the later change wins — so a slow device never writes an older
 * choice over a newer one.
 *
 * Kept in the watchlists' collection under its own key (`profile:<wallet>`):
 * the store's list of collections is not the line's to extend, and the two
 * records never share a key.
 *
 * Server only.
 */

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { failure } from "./failure.ts";
import { LAYOUT_PAGES_LIMIT, clampPrefs, layoutDate, mergePrefs, parsePrefs, storableLayout, type PredictPrefs } from "./preferences.ts";
import type { Result } from "./provider.ts";

export type ProfileRecord = Readonly<{
  version: number;
  wallet: string;
  prefs: PredictPrefs | null;
  layouts: Readonly<Record<string, Record<string, unknown>>>;
  updatedAt: string;
}>;

export type Profile = Readonly<{ prefs: PredictPrefs | null; layouts: Readonly<Record<string, Record<string, unknown>>> }>;

export type ProfileChange = Readonly<{ prefs?: unknown; layout?: Readonly<{ page: string; value: unknown }> }>;

function collection(store: GuardStore) {
  return store.versioned<ProfileRecord>("predictionWatchlists");
}

const keyOf = (wallet: string) => `profile:${wallet}`;

/** How far ahead of the server's clock a device's date may be. */
const CLOCK_MARGIN_MS = 60_000;

function profileOf(row: ProfileRecord | null | undefined): Profile {
  return { prefs: row?.prefs ? parsePrefs(row.prefs) : null, layouts: row?.layouts ?? {} };
}

export async function readProfile(store: GuardStore, wallet: string): Promise<Result<Profile>> {
  try {
    return { ok: true, value: profileOf(await collection(store).get(keyOf(wallet))) };
  } catch {
    return failure("UNAVAILABLE", "The settings could not be read; try again.");
  }
}

/**
 * Merges a change into the stored profile: each setting if it was chosen
 * later than the stored one, a page's layout if it is later than that page's.
 * Dates are taken no later than the server's clock (and a minute), so a
 * device whose clock runs ahead does not win by it. The answer is the profile
 * as it stands after, so the browser can take what is newer there.
 */
export async function saveProfile(store: GuardStore, wallet: string, change: ProfileChange, nowMs: number = Date.now()): Promise<Result<Profile>> {
  const key = keyOf(wallet);
  const at = new Date(nowMs).toISOString();
  const limit = nowMs + CLOCK_MARGIN_MS;
  const prefs = change.prefs === undefined ? null : clampPrefs(parsePrefs(change.prefs), limit);
  const sent = change.layout ? storableLayout(change.layout.value) : null;
  const layout = sent && layoutDate(sent) > limit ? { ...sent, updatedAt: limit } : sent;
  try {
    const result = await withBoundedCasRetry(async () => {
      const current = await collection(store).get(key);
      const stored = profileOf(current);
      const nextPrefs = prefs ? mergePrefs(stored.prefs, prefs) : stored.prefs;
      let layouts = stored.layouts;
      if (change.layout && layout && layoutDate(layout) > layoutDate(stored.layouts[change.layout.page])) {
        const others = Object.keys(stored.layouts).filter((page) => page !== change.layout?.page);
        // A bounded number of pages: the oldest goes first when a new one would pass the limit.
        const kept = others.sort((a, b) => layoutDate(stored.layouts[b]) - layoutDate(stored.layouts[a])).slice(0, LAYOUT_PAGES_LIMIT - 1);
        layouts = { ...Object.fromEntries(kept.map((page) => [page, stored.layouts[page]!])), [change.layout.page]: layout };
      }
      if (current && nextPrefs === stored.prefs && layouts === stored.layouts) return stored;
      const record: ProfileRecord = { version: (current?.version ?? 0) + 1, wallet, prefs: nextPrefs, layouts, updatedAt: at };
      const ok = current ? await collection(store).compareAndSet(key, current.version, record) : await collection(store).insertIfAbsent(key, record);
      return ok ? profileOf(record) : false;
    });
    return { ok: true, value: result };
  } catch {
    return failure("UNAVAILABLE", "The settings could not be saved; try again.");
  }
}
