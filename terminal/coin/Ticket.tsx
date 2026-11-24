'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { SPOT, TRADE, riskWords } from '@/city/components/trade/words';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue, plainFigure } from '@/city/lib/i18n/figures';
import { useLang } from '@/city/lib/i18n/lang';
import { decimalsOf, figuresOf, friendDiscountOf, type Figures } from '@/city/lib/trade/figures';
import { cleanSells, OWN_SELLS, useTradePrefs, writeTrade } from '@/city/lib/settings/trade';
import { formatBps, formatUnits } from '@/city/lib/trade/format';
import { SPOT_OPEN, STOPS_ENGINE, TRADE_OPEN } from '@/city/lib/trade/gates';
import type { LimitIntent } from '@/city/lib/trade/limits';
import type { Market as LadderMarket } from '@/city/lib/trade/pro-ladder';
import { LADDER_BUSY, useLadder } from '@/city/lib/trade/pro-store';
import { engineAmount, reviewKey, SPOT_BUSY, SPOT_IDLE, useSpot } from '@/city/lib/trade/spot-store';
import { typedPrice } from '@/lib/solana/limits/model';
import { balanceOf, choiceOf, reviewNotes, useTrade, type Choice, type CoinRef, type Done as DoneTrade, type Mode, type Review, type TowerRef } from '@/city/lib/trade/store';
import { isBase, payAssetFor, unitOf, USDC, type PayAsset, type Side } from '@/city/lib/trade/tiles';
import { sellLine, sellWords } from '@/city/lib/trade/tower-window';
import { useWallet, type Holdings } from '@/city/lib/trade/wallet';
import { useDismiss } from '@/terminal/shell/useDismiss';
import { PrivateStockPart, startPrivateStockBuy, usePrivateStock, usePrivateStockButton } from '@/terminal/stocks/private/PrivateStockBuy';
import { Action, AmountField, Chip, CoinLogo, Figure, Icon, Kick, Panel, Quiet, Segment, Shares, Switch, Tabs, cx } from '@/terminal/ui';
import { FEE } from '@/terminal/ui/words';
import { setLimitTab, useLadderHere, useLimitTab } from './ladder/here';
import { LadderTicket } from './ladder/LadderTicket';
import { LimitStop, SPOT_RESULT } from './LimitStop';
import { ExplainBox, ExplainButton, LONG_LABEL, Rows, TxLink, bare, connectOrPick } from './parts';
import { coinLogo, paidRows, payLogo, payRows, saleMoney, USDC_LOGO } from './staples';
import { actionOf, cleanPct, editQuick, entryOf, protectPrices, retryShown, STOP_RANGE, TAKE_RANGE, type ActionLabel, type CoinStand, type QuickPay } from './ticket-rules';
import { BUY_TICKET } from './ticket-words';
import { hydrateTicketExtras, quickPayOf, useCoinStand, useTicket, useTicketExtras } from './useTicket';
import { zerosText } from './tiny';
import { WalletPick } from './WalletPick';
import { TICKET } from './words';
import s from './ticket.module.css';

/** Whether this deployment trades at all: shut, a screen draws no ticket. */
export const TICKET_OPEN = TRADE_OPEN;

const MODES = ['market', 'limit', 'stop'] as const;

/**
 * The ticket: buy or sell one coin at the engine's price, in the approved design's look. Everything it shows and does
 * is the trade card's logic, as it is — the price, the route, Ryntra's fee, the exact order, the wallet's signature
 * and the reading of the outcome (`city/lib/trade/**`, through `useTicket`); only the screen is new.
 *
 * Before the one amber press it shows what you get, the fee and — once the wallet's exact order is built — the least
 * you get and the price impact, in one line; the breakdown waits behind «i». The button asks the trade card for its one
 * step: a price alone builds the exact order and shows it, and only a press over that order opens the wallet. A price
 * that did not come says so in plain words, and «Try again» — a quiet control of its own — only reads the price again.
 *
 * `modes`: Market · Limit · Stop on top, where the engine keeps limits and stops open. `head`: what stands over the
 * fields (the coin with its price, on the Market's side panel). `onTopUp`: where a person with nothing to buy with is
 * sent; without it the button says what is short. `onOrders`: «My orders» after a limit or a stop is placed. `lean`: on a
 * phone, the ticket as the approved design draws it under a chart — on the page itself, without its panel and its shares.
 * `limits`: the coin's own screen — where the coin has a DLMM Pro pool, its Limit tab buys cheaper or sells higher there,
 * at one price or on a ladder (`ladder/LadderTicket.tsx`), on a desk and on a phone; `usd` is the coin's price the chart
 * shows, so the ladder's lines stand where its prices are.
 *
 * `desk`: the coin's own trading desk — quick sums under the amount (in SOL, or in dollars paying with USDC or
 * USDT), the slippage the order allows in
 * the terms' line, and `foot` (the coin's facts) at the panel's foot, so the ticket stands the column's whole height.
 *
 * `only`: one order type and no row of them — the Swap screen's own Limit tab, where the screen's tabs are the
 * row. `framed`: false draws the fields into the panel that holds them (the Swap screen's one card), without a panel of
 * the ticket's own. `side`: the side the card opens on for this coin (a sale on the swap stays a sale on its limit).
 *
 * On the desk the buy is a trader's ticket: the person's own quick sums and sale shares (kept in this browser, the keys
 * 1–4 reach the same deeds — `quickNow`), take-profit and stop in one line at the buy, the limit by market cap (`supply`:
 * the supply the coin's market cap is counted on, as the chart counts it), the fee and the slippage in one line with what
 * they do behind «i», the strip of what this wallet did in the coin, and `risk` — the coin's risk line — over the button.
 */
