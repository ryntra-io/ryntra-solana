'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { withoutOffensiveNames } from '@/lib/spot/offensive-names';
import { useCity } from '@/city/lib/city/store';
import { useKeyboardInset } from '@/city/lib/keyboard';
import { openCoin, openTower, openTradeCard } from '@/city/lib/coin/open';
import { allLaunches, useLaunch } from '@/city/lib/launch/district';
import { pastedMint } from '@/city/lib/search/mint';
import { catalogHits, cityHits, indexHits, launchHits, mergeHits, type CatalogRow, type CoinHit, type IndexCoin } from '@/city/lib/search/rank';
import { readIndex, searchCatalog } from '@/city/lib/search/sources';
import hud from '../hud/hud.module.css';
import s from './search.module.css';

/** A pause in typing this long asks Jupiter's catalogue; the towers and the index answer at every key. */
const TYPING_MS = 280;
/** A pasted mint the engine has not named in this long is said as not found now. */
const OPEN_MS = 12_000;
/** The engine's index of Markets is read once, and again after this long. */
const INDEX_MS = 120_000;

let index: { at: number; rows: Promise<IndexCoin[]> } | null = null;
function marketIndex(): Promise<IndexCoin[]> {
  if (!index || Date.now() - index.at > INDEX_MS) {
    const rows = readIndex().catch(() => []);
    index = { at: Date.now(), rows };
    void rows.then((list) => {
      /* An index that did not answer is asked again on the next open. */
      if (!list.length && index?.rows === rows) index = null;
    });
  }
  return index.rows;
}

/**
 * The city's search, in the top bar: a coin by its ticker, its name or a pasted mint. The towers answer first, on this
 * device; then the Ryntra launches the docks know, the coins Markets lists and Jupiter's whole catalogue. A tower is
 * flown to and its card opens; any other coin opens its trade card. Escape closes it.
 */
export function CitySearch() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = (focusButton = false) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };
  // A tap anywhere else closes it, as the city's other panels do.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div ref={wrap} className={s.wrap}>
      <button ref={button} className={`${hud.panel} ${hud.iconBtn} ${open ? s.on : ''}`} aria-label="Search coins" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <SearchGlyph />
      </button>
      {open && <SearchPanel onClose={close} />}
    </div>
  );
}

