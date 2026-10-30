'use client';

import { useEffect, useState } from 'react';
import { requestFrame } from '@/city/lib/capture';
import { useWords, type TextKey } from '@/city/lib/i18n/dict';
import { towerFigure, type District, type Tower, type TowerFigure } from '@/city/lib/market/types';
import { composeTowerCard, shareImage } from '@/city/lib/share';
import { coinLink } from '@/city/lib/share/coin-link';
import { issuerOf, issuerTags, keepIssuer, powerWords } from '@/city/lib/trade/issuer';
import { useTrade } from '@/city/lib/trade/store';
import { ChartAction } from '../chart/ChartAction';
import { compact, formatPrice, money, signed } from '../hud/bits';
import { ShareGlyph } from '../hud/glyphs';
import { COIN } from './words';
import s from './trade.module.css';

/**
 * A figure in the window's compact places — the price line and the four cells: a source that did not measure it
 * leaves a calm dash there, never a clipped «Not meas…»; the words themselves are its tooltip.
 */
const UNMEASURED = '—';
const cell = (tower: Tower, figure: TowerFigure, format: (value: number) => string): string =>
  tower.unread?.includes(figure) ? UNMEASURED : format(tower[figure]);
const unmeasured = (tower: Tower, figure: TowerFigure): string | undefined => (tower.unread?.includes(figure) ? towerFigure(tower, figure, String) : undefined);

const DISTRICT: Record<District, TextKey<typeof COIN>> = {
  core: 'districtCore',
  heights: 'districtHeights',
  strip: 'districtStrip',
  avenue: 'districtAvenue',
  docks: 'districtDocks',
};

/** The coin's price, its day's move and its chart: the first line under the window's head. */
export function CoinPrice({ tower, chart = true }: { tower: Tower; chart?: boolean }) {
  const up = tower.change24h >= 0;
  const w = useWords(COIN);
  return (
    <div className={s.coinPrice}>
      <span className={`${s.display} ${s.coinFigure}`} title={unmeasured(tower, 'price')}>
        {cell(tower, 'price', formatPrice)}
      </span>
      {!tower.unread?.includes('change24h') && (
        <span className={`${s.coinMove} ${up ? s.up : s.down}`}>
          {signed(tower.change24h)} <small>{w.h24}</small>
        </span>
      )}
      {chart && <ChartAction tower={tower} />}
    </div>
  );
}

/**
 * The tower's key figures in the trade window (CITY-78): market cap, liquidity, traders this hour and its rank, then
 * whether Jupiter verified it and what its issuer can still do. Everything else waits behind «Details». The issuer's
 * powers come from the passport on the engine's price for this coin; until a price brings one, they are not shown.
 */
export function CoinFacts({ tower, rank }: { tower: Tower; rank: number }) {
  const passports = useTrade((st) => (st.quote.status === 'ready' ? st.quote.body.passports : null));
  const [open, setOpen] = useState(false);
  const w = useWords(COIN);
  useEffect(() => setOpen(false), [tower.id]);
  const issuer = keepIssuer(tower.id, issuerOf(passports, tower.id));
  const tags = issuerTags(issuer);

  return (
    <>
      <div className={s.facts}>
        <Fact label={w.mktCap} value={cell(tower, 'mcap', money)} title={unmeasured(tower, 'mcap')} />
        <Fact label={w.liquidity} value={cell(tower, 'liquidity', money)} title={unmeasured(tower, 'liquidity')} />
        <Fact label={w.traders1h} value={cell(tower, 'traders1h', compact)} title={unmeasured(tower, 'traders1h')} />
        <Fact label={w.rank} value={rank ? `#${rank}` : '—'} />
      </div>
      <div className={s.tagRow}>
        <span className={s.tags}>
          {tower.verified ? <span className={`${s.tag} ${s.tagOk}`}>{w.verified}</span> : <span className={`${s.tag} ${s.tagWarn}`}>{w.unverified}</span>}
          {tags.map((tag) => (
            <span key={tag.text} className={`${s.tag} ${tag.tone === 'ok' ? s.tagOk : s.tagWarn}`}>
              {tag.text}
            </span>
          ))}
        </span>
        <button className={`${s.factLink} ${open ? s.factLinkOn : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {w.details}
          <svg className={s.chevron} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={open ? 'M3 7.5l3-3 3 3' : 'M3 4.5l3 3 3-3'} />
          </svg>
        </button>
      </div>
      {open && (
        <dl className={s.details}>
          <dt>{w.name}</dt>
          <dd>{tower.name}</dd>
          <dt>{w.district}</dt>
          <dd>{w[DISTRICT[tower.district]]}</dd>
          <dt>{w.volume24h}</dt>
          <dd>{towerFigure(tower, 'volume24h', money)}</dd>
          <dt>{w.holders}</dt>
          <dd>{towerFigure(tower, 'holders', compact)}</dd>
          <dt>{w.move1h}</dt>
          <dd>{towerFigure(tower, 'change1h', signed)}</dd>
          <dt>{w.organic}</dt>
          <dd>{towerFigure(tower, 'organic', (v) => `${Math.round(v)}/100`)}</dd>
          <dt>{w.verified}</dt>
          <dd>{tower.verified ? w.byJupiter : w.no}</dd>
          {issuer && (
            <>
              <dt>{w.canMintMore}</dt>
              <dd>{powerWords(issuer.mint)}</dd>
              <dt>{w.canFreeze}</dt>
              <dd>{powerWords(issuer.freeze)}</dd>
            </>
          )}
        </dl>
      )}
    </>
  );
}

/** «Share tower»: a quiet button in the window's head — a frame of the city with the tower's card, to post or save. */
export function ShareTower({ tower, rank, total }: { tower: Tower; rank: number; total: number }) {
  const [busy, setBusy] = useState(false);
  const w = useWords(COIN);
  useEffect(() => setBusy(false), [tower.id]);
  const share = async () => {
    setBusy(true);
    // Let the camera finish its flight before taking the frame.
    await new Promise((r) => setTimeout(r, 120));
    const frame = await requestFrame();
    const blob = await composeTowerCard(frame, tower, rank, total);
    if (blob) await shareImage(blob, `${tower.symbol.replace(/[^a-z0-9]/gi, '')}-tower.png`, w.shareText(`$${tower.symbol.replace(/^\$/, '')}`, rank, coinLink(tower.id)));
    setBusy(false);
  };
  return (
    <button className={`${s.shareTower} ${busy ? s.waiting : ''}`} onClick={() => void share()} disabled={busy} aria-label={w.shareTower}>
      <ShareGlyph />
      <span className={s.shareTowerWord}>{w.share}</span>
    </button>
  );
}

function Fact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className={s.fact}>
      <div className={s.factLabel}>{label}</div>
      <div className={s.factValue} title={title}>
        {value}
      </div>
    </div>
  );
}