export function Ticket({
  coin,
  modes = false,
  only,
  framed = true,
  side = 'buy',
  head,
  onTopUp,
  onOrders,
  lean = false,
  limits = false,
  usd = null,
  desk = false,
  foot,
  risk,
  supply = null,
  onEarn,
  className,
}: {
  coin: CoinRef;
  modes?: boolean;
  only?: Exclude<Mode, 'market'>;
  framed?: boolean;
  side?: Side;
  head?: ReactNode;
  onTopUp?: () => void;
  onOrders?: () => void;
  lean?: boolean;
  limits?: boolean;
  usd?: number | null;
  desk?: boolean;
  foot?: ReactNode;
  risk?: ReactNode;
  supply?: number | null;
  onEarn?: () => void;
  className?: string;
}) {
  const w = useWords(TICKET);
  const press = useTicket(coin, 'spot', side);
  const ladder = useLadderHere(limits ? { mint: coin.id, symbol: coin.symbol } : null);
  const card = useTrade((st) => st.tower);
  const phase = useTrade((st) => st.phase);
  // Until the card opens on this coin (the first frame), the ticket stands on the coin the screen named.
  const tower: TowerRef = card ?? { mint: coin.id, symbol: coin.symbol, name: coin.name, icon: coin.icon };
  const other = tower.mint !== coin.id;
  const body = (
    <>
      {head}
      {other ? <Chip>{w.openTrade(bare(tower.symbol))}</Chip> : null}
      {phase === 'done' ? (
        <Done protect={desk} onEarn={tower.mint === coin.id ? onEarn : undefined} />
      ) : phase === 'failed' ? (
        <Failed />
      ) : phase === 'unknown' ? (
        <Unknown press={press} />
      ) : (
        <Fields tower={tower} modes={modes} only={only} press={press} onTopUp={onTopUp} onOrders={onOrders} ladder={tower.mint === coin.id ? ladder : null} usd={usd} desk={desk} risk={tower.mint === coin.id ? risk : undefined} supply={tower.mint === coin.id ? supply : null} />
      )}
    </>
  );
  if (!framed) return body;
  return (
    <Panel tone="hi" gap={desk ? 8 : 12} label={w.label} className={cx(lean && s.lean, desk && s.desk, className)}>
      {body}
      {foot ? <div className={s.foot}>{foot}</div> : null}
    </Panel>
  );
}