function SearchPanel({ onClose }: { onClose: (focusButton?: boolean) => void }) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [indexRows, setIndexRows] = useState<IndexCoin[]>([]);
  const [catalog, setCatalog] = useState<{ query: string; rows: CatalogRow[] }>({ query: '', rows: [] });
  const [asking, setAsking] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const keyboard = useKeyboardInset();
  const layout = useCity((st) => st.layout);
  const feed = useLaunch((st) => st.feed);
  const mine = useLaunch((st) => st.mine);

  useEffect(() => {
    let alive = true;
    void marketIndex().then((rows) => alive && setIndexRows(rows));
    return () => {
      alive = false;
    };
  }, []);

  // Jupiter's catalogue, once the typing pauses; a newer query aborts the older read.
  const typed = query.trim();
  useEffect(() => {
    setMiss(null);
    if (typed.length < 2 && !pastedMint(typed)) {
      setAsking(false);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setAsking(true);
      searchCatalog(typed, { signal: abort.signal })
        .then((rows) => setCatalog({ query: typed, rows: withoutOffensiveNames(rows) }))
        .catch(() => {})
        .finally(() => {
          if (!abort.signal.aborted) setAsking(false);
        });
    }, TYPING_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [typed]);

  const hits = useMemo(() => {
    if (!typed) return [];
    const launches = allLaunches({ feed, mine });
    const inCity = new Set(layout.towers.map((placed) => placed.tower.id));
    const launchIds = new Set(launches.map((launch) => launch.token));
    return mergeHits(
      [
        cityHits(
          layout.towers.map((placed) => placed.tower),
          launchIds,
        ),
        launchHits(launches, inCity),
        indexHits(indexRows, inCity),
        catalogHits(catalog.rows, inCity),
      ],
      typed,
    );
  }, [typed, layout, feed, mine, indexRows, catalog]);

  // A pasted address nothing names yet is offered as it is.
  const mint = pastedMint(typed);
  const offerMint = mint !== null && !hits.some((hit) => hit.mint === mint);
  const rows = offerMint ? hits.length + 1 : hits.length;
  useEffect(() => setActive(0), [typed]);

  const pick = (hit: CoinHit) => {
    if (hit.inCity) openTower(hit.mint);
    else openTradeCard({ mint: hit.mint, symbol: hit.symbol ?? '', name: hit.name ?? hit.symbol ?? '', icon: hit.icon });
    onClose();
  };

  const openMint = async (address: string) => {
    setOpening(address);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), OPEN_MS);
    const opened = await openCoin(address, null, abort.signal).catch(() => false);
    clearTimeout(timer);
    setOpening(null);
    if (opened) onClose();
    else setMiss(address);
  };

  const choose = (index: number) => {
    const hit = hits[index];
    if (hit) pick(hit);
    else if (offerMint && mint && index === hits.length) void openMint(mint);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === 'ArrowDown' && rows) {
      event.preventDefault();
      setActive((n) => (n + 1) % rows);
    } else if (event.key === 'ArrowUp' && rows) {
      event.preventDefault();
      setActive((n) => (n - 1 + rows) % rows);
    } else if (event.key === 'Enter' && rows) {
      event.preventDefault();
      choose(Math.min(active, rows - 1));
    }
  };

  const optionId = (n: number) => `${listId}-${n}`;
  const status = miss
    ? 'No coin found at this address right now.'
    : opening
      ? 'Reading this mint…'
      : !typed
        ? 'Find a coin by its ticker, its name or a pasted mint address.'
        : !rows && asking
          ? 'Searching…'
          : !rows && typed.length >= 2
            ? 'Nothing found. Try the ticker or paste the mint.'
            : null;

  return (
    // On a phone the panel is a sheet at the bottom, above the dock and above the keyboard (`--kb`).
    <div className={`${hud.panel} ${s.panel}`} style={{ ['--kb' as string]: `${keyboard}px` }} role="dialog" aria-label="Search coins">
      <div className={s.field}>
        <SearchGlyph />
        <input
          className={s.input}
          type="search"
          inputMode="search"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
          maxLength={64}
          placeholder="Ticker, name or mint"
          aria-label="Ticker, name or mint address"
          role="combobox"
          aria-expanded={rows > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={rows ? optionId(Math.min(active, rows - 1)) : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKey}
        />
        {asking && <span className={s.spinner} aria-hidden="true" />}
      </div>
      {rows > 0 && (
        <ul className={s.list} id={listId} role="listbox" aria-label="Coins">
          {hits.map((hit, n) => (
            <li
              key={hit.mint}
              id={optionId(n)}
              role="option"
              aria-selected={n === active}
              className={`${s.row} ${n === active ? s.active : ''}`}
              onPointerEnter={() => setActive(n)}
              onClick={() => pick(hit)}
            >
              <HitIcon src={hit.icon} />
              <span className={s.words}>
                <span className={`${hud.display} ${s.symbol}`}>{hit.symbol ? `$${hit.symbol}` : 'New pool'}</span>
                <span className={s.name}>{hit.name ?? short(hit.mint)}</span>
              </span>
              <span className={s.tags}>
                {hit.launch && <span className={hud.tag}>Ryntra Launch</span>}
                {!hit.launch && hit.verified === false && <span className={`${hud.tag} ${hud.tagWarn}`}>Unverified</span>}
                <span className={`${s.where} ${hit.inCity ? s.inCity : ''}`}>{hit.inCity ? 'In the city' : 'Not a tower yet'}</span>
              </span>
            </li>
          ))}
          {offerMint && mint && (
            <li
              id={optionId(hits.length)}
              role="option"
              aria-selected={active === hits.length}
              className={`${s.row} ${active === hits.length ? s.active : ''}`}
              onPointerEnter={() => setActive(hits.length)}
              onClick={() => void openMint(mint)}
            >
              <HitIcon src={null} />
              <span className={s.words}>
                <span className={`${hud.display} ${s.symbol}`}>Open this mint</span>
                <span className={s.name}>{short(mint)}</span>
              </span>
              <span className={s.tags}>
                <span className={s.where}>{opening === mint ? 'Reading…' : 'Address'}</span>
              </span>
            </li>
          )}
        </ul>
      )}
      {status && (
        <div className={s.status} role="status">
          {status}
        </div>
      )}
    </div>
  );
}

function short(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

/** The coin's picture on the same origin; one that does not load leaves the plain disc. */
function HitIcon({ src }: { src: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <span className={s.icon} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={s.icon} src={src} alt="" loading="lazy" onError={() => setFailed(src)} />;
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 L21 21" />
    </svg>
  );
}
