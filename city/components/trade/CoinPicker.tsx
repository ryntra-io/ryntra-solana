'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { withoutOffensiveNames } from '@/lib/spot/offensive-names';
import { useCity } from '@/city/lib/city/store';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { pastedMint } from '@/city/lib/search/mint';
import { catalogHits, cityHits, indexHits, mergeHits, type CatalogRow, type CoinHit, type IndexCoin } from '@/city/lib/search/rank';
import { readCoinFacts, readIndex, searchCatalog } from '@/city/lib/search/sources';
import { shortAddress } from '@/city/lib/trade/format';
import { coinMatches, suggestedCoins, walletCoins } from '@/city/lib/trade/pair';
import { unitOf, type PayAsset } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { PICK } from './words';
import s from './trade.module.css';

/** A pause in typing this long asks Jupiter's catalogue; the towers and the index answer at every key. */
const TYPING_MS = 280;
/** The engine's index of Markets is read once per this long, for every picker. */
const INDEX_MS = 120_000;

let index: { at: number; rows: Promise<IndexCoin[]> } | null = null;
function marketIndex(): Promise<IndexCoin[]> {
  if (!index || Date.now() - index.at > INDEX_MS) {
    const rows = readIndex().catch(() => []);
    index = { at: Date.now(), rows };
    void rows.then((list) => {
      if (!list.length && index?.rows === rows) index = null;
    });
  }
  return index.rows;
}

export type PickerKind = 'wallet' | 'search';

type Row = Readonly<{ asset: PayAsset; amount: string | null }>;

/**
 * Picking a coin inside the trade card: one of the wallet's coins to pay with or to sell, or any coin to receive —
 * the towers of the city, the coins Markets lists and Jupiter's catalogue, the same search as the top bar. A coin
 * Jupiter has not verified says so. Nothing is priced here; the card asks the engine once a coin is picked.
 */
export function CoinPicker({ kind, title, exclude, onPick, onBack }: { kind: PickerKind; title: string; exclude: readonly string[]; onPick: (asset: PayAsset) => void; onBack: () => void }) {
  const w = useWords(PICK);
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const holdings = useWallet((st) => st.holdings);
  const connection = useWallet((st) => st.connection);
  const holdingsRead = useWallet((st) => st.holdingsRead);
  const layout = useCity((st) => st.layout);
  const towers = useMemo(() => layout.towers.map((placed) => placed.tower), [layout]);
  const skip = useMemo(() => new Set(exclude), [exclude]);
  const found = useFound(kind === 'search' ? query : '', towers);
  const [reading, setReading] = useState<string | null>(null);
  const [miss, setMiss] = useState<string | null>(null);

  // A mint still being read when the picker goes picks nothing: the person has moved on.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    field.current?.focus({ preventScroll: true });
    return () => {
      alive.current = false;
    };
  }, []);

  const rows = useMemo<readonly Row[]>(() => {
    if (kind === 'wallet') {
      return walletCoins(holdings, towers)
        .filter((coin) => !skip.has(coin.asset.mint) && coinMatches(coin.asset, query))
        .map((coin) => ({ asset: coin.asset, amount: coin.amount }));
    }
    if (!query.trim()) return suggestedCoins(towers, skip).map((asset) => ({ asset, amount: null }));
    return found.filter((asset) => !skip.has(asset.mint)).map((asset) => ({ asset, amount: null }));
  }, [kind, holdings, towers, skip, query, found]);

  // A pasted address nothing names yet is read once from the engine before it is offered.
  const mint = kind === 'search' ? pastedMint(query) : null;
  const offerMint = mint !== null && !skip.has(mint) && !rows.some((row) => row.asset.mint === mint);
  const readMint = async (address: string) => {
    setReading(address);
    setMiss(null);
    const facts = await readCoinFacts(address).catch(() => null);
    if (!alive.current) return;
    setReading(null);
    if (!facts) return setMiss(address);
    onPick({ mint: facts.mint, symbol: facts.symbol.replace(/^\$+/, ''), name: facts.name, decimals: null, verified: facts.verified, icon: facts.icon });
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      // Back to the card, not out of it.
      event.preventDefault();
      event.stopPropagation();
      onBack();
    } else if (event.key === 'Enter' && rows[0]) {
      event.preventDefault();
      onPick(rows[0].asset);
    }
  };

  const status =
    kind === 'wallet'
      ? !connection
        ? w.connectToSee
        : !holdings
          ? holdingsRead === 'failed'
            ? w.balancesUnavailable
            : w.readingWallet
          : !rows.length
            ? query.trim()
              ? w.nothingFound
              : w.noOtherCoins
            : null
      : miss
        ? w.nothingFound
        : reading
          ? w.lookingUp
          : !rows.length && !offerMint && query.trim().length >= 2
            ? w.nothingFound
            : null;

  return (
    <div className={s.picker} role="group" aria-label={title}>
      <div className={s.pickerHead}>
        <button className={s.pickerBack} onClick={onBack} aria-label={w.backToTrade}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <span className={s.label}>{title}</span>
      </div>
      <input
        ref={field}
        className={s.pickerField}
        type="search"
        inputMode="search"
        autoComplete="off"
        spellCheck={false}
        placeholder={kind === 'wallet' ? w.searchYours : w.searchAny}
        aria-label={kind === 'wallet' ? w.searchYours : w.searchAny}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKey}
      />
      <ul className={s.pickerList}>
        {rows.map((row) => (
          <li key={row.asset.mint}>
            <button className={s.pickerRow} onClick={() => onPick(row.asset)}>
              <CoinIcon asset={row.asset} />
              <span className={s.pickerNames}>
                <b>{unitOf(row.asset)}</b>
                <span className={`${s.pickerName} ${row.asset.verified === false ? s.pickerRisk : ''}`}>{row.asset.verified === false ? w.unverified : (row.asset.name ?? shortAddress(row.asset.mint))}</span>
              </span>
              {row.amount !== null && <span className={s.pickerAmount}>{digits(row.amount)}</span>}
            </button>
          </li>
        ))}
        {offerMint && mint && (
          <li>
            <button className={s.pickerRow} onClick={() => void readMint(mint)} disabled={reading === mint}>
              <span className={s.pickerIcon} aria-hidden="true" />
              <span className={s.pickerNames}>
                <b>{shortAddress(mint)}</b>
                <span className={s.pickerName}>{w.lookUp}</span>
              </span>
            </button>
          </li>
        )}
      </ul>
      {status && <div className={s.walletHint}>{status}</div>}
    </div>
  );
}