function Fields({
  tower,
  modes,
  only,
  press,
  onTopUp,
  onOrders,
  ladder,
  usd,
  desk = false,
  risk,
  supply = null,
}: {
  tower: TowerRef;
  modes: boolean;
  only?: Exclude<Mode, 'market'>;
  press: () => Promise<'connect' | 'ok'>;
  onTopUp?: () => void;
  onOrders?: () => void;
  ladder: LadderMarket | null;
  usd: number | null;
  desk?: boolean;
  risk?: ReactNode;
  supply?: number | null;
}) {
  const t = useWords(TRADE);
  const w = useWords(TICKET);
  const x = useWords(BUY_TICKET);
  // The person's own sale shares (kept by the trade card's settings) and quick sums (this ticket's): a change redraws.
  useTradePrefs((st) => st.prefs.sells);
  const kept = useTicketExtras((st) => st.kept);
  const protectOn = useTicketExtras((st) => st.protectOn);
  const [editing, setEditing] = useState(false);
  useEffect(() => hydrateTicketExtras(), []);
  const side = useTrade((st) => st.side);
  const pay = useTrade((st) => st.pay);
  const otherCoin = useTrade((st) => st.other);
  const storeMode = useTrade((st) => st.mode);
  const typed = useTrade((st) => st.typed);
  const phase = useTrade((st) => st.phase);
  const auto = useTrade((st) => st.auto);
  const setSide = useTrade((st) => st.setSide);
  const setMode = useTrade((st) => st.setMode);
  const setShare = useTrade((st) => st.setShare);
  const setTyped = useTrade((st) => st.setTyped);
  const spotPhase = useSpot((st) => st.phase);
  const holdings = useWallet((st) => st.holdings);
  const connected = useWallet((st) => Boolean(st.connection));
  const [menu, setMenu] = useState(false);
  // The list closes on a tap outside the field it hangs from, and on Escape; the pill itself opens and closes it.
  const payBox = useRef<HTMLDivElement>(null);
  useDismiss(menu, payBox, () => setMenu(false));
  // The Limit tab on the coin's ladders: on by a tap or a sentence that asked for a ladder; a sentence for a limit or a
  // stop at Jupiter (the store's own mode) takes the ticket back to those.
  const ladderTab = useLimitTab((st) => st.mint === tower.mint && st.on);
  const ladderBusy = useLadder((st) => LADDER_BUSY.has(st.phase));
  const ladderOn = ladder !== null && ladderTab;
  useEffect(() => {
    if (storeMode !== 'market' && useLimitTab.getState().on) setLimitTab(tower.mint, false);
  }, [storeMode, tower.mint]);

  // One order type only (the Swap screen's Limit tab): the card is turned to it as soon as it stands open on this coin as
  // a ticket of its own — not the swap's card it replaces, which closes as this one opens.
  const onCoin = useTrade((st) => st.open && st.view !== 'swap' && st.tower?.mint === tower.mint);
  useEffect(() => {
    if (only && onCoin && storeMode !== only && phase === 'idle') setMode(only);
  }, [only, onCoin, storeMode, phase, setMode]);

  const choice = choiceOf(tower, side, holdings, { pay, typed, other: otherCoin });
  // Limit and Stop exist only where the engine keeps them open: where the screen asks for them, and wherever a limit or a
  // stop is already on the ticket (a sentence asked for one) — so it is shown as it is, never turned into a market order.
  const spot = SPOT_OPEN && (modes || only !== undefined || storeMode !== 'market');
  const mode: Mode = spot ? storeMode : 'market';
  const owned = balanceOf(holdings, tower.mint);
  const nothing = sellLine(side, connected, Boolean(holdings), owned);
  const idle = phase === 'idle' && (mode === 'market' || SPOT_IDLE.has(spotPhase));
  // An order the card builds by itself never shuts the field: typing on drops that order.
  const typable = idle || (phase === 'preparing' && auto);
  const coin = bare(tower.symbol);
  // What pays can change only while the ticket rests: its list closes as an order starts being built.
  useEffect(() => {
    if (!idle) setMenu(false);
  }, [idle]);
  // A buy turned into a sale — by the switch, «Sell» under the chart, the phone's bar or a sentence — is paid in money: a coin of the wallet picked to pay with gives way to SOL (USDC on the SOL desk), as the paid-in list
  // offers them; turned back into a buy, the coin comes back while the wallet still holds it. It happens as the side
  // changes, in the same beat — a price said for the sale is written against the coin it is paid in.
  useEffect(() => {
    let left: Readonly<{ coin: PayAsset; money: string }> | null = null;
    return useTrade.subscribe((card, was) => {
      if (card.side === was.side || card.phase !== 'idle' || card.held || card.tower?.mint !== tower.mint) return;
      // Never under a limit's or a stop's signature either.
      if (!SPOT_IDLE.has(useSpot.getState().phase)) return;
      const pay = payAssetFor(tower.mint, card.pay, card.other);
      if (card.side === 'sell') {
        const money = saleMoney(tower.mint, pay.mint);
        left = money ? { coin: pay, money: money.mint } : null;
        if (money) pickPay(money);
        return;
      }
      const back = left;
      left = null;
      const held = back ? balanceOf(useWallet.getState().holdings, back.coin.mint) : null;
      if (back && pay.mint === back.money && held && held.spendableRaw !== '0') pickPay(back.coin);
    });
  }, [tower.mint]);

  // Market always; Limit where Jupiter's limits are open on this screen or the coin has a ladder pool; Stop with Jupiter's.
  const tabs = MODES.filter((id) => id === 'market' || (id === 'limit' ? spot || ladder !== null : spot));
  const pick = (id: Mode) => {
    if (id === 'limit' && ladder) {
      setLimitTab(tower.mint, true);
      if (storeMode !== 'market') setMode('market');
      return;
    }
    setLimitTab(tower.mint, false);
    setMode(id);
  };
  const tabsRow =
    !only && tabs.length > 1 ? (
      <fieldset className={cx(s.group, storeMode === 'market' && !ladder && s.modes)} disabled={ladderOn ? ladderBusy : !idle}>
        <Tabs fill label={t.orderType} value={ladderOn ? 'limit' : mode} onChange={pick} items={tabs.map((id) => ({ id, label: t[id] }))} />
      </fieldset>
    ) : null;

  // One order type only: until the card has turned to it (the frame after it opens), nothing of another type is drawn —
  // its fields then open on the card as it stays, and read their pair's price once the card has stopped changing. A
  // trade of another type still under its signature is shown as it is.
  if (only && mode !== only && phase === 'idle') return null;

  if (ladderOn) {
    return (
      <>
        {tabsRow}
        <LadderTicket coin={tower} market={ladder} usd={usd} onOrders={onOrders} />
      </>
    );
  }

  // A placed limit or a set stop is said on its own, without the fields it was made from.
  if (mode !== 'market' && SPOT_RESULT.has(spotPhase)) return <LimitStop tower={tower} choice={choice} mode={mode} onOrders={onOrders} supply={supply} />;

  const balance = choice.holding;
  const shares = choice.sizing.chips.map((chip) => ({ id: String(chip.share), label: chip.share === 100 ? w.max : w.share(String(chip.share)) }));
  const lit = choice.sizing.chips.find((chip) => chip.on);
  // What the amount is written in: the coin paid with when buying (a list of them), the coin itself when selling — each
  // with its logo, the coin's own through the engine's route whether or not it is a tower of the market.
  const asset = side === 'buy' ? { symbol: bare(unitOf(choice.pay)), icon: payLogo(choice.pay) } : { symbol: coin, icon: coinLogo(tower) };
  const quickPay = quickPayOf(choice.pay.mint);
  const sums = quickPay ? kept.sums[quickPay] : null;
  // The quick sums and shares are the desk's, and changed where they stand: beside the buy's sums, else beside the shares.
  const quickBuy = desk && side === 'buy' && sums !== null;
  const editButton = desk ? (
    <Quiet size="s" className={s.edit} aria-label={x.editQuick} title={x.editQuick} aria-expanded={editing} disabled={!typable} onClick={() => setEditing((was) => !was)}>
      <Icon name="tools" size="s" />
    </Quiet>
  ) : null;
  // Take-profit and stop at the buy: where Jupiter's limits and the stops are open, on a market buy paid in SOL or dollars.
  const protectShown = desk && SPOT_OPEN && side === 'buy' && mode === 'market' && quickPay !== null;

  return (
    <>
      {tabsRow}
      <fieldset className={s.group} disabled={!idle}>
        <Segment
          label={t.buyOrSell}
          value={side}
          onChange={setSide}
          items={[
            { id: 'buy', label: t.buy, tone: 'buy' },
            { id: 'sell', label: t.sell, tone: 'sell' },
          ]}
        />
      </fieldset>
      {nothing ? (
        <NothingToSell coin={coin} line={sellWords(nothing, coin)} connect={nothing === 'connect'} />
      ) : (
        <>
          <fieldset className={s.group} disabled={!typable}>
            <div className={s.anchor} ref={payBox}>
              <AmountField
                label={side === 'buy' ? t.youPay : t.youSell}
                aside={balance && choice.spendDecimals !== null ? w.balance(digits(formatUnits(balance.spendableRaw, choice.spendDecimals, 'down'))) : undefined}
                value={fieldText(typed)}
                onChange={(text) => setTyped(fieldValue(text))}
                asset={asset}
                onAsset={side === 'buy' && idle ? () => setMenu((was) => !was) : undefined}
                assetLabel={t.payAnother}
                assetOpen={side === 'buy' && idle ? menu : undefined}
              />
              {menu && side === 'buy' ? <PayMenu tower={tower} choice={choice} holdings={holdings} label={t.payWith} onClose={() => setMenu(false)} /> : null}
            </div>
          </fieldset>
          {editing && desk ? (
            <QuickEdit pay={quickPay ?? 'sol'} onClose={() => setEditing(false)} />
          ) : (
            <>
              {quickBuy && sums ? (
                <div className={s.quickRow}>
                  <fieldset className={cx(s.group, s.shares)} disabled={!typable}>
                    <Shares label={w.quick(asset.symbol)} options={sums.map((sum) => ({ id: sum, label: quickPay === 'usd' ?`$${digits(sum)}` : `${digits(sum)} ${asset.symbol}` }))} value={sums.find((sum) => sum === typed) ?? null} onPick={(sum) => setTyped(sum)} />
                  </fieldset>
                  {editButton}
                </div>
              ) : null}
              {/* A buy in SOL or dollars has its sums; the shares of a balance are a sale's, and a buy's in another coin. */}
              {quickBuy ? null : (
                <div className={s.quickRow}>
                  <fieldset className={cx(s.group, s.shares)} disabled={!typable || choice.sizing.share === null}>
                    <Shares label={t.shareOfBalance} options={shares} value={lit ? String(lit.share) : null} onPick={(id) => setShare(Number(id))} />
                  </fieldset>
                  {editButton}
                </div>
              )}
            </>
          )}
          {protectShown ? <ProtectRow on={protectOn} take={kept.protect.take} stop={kept.protect.stop} disabled={!typable} /> : null}
          {mode === 'market' ? (
            <MarketPart tower={tower} choice={choice} press={press} onTopUp={onTopUp} idle={idle} desk={desk} risk={risk} usd={usd} />
          ) : (
            <LimitStop tower={tower} choice={choice} mode={mode} onOrders={onOrders} onTopUp={onTopUp} supply={supply} risk={risk} />
          )}
        </>
      )}
    </>
  );
}

/** A coin's logo as the trade logic names it: a same-origin picture when it has one; SOL's from the engine, USDC's own. */
export function iconOf(asset: PayAsset): string | null {
  if (asset.icon) return asset.icon;
  if (asset.mint === USDC.mint) return USDC_LOGO;
  return isBase(asset) ? `/api/icon/${asset.mint}` : null;
}

/**
 * A pick from the ticket's lists, as the trade card takes it (`pickCoin`: SOL and USDC by their symbol, any other coin
 * by itself; a buy starts again in the coin picked — ten dollars in USDC or USDT — and a sale keeps its amount).
 */
const pickPay = (asset: PayAsset): void => useTrade.getState().pickCoin(asset);

