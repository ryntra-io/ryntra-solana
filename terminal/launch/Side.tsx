'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { LaunchMarketRow } from '@/lib/api/v1/contract';
import { num } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { launchEngine, launchPoolEngine, poolDoorHere, useLaunch } from '@/city/lib/launch/district';
import { pct } from '@/city/lib/launch/format';
import { POOL_AFTER, poolOpensAt, usePool } from '@/city/lib/launch/pool';
import { connectOrPick } from '@/terminal/coin/parts';
import { WalletPick } from '@/terminal/coin/WalletPick';
import { coinHref } from '@/terminal/shell/shelves';
import { useMarket } from '@/terminal/shell/useMarket';
import { Action, Cell, Chip, CoinCell, Kick, ListRow, Panel, Quiet, Table, TableHead, TableRow, usdText } from '@/terminal/ui';
import { usdShort, useWhen } from './Form';
import { Glyph, type GlyphName } from './glyphs';
import { logoOf } from '@/terminal/market/depth-view';
import { LADDER, ageOf, ageText, clockLeft, freshLaunches, measured, mineOf, showcase, type Mine } from './launch-view';
import type { LaunchModel } from './useLaunchModel';
import { useSeconds } from './useSeconds';
import l from './launch.module.css';

/** The links a coin's card shows, as their marks: X, Telegram, the website. */
const LINK_MARKS: readonly (readonly ['x' | 'telegram' | 'website', GlyphName])[] = [
  ['x', 'x'],
  ['telegram', 'telegram'],
  ['website', 'globe'],
];

/**
 * «How people see it»: the new coin as the Spot and the Market will show it — its picture large and round,
 * its ticker and name, its line and links, its way to a pool or its opening counted down, the liquidity locked; then its
 * row as the Market lists it. Until it has a picture, the brand's own light stands in its place — never a letter.
 */
