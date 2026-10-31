import type {
  LaunchCabinetRow,
  LaunchClaimBuildResponse,
  LaunchClaimReceipt,
  LaunchClaimReviewResponse,
  LaunchCreatorCabinetResponse,
  LaunchMarketRow,
} from '../../../lib/api/v1/contract.ts';
import { EARNINGS_CARD_SOURCE } from '../../../lib/core/launch/earnings-card.ts';
import type { BerthEngine } from './berth.ts';
import type { Answer, LaunchEngine } from './engine.ts';
import { stubAddress, stubSignature } from './stub.ts';

/**
 * A stand-in for the engine's creator cabinet and claim, beside the stub Launch engine (`stub.ts`): development and
 * tests only, every answer in the shape of the v1 contract, the stub wallet the creator of the stand's Spark (on its
 * curve) and Moth (in its pool), nothing sent anywhere. The counters are made up once and move only when «Забрати»
 * takes them. Opened with `?launch=stub` in a development build; never part of a production bundle.
 */

const DAY = 86_400_000;
const USDC = 1_000_000n;
const cents = (value: number) => ((BigInt(Math.round(value * 100)) * USDC) / 100n).toString();

type Source = { earned: string; unclaimed: string };
type Counters = { curve: Source; graduation: Source; lp: Source; surplus: Source };
const none = (): Source => ({ earned: '0', unclaimed: '0' });

/**
 * What the stand's two test launches earned for their creator, in USDC — at their presets' rates: Moth's curve made
 * $412.80 on $129K of trading (taken two days in), its exit $160 on the $20K it raised, its half of the exit position
 * $184 on $184K of pool trading; Spark's curve $18.64 in its first minutes, under the launch fee.
 */
const STAND: Readonly<Record<string, () => Counters>> = {
  MOTH: () => ({ curve: { earned: cents(412.8), unclaimed: '0' }, graduation: { earned: cents(160), unclaimed: cents(160) }, lp: { earned: cents(184), unclaimed: cents(184) }, surplus: none() }),
  SPARK: () => ({ curve: { earned: cents(18.64), unclaimed: cents(18.64) }, graduation: none(), lp: none(), surplus: none() }),
};

/** The claim Moth's creator already made, two days after the launch: its curve's share. */
const EARLIER: Readonly<Record<string, Readonly<{ afterMs: number; curve: string }>>> = { MOTH: { afterMs: 2 * DAY, curve: cents(412.8) } };

const SOURCES = ['curve', 'graduation', 'lp', 'surplus'] as const;

export type StubBerthOptions = Readonly<{ engine: LaunchEngine; delayMs?: number; now?: () => number; refuse?: Partial<Record<keyof BerthEngine, Answer<never>>> }>;