/** One coin of the ticket's lists: its logo (asked at once — the list opened on a tap), its ticker and, known, its balance. */
function MenuRow({ asset, on, balance, onPick }: { asset: PayAsset; on: boolean; balance: string | null; onPick: () => void }) {
  const symbol = bare(unitOf(asset));
  return (
    <button type="button" role="menuitemradio" aria-checked={on} className={s.menuRow} onClick={onPick}>
      <CoinLogo src={payLogo(asset)} symbol={symbol} size="s" eager />
      <span className={s.menuName}>{symbol}</span>
      {balance !== null ? <span className={s.menuAside}>{digits(balance)}</span> : null}
    </button>
  );
}

/**
 * What a buy is paid with: SOL, USDC and USDT always, then the coins of the wallet with something to spend —
 * one tap each, each with its logo and, with a wallet, its balance. A pick is the trade card's own (`setPay`,
 * `pickCoin`); the price and the route of any of them are the swap engine's.
 */
function PayMenu({ tower, choice, holdings, label, onClose }: { tower: TowerRef; choice: Choice; holdings: Holdings | null; label: string; onClose: () => void }) {
  const rows = useMemo<PayAsset[]>(() => {
    const held: { asset: PayAsset; spendableRaw: string }[] = [];
    for (const [mint, balance] of holdings?.tokens ?? []) {
      const name = holdings?.names?.get(mint);
      if (!name?.symbol) continue;
      held.push({ asset: { mint, symbol: name.symbol, decimals: balance.decimals, name: name.name, verified: name.verified, icon: name.icon }, spendableRaw: balance.spendableRaw });
    }
    return payRows({ towerMint: tower.mint, held, picked: choice.pay });
  }, [holdings, choice.pay, tower.mint]);
  return (
    <div className={s.menu} role="menu" aria-label={label}>
      {rows.map((asset) => {
        const balance = balanceOf(holdings, asset.mint);
        return (
          <MenuRow
            key={asset.mint}
            asset={asset}
            on={asset.mint === choice.pay.mint}
            balance={balance ? formatUnits(balance.spendableRaw, balance.decimals, 'down') : null}
            onPick={() => {
              onClose();
              pickPay(asset);
            }}
          />
        );
      })}
    </div>
  );
}

/** The Sell side with nothing to sell, in one line; with no wallet yet, the way to connect one. */
function NothingToSell({ coin, line, connect }: { coin: string; line: string; connect: boolean }) {
  const t = useWords(TRADE);
  const connecting = useWallet((st) => Boolean(st.connecting));
  const [picking, setPicking] = useState(false);
  // Connecting asks the wallet for nothing but its address: it never goes through the trade's press.
  const tap = () => connectOrPick(() => setPicking(true));
  return (
    <>
      <p className={s.line} role="status">
        {line}
      </p>
      {connect ? (
        picking ? (
          <WalletPick onBack={() => setPicking(false)} />
        ) : (
          <Action onClick={tap} disabled={connecting} busy={connecting}>
            {connecting ? t.connecting : t.connectWallet}
          </Action>
        )
      ) : (
        <Action disabled>{t.sellOf(coin)}</Action>
      )}
    </>
  );
}

/**
 * The person's own quick sums, in place of the rows they change: the four sums of a buy in what pays (SOL or dollars),
 * the three sale shares beside «Max», and the take-profit and stop. Kept in this browser on «Save»; a field that cannot
 * be kept says so and keeps the rest unchanged.
 */
function QuickEdit({ pay, onClose }: { pay: QuickPay; onClose: () => void }) {
  const w = useWords(TICKET);
  const x = useWords(BUY_TICKET);
  const kept = useTicketExtras((st) => st.kept);
  const sells = useTradePrefs((st) => st.prefs.sells);
  const [sums, setSums] = useState<string[]>(() => kept.sums[pay].map((sum) => fieldText(sum)));
  const [shares, setShares] = useState<string[]>(() => sells.slice(0, OWN_SELLS).map(String));
  const [take, setTake] = useState(String(kept.protect.take));
  const [stop, setStop] = useState(String(kept.protect.stop));
  const [bad, setBad] = useState<string | null>(null);
  const unit = pay === 'usd' ? '$' : 'SOL';

  const save = () => {
    const row = editQuick(sums.map((sum) => fieldValue(sum)), pay);
    if (!row.ok) return setBad(x.badSum);
    const own = shares.map((share) => cleanPct(share, [1, 99]));
    if (own.some((share) => share === null) || new Set(own).size !== own.length) return setBad(x.badShare);
    const takePct = cleanPct(take, TAKE_RANGE);
    const stopPct = cleanPct(stop, STOP_RANGE);
    if (takePct === null || stopPct === null) return setBad(x.badProtect);
    const extras = useTicketExtras.getState();
    extras.setSums(pay, row.row);
    extras.setProtect({ take: takePct, stop: stopPct });
    // The sale shares are the trade card's own settings (`city/lib/settings/trade.ts`): four different shares, «Max» last,
    // kept on this device the way those settings keep them.
    const sellsNext = cleanSells([...(own as number[]), 100]);
    if (sellsNext) {
      const prefs = { ...useTradePrefs.getState().prefs, sells: sellsNext };
      useTradePrefs.setState({ prefs });
      try {
        writeTrade(window.localStorage, prefs);
      } catch {
        /* A browser that keeps nothing still has the shares for this page. */
      }
    }
    onClose();
  };

  // Each field is the kit's own small amount field: its number, the slot's place as its word.
  const cell = (key: string, label: string, value: string, onChange: (text: string) => void, wide = false) => (
    <div key={key} className={cx(s.editCell, wide && s.editWide)}>
      <AmountField size="s" label={label} value={value} onChange={(text) => (setBad(null), onChange(text.slice(0, 12)))} />
    </div>
  );

  return (
    <div className={s.editor} role="group" aria-label={x.editQuick}>
      <Kick>{w.quick(unit === '$' ? 'USD' : unit)}</Kick>
      <div className={s.editRow}>{sums.map((sum, i) => cell(`sum${i}`, String(i + 1), sum, (text) => setSums((was) => was.map((one, j) => (j === i ? text : one)))))}</div>
      <Kick>{x.sellShares}</Kick>
      <div className={s.editRow}>
        {shares.map((share, i) => cell(`share${i}`, String(i + 1), share, (text) => setShares((was) => was.map((one, j) => (j === i ? text.replace(/\D/g, '').slice(0, 2) : one)))))}
        <div className={s.editCell} title={x.maxStays}>
          <AmountField size="s" label={w.max} value="100" onChange={() => undefined} readOnly />
        </div>
      </div>
      <Kick>{x.protect}</Kick>
      <div className={s.editRow}>
        {cell('take', x.takeLabel, take, (text) => setTake(text.replace(/\D/g, '').slice(0, 4)), true)}
        {cell('stop', x.stopLabel, stop, (text) => setStop(text.replace(/\D/g, '').slice(0, 2)), true)}
      </div>
      {bad ? (
        <p className={s.note} data-tone="error" role="alert">
          {bad}
        </p>
      ) : null}
      <div className={s.editActions}>
        <Quiet size="s" onClick={onClose}>
          {x.cancelQuick}
        </Quiet>
        <Quiet
          size="s"
          onClick={() => {
            useTicketExtras.getState().resetSums();
            onClose();
          }}
        >
          {x.resetQuick}
        </Quiet>
        <Quiet size="s" onClick={save}>
          {x.saveQuick}
        </Quiet>
      </div>
    </div>
  );
}

