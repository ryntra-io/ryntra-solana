'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LaunchMarketRow } from '@/lib/api/v1/contract';
import { num } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { launchEngine, launchPoolEngine, poolDoorHere, useLaunch } from '@/city/lib/launch/district';
import { pct } from '@/city/lib/launch/format';
import { poolOpensAt, usePool } from '@/city/lib/launch/pool';
import { connectOrPick } from '@/terminal/coin/parts';
import { WalletPick } from '@/terminal/coin/WalletPick';
import { coinHref } from '@/terminal/shell/shelves';
import { useMarket } from '@/terminal/shell/useMarket';
import { Cell, Chip, CoinCell, Kick, ListRow, Panel, Quiet, Table, TableHead, TableRow, Tile, coinIcon, usdText } from '@/terminal/ui';
import { usdShort } from './Form';
import { Glyph } from './glyphs';
import { ageOf, ageText, clockLeft, freshLaunches, measured, mineOf, sniperOf, type Mine } from './launch-view';
import type { LaunchModel } from './useLaunchModel';
import { useSeconds } from './useSeconds';
import l from './launch.module.css';

/**
 * «How people see it»: the new coin's card as the market will show it — its picture, ticker and name, when trading
 * opens (counted down) or where its curve moves to a pool, what the first buyers pay, and its liquidity locked.
 */
export function Preview({ m }: { m: LaunchModel }) {
  const { w } = m;
  useLang();
  const now = useSeconds();
  const pooled = m.phase?.step === 'pooled' ? m.phase.pooled : null;
  const opensAt = pooled ? pooled.opensAt : m.format === 'pool' && m.choice && now !== null ? poolOpensAt(m.choice, now) : null;
  const symbol = m.symbol || w.tickerPlaceholder;
  const name = m.check.clean.name || w.namePlaceholder;
  const sniper = sniperOf(m.format, m.preset);
  return (
    <Panel gap={12} label={w.seen} className={l.preview}>
      <Kick>{w.seen}</Kick>
      <div className={l.seenCoin} data-empty={m.symbol ? undefined : ''}>
        <CoinLogoPicture src={m.draft.picture?.url ?? null} symbol={symbol} />
        <span className={l.seenNames}>
          <span className={l.seenSym}>${symbol}</span>
          <span className={l.seenName}>{name}</span>
        </span>
        <Chip tone="ok">{w.fair}</Chip>
      </div>
      {m.format === 'pool' || pooled ? (
        <Tile label={w.opensIn} value={<span className={l.amber}>{opensAt !== null && now !== null ? clockLeft(opensAt - now) : ' '}</span>} />
      ) : m.preset ? (
        <Tile label={w.movesAt} value={usdShort(m.preset.graduationMarketCapUsd)} />
      ) : null}
      {sniper ? (
        <div className={l.sniper}>
          <span className={l.sniperHead}>
            <Kick className={l.grow}>{w.sniper}</Kick>
            <b>
              {pct(sniper.startBps)} → {pct(sniper.endBps)}
            </b>
          </span>
          <span className={l.shieldBar} aria-hidden="true" />
        </div>
      ) : null}
      <div className={l.chips}>
        <Chip>
          <Glyph name="lock" small />
          {w.locked}
        </Chip>
        <Chip>Meteora</Chip>
      </div>
    </Panel>
  );
}

/** The new coin's picture in the card, round as every coin's logo; its ticker's first letter until it has one. */
function CoinLogoPicture({ src, symbol }: { src: string | null; symbol: string }) {
  if (!src) {
    return (
      <span className={l.seenMark} aria-hidden="true">
        {symbol.slice(0, 1)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={l.seenPicture} src={src} alt="" />;
}

/** A launch's second line: how long ago, and how many hold it — each only where the market measured it. */
function launchLine(m: LaunchModel, tower: Parameters<typeof measured>[0], now: number): string {
  const holders = measured(tower, 'holders');
  return [ageText(m.w, ageOf(tower.launchedAt, now)), holders !== null ? m.w.holders(holders) : null].filter(Boolean).join(' · ');
}

/** «New on the market», three rows beside the form, and «All» opens the whole list. */
export function FreshMini({ m, onAll }: { m: LaunchModel; onAll: () => void }) {
  const { w } = m;
  const lang = useLang();
  const towers = useMarket().towers;
  const now = useSeconds(30_000);
  const rows = freshLaunches(towers, 3);
  if (!rows.length || now === null) return null;
  return (
    <Panel pad="none" label={w.fresh} className={l.freshMini}>
      <div className={l.freshHead}>
        <Kick className={l.grow}>{w.fresh}</Kick>
        <button type="button" className={l.all} onClick={onAll}>
          {w.all}
        </button>
      </div>
      <Table columns="minmax(0, 1fr) auto" minWidth={0} label={w.fresh}>
        {rows.map((tower) => (
          <TableRow key={tower.id}>
            <CoinCell icon={coinIcon(tower)} symbol={tower.symbol} name={launchLine(m, tower, now * 1000)} href={coinHref(tower.id, 'live')} />
            <Cell end>{measured(tower, 'mcap') !== null ? usdText(tower.mcap, lang) : ''}</Cell>
          </TableRow>
        ))}
      </Table>
    </Panel>
  );
}

/** The whole list of new launches: the market's own «New» launches, newest first. */
export function FreshPanel({ m }: { m: LaunchModel }) {
  const { w } = m;
  const lang = useLang();
  const towers = useMarket().towers;
  const now = useSeconds(30_000);
  const rows = freshLaunches(towers, 40);
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
                  <CoinCell icon={coinIcon(tower)} symbol={tower.symbol} name={tower.name} href={coinHref(tower.id, 'live')} />
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
                icon={coinIcon(tower)}
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
      <Panel pad="l" gap={14} edge label={w.mine}>
        <p className={l.emptyLine}>{w.mineConnect}</p>
        {picking ? <WalletPick onBack={() => setPicking(false)} /> : <Quiet onClick={() => connectOrPick(() => setPicking(true))}>{w.connect}</Quiet>}
      </Panel>
    );
  }
  const mine = now !== null ? mineOf(read.rows, pools, address, now * 1000) : [];
  if (read.state === 'failed') {
    return (
      <Panel pad="l" gap={14} edge label={w.mine}>
        <p className={l.emptyLine}>{w.mineFailed}</p>
        <Quiet onClick={() => void load()}>{w.tryAgain}</Quiet>
      </Panel>
    );
  }
  if (!mine.length) {
    return (
      <Panel pad="l" edge label={w.mine}>
        <p className={l.emptyLine}>{read.state === 'ready' ? w.mineEmpty : ' '}</p>
      </Panel>
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
      {mine.map((coin) => (
        <ListRow key={coin.token} icon={coin.image} symbol={coin.symbol} name={coin.name} value={mineState(m, coin, now ?? 0)} href={coinHref(coin.token, 'live')} />
      ))}
    </Panel>
  );
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