export function Preview({ m }: { m: LaunchModel }) {
  const { w } = m;
  const lang = useLang();
  const now = useSeconds();
  const when = useWhen(m);
  const pooled = m.phase?.step === 'pooled' ? m.phase.pooled : null;
  const opensAt = pooled ? pooled.opensAt : m.format === 'pool' && m.choice && now !== null ? poolOpensAt(m.choice, now) : null;
  const symbol = m.symbol || w.tickerPlaceholder;
  const name = m.check.clean.name || w.namePlaceholder;
  const picture = m.draft.picture?.url ?? null;
  const about = m.check.clean.description;
  const links = LINK_MARKS.filter(([kind]) => m.check.clean.links[kind] !== null);
  const pool = m.format === 'pool' || pooled !== null;
  // With the take-profit ladder, part of the supply stays the creator's: the card says how much is locked, and no «fair».
  const ladder = !pooled && m.format === 'pool' && m.choice?.ladder === true;
  // Before the coin is in its pool its opening is the wait the creator chose; once there, a clock counts down to it.
  const wait = !pooled && m.format === 'pool' && m.choice && m.choice.at === null ? ([w.in15, w.in1h, w.in6h][POOL_AFTER.indexOf(m.choice.after)] ?? null) : null;
  return (
    <Panel pad="none" label={w.seen} className={l.preview}>
      <div className={l.banner} data-empty={picture ? undefined : ''} data-launch-preview={picture ? 'picture' : 'empty'}>
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={l.bannerImage} src={picture} alt="" />
        ) : (
          <span className={l.bannerArt} aria-hidden="true" />
        )}
        <span className={l.bannerShade} aria-hidden="true" />
        <Kick className={l.bannerKick}>{w.seen}</Kick>
        <CoinMark picture={picture} large />
      </div>
      <div className={l.seenBody}>
        <div className={l.seenTitle} data-empty={m.symbol ? undefined : ''}>
          <span className={l.seenSym}>${symbol}</span>
          {ladder ? null : <Chip tone="ok">{w.fair}</Chip>}
        </div>
        <span className={l.seenName} data-empty={m.check.clean.name ? undefined : ''}>
          {name}
        </span>
        {about ? <p className={l.seenAbout}>{about}</p> : null}
        {links.length ? (
          <span className={l.seenLinks}>
            {links.map(([kind, glyph]) => (
              <span key={kind} className={l.seenLink}>
                <Glyph name={glyph} small />
              </span>
            ))}
          </span>
        ) : null}
        {pool ? (
          <div className={l.seenStat}>
            <span>{pooled ? w.opensIn : w.opens}</span>
            <b className={l.amber}>{wait ?? (opensAt !== null && now !== null ? (pooled ? clockLeft(opensAt - now) : when(opensAt)) : ' ')}</b>
          </div>
        ) : m.preset ? (
          <div className={l.road}>
            <span className={l.roadHead}>
              <span>{w.toPool}</span>
              <b>
                {usdShort(m.preset.startMarketCapUsd)} → {usdShort(m.preset.graduationMarketCapUsd)}
              </b>
            </span>
            <span className={l.roadBar} aria-hidden="true">
              <span className={l.roadFill} />
            </span>
          </div>
        ) : null}
        <div className={l.chips}>
          <Chip>
            <Glyph name="lock" small />
            {ladder ? w.lineLockedPart(pct(10_000 - LADDER.shareBps)) : w.locked}
          </Chip>
          <Chip>{pool ? `Meteora ${w.fmtPoolTag}` : 'Meteora'}</Chip>
          {pool || m.shield?.on ? (
            <Chip>
              <Glyph name="shield" small />
              {w.shield}
            </Chip>
          ) : null}
        </div>
      </div>
      <div className={l.seenRowHead}>
        <Kick>{w.onMarket}</Kick>
      </div>
      <div className={l.seenRow} data-empty={m.symbol ? undefined : ''}>
        <CoinMark picture={picture} />
        <span className={l.listWords}>
          <b>{symbol}</b>
          <span>
            {pool ? name : `${name} · ${w.justNow}`}
          </span>
        </span>
        <span className={l.listCap}>{pool ? (wait ?? (opensAt !== null && !pooled ? when(opensAt) : '')) : m.preset ? usdText(m.preset.startMarketCapUsd, lang) : ''}</span>
      </div>
    </Panel>
  );
}

/** The new coin's own mark: its picture, round; until it has one, a glass orb with the brand's light and a rocket. */
function CoinMark({ picture, large = false }: { picture: string | null; large?: boolean }) {
  if (picture) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={large ? l.markLarge : l.markSmall} src={picture} alt="" />;
  }
  return (
    <span className={`${l.orb} ${large ? l.markLarge : l.markSmall}`} aria-hidden="true">
      <Glyph name="rocket" small={!large} />
    </span>
  );
}

/** A launch's second line: how long ago, and how many hold it — each only where the market measured it. */
function launchLine(m: LaunchModel, tower: Parameters<typeof measured>[0], now: number): string {
  const holders = measured(tower, 'holders');
  return [ageText(m.w, ageOf(tower.launchedAt, now)), holders !== null ? m.w.holders(holders) : null].filter(Boolean).join(' · ');
}

/** The market's new launches the screen shows: each with its logo and its market cap, none crude, hateful or borrowed. */
function shown(towers: Parameters<typeof freshLaunches>[0], max: number) {
  return showcase(freshLaunches(towers), (tower) => ({ symbol: tower.symbol, name: tower.name, icon: tower.icon, mcap: measured(tower, 'mcap'), holders: measured(tower, 'holders') }), max);
}