/**
 * Take-profit and stop at the buy, one line: a switch, «+50% · −20%» and «i». Off until the person turns it on. On, it
 * says in one line what the stop is — a reminder the person signs, never an automatic sale — and the rest waits
 * behind «i». It is set right after the buy lands (`Done`), on the trade card's limits and stops as they are.
 */
function ProtectRow({ on, take, stop, disabled }: { on: boolean; take: number; stop: number; disabled: boolean }) {
  const x = useWords(BUY_TICKET);
  const [details, setDetails] = useState(false);
  const id = useId();
  const takeText = digits(String(take));
  const stopText = digits(String(stop));
  return (
    <>
      <div className={s.protect}>
        <Switch on={on} onChange={(next) => useTicketExtras.getState().setProtectOn(next)} label={`${x.protect} ${x.protectLine(takeText, stopText)}`} disabled={disabled} />
        <span className={s.protectWords} aria-hidden="true">
          <span className={s.protectName}>{x.protect}</span>
          <span className={s.protectFigures} data-on={on || undefined}>
            {x.protectLine(takeText, stopText)}
          </span>
        </span>
        <ExplainButton label={x.protectHow} open={details} controls={id} onToggle={() => setDetails((was) => !was)} />
      </div>
      {on ? <p className={s.protectSays}>{x.protectSays}</p> : null}
      {details ? (
        <ExplainBox id={id}>
          <Rows
            rows={[
              [x.protectRowTake, x.protectTakeIs(takeText)],
              [x.protectRowStop, STOPS_ENGINE ? x.protectStopIs(stopText) : x.protectStopDevice(stopText)],
              [x.protectRowWhen, x.protectWhenIs],
              [x.protectRowDeposit, x.protectDepositIs],
            ]}
          />
        </ExplainBox>
      ) : null}
    </>
  );
}

/** Bought · sold · holding · result of this wallet in the coin, in SOL: drawn only when every figure is known. */
function Stand({ stand }: { stand: CoinStand }) {
  const x = useWords(BUY_TICKET);
  const sol = (value: number) => `${digits(plainFigure(Math.abs(value), { places: Math.abs(value) >= 100 ? 1 : 3, significant: 3 }))} SOL`;
  const sign = stand.resultSol > 0 ? '+' : stand.resultSol < 0 ? '−' : '';
  const tone = stand.resultSol > 0 ? 'up' : stand.resultSol < 0 ? 'down' : undefined;
  return (
    <dl className={s.stand} aria-label={x.stand}>
      <div>
        <dt>{x.bought}</dt>
        <dd>{sol(stand.boughtSol)}</dd>
      </div>
      <div>
        <dt>{x.sold}</dt>
        <dd>{sol(stand.soldSol)}</dd>
      </div>
      <div>
        <dt>{x.holding}</dt>
        <dd>{sol(stand.holdingSol)}</dd>
      </div>
      <div>
        <dt>{x.result}</dt>
        {/* In SOL as its neighbours, said without the unit so the per cent fits beside it. */}
        <dd data-tone={tone} title={`${sign}${sol(stand.resultSol)}`}>
          {`${sign}${digits(plainFigure(Math.abs(stand.resultSol), { places: Math.abs(stand.resultSol) >= 100 ? 1 : 3, significant: 3 }))}`}
          <span className={s.standPct}>{` · ${sign}${digits(plainFigure(Math.abs(stand.resultPct), { places: Math.abs(stand.resultPct) >= 10 ? 0 : 1, significant: 2 }))}%`}</span>
        </dd>
      </div>
    </dl>
  );
}