/** What the search finds for a query: the towers and the index at once, Jupiter's catalogue once the typing pauses. */
function useFound(query: string, towers: readonly Parameters<typeof cityHits>[0][number][]): readonly PayAsset[] {
  const [indexRows, setIndexRows] = useState<IndexCoin[]>([]);
  const [catalog, setCatalog] = useState<readonly CatalogRow[]>([]);
  const typed = query.trim();
  useEffect(() => {
    if (!typed) return;
    let alive = true;
    void marketIndex().then((rows) => alive && setIndexRows(rows));
    return () => {
      alive = false;
    };
  }, [typed]);
  useEffect(() => {
    if (typed.length < 2 && !pastedMint(typed)) return setCatalog([]);
    const abort = new AbortController();
    const timer = setTimeout(() => {
      searchCatalog(typed, { signal: abort.signal })
        .then((rows) => setCatalog(withoutOffensiveNames(rows)))
        .catch(() => {});
    }, TYPING_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [typed]);
  return useMemo(() => {
    if (!typed) return [];
    const inCity = new Set(towers.map((tower) => tower.id));
    const hits = mergeHits([cityHits(towers), indexHits(indexRows, inCity), catalogHits([...catalog], inCity)], typed);
    return hits.flatMap((hit: CoinHit) =>
      hit.symbol ? [{ mint: hit.mint, symbol: hit.symbol, name: hit.name, decimals: null, verified: hit.verified, icon: hit.icon }] : [],
    );
  }, [typed, towers, indexRows, catalog]);
}

/** A coin's picture as its source named it; without one, or when it cannot be brought, the plain disc. */
function CoinIcon({ asset }: { asset: PayAsset }) {
  const [failed, setFailed] = useState(false);
  if (!asset.icon || failed) return <span className={s.pickerIcon} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={s.pickerIcon} src={asset.icon} alt="" draggable={false} onError={() => setFailed(true)} />;
}
