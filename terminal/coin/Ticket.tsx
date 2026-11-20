'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { TRADE, riskWords } from '@/city/components/trade/words';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { useLang } from '@/city/lib/i18n/lang';
import { decimalsOf, figuresOf, friendDiscountOf, type Figures } from '@/city/lib/trade/figures';
import { formatUnits } from '@/city/lib/trade/format';
import { SPOT_OPEN, TRADE_OPEN } from '@/city/lib/trade/gates';
import type { Market as LadderMarket } from '@/city/lib/trade/pro-ladder';
import { LADDER_BUSY, useLadder } from '@/city/lib/trade/pro-store';
import { SPOT_IDLE, useSpot } from '@/city/lib/trade/spot-store';
import { balanceOf, choiceOf, reviewNotes, useTrade, type Choice, type CoinRef, type Mode, type Review, type TowerRef } from '@/city/lib/trade/store';
import { isBase, payAssetFor, unitOf, USDC, type PayAsset, type Side } from '@/city/lib/trade/tiles';
import { sellLine, sellWords } from '@/city/lib/trade/tower-window';
import { useWallet, type Holdings } from '@/city/lib/trade/wallet';
import { useDismiss } from '@/terminal/shell/useDismiss';
import { Action, AmountField, Chip, CoinLogo, Figure, Icon, Kick, Panel, Quiet, Segment, Shares, Tabs, cx } from '@/terminal/ui';
import { setLimitTab, useLadderHere, useLimitTab } from './ladder/here';
import { LadderTicket } from './ladder/LadderTicket';
import { LimitStop, SPOT_RESULT } from './LimitStop';
import { ExplainBox, ExplainButton, LONG_LABEL, Rows, TxLink, bare, connectOrPick } from './parts';
import { coinLogo, paidRows, payLogo, payRows, quickSums, saleMoney, USDC_LOGO } from './staples';
import { actionOf, retryShown, type ActionLabel } from './ticket-rules';
import { useTicket } from './useTicket';
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
      {phase === 'done' ? <Done /> : phase === 'failed' ? <Failed /> : phase === 'unknown' ? <Unknown press={press} /> : <Fields tower={tower} modes={modes} only={only} press={press} onTopUp={onTopUp} onOrders={onOrders} ladder={tower.mint === coin.id ? ladder : null} usd={usd} desk={desk} />}
    </>
  );
  if (!framed) return body;
  return (
    <Panel tone="hi" gap={12} label={w.label} className={cx(lean && s.lean, desk && s.desk, className)}>
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
}) {
  const t = useWords(TRADE);
  const w = useWords(TICKET);
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
  if (mode !== 'market' && SPOT_RESULT.has(spotPhase)) return <LimitStop tower={tower} choice={choice} mode={mode} onOrders={onOrders} />;

  const balance = choice.holding;
  const shares = choice.sizing.chips.map((chip) => ({ id: String(chip.share), label: chip.share === 100 ? w.max : w.share(String(chip.share)) }));
  const lit = choice.sizing.chips.find((chip) => chip.on);
  // What the amount is written in: the coin paid with when buying (a list of them), the coin itself when selling — each
  // with its logo, the coin's own through the engine's route whether or not it is a tower of the market.
  const asset = side === 'buy' ? { symbol: bare(unitOf(choice.pay)), icon: payLogo(choice.pay) } : { symbol: coin, icon: coinLogo(tower) };
  const quick = quickSums(choice.pay.mint);

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
          {desk && side === 'buy' && quick ? (
            <fieldset className={cx(s.group, s.shares)} disabled={!typable}>
              <Shares label={w.quick(asset.symbol)} options={quick.sums.map((sum) => ({ id: sum, label: quick.dollars ? `$${digits(sum)}` : `${digits(sum)} ${asset.symbol}` }))} value={quick.sums.find((sum) => sum === typed) ?? null} onPick={(sum) => setTyped(sum)} />
            </fieldset>
          ) : null}
          <fieldset className={cx(s.group, s.shares)} disabled={!typable || choice.sizing.share === null}>
            <Shares label={t.shareOfBalance} options={shares} value={lit ? String(lit.share) : null} onPick={(id) => setShare(Number(id))} />
          </fieldset>
          {mode === 'market' ? <MarketPart tower={tower} choice={choice} press={press} onTopUp={onTopUp} idle={idle} desk={desk} /> : <LimitStop tower={tower} choice={choice} mode={mode} onOrders={onOrders} onTopUp={onTopUp} />}
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

/** The market ticket: what you get at the engine's price, its terms in one line, and the one amber press. */
function MarketPart({ tower, choice, press, onTopUp, idle, desk = false }: { tower: TowerRef; choice: Choice; press: () => Promise<'connect' | 'ok'>; onTopUp?: () => void; idle: boolean; desk?: boolean }) {
  const t = useWords(TRADE);
  const w = useWords(TICKET);
  const side = useTrade((st) => st.side);
  const quote = useTrade((st) => st.quote);
  const review = useTrade((st) => st.review);
  const notice = useTrade((st) => st.notice);
  const phase = useTrade((st) => st.phase);
  const autoBuild = useTrade((st) => st.auto);
  const connection = useWallet((st) => st.connection);
  const connecting = useWallet((st) => Boolean(st.connecting));
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
        <span className={s.terms}>
          {retry ? (
            <Quiet size="s" onClick={() => void useTrade.getState().refreshQuote()}>
              {t.tryAgain}
            </Quiet>
          ) : figures && !choice.problem ? (
            <>
              <span className={s.fee}>
                {figures.fee ? w.fee(figures.fee) : t.noRyntraFee}
                {off ? <span className={s.off}>{off}</span> : null}
              </span>
              {desk && figures.slippage ? <span className={s.fee}>{w.slippage(digits(figures.slippage))}</span> : null}
              <ExplainButton label={t.tradeDetails} open={details} controls={detailsId} onToggle={() => setDetails((was) => !was)} />
            </>
          ) : null}
        </span>
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
        </ExplainBox>
      ) : null}
      {note ? (
        <p className={s.note} data-tone={note.tone} role={note.tone === 'error' ? 'alert' : 'status'}>
          {note.text}
        </p>
      ) : null}
      {picking && !connection ? (
        <WalletPick onBack={() => setPicking(false)} />
      ) : (
        <Action className={s.go} data-long={labels[action.label].length > LONG_LABEL || undefined} onClick={() => void tap()} disabled={action.does === 'none'} busy={action.busy}>
          {labels[action.label]}
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

/** After a trade: what arrived and what it cost, read back from the chain, and the way to the next one. */
export function Done() {
  const t = useWords(TRADE);
  const w = useWords(TICKET);
  const done = useTrade((st) => st.done);
  const again = useTrade((st) => st.again);
  if (!done) return null;
  const { trade, side, tower, pay, decimals } = done;
  const coin = bare(tower.symbol);
  const paid = bare(unitOf(pay));
  const got = trade.outputRaw && decimals[trade.outputMint] !== undefined ? formatUnits(trade.outputRaw, decimals[trade.outputMint]!, 'down') : null;
  const gave = trade.inputRaw && decimals[trade.inputMint] !== undefined ? formatUnits(trade.inputRaw, decimals[trade.inputMint]!) : null;
  const bought = side === 'buy';
  return (
    <>
      <div className={s.result} role="status">
        <Kick className={s.kickUp}>{bought ? t.youreIn : t.sold}</Kick>
        {got ? <Figure value={digits(got)} unit={bought ? coin : paid} /> : <Figure value={bought ? t.isYours(coin) : t.done} size="m" />}
        {gave ? <span className={s.line}>{w.forPaid(digits(gave), bought ? paid : coin)}</span> : null}
        <TxLink signature={trade.signature} />
      </div>
      <Action onClick={again}>{w.newTrade}</Action>
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
