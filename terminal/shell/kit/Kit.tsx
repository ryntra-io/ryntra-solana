'use client';

import { useMemo, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { Split } from '../Split';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { SOL, USDC } from '@/city/lib/trade/tiles';
import {
  Action,
  AmountField,
  Cell,
  Chip,
  CoinCell,
  CoinLogo,
  Figure,
  Icon,
  Info,
  Kick,
  ListRow,
  Panel,
  Quiet,
  QuietLink,
  SayLine,
  Search,
  Segment,
  Shares,
  Slider,
  SwitchRow,
  Table,
  TableHead,
  TableRow,
  Tabs,
  Tile,
  Title,
  amountOf,
  changeText,
  changeTone,
  coinIcon,
  priceText,
  usdText,
} from '@/terminal/ui';
import { useAskHere } from '../useAskHere';
import { useMarket } from '../useMarket';
import { useSay } from '../say';
import { coinHref, shelfHref, type ShelfId } from '../shelves';
import { SHELF_WORDS } from '../words';
import { KIT } from './words';
import k from './kit.module.css';

type Span = 'h24' | 'h1' | 'm5';
const CHANGE: Readonly<Record<Span, 'change24h' | 'change1h' | 'change5m'>> = { h24: 'change24h', h1: 'change1h', m5: 'change5m' };
const COLUMNS = 'minmax(184px, 1.7fr) minmax(96px, 1.1fr) minmax(74px, 0.8fr) minmax(84px, 0.9fr) minmax(84px, 0.9fr)';
const SHARES = ['25', '50', '75', 'max'] as const;

/**
 * The kit page: every part of the kit on the market's real figures (the market read every screen stands on), laid out
 * as the market screen of the approved design, with the rail showing every shelf in its preview state. A shelf's
 * preview takes the sentences the agent's line hands it and shows the last one it got. Nothing here moves money: the
 * amber action hands its sentence to the Market's preview, as the agent's line would.
 */
export function Kit({ shelf }: { shelf: ShelfId | null }) {
  const w = useWords(KIT);
  const names = useWords(SHELF_WORDS);
  const lang = useLang();
  const say = useSay();
  const towers = useMarket().towers;
  const [span, setSpan] = useState<Span>('h24');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('10');
  const [share, setShare] = useState<(typeof SHARES)[number] | null>(null);
  const [collect, setCollect] = useState(true);
  const [distance, setDistance] = useState(8);
  const [said, setSaid] = useState<string | null>(null);
  useAskHere((ask) => setSaid(ask.said));

  const named = useMemo(() => towers.filter((t) => t.verified && t.symbol).sort((a, b) => b.volume24h - a.volume24h), [towers]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\$/, '');
    return (q ? named.filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) : named).slice(0, 12);
  }, [named, query]);
  const sol = useMemo(() => towers.find((t) => t.id === SOL.mint) ?? null, [towers]);
  const volume = useMemo(() => named.reduce((sum, t) => sum + (t.volume24h || 0), 0), [named]);
  const rising = useMemo(() => named.filter((t) => t[CHANGE[span]] > 0).length, [named, span]);

  const typed = Number(amount.replace(',', '.'));
  const solPrice = sol?.price ?? 0;
  const get = solPrice > 0 && typed > 0 ? (side === 'buy' ? typed / solPrice : typed * solPrice) : 0;
  const view = 'preview' as const;
  const change = (t: Tower) => t[CHANGE[span]];

  return (
    <>
      <div className={k.head}>
        <Title>{shelf ? names[shelf] : w.kit}</Title>
        <Tabs
          className={k.headTabs}
          label={w.window}
          value={span}
          onChange={setSpan}
          items={[
            { id: 'h24', label: w.h24, count: String(named.length) },
            { id: 'h1', label: w.h1 },
            { id: 'm5', label: w.m5 },
          ]}
        />
        {said ? (
          <Chip tone="ok" dot>
            {w.said}: «{said}»
          </Chip>
        ) : null}
        <div className={k.grow} />
        <span className={k.desktopOnly}>
          <Search value={query} onChange={setQuery} placeholder={w.search} />
        </span>
        <button type="button" className={`${k.iconBtn} ${k.phoneOnly}`} aria-label={w.search} aria-expanded={searching} onClick={() => setSearching((was) => !was)}>
          <Icon name="search" />
        </button>
        <QuietLink className={`${k.phoneOnly} ${k.launchBtn}`} href={shelfHref('launch', view)}>
          <Icon name="launch" size="s" />
          {names.launch}
        </QuietLink>
        {searching ? (
          <span className={`${k.phoneOnly} ${k.searchRow}`}>
            <Search value={query} onChange={setQuery} placeholder={w.search} />
          </span>
        ) : null}
      </div>

      {/* The side column as every screen gets it: dragged, folded, remembered; a sheet on a phone. */}
      <Split
        id="kit"
        label={w.quickBuy}
        peek={
          <>
            <CoinLogo src={sol ? coinIcon(sol) : SOL.icon ?? null} symbol="SOL" />
            <span className={k.coinSym}>SOL</span>
            <span className={k.grow} />
            {sol ? <Figure value={priceText(sol.price, lang)} size="m" /> : null}
          </>
        }
        side={
          <>
            <Panel tone="hi" gap={12} label={w.quickBuy}>
              <div className={k.coinHead}>
                <CoinLogo src={sol ? coinIcon(sol) : SOL.icon ?? null} symbol="SOL" size="l" />
                <span className={k.coinWords}>
                  <span className={k.coinSym}>SOL</span>
                  <span className={k.coinName}>{sol?.name ?? 'Solana'}</span>
                </span>
                {sol ? (
                  <span className={k.coinPrice}>
                    <Figure value={priceText(sol.price, lang)} size="m" />
                    <span className={k.coinChange} data-tone={changeTone(sol.change24h)}>
                      {changeText(sol.change24h, lang)}
                    </span>
                  </span>
                ) : null}
              </div>
              <Segment
                label={w.side}
                value={side}
                onChange={setSide}
                items={[
                  { id: 'buy', label: w.buy, tone: 'buy' },
                  { id: 'sell', label: w.sell, tone: 'sell' },
                ]}
              />
              <AmountField label={w.pay} value={amount} onChange={setAmount} asset={side === 'buy' ? { symbol: USDC.symbol, icon: `/api/icon/${USDC.mint}` } : { symbol: SOL.symbol, icon: SOL.icon ?? null }} />
              <Shares label={w.shares} value={share} onPick={setShare} options={SHARES.map((id) => ({ id, label: id === 'max' ? w.max : `${id}%` }))} />
              <div className={k.between}>
                <span className={k.getCol}>
                  <Kick>{w.get}</Kick>
                  <Figure value={get > 0 ? amountOf(get, side === 'buy' ? 4 : 2, lang) : '—'} unit={side === 'buy' ? 'SOL' : 'USDC'} size="m" />
                </span>
                <Info label={w.details}>{w.detailsText}</Info>
              </div>
              <Action onClick={() => say(lang === 'uk' ? `${side === 'buy' ? 'купити' : 'продати'} SOL на ${amount || '10'}` : `${side} SOL for ${amount || '10'}`)}>
                {side === 'buy' ? w.buyCoin('SOL') : w.sellCoin('SOL')}
              </Action>
            </Panel>
  
            <Panel gap={10} label={w.agentDoes}>
              <div className={k.agentHead}>
                <Icon name="agents" />
                <Kick className={k.agentKick}>{w.agentDoes}</Kick>
                <Info label={w.howAgent}>{w.howAgentText}</Info>
              </div>
              {[w.say1, w.say2, w.say3].map((sentence) => (
                <SayLine key={sentence} onSay={() => say(sentence)}>
                  {sentence}
                </SayLine>
              ))}
            </Panel>
          </>
        }
      >
        <Panel className={k.tableWrap} pad="none" label={w.coins}>
          <Table columns={COLUMNS} minWidth={560} label={w.coins}>
            <TableHead>
              <Cell head>{w.coin}</Cell>
              <Cell head end>
                {w.price}
              </Cell>
              <Cell head end>
                {w[span]}
              </Cell>
              <Cell head end sorted>
                {w.volume}
              </Cell>
              <Cell head end>
                {w.liquidity}
              </Cell>
            </TableHead>
            {shown.map((t) => (
              <TableRow key={t.id} current={t.id === SOL.mint}>
                <CoinCell icon={coinIcon(t)} symbol={t.symbol} name={t.name} href={coinHref(t.id, view)} />
                <Cell end>{priceText(t.price, lang)}</Cell>
                <Cell end tone={changeTone(change(t))}>
                  {changeText(change(t), lang)}
                </Cell>
                <Cell end>{usdText(t.volume24h, lang)}</Cell>
                <Cell end tone="dim">
                  {usdText(t.liquidity, lang)}
                </Cell>
              </TableRow>
            ))}
          </Table>
        </Panel>

        <div className={k.listWrap}>
          {shown.slice(0, 9).map((t) => (
            <ListRow
              key={t.id}
              icon={coinIcon(t)}
              symbol={t.symbol}
              name={t.name}
              value={priceText(t.price, lang)}
              change={changeText(change(t), lang)}
              tone={changeTone(change(t))}
              href={coinHref(t.id, view)}
            />
          ))}
        </div>

      </Split>

      <div className={k.parts}>
        <Panel className={k.part} gap={12} label={w.facts}>
          <Kick>{w.facts}</Kick>
          <div className={k.tiles}>
            <Tile label={w.listed} value={amountOf(named.length, 0, lang)} />
            <Tile label={w.rising} value={amountOf(rising, 0, lang)} tone={rising > 0 ? 'up' : undefined} />
            <Tile label={w.volume24} value={usdText(volume, lang)} />
          </div>
        </Panel>
        <Panel className={k.part} gap={12} label={w.parts}>
          <Kick>{w.parts}</Kick>
          <div className={k.chips}>
            <Chip tone="ok" dot>
              {w.working}
            </Chip>
            <Chip tone="warn">{w.waiting}</Chip>
            <Chip>{w.filled}</Chip>
          </div>
          <SwitchRow label={w.collect} on={collect} onChange={setCollect} />
          <div className={k.sliderHead}>
            <span>{w.distance}</span>
            <span className={k.sliderValue}>{amountOf(distance, 0, lang)}%</span>
          </div>
          <Slider label={w.distance} value={distance} min={1} max={30} onChange={setDistance} valueText={`${distance}%`} />
          <div className={k.buttons}>
            <Quiet>{w.stop}</Quiet>
            <Quiet size="s">{w.open}</Quiet>
          </div>
        </Panel>
      </div>
    </>
  );
}