/** The market ticket: what you get at the engine's price, its terms in one line, and the one amber press. */
function MarketPart({
  tower,
  choice,
  press,
  onTopUp,
  idle,
  desk = false,
  risk,
  usd = null,
}: {
  tower: TowerRef;
  choice: Choice;
  press: () => Promise<'connect' | 'ok'>;
  onTopUp?: () => void;
  idle: boolean;
  desk?: boolean;
  risk?: ReactNode;
  usd?: number | null;
}) {
  const t = useWords(TRADE);
  const w = useWords(TICKET);
  const x = useWords(BUY_TICKET);
  const fw = useWords(FEE);
  const stand = useCoinStand(tower.mint, usd, desk);
  const side = useTrade((st) => st.side);
  const quote = useTrade((st) => st.quote);
  const review = useTrade((st) => st.review);
  const notice = useTrade((st) => st.notice);
  const phase = useTrade((st) => st.phase);
  const autoBuild = useTrade((st) => st.auto);
  const connection = useWallet((st) => st.connection);
  const connecting = useWallet((st) => Boolean(st.connecting));
  // A stock from the private balance: the same ticket and button; the part is `terminal/stocks/private`'s.
  const priv = usePrivateStock(tower.mint, side === 'buy');
  const privButton = usePrivateStockButton();
  const [picking, setPicking] = useState(false);
  const [paidMenu, setPaidMenu] = useState(false);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const paidBox = useRef<HTMLSpanElement>(null);
  useDismiss(paidMenu, paidBox, () => setPaidMenu(false));
  useEffect(() => {
    if (!idle) setPaidMenu(false);
  }, [idle]);

  const shown = review && review.key === choice.key ? review : null;
  const priced = quote.status === 'ready' && quote.key === choice.key ? quote.body : null;
  const failed = quote.status === 'error' && quote.key === choice.key ? quote.refusal : null;
  const coin = bare(tower.symbol);
  const getUnit = side === 'buy' ? coin : bare(unitOf(choice.pay));
  const outputDecimals = shown ? decimalsOf(shown.order, choice.outputMint) : priced ? decimalsOf(priced, choice.outputMint) : null;
  // Written in the language on screen: a switch of it writes the fee and the rest again (QA 19.11: «Fee 0,1%»).
  const figuresLang = useLang();
  const figures = useMemo<Figures | null>(() => {
    if (outputDecimals === null) return null;
    if (shown) return figuresOf(shown.order.order, outputDecimals, 'order');
    return priced ? figuresOf(priced.order, outputDecimals, 'quote') : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the dictionary reads the language `figuresOf` writes in
  }, [shown, priced, outputDecimals, figuresLang]);
  // A partner's friend: the order the wallet signs states the discounted fee of the one the ticket quoted.
  const off = shown ? friendDiscountOf(priced?.order ?? null, shown.order.order) : null;

  // A wallet that connects closes the list of wallets.
  useEffect(() => {
    if (connection) setPicking(false);
  }, [connection]);

  const empty = choice.sizing.max === '0';
  const action = actionOf({
    phase,
    auto: autoBuild,
    side,
    connected: Boolean(connection),
    connecting,
    problem: choice.problem ? (choice.problem.kind === 'balance' ? 'balance' : 'other') : null,
    hasAmount: Boolean(choice.amountRaw),
    empty,
    priced: Boolean(priced),
    exact: Boolean(shown),
    canTopUp: Boolean(onTopUp),
  });
  const retry = retryShown({ quoteFailed: Boolean(failed), retryable: failed?.retryable === true, exact: Boolean(shown), phase });
  const tap = async () => {
    if (action.does === 'topUp') return onTopUp?.();
    if (action.does !== 'press') return;
    if (priv.on && connection) return void (shown && startPrivateStockBuy(shown.order.order, connection.wallet, connection.address));
    if ((await press()) === 'connect') connectOrPick(() => setPicking(true));
  };

  // Beside «Add…» the balance's own sentence is the same news a second time: the button already answers it.
  const problem = choice.problem && !(action.does === 'topUp' && choice.problem.kind === 'balance') ? choice.problem.text : null;
  const warnings = reviewNotes(shown);
  const caution = shown?.order.risk.verdict === 'REVIEW_REQUIRED' ? shown.order.risk.findings.find((finding) => finding.outcome === 'REVIEW_REQUIRED')?.detail : null;
  const note: Readonly<{ tone: string; text: string }> | null =
    (problem ? { tone: 'error', text: problem } : null) ?? notice ?? (warnings[0] ? { tone: 'warn', text: warnings[0] } : caution ? { tone: 'warn', text: caution } : failed ? { tone: 'error', text: failed.message } : null);

  const labels: Readonly<Record<ActionLabel, string>> = {
    verb: side === 'buy' ? t.buyOf(coin) : t.sellOf(coin),
    connect: t.connectWallet,
    connecting: t.connecting,
    building: t.gettingOrder,
    wallet: connection?.wallet ? t.confirmIn(connection.wallet) : t.confirmInWallet,
    sending: t.sending,
    checking: t.readingNetwork,
    short: t.notEnough(bare(choice.spendUnit)),
    nothing: t.nothingToSell,
    topUp: t.addOf(bare(choice.spendUnit)),
  };

  return (
    <>
      <div className={s.getRow}>
        <span className={s.getCol}>
          <Kick>{t.youGet}</Kick>
          <span className={s.getFigure}>
            <span className={s.getValue} aria-live="polite">
              {choice.problem || (!figures && (failed || !choice.amountRaw)) ? (
                <Figure value="—" size="m" />
              ) : figures ? (
                <Figure value={digits(figures.get)} unit={side === 'buy' ? getUnit : undefined} size="m" />
              ) : (
                <span className={s.shimmer} role="status" aria-label={t.gettingPrice} />
              )}
            </span>
            {/* What a sale is paid in stands whatever the price does: a price that did not come for one coin is left
                for another without going through Buy. */}
            {side === 'sell' ? (
              <span className={s.anchor} ref={paidBox}>
                <Quiet size="s" className={s.paidPick} disabled={!idle} aria-label={w.paidIn(getUnit)} aria-haspopup="menu" aria-expanded={paidMenu} onClick={() => setPaidMenu((was) => !was)}>
                  <CoinLogo src={payLogo(choice.pay)} symbol={getUnit} size="s" eager />
                  {getUnit}
                  <Icon name="chevron" size="s" />
                </Quiet>
                {paidMenu ? <PaidMenu tower={tower} choice={choice} label={t.sellFor} onClose={() => setPaidMenu(false)} /> : null}
              </span>
            ) : null}
          </span>
        </span>
      </div>
      {/* The fee and the slippage on a line of their own under what you get, as on the Limit tab: kept before the price
          comes, so its coming moves nothing under the finger (QA 20.11: the button stepped 31 px down as the line came)
          and a long figure never runs into them (EYES 19.11, вада 11). What they do waits behind «i». */}
      <div className={s.terms}>
        {retry ? (
          <Quiet size="s" onClick={() => void useTrade.getState().refreshQuote()}>
            {t.tryAgain}
          </Quiet>
        ) : figures && !choice.problem ? (
          <>
            <span className={s.fee}>
              {figures.fee ? fw.ryntra(figures.fee) : fw.none}
              {off ? <span className={s.off}>{off}</span> : null}
              <span aria-hidden="true">·</span>
              {figures.slippage ? x.slippageLine(digits(figures.slippage)) : x.slippageAuto}
            </span>
            <ExplainButton label={t.tradeDetails} open={details} controls={detailsId} onToggle={() => setDetails((was) => !was)} />
          </>
        ) : null}
      </div>
      {/* With a wallet the exact order follows the price: its least amount and impact take a line kept for them, so the
          button below never moves under the finger. */}
      {connection && !choice.problem && choice.amountRaw && !failed ? (
        <p className={s.exact} aria-live="polite">
          {figures && shown ? (
            <>
              <span>{w.atLeast(digits(figures.minimum), getUnit)}</span>
              <span data-level={figures.impactLevel}>{w.impact(digits(figures.impact))}</span>
            </>
          ) : null}
        </p>
      ) : null}
      {details && figures && !choice.problem ? (
        <ExplainBox id={detailsId}>
          <Details figures={figures} off={off} review={shown} quoteAt={quote.status === 'ready' ? quote.at : null} getUnit={getUnit} />
          <span className={s.rule} aria-hidden="true" />
          <Rows
            rows={[
              [x.rowSlippage, figures.slippage ? x.slippageIs(digits(figures.slippage)) : x.slippageAutoIs],
              [x.rowMinimum, x.minimumIs],
              [x.rowFrontRun, x.frontRunIs],
              [x.rowIfMissed, x.ifMissedIs],
            ]}
          />
        </ExplainBox>
      ) : null}
      {note ? (
        <p className={s.note} data-tone={note.tone} role={note.tone === 'error' ? 'alert' : 'status'}>
          {note.text}
        </p>
      ) : null}
      {stand ? <Stand stand={stand} /> : null}
      {risk && side === 'buy' ? <div className={s.risk}>{risk}</div> : null}
      {priv.offered ? <PrivateStockPart stock={{ mint: tower.mint, symbol: coin, decimals: outputDecimals }} pay={{ mint: choice.inputMint, symbol: bare(unitOf(choice.pay)), decimals: shown ? decimalsOf(shown.order, choice.inputMint) : null }} on={priv.on} /> : null}
      {picking && !connection ? (
        <WalletPick onBack={() => setPicking(false)} />
      ) : (
        // With «Private» on, the press waits for the exact order the ticket builds by itself, and for a buy under way.
        <Action
          className={s.go}
          data-long={labels[action.label].length > LONG_LABEL || undefined}
          onClick={() => void tap()}
          disabled={action.does === 'none' || (priv.on && (privButton.busy || (action.does === 'press' && Boolean(connection) && !shown)))}
          busy={action.busy || (priv.on && privButton.busy)}
        >
          {(priv.on ? privButton.label : null) ?? <>{labels[action.label]}</>}
        </Action>
      )}
    </>
  );
}