export function stubBerthEngine(options: StubBerthOptions): BerthEngine & Readonly<{ calls: string[] }> {
  const now = options.now ?? Date.now;
  const refuse = { ...(options.refuse ?? {}) };
  const calls: string[] = [];
  const counters = new Map<string, Counters>();
  const receipts: LaunchClaimReceipt[] = [];
  const builds = new Map<string, { token: string; wallet: string; wire: string; used: boolean }>();
  let seeded = false;
  const iso = (ms: number) => new Date(ms).toISOString();

  async function answer<T>(route: keyof BerthEngine, make: () => Promise<Answer<T>> | Answer<T>): Promise<Answer<T>> {
    calls.push(route);
    await new Promise<void>((resolve) => setTimeout(resolve, (options.delayMs ?? 0) * (route === 'submit' ? 4 : 1)));
    const refused = refuse[route];
    if (refused) {
      delete refuse[route];
      return refused;
    }
    return make();
  }

  const own = async (wallet: string): Promise<LaunchMarketRow[] | null> => {
    const markets = await options.engine.markets();
    if (!markets.ok) return null;
    const rows = markets.data.markets.filter((row) => row.creator === wallet);
    if (!seeded) {
      seeded = true;
      for (const row of rows) {
        const earlier = EARLIER[row.symbol];
        if (earlier) receipts.push(receiptOf(row, stubSignature(`claim:${row.symbol}:1`), Date.parse(row.launchedAt) + earlier.afterMs, { curve: earlier.curve, graduation: '0', lp: '0', surplus: '0' }));
      }
    }
    return rows;
  };

  const countersOf = (row: LaunchMarketRow): Counters => {
    let entry = counters.get(row.token);
    if (!entry) {
      entry = STAND[row.symbol]?.() ?? { curve: none(), graduation: none(), lp: none(), surplus: none() };
      counters.set(row.token, entry);
    }
    return entry;
  };

  const sum = (entry: Counters, key: keyof Source) => SOURCES.reduce((total, source) => total + BigInt(entry[source][key]), 0n);

  function receiptOf(row: LaunchMarketRow, signature: string, at: number, paid: Record<(typeof SOURCES)[number], string>): LaunchClaimReceipt {
    const received = SOURCES.reduce((total, source) => total + BigInt(paid[source]), 0n).toString();
    return { token: row.token, name: row.name, symbol: row.symbol, signature, at: iso(at), pair: { mint: row.pair.mint, symbol: row.pair.symbol, decimals: row.pair.decimals, dollar: row.pair.dollar }, paid, vaultPaidRaw: null, receivedRaw: received };
  }

  function cabinetRow(row: LaunchMarketRow): LaunchCabinetRow {
    const entry = countersOf(row);
    const earned = sum(entry, 'earned');
    const unclaimed = sum(entry, 'unclaimed');
    const source = (s: Source) => ({ earnedRaw: s.earned, unclaimedRaw: s.unclaimed });
    return {
      token: row.token,
      name: row.name,
      symbol: row.symbol,
      image: row.image,
      preset: row.preset,
      creator: row.creator,
      role: 'creator',
      launchedAt: row.launchedAt,
      pair: { mint: row.pair.mint, symbol: row.pair.symbol, decimals: row.pair.decimals, dollar: row.pair.dollar },
      progressBps: row.progress?.bps ?? null,
      migrated: row.progress?.migrated ?? null,
      earnings: {
        role: { curve: source(entry.curve), graduation: source(entry.graduation), lp: source(entry.lp), surplus: source(entry.surplus), earnedRaw: earned.toString(), unclaimedRaw: unclaimed.toString() },
        mine: { shareBps: 10_000, earnedRaw: earned.toString(), unclaimedRaw: unclaimed.toString(), claimedRaw: (earned - unclaimed).toString() },
      },
      feeSharing: null,
      claimable: unclaimed > 0n,
    };
  }

  const find = async (token: string, wallet: string) => (await own(wallet))?.find((row) => row.token === token) ?? null;

  return {
    calls,
    market: (token) => answer('market', () => options.engine.market(token)),
    cabinet: (wallet) =>
      answer('cabinet', async (): Promise<Answer<LaunchCreatorCabinetResponse>> => {
        const rows = await own(wallet);
        if (!rows) return { ok: false, code: 'UNAVAILABLE', message: 'The launches could not be read now. Try again.' };
        const launches = rows.map(cabinetRow);
        const mine = receipts.filter((receipt) => rows.some((row) => row.token === receipt.token));
        const earned = launches.reduce((total, row) => total + BigInt(row.earnings?.mine.earnedRaw ?? '0'), 0n);
        const claimed = mine.reduce((total, receipt) => total + BigInt(receipt.receivedRaw), 0n);
        const pair = launches[0]?.pair ?? { mint: stubAddress('usdc'), symbol: 'USDC', decimals: 6, dollar: true };
        return {
          ok: true,
          data: {
            network: 'solana:devnet',
            wallet,
            launches,
            receipts: [...mine].reverse(),
            card: {
              source: EARNINGS_CARD_SOURCE,
              kind: 'creator',
              wallet,
              network: 'solana:devnet',
              period: { from: launches.at(-1)?.launchedAt ?? iso(now()), to: iso(now()) },
              launches: launches.length,
              graduated: launches.filter((row) => row.migrated).length,
              unread: 0,
              amounts: launches.length ? [{ pairMint: pair.mint, symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar, earnedRaw: earned.toString(), claimedRaw: claimed.toString() }] : [],
              receipts: mine.map((receipt) => receipt.signature),
            },
            observedAt: iso(now()),
          },
        };
      }),
    review: (token, wallet) =>
      answer('review', async (): Promise<Answer<LaunchClaimReviewResponse>> => {
        const row = await find(token, wallet);
        if (!row) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No launch of this wallet by that mint.' };
        const entry = countersOf(row);
        const migrated = row.progress?.migrated === true;
        const taken = SOURCES.filter((source) => BigInt(entry[source].unclaimed) > 0n);
        const pocket = (id: 'curve' | 'graduation' | 'surplus' | 'lp') => {
          if (id !== 'curve' && !migrated) return { pocket: id, state: 'BEFORE_DEX' as const, amountRaw: null, transaction: null, holder: null };
          const raw = entry[id].unclaimed;
          return BigInt(raw) > 0n ? { pocket: id, state: 'IN_CLAIM' as const, amountRaw: raw, transaction: 1, holder: null } : { pocket: id, state: 'EMPTY' as const, amountRaw: '0', transaction: null, holder: null };
        };
        return {
          ok: true,
          data: {
            network: 'solana:devnet',
            token,
            wallet,
            pair: { mint: row.pair.mint, symbol: row.pair.symbol, decimals: row.pair.decimals, dollar: row.pair.dollar },
            shared: false,
            claimsV2: false,
            pockets: [
              pocket('curve'),
              pocket('graduation'),
              pocket('surplus'),
              pocket('lp'),
              migrated ? { pocket: 'leftover', state: 'NOT_YOURS', amountRaw: null, transaction: null, holder: stubAddress('leftover') } : { pocket: 'leftover', state: 'NONE', amountRaw: null, transaction: null, holder: null },
              { pocket: 'transferFee', state: 'NONE', amountRaw: null, transaction: null, holder: null },
            ],
            blockedBy: null,
            transactions: taken.length ? [{ index: 1, sources: taken, payout: false }] : [],
            expectedRaw: sum(entry, 'unclaimed').toString(),
            networkCostLamports: taken.length ? '10000' : null,
            surplus: null,
            position: migrated ? { address: stubAddress(`position:${token}`), pool: stubAddress(`pool:${token}`), nftMint: stubAddress(`nft:${token}`), holder: wallet, holderIs: 'YOU', permanentBps: 10_000, forever: true } : null,
            lock: null,
            observedAt: iso(now()),
          },
        };
      }),
    build: (token, body) =>
      answer('build', async (): Promise<Answer<LaunchClaimBuildResponse>> => {
        const row = await find(token, body.wallet);
        if (!row) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No launch of this wallet by that mint.' };
        const entry = countersOf(row);
        const expected = sum(entry, 'unclaimed');
        if (expected <= 0n) return { ok: false, code: 'LAUNCH_NOTHING_TO_CLAIM', message: 'Nothing to claim now.' };
        const buildId = `${builds.size + 1}`.padStart(32, 'c');
        const wire = btoa(`stub-claim:${buildId}:${token}`);
        builds.set(buildId, { token, wallet: body.wallet, wire, used: false });
        return {
          ok: true,
          data: {
            buildId,
            network: 'solana:devnet',
            unsignedWireBase64: [wire],
            sources: SOURCES.filter((source) => BigInt(entry[source].unclaimed) > 0n),
            expectedRaw: expected.toString(),
            networkCostLamports: '10000',
            pair: { mint: row.pair.mint, symbol: row.pair.symbol, decimals: row.pair.decimals, dollar: row.pair.dollar },
            expiresAt: iso(now() + 90_000),
            signableMs: 25_000,
          },
        };
      }),
    submit: (token, body) =>
      answer('submit', async () => {
        const build = builds.get(body.buildId);
        if (!build || build.token !== token) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'This claim was not built here.' };
        if (build.wallet !== body.wallet) return { ok: false, code: 'WALLET_MISMATCH', message: 'Another wallet.' };
        if (build.used) return { ok: false, code: 'LAUNCH_BUILD_USED', message: 'This claim was already sent.' };
        if (body.signedWireBase64.length !== 1 || body.signedWireBase64[0] !== build.wire) return { ok: false, code: 'LAUNCH_SIGNED_OTHER_BYTES', message: 'The signed bytes are not the built ones.' };
        build.used = true;
        const row = await find(token, body.wallet);
        if (!row) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No launch of this wallet by that mint.' };
        const entry = countersOf(row);
        const paid = { curve: entry.curve.unclaimed, graduation: entry.graduation.unclaimed, lp: entry.lp.unclaimed, surplus: entry.surplus.unclaimed };
        for (const source of SOURCES) entry[source].unclaimed = '0';
        const receipt = receiptOf(row, stubSignature(`claim:${body.buildId}`), now(), paid);
        receipts.push(receipt);
        return { ok: true, data: { state: 'CONFIRMED' as const, receipts: [receipt], pending: [], failed: [] } };
      }),
  };
}
