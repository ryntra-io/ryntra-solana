'use client';

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { CreatorAction, CreatorCoin } from '@/lib/spot/creator';
import { coinHref } from '@/terminal/shell/shelves';
import { CoinLogo, Info, ListRow, Quiet, coinIcon, usdText } from '@/terminal/ui';
import { walletHref } from '@/terminal/watch/watch-view';
import { shortAddress } from '../tape-view';
import { creatorOf, didLineOf, launchedOf, othersFirst, type Launched } from './creator-view';
import { useCreatorPart } from './useCreatorPart';
import { CREATOR } from './words';
import c from './creator.module.css';

/** The coin, when, the highest capitalisation, now, the pool: dense, as the panel's other tables. */
const COLUMNS = 'minmax(180px, 1.8fr) minmax(96px, 0.8fr) repeat(2, minmax(88px, 0.8fr)) minmax(76px, 0.6fr)';
const BONES = 4;

/**
 * The creator's tab under the coin's chart. On top: the creator's wallet (short; the whole address one tap
 * away on its page), how many coins it launched and how many reached a pool, and in one line what it did with this coin
 * — holds, sold part, sold everything, moved it to other wallets, never held it. Under it: its coins, the newest first —
 * the logo, the name, when, the highest capitalisation, now, whether it reached a pool; a row opens the coin.
 *
 * Every figure is the engine's (`/api/spot/creator?part=creator`): the chain for the launches and the moves, Jupiter for
 * the names, logos and capitalisations, GeckoTerminal's daily bars for the highest. What it did not give is a dash. On a
 * phone (`phone`) the coins are a list.
 */
export function CreatorTab({ mint, phone = false }: { mint: string; phone?: boolean }) {
  const w = useWords(CREATOR);
  const read = useCreatorPart(mint, 'creator', true, creatorOf);
  if (!read.value) {
    if (read.status === 'reading') return <Bones label={w.reading} />;
    if (read.status === 'none') return <Line>{w.none}</Line>;
    return (
      <Line>
        {w.quiet}
        <Quiet size="s" onClick={read.again}>
          {w.again}
        </Quiet>
      </Line>
    );
  }
  const answer = read.value;
  const short = shortAddress(answer.creator);
  const shown = answer.coins.length;
  return (
    <div className={c.tab} data-phone={phone || undefined}>
      <div className={c.head}>
        <span className={c.who}>
          <span className={c.kick}>{w.creator}</span>
          <Link href={walletHref(answer.creator)} prefetch={false} className={c.wallet} aria-label={w.openCreator(short)} title={answer.creator}>
            {short}
          </Link>
        </span>
        {answer.launched !== null ? (
          <span className={c.count}>
            {w.launched(answer.launched)}
            {answer.listed !== null ? <span className={c.listed}>{w.listed(answer.listed)}</span> : null}
          </span>
        ) : null}
        {phone ? null : <Did action={answer.action} />}
        <span className={c.end}>
          {!answer.coinsWhole && answer.launched !== null && answer.launched > shown ? <span className={c.part}>{w.newest(digits(String(shown)), digits(String(answer.launched)))}</span> : null}
          <Info label={w.didHow}>
            {w.didWhy}
            {answer.action && !answer.action.whole ? ` ${w.didPart}` : null} {w.coinsWhy}
          </Info>
        </span>
      </div>
      {phone ? <Did action={answer.action} /> : null}
      {phone ? <PhoneCoins coins={othersFirst(answer.coins)} /> : <DeskCoins coins={othersFirst(answer.coins)} />}
    </div>
  );
}

/** One calm line where the tab has nothing to show. */
function Line({ children }: { children: ReactNode }) {
  return (
    <p className={c.line} role="status">
      {children}
    </p>
  );
}