/** What a sale is paid in: SOL, USDC or USDT, one tap each, each with its logo. */
function PaidMenu({ tower, choice, label, onClose }: { tower: TowerRef; choice: Choice; label: string; onClose: () => void }) {
  const rows = useMemo(() => paidRows(tower.mint, choice.pay), [tower.mint, choice.pay]);
  return (
    <div className={cx(s.menu, s.menuLeft)} role="menu" aria-label={label}>
      {rows.map((asset) => (
        <MenuRow
          key={asset.mint}
          asset={asset}
          on={asset.mint === choice.pay.mint}
          balance={null}
          onPick={() => {
            onClose();
            pickPay(asset);
          }}
        />
      ))}
    </div>
  );
}

/** The breakdown behind «i»: the fee, the route, the least you get, the impact and — once the order is exact — the rest. */
export function Details({ figures, off, review, quoteAt, getUnit }: { figures: Figures; off: string | null; review: Review | null; quoteAt: number | null; getUnit: string }) {
  const t = useWords(TRADE);
  const w = useWords(TICKET);
  const risk = review?.order.risk.verdict;
  const route = review ? review.order.order.route.map((hop) => hop.label).join(' → ') : figures.route;
  // The least you get is said once the exact order stands; before it, no row says «known later».
  const rows: [string, string][] = [
    [t.ryntraFee, figures.fee ? (off ? `${figures.fee} · ${t.friendOff} ${off}` : figures.fee) : t.none],
    [t.route, route || figures.route],
    ...(review ? [[t.youGetAtLeast, `${digits(figures.minimum)} ${getUnit}`] as [string, string]] : []),
    [t.priceImpact, digits(figures.impact)],
  ];
  if (review) {
    rows.push([t.slippage, digits(figures.slippage)]);
    if (figures.networkSol) rows.push([t.networkFee, `${digits(figures.networkSol)} SOL`]);
    if (figures.depositSol) rows.push([t.newTokenAccount, `${digits(figures.depositSol)} SOL${t.once}`]);
    if (risk) rows.push([t.riskCheck, riskWords(risk, t)]);
  }
  rows.push([t.price, quoteAt ? w.priceFrom(dateText(quoteAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' })) : 'Jupiter']);
  return <Rows rows={rows} />;
}

/**
 * After a trade: what arrived and what it cost, read back from the chain, and the way to the next one. `protect`: the
 * desk's ticket — a buy made with take-profit and stop on is protected here, one press each (`Protect`).
 */
export function Done({ protect = false, onEarn }: { protect?: boolean; onEarn?: () => void }) {
  const t = useWords(TRADE);
  const w = useWords(TICKET);
  const done = useTrade((st) => st.done);
  const again = useTrade((st) => st.again);
  const protectOn = useTicketExtras((st) => st.protectOn);
  if (!done) return null;
  const { trade, side, tower, pay, decimals } = done;
  const coin = bare(tower.symbol);
  const paid = bare(unitOf(pay));
  const got = trade.outputRaw && decimals[trade.outputMint] !== undefined ? formatUnits(trade.outputRaw, decimals[trade.outputMint]!, 'down') : null;
  const gave = trade.inputRaw && decimals[trade.inputMint] !== undefined ? formatUnits(trade.inputRaw, decimals[trade.inputMint]!) : null;
  const bought = side === 'buy';
  const guarded = protect && protectOn && SPOT_OPEN && bought && trade.outputMint === tower.mint && quickPayOf(pay.mint) !== null;
  const next = () => {
    // A take-profit or a stop just set here leaves the limits' ticket at rest for the next order.
    if (guarded && !SPOT_BUSY.has(useSpot.getState().phase)) useSpot.getState().again();
    again();
  };
  return (
    <>
      <div className={s.result} role="status">
        <Kick className={s.kickUp}>{bought ? t.youreIn : t.sold}</Kick>
        {got ? <Figure value={digits(got)} unit={bought ? coin : paid} /> : <Figure value={bought ? t.isYours(coin) : t.done} size="m" />}
        {gave ? <span className={s.line}>{w.forPaid(digits(gave), bought ? paid : coin)}</span> : null}
        <TxLink signature={trade.signature} />
      </div>
      {guarded ? <Protect done={done} onNext={next} /> : <Action onClick={next}>{w.newTrade}</Action>}
      {/* The coin just bought, put to work — the same pool ticket Earn opens, in a drawer on this screen. */}
      {onEarn && bought && trade.outputMint === tower.mint ? (
        <Quiet full onClick={onEarn} data-ticket="earn-on">
          {w.earnOnIt}
        </Quiet>
      ) : null}
    </>
  );
}

/**
 * Take-profit and stop for the buy that just landed, on the trade card's limits and stops as they are: the stop is the
 * stops' own reminder — the wallet proves itself with one signed message, and when the price falls there the person is
 * told and signs the sale; the take-profit is a Jupiter limit order to sell what arrived at the entry plus its per cent,
 * built by the limits engine and shown before the wallet signs it. One press sets the stop and builds the take-profit's
 * order; the next signs that order. Each can be left — «New trade» stands throughout.
 */
function Protect({ done, onNext }: { done: DoneTrade; onNext: () => void }) {
  const t = useWords(TRADE);
  const w = useWords(TICKET);
  const k = useWords(SPOT);
  const x = useWords(BUY_TICKET);
  const fw = useWords(FEE);
  const set = useTicketExtras((st) => st.kept.protect);
  const connection = useWallet((st) => st.connection);
  const spotPhase = useSpot((st) => st.phase);
  const spotReview = useSpot((st) => st.review);
  const spotNotice = useSpot((st) => st.notice);
  const [stopAt, setStopAt] = useState<string | null>(null);
  const [takeAt, setTakeAt] = useState<string | null>(null);
  const [note, setNote] = useState<Readonly<{ tone: string; text: string }> | null>(null);
  const [over, setOver] = useState(false);

  const { trade, tower, pay, decimals } = done;
  const coin = bare(tower.symbol);
  const unit = bare(unitOf(pay));
  const gotDecimals = decimals[trade.outputMint];
  const paidDecimals = decimals[trade.inputMint];
  const entry =
    trade.inputRaw && trade.outputRaw && gotDecimals !== undefined && paidDecimals !== undefined
      ? entryOf({ paidRaw: trade.inputRaw, paidDecimals, gotRaw: trade.outputRaw, gotDecimals })
      : null;
  const prices = entry !== null ? protectPrices(entry, set) : null;
  const amount = trade.outputRaw && gotDecimals !== undefined ? engineAmount(trade.outputRaw, gotDecimals) : null;
  const intent: LimitIntent | null = connection && prices && amount ? { owner: connection.address, side: 'sell', baseMint: tower.mint, quoteMint: pay.mint, amount, price: prices.take, quoteUsd: null } : null;
  const review = intent && spotReview && spotReview.key === reviewKey(intent) ? spotReview.review : null;
  const busy = !SPOT_IDLE.has(spotPhase) && !SPOT_RESULT.has(spotPhase);
  const takeText = digits(String(set.take));
  const stopText = digits(String(set.stop));

  // What the person can still do: set both, sign the take-profit's order, or nothing left.
  const step: 'both' | 'sign' | 'over' = over || !prices || !intent ? 'over' : stopAt !== null && review ? 'sign' : stopAt !== null ? 'over' : 'both';

  const start = async () => {
    if (!prices || !intent || gotDecimals === undefined || paidDecimals === undefined || !trade.outputRaw) return;
    setNote(null);
    const spot = useSpot.getState();
    // Never under another signature of the limits' ticket; a result it still shows is let go.
    if (SPOT_BUSY.has(spot.phase)) return;
    if (!SPOT_IDLE.has(spot.phase)) spot.again();
    await useSpot.getState().setStop(
      {
        side: 'sell',
        base: { mint: tower.mint, symbol: coin, name: tower.name, decimals: gotDecimals },
        quote: { mint: pay.mint, symbol: pay.symbol, decimals: paidDecimals },
        amountRaw: trade.outputRaw,
        price: prices.stop,
        expiry: useSpot.getState().expiry,
      },
      null,
    );
    const after = useSpot.getState();
    if (after.phase !== 'set') {
      // Not signed, or refused: said as the stops say it; the press stands for another try.
      if (after.notice) setNote(after.notice);
      return;
    }
    setStopAt(prices.stop);
    after.again();
    await useSpot.getState().reviewOrder(intent);
    const built = useSpot.getState();
    if (!built.review || built.review.key !== reviewKey(intent)) {
      setNote(built.notice ? { tone: 'warn', text: `${x.takeSkipped}. ${built.notice.text}` } : { tone: 'warn', text: x.takeSkipped });
      setOver(true);
    }
  };

  const sign = async () => {
    if (!intent || !review) return;
    setNote(null);
    await useSpot.getState().placeOrder(intent, { coin, unit });
    const after = useSpot.getState();
    if (after.phase === 'placed') {
      setTakeAt(intent.price);
      setOver(true);
      after.again();
      return;
    }
    if (after.phase === 'failed') {
      setNote({ tone: 'error', text: `${t.didntGo}. ${t.onlyFee}` });
      setOver(true);
      after.again();
      return;
    }
    if (after.phase === 'unclear') {
      setNote({ tone: 'warn', text: after.unclear?.message ?? t.stillChecking });
      setOver(true);
      after.again();
      return;
    }
    if (after.notice) setNote(after.notice);
  };

  const fee = review ? (review.fee.ryntraBps > 0 ? fw.ryntra(formatBps(review.fee.ryntraBps)) : review.fee.venueBps > 0 ? `${k.jupiterFee} ${formatBps(review.fee.venueBps)}` : fw.none) : null;
  const deposit = review && review.depositLamports !== null && review.depositLamports > 0 ? digits(formatUnits(String(review.depositLamports), 9)) : null;
  const shownNote = note ?? (busy ? null : spotNotice);

  return (
    <>
      <div className={s.guard} aria-live="polite">
        {prices ? (
          <>
            <span className={s.guardRow} data-done={stopAt !== null || undefined}>
              <span>{x.protectRowStop}</span>
              <b>
                {stopAt !== null ? <Icon name="check" size="s" /> : null}
                {`−${stopText}% · ${digits(zerosText(Number(prices.stop), typedPrice))} ${unit}`}
              </b>
            </span>
            <span className={s.guardRow} data-done={takeAt !== null || undefined}>
              <span>{x.protectRowTake}</span>
              <b>
                {takeAt !== null ? <Icon name="check" size="s" /> : null}
                {`+${takeText}% · ${digits(zerosText(Number(prices.take), typedPrice))} ${unit}`}
              </b>
            </span>
            {step === 'sign' && fee ? <span className={s.guardTerms}>{x.takeReview(fee, deposit)}</span> : null}
          </>
        ) : null}
      </div>
      {shownNote ? (
        <p className={s.note} data-tone={shownNote.tone} role={shownNote.tone === 'error' ? 'alert' : 'status'}>
          {shownNote.text}
        </p>
      ) : null}
      {step === 'over' ? (
        <Action onClick={onNext}>{w.newTrade}</Action>
      ) : (
        <>
          <Action className={s.go} disabled={busy} busy={busy} onClick={() => void (step === 'sign' ? sign() : start())}>
            {spotPhase === 'reviewing'
              ? t.gettingOrder
              : spotPhase === 'sending'
                ? t.sending
                : busy
                  ? connection?.wallet
                    ? t.confirmIn(connection.wallet)
                    : x.protectBusy
                  : step === 'sign'
                    ? x.placeTake(takeText)
                    : x.setProtect(takeText, stopText)}
          </Action>
          <Quiet full disabled={busy} onClick={onNext}>
            {w.newTrade}
          </Quiet>
        </>
      )}
    </>
  );
}

/** The trade reached the chain and failed: only the network fee moved. */
export function Failed() {
  const t = useWords(TRADE);
  const signature = useTrade((st) => st.failed);
  const again = useTrade((st) => st.again);
  return (
    <>
      <div className={s.result} role="alert">
        <Kick className={s.kickDown}>{t.didntGo}</Kick>
        <span className={s.line}>{t.onlyFee}</span>
        {signature ? <TxLink signature={signature} /> : null}
      </div>
      <Action onClick={again}>{t.tryAgain}</Action>
    </>
  );
}

/** The outcome is not known yet: the signature is read again, never sent again. */
export function Unknown({ press }: { press: () => Promise<'connect' | 'ok'> }) {
  const t = useWords(TRADE);
  const unknown = useTrade((st) => st.unknown);
  return (
    <>
      <div className={s.result} role="status">
        <Kick className={s.kickWarn}>{t.stillChecking}</Kick>
        <span className={s.line}>{unknown?.message ?? t.notKnown}</span>
        {unknown ? <TxLink signature={unknown.signature} /> : null}
      </div>
      <Action onClick={() => void press()}>{t.checkAgain}</Action>
    </>
  );
}