/** «New on the market», a few rows beside the form, and «All» opens the whole list. */
export function FreshMini({ m, onAll }: { m: LaunchModel; onAll: () => void }) {
  const { w } = m;
  const lang = useLang();
  const towers = useMarket().towers;
  const now = useSeconds(30_000);
  const rows = shown(towers, 6);
  if (!rows.length || now === null) return null;
  return (
    <Panel pad="none" label={w.fresh} className={l.freshMini}>
      <div className={l.listHead}>
        <Kick className={l.grow}>{w.fresh}</Kick>
        <button type="button" className={l.all} onClick={onAll}>
          {w.all}
        </button>
      </div>
      <Table columns="minmax(0, 1fr) auto" minWidth={0} label={w.fresh}>
        {rows.map((tower) => (
          <TableRow key={tower.id}>
            <CoinCell icon={logoOf(tower)} symbol={tower.symbol} name={launchLine(m, tower, now * 1000)} href={coinHref(tower.id, 'live')} />
            <Cell end>{measured(tower, 'mcap') !== null ? usdText(tower.mcap, lang) : ''}</Cell>
          </TableRow>
        ))}
      </Table>
    </Panel>
  );
}

/** The whole list of new launches: the market's own «New» launches, newest first, with their logos. */
export function FreshPanel({ m }: { m: LaunchModel }) {
  const { w } = m;
  const lang = useLang();
  const towers = useMarket().towers;
  const now = useSeconds(30_000);
  const rows = shown(towers, 40);
  return (
    <Panel pad="none" edge label={w.fresh}>
      {rows.length === 0 || now === null ? (
        <p className={l.empty}>{w.freshEmpty}</p>
      ) : (
        <>
          <div className={l.deskList}>
            <Table columns="minmax(184px, 1.6fr) minmax(96px, 1fr) minmax(96px, 1fr) minmax(110px, 1fr)" label={w.fresh}>
              <TableHead>
                <Cell head>{w.coin}</Cell>
                <Cell head>{w.age}</Cell>
                <Cell head end>
                  {w.holdersHead}
                </Cell>
                <Cell head end>
                  {w.marketCap}
                </Cell>
              </TableHead>
              {rows.map((tower) => (
                <TableRow key={tower.id}>
                  <CoinCell icon={logoOf(tower)} symbol={tower.symbol} name={tower.name} href={coinHref(tower.id, 'live')} />
                  <Cell tone="dim">{ageText(w, ageOf(tower.launchedAt, now * 1000)) ?? ''}</Cell>
                  <Cell end>{measured(tower, 'holders') !== null ? num(tower.holders) : ''}</Cell>
                  <Cell end>{measured(tower, 'mcap') !== null ? usdText(tower.mcap, lang) : ''}</Cell>
                </TableRow>
              ))}
            </Table>
          </div>
          <div className={l.phoneList}>
            {rows.map((tower) => (
              <ListRow
                key={tower.id}
                icon={logoOf(tower)}
                symbol={tower.symbol}
                name={launchLine(m, tower, now * 1000)}
                value={measured(tower, 'mcap') !== null ? usdText(tower.mcap, lang) : ''}
                href={coinHref(tower.id, 'live')}
              />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

type MineRead = Readonly<{ state: 'idle' | 'reading' | 'ready' | 'failed'; rows: readonly LaunchMarketRow[] | null }>;

/**
 * «My launches»: the coins this wallet launched — the engine's list of launches on the curve, and of launches into a
 * pool where that door is open. Read when the tab opens, and again after a launch lands.
 */
export function MinePanel({ m, shown, onResume }: { m: LaunchModel; shown: boolean; onResume: () => void }) {
  const { w } = m;
  useLang();
  const now = useSeconds(15_000);
  const pools = usePool((st) => st.launches);
  const network = useLaunch((st) => st.network);
  const landed = m.phase?.step === 'done' || m.phase?.step === 'pooled';
  const [read, setRead] = useState<MineRead>({ state: 'idle', rows: null });
  const [picking, setPicking] = useState(false);
  const address = m.connection?.address ?? null;

  const load = useCallback(async () => {
    setRead((was) => ({ state: 'reading', rows: was.rows }));
    const [markets, pooled] = await Promise.all([launchEngine().markets(), poolDoorHere() ? launchPoolEngine().then((engine) => engine.list()) : Promise.resolve(null)]);
    if (pooled?.ok) usePool.getState().setLaunches(pooled.data.launches);
    setRead(markets.ok ? { state: 'ready', rows: markets.data.markets } : { state: 'failed', rows: null });
  }, []);

  useEffect(() => {
    if (shown && address && network) void load();
  }, [shown, address, network, landed, load]);

  if (!address) {
    return (
      <Blank m={m} line={w.mineConnect}>
        {picking ? <WalletPick onBack={() => setPicking(false)} /> : <Quiet onClick={() => connectOrPick(() => setPicking(true))}>{w.connect}</Quiet>}
      </Blank>
    );
  }
  const mine = now !== null ? mineOf(read.rows, pools, address, now * 1000) : [];
  if (read.state === 'failed') {
    return (
      <Panel pad="l" gap={14} edge label={w.mine}>
        <p className={l.emptyLine}>{w.mineFailed}</p>
        <Quiet className={l.blankAct} onClick={() => void load()}>{w.tryAgain}</Quiet>
      </Panel>
    );
  }
  if (!mine.length && read.state !== 'ready') {
    // While the engine reads: the rows' places, never a blank bar.
    return (
      <Panel pad="none" edge label={w.mine}>
        <span className={l.skeleton} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </Panel>
    );
  }
  if (!mine.length) {
    return (
      <Blank m={m} line={w.mineEmpty}>
        <Action onClick={onResume}>{w.newCoin}</Action>
      </Blank>
    );
  }
  // A launch into a pool begun and not finished waits for its next step: the form takes it up, never mints again.
  const waiting = mine.flatMap((coin) => {
    const listed = coin.kind === 'pool' && coin.phase === 'BUILDING' ? pools.find((launch) => launch.mint === coin.token) : undefined;
    return listed ? [listed] : [];
  });
  return (
    <Panel pad="none" label={w.mine}>
      {waiting.map((listed) => (
        <div key={listed.mint} className={l.resumeRow} data-launch-resume="">
          <span>{w.waitsFor(listed.symbol)}</span>
          <Quiet
            size="s"
            disabled={m.working}
            onClick={() => {
              m.resume(listed);
              onResume();
            }}
          >
            {w.resume}
          </Quiet>
        </div>
      ))}
      <ul className={l.listRows}>
        {mine.map((coin) => (
          <li key={coin.token}>
            <Link href={coinHref(coin.token, 'live')} className={l.listRow}>
              <MineMark src={coin.image ?? `/api/icon/${encodeURIComponent(coin.token)}`} />
              <span className={l.listWords}>
                <b>{coin.symbol}</b>
                <span>{coin.name}</span>
              </span>
              <span className={l.listCap}>{mineState(m, coin, now ?? 0)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * «My coins» with nothing to list yet: the brand's light and a coin waiting for its picture, one line, and one way on —
 * launching the first coin, or connecting the wallet that launched them.
 */
function Blank({ m, line, children }: { m: LaunchModel; line: string; children: ReactNode }) {
  return (
    <Panel pad="none" edge label={m.w.mine} className={l.blank}>
      <span className={l.blankArt} aria-hidden="true">
        <span className={`${l.orb} ${l.blankOrb}`}>
          <Glyph name="rocket" />
        </span>
      </span>
      <span className={l.blankWords} data-launch-blank="">
        <b>{line}</b>
        {children}
      </span>
    </Panel>
  );
}

/** One of the creator's coins by its picture; where the picture does not come, the brand's coin in its place. */
function MineMark({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <CoinMark picture={null} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={l.markSmall} src={src} alt="" decoding="async" onError={() => setFailed(true)} />;
}

/** Where one of the creator's coins stands: its way to the pool on the curve, or its opening in a pool. */
function mineState(m: LaunchModel, coin: Mine, now: number): string {
  if (coin.kind === 'pool') {
    if (coin.phase === 'BUILDING') return m.w.waits;
    if (coin.phase === 'COUNTDOWN' && coin.opensAt !== null) return m.w.opensInShort(clockLeft(coin.opensAt - now));
    return m.w.open;
  }
  if (coin.migrated) return m.w.inPool;
  return coin.progressBps !== null ? m.w.onCurve(pct(coin.progressBps)) : m.w.open;
}