/** The tab's frame while it reads: rows of the table's own height, nothing that moves the page when they come. */
function Bones({ label }: { label: string }) {
  return (
    <div className={c.bones} role="status" aria-busy="true" aria-label={label}>
      <span className={c.boneHead} />
      {Array.from({ length: BONES }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

/** What the creator did with this coin, in one line, with its «i». */
function Did({ action }: { action: CreatorAction | null }) {
  const w = useWords(CREATOR);
  const lang = useLang();
  if (!action) {
    return (
      <span className={c.did} data-tone="dim">
        {w.didUnknown}
      </span>
    );
  }
  const line = didLineOf(action);
  const word = { holds: w.didHolds, soldSome: w.didSoldSome, soldAll: w.didSoldAll, moved: w.didMoved, never: w.didNever }[line.did];
  const figures = [
    line.moved ? w.movedShare(digits(line.moved.share, lang), line.moved.wallets) : null,
    line.sold ? w.soldShare(digits(line.sold, lang)) : null,
    line.holds ? w.holdsShare(digits(line.holds, lang)) : line.empty ? w.nothingLeft : null,
  ].filter((part): part is string => part !== null);
  return (
    <span className={c.did} data-tone={line.tone}>
      <b>{word}</b>
      {figures.length ? <span className={c.figures}>{figures.join(' · ')}</span> : null}
    </span>
  );
}

/** When a coin was launched, in the screen's words. */
function useLaunchedText(): (launched: Launched) => string {
  const w = useWords(CREATOR);
  const lang = useLang();
  return (launched) => {
    if (!launched) return '—';
    if (launched.kind === 'date') return dateText(launched.at, { day: 'numeric', month: 'short', year: 'numeric' }, lang);
    const n = digits(String(launched.n), lang);
    return launched.unit === 'm' ? w.agoM(n) : launched.unit === 'h' ? w.agoH(n) : w.agoD(n);
  };
}

const logoOf = (coin: CreatorCoin): string | null => (coin.icon ? coinIcon({ id: coin.mint, icon: coin.mint }) : null);
const symbolOf = (coin: CreatorCoin): string => coin.symbol ?? shortAddress(coin.mint);

function DeskCoins({ coins }: { coins: readonly CreatorCoin[] }) {
  const w = useWords(CREATOR);
  const lang = useLang();
  const when = useLaunchedText();
  const now = useMemo(() => Date.now(), []);
  return (
    <div className={c.scroll}>
      <div role="table" aria-label={w.table} className={c.table} style={{ ['--cols' as string]: COLUMNS }}>
        <div role="row" className={c.th}>
          <span role="columnheader">{w.colCoin}</span>
          <span role="columnheader">{w.colLaunched}</span>
          <span role="columnheader" className={c.num}>
            {w.colPeak}
          </span>
          <span role="columnheader" className={c.num}>
            {w.colNow}
          </span>
          <span role="columnheader" className={c.num}>
            {w.colPool}
          </span>
        </div>
        {coins.map((coin) => {
          const symbol = symbolOf(coin);
          return (
            <div key={coin.mint} role="row" className={c.tr} aria-current={coin.current || undefined}>
              <span role="cell" className={c.coin}>
                <CoinLogo src={logoOf(coin)} symbol={symbol} size="s" />
                {coin.current ? (
                  <b className={c.sym}>{symbol}</b>
                ) : (
                  <Link href={coinHref(coin.mint, 'live')} prefetch={false} className={c.sym} aria-label={w.openCoin(coin.name ?? symbol)}>
                    {symbol}
                  </Link>
                )}
                <span className={c.name}>{coin.current ? w.thisCoin : (coin.name ?? '')}</span>
              </span>
              <span role="cell" className={c.dim}>
                {when(launchedOf(coin.launchedAt, now))}
              </span>
              <span role="cell" className={c.num}>
                {coin.peakCapUsd !== null ? usdText(coin.peakCapUsd, lang) : '—'}
              </span>
              <span role="cell" className={c.num}>
                {coin.capUsd !== null ? usdText(coin.capUsd, lang) : '—'}
              </span>
              <span role="cell" className={coin.listed === true ? c.num : `${c.num} ${c.dim}`}>
                {coin.listed === true ? w.onPool : coin.listed === false ? w.onCurve : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PhoneCoins({ coins }: { coins: readonly CreatorCoin[] }) {
  const w = useWords(CREATOR);
  const lang = useLang();
  const when = useLaunchedText();
  const now = useMemo(() => Date.now(), []);
  return (
    <div className={c.list} role="list" aria-label={w.table}>
      {coins.map((coin) => (
        <div key={coin.mint} role="listitem" className={c.item} aria-current={coin.current || undefined}>
          <ListRow
            icon={logoOf(coin)}
            symbol={symbolOf(coin)}
            name={coin.current ? `${w.thisCoin} · ${when(launchedOf(coin.launchedAt, now))}` : when(launchedOf(coin.launchedAt, now))}
            value={coin.capUsd !== null ? usdText(coin.capUsd, lang) : '—'}
            change={coin.peakCapUsd !== null ? `${w.colPeak} ${usdText(coin.peakCapUsd, lang)}` : coin.listed === true ? w.onPool : coin.listed === false ? w.onCurve : undefined}
            href={coin.current ? undefined : coinHref(coin.mint, 'live')}
            label={w.openCoin(coin.name ?? symbolOf(coin))}
          />
        </div>
      ))}
    </div>
  );
}
