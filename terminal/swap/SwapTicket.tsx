'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { TRADE } from '@/city/components/trade/words';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { decimalsOf, figuresOf, friendDiscountOf, type Figures } from '@/city/lib/trade/figures';
import { formatUnits } from '@/city/lib/trade/format';
import { BUSY, balanceOf, choiceOf, payKey, reviewNotes, useTrade, type Choice, type TowerRef } from '@/city/lib/trade/store';
import { isBase, unitOf, USDC, type PayAsset, type Side } from '@/city/lib/trade/tiles';
import { useWallet, type Holdings } from '@/city/lib/trade/wallet';
import { Details, Done, Failed, Unknown, iconOf } from '@/terminal/coin/Ticket';
import { ExplainBox, ExplainButton, LONG_LABEL, bare, connectOrPick } from '@/terminal/coin/parts';
import { actionOf, retryShown, type ActionLabel } from '@/terminal/coin/ticket-rules';
import { useTicket } from '@/terminal/coin/useTicket';
import { WalletPick } from '@/terminal/coin/WalletPick';
import { TICKET } from '@/terminal/coin/words';
import { useMarket } from '@/terminal/shell/useMarket';
import { Action, AmountField, CoinLogo, Figure, Icon, Kick, Quiet, Shares, cx } from '@/terminal/ui';
import { FILL_LIFE_MS, pickSubject, useSwapScreen } from './state';
import { pickList, pickPlan, rateOf, type Field } from './swap-view';
import { SWAP } from './words';
import t from '@/terminal/coin/ticket.module.css';
import s from './swap.module.css';

/** A pick made while the card builds its own order waits this long at most for it to rest. */
const PICK_WAIT_MS = 6_000;

/** The most coins a field's list shows at once; a search narrows the rest. */
const LIST_MOST = 40;

/**
 * The swap: what you pay, one flip, what you get — at the engine's best price across Solana's markets (Jupiter). It is
 * the trade card's logic as it is (`city/lib/trade/**`) on its plain swap face, through the coin ticket's own rhythm
 * (`useTicket`): the price, the route, Ryntra's fee, the exact order built while the person reads, the wallet's
 * signature and the reading of the outcome. Only the screen is new.
 *
 * Before the one amber press it shows the rate and the fee in one line, the breakdown behind «i»; with a wallet, the
 * least you get and the price impact. A price that did not come says so in plain words, and «Try again» — a quiet
 * control in the fee's place — only reads the price again; it never opens the wallet.
 *
 * `onTopUp`: where a person with no USDC to pay with is sent (the bridge into Solana); without it the button says what
 * is short.
 *
 * Drawn into the card that holds it — the Swap screen's one card with its tabs — without a panel or a name
 * of its own: the card's tab already says «Swap».
 */
export function SwapTicket({ onTopUp, desk = false }: { onTopUp?: () => void; desk?: boolean }) {
  const subject = useSwapScreen((st) => st.subject);
  const side = useSwapScreen((st) => st.side);
  const press = useTicket(subject, 'swap', side);
  useSaidFill();
  useSideMirror();
  const card = useTrade((st) => (st.view === 'swap' ? st.tower : null));
  const phase = useTrade((st) => st.phase);
  // Until the card opens on the screen's coin (the first frame), the ticket stands on that coin.
  const tower: TowerRef = card ?? { mint: subject.id, symbol: subject.symbol, name: subject.name, icon: subject.icon };
  return phase === 'done' ? <Done /> : phase === 'failed' ? <Failed /> : phase === 'unknown' ? <Unknown press={press} /> : <Fields tower={tower} press={press} onTopUp={onTopUp} desk={desk} />;
}

/**
 * A sentence's fill, written once the card stands on its coin and side: what pays, then the amount or a share — through
 * the card's own setters, as the person's typing would. Nothing is ordered, nothing is signed.
 */
function useSaidFill(): void {
  const fill = useSwapScreen((st) => st.fill);
  useEffect(() => {
    if (!fill) return;
    const put = (): boolean => {
      const screen = useSwapScreen.getState();
      if (screen.fill?.id !== fill.id) return true;
      if (Date.now() - fill.at > FILL_LIFE_MS) {
        useSwapScreen.setState({ fill: null });
        return true;
      }
      const card = useTrade.getState();
      if (!card.open || card.view !== 'swap' || card.tower?.mint !== screen.subject.id || card.phase !== 'idle' || card.held) return false;
      useSwapScreen.setState({ fill: null });
      if (card.side !== fill.side) card.setSide(fill.side);
      if (fill.pay) useTrade.getState().setPay(fill.pay);
      if (fill.amount) useTrade.getState().setTyped(fill.amount);
      else if (fill.share !== null) useTrade.getState().setShare(fill.share);
      return true;
    };
    if (put()) return;
    let done = false;
    const unsubscribe = useTrade.subscribe(() => {
      if (!done && put()) {
        done = true;
        unsubscribe();
      }
    });
    const timer = setTimeout(() => {
      if (!done) put();
    }, FILL_LIFE_MS + 50);
    return () => {
      done = true;
      unsubscribe();
      clearTimeout(timer);
    };
  }, [fill]);
}

/** The card's side, as the person last left it on the screen's coin: a coin picked next opens on the same side. */
function useSideMirror(): void {
  useEffect(
    () =>
      useTrade.subscribe((card, before) => {
        if (card.side === before.side || card.view !== 'swap' || !card.tower) return;
        const screen = useSwapScreen.getState();
        if (card.tower.mint === screen.subject.id && screen.side !== card.side) useSwapScreen.setState({ side: card.side });
      }),
    [],
  );
}

/**
 * A coin put into a field of the swap — from the field's own list or from the screen's popular coins: the
 * same one does nothing, the other field's one flips the two, else it takes its field (`pickPlan`). Through the card's
 * own setters, as the person's tap would; nothing is ordered.
 */
export function pickInto(field: Field, picked: PayAsset): void {
  const card = useTrade.getState();
  // Under a signature nothing is picked: the card shows how that trade ends.
  if (card.held || BUSY.has(card.phase)) return;
  const subject = useSwapScreen.getState().subject;
  const tower: TowerRef = card.view === 'swap' && card.tower ? card.tower : { mint: subject.id, symbol: subject.symbol, name: subject.name, icon: subject.icon };
  const choice = choiceOf(tower, card.side, useWallet.getState().holdings, { pay: card.pay, typed: card.typed, other: card.other });
  const plan = pickPlan({ side: card.side, subject: tower.mint, counter: choice.pay.mint, field, picked });
  // Another coin for the card: the screen names it, and the card follows it as soon as it rests (`useTicket`).
  if (plan.kind === 'subject') return pickSubject({ id: plan.asset.mint, symbol: plan.asset.symbol, name: plan.asset.name ?? plan.asset.symbol, icon: plan.asset.icon ?? null }, plan.side);
  if (plan.kind === 'none') return;
  const side: Side = card.side === 'buy' ? 'sell' : 'buy';
  const usable = plan.kind === 'counter' && (isBase(plan.asset) || choice.options.some((option) => option.mint === plan.asset.mint));
  const apply = () => {
    const now = useTrade.getState();
    if (plan.kind === 'flip') return now.setSide(side);
    if (plan.kind === 'counter') return usable ? now.setPay(payKey(plan.asset)) : now.pickCoin(plan.asset);
  };
  if (card.phase === 'idle') return apply();
  // The card is building its own order this moment: the pick waits for it to rest — once, and not for long.
  let settled = false;
  const finish = () => {
    settled = true;
    off();
    clearTimeout(timer);
  };
  const off = useTrade.subscribe((now) => {
    if (settled) return;
    if (now.held || BUSY.has(now.phase)) return finish();
    if (now.phase !== 'idle') return;
    finish();
    apply();
  });
  const timer = setTimeout(() => {
    if (!settled) finish();
  }, PICK_WAIT_MS);
}

/** A coin as a field's list names it. */
function assetOfTower(tower: TowerRef): PayAsset {
  return { mint: tower.mint, symbol: bare(tower.symbol), decimals: null, name: tower.name, icon: tower.icon ? `/api/icon/${tower.mint}` : null };
}

function Fields({ tower, press, onTopUp, desk }: { tower: TowerRef; press: () => Promise<'connect' | 'ok'>; onTopUp?: () => void; desk: boolean }) {
  const tr = useWords(TRADE);
  const tw = useWords(TICKET);
  const w = useWords(SWAP);
  const side = useTrade((st) => st.side);
  const pay = useTrade((st) => st.pay);
  const other = useTrade((st) => st.other);
  const typed = useTrade((st) => st.typed);
  const phase = useTrade((st) => st.phase);
  const auto = useTrade((st) => st.auto);
  const holdings = useWallet((st) => st.holdings);
  // A field's coins stand in the panel's place while one is picked: a list hanging below would be cut by its corner.
  const [menu, setMenu] = useState<Field | null>(null);

  const choice = choiceOf(tower, side, holdings, { pay, typed, other });
  const idle = phase === 'idle';
  // An order the card builds by itself never shuts the field: typing on drops that order.
  const typable = idle || (phase === 'preparing' && auto);
  useEffect(() => {
    if (!idle) setMenu(null);
  }, [idle]);

  const subject = assetOfTower(tower);
  const counter = choice.pay;
  const payAsset = side === 'buy' ? counter : subject;
  const getAsset = side === 'buy' ? subject : counter;
  const spent = choice.holding;
  const gotBalance = balanceOf(holdings, choice.outputMint);
  const shares = choice.sizing.chips.map((chip) => ({ id: String(chip.share), label: chip.share === 100 ? tw.max : tw.share(String(chip.share)) }));
  const lit = choice.sizing.chips.find((chip) => chip.on);

  const pick = (field: Field, picked: PayAsset) => {
    setMenu(null);
    pickInto(field, picked);
  };

  if (menu) {
    return (
      <Picker
        field={menu}
        holdings={holdings}
        current={menu === 'pay' ? payAsset : getAsset}
        label={menu === 'pay' ? w.pickPay : w.pickGet}
        onPick={(asset) => pick(menu, asset)}
        onBack={() => setMenu(null)}
      />
    );
  }

  return (
    <>
      <div className={s.pair}>
        <fieldset className={t.group} disabled={!typable}>
          <AmountField
              label={w.pay}
              aside={spent && choice.spendDecimals !== null ? w.balance(digits(formatUnits(spent.spendableRaw, choice.spendDecimals, 'down'))) : undefined}
              value={fieldText(typed)}
              onChange={(text) => useTrade.getState().setTyped(fieldValue(text))}
              asset={{ symbol: bare(unitOf(payAsset)), icon: iconOf(payAsset) }}
              onAsset={idle ? () => setMenu('pay') : undefined}
              assetLabel={w.pickPay}
            />
        </fieldset>
        <button type="button" className={s.flip} onClick={() => useTrade.getState().setSide(side === 'buy' ? 'sell' : 'buy')} disabled={!idle} aria-label={w.flip}>
          <Icon name="swap" size="s" className={s.flipSign} />
        </button>
        <GetField asset={getAsset} balance={gotBalance} choice={choice} onAsset={idle ? () => setMenu('get') : undefined} />
      </div>
      <fieldset className={cx(t.group, s.shares)} disabled={!typable || choice.sizing.share === null}>
        <Shares label={tr.shareOfBalance} options={shares} value={lit ? String(lit.share) : null} onPick={(id) => useTrade.getState().setShare(Number(id))} />
      </fieldset>
      <MarketPart tower={tower} choice={choice} press={press} onTopUp={onTopUp} desk={desk} />
    </>
  );
}

/** «You get»: the figure the engine's price brings, in the coin picked — read, never typed. */
function GetField({ asset, balance, choice, onAsset }: { asset: PayAsset; balance: { spendableRaw: string; decimals: number } | null; choice: Choice; onAsset?: () => void }) {
  const w = useWords(SWAP);
  const tr = useWords(TRADE);
  const quote = useTrade((st) => st.quote);
  const review = useTrade((st) => st.review);
  const figures = useFigures(choice, quote, review);
  const failed = quote.status === 'error' && quote.key === choice.key;
  const symbol = bare(unitOf(asset));
  const waiting = !figures && !failed && Boolean(choice.amountRaw) && !choice.problem;
  return (
    <div className={s.field}>
      <div className={s.fieldHead}>
        <Kick>{w.get}</Kick>
        {balance && balance.decimals !== null ? <span className={s.fieldAside}>{w.balance(digits(formatUnits(balance.spendableRaw, balance.decimals, 'down')))}</span> : null}
      </div>
      <div className={s.fieldRow}>
        <span className={s.got} aria-live="polite">
          {waiting ? <span className={t.shimmer} role="status" aria-label={tr.gettingPrice} /> : <Figure value={figures && !choice.problem ? digits(figures.get) : '—'} className={s.gotFigure} />}
        </span>
        {onAsset ? (
          <button type="button" className={s.pill} onClick={onAsset} aria-label={w.pickGet}>
            <CoinLogo src={iconOf(asset)} symbol={symbol} size="s" />
            {symbol}
            <Icon name="chevron" size="s" />
          </button>
        ) : (
          <span className={s.pill}>
            <CoinLogo src={iconOf(asset)} symbol={symbol} size="s" />
            {symbol}
          </span>
        )}
      </div>
    </div>
  );
}

/** The figures on screen: the exact order's when it stands for this choice, else the price's. */
function useFigures(choice: Choice, quote: ReturnType<typeof useTrade.getState>['quote'], review: ReturnType<typeof useTrade.getState>['review']): Figures | null {
  const shown = review && review.key === choice.key ? review : null;
  const priced = quote.status === 'ready' && quote.key === choice.key ? quote.body : null;
  const outputDecimals = shown ? decimalsOf(shown.order, choice.outputMint) : priced ? decimalsOf(priced, choice.outputMint) : null;
  return useMemo<Figures | null>(() => {
    if (outputDecimals === null) return null;
    if (shown) return figuresOf(shown.order.order, outputDecimals, 'order');
    return priced ? figuresOf(priced.order, outputDecimals, 'quote') : null;
  }, [shown, priced, outputDecimals]);
}

/**
 * A field's coins, in the panel's place: SOL, USDC and the wallet's coins for what pays; for what is got, the market's
 * coins too; a search over them all. A coin of the other field puts the two in each other's place. Escape, or the back
 * control, returns to the ticket as it was.
 */
function Picker({ field, holdings, current, label, onPick, onBack }: { field: Field; holdings: Holdings | null; current: PayAsset; label: string; onPick: (asset: PayAsset) => void; onBack: () => void }) {
  const w = useWords(SWAP);
  const tw = useWords(TICKET);
  const towers = useMarket().towers;
  const [query, setQuery] = useState('');
  const held = useMemo<PayAsset[]>(() => {
    if (!holdings) return [];
    const coins: PayAsset[] = [];
    for (const [mint, balance] of holdings.tokens) {
      const name = holdings.names?.get(mint);
      if (!name?.symbol || balance.spendableRaw === '0') continue;
      coins.push({ mint, symbol: bare(name.symbol), decimals: balance.decimals, name: name.name, verified: name.verified, icon: name.icon });
    }
    return coins;
  }, [holdings]);
  const market = useMemo<PayAsset[]>(
    () => (field === 'get' ? towers.map((tower) => ({ mint: tower.id, symbol: bare(tower.symbol), decimals: null, name: tower.name, verified: tower.verified, icon: tower.icon ? `/api/icon/${tower.id}` : null })) : []),
    [field, towers],
  );
  const list = pickList({ field, held, market, query, most: LIST_MOST });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onBack();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onBack]);
  return (
    <div className={s.picker} role="dialog" aria-label={label}>
      <div className={s.pickerHead}>
        <button type="button" className={s.back} onClick={onBack} aria-label={tw.back}>
          <Icon name="back" size="s" />
        </button>
        <input
          className={s.find}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={w.find}
          aria-label={w.find}
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </div>
      <div role="menu" aria-label={label} className={s.pickList}>
        {list.length ? (
          list.map((asset) => {
            const balance = balanceOf(holdings, asset.mint);
            return (
              <button key={asset.mint} type="button" role="menuitemradio" aria-checked={asset.mint === current.mint} className={t.menuRow} onClick={() => onPick(asset)}>
                <CoinLogo src={iconOf(asset)} symbol={asset.symbol} size="s" />
                <span className={t.menuName}>{bare(unitOf(asset))}</span>
                {balance && balance.spendableRaw !== '0' ? <span className={t.menuAside}>{digits(formatUnits(balance.spendableRaw, balance.decimals, 'down'))}</span> : null}
              </button>
            );
          })
        ) : (
          <p className={s.pickEmpty}>{w.noMatch}</p>
        )}
      </div>
    </div>
  );
}

/** The swap's terms and its one amber press: the rate and the fee in one line, the breakdown behind «i». */
function MarketPart({ tower, choice, press, onTopUp, desk }: { tower: TowerRef; choice: Choice; press: () => Promise<'connect' | 'ok'>; onTopUp?: () => void; desk: boolean }) {
  const tr = useWords(TRADE);
  const tw = useWords(TICKET);
  const w = useWords(SWAP);
  const side = useTrade((st) => st.side);
  const quote = useTrade((st) => st.quote);
  const review = useTrade((st) => st.review);
  const notice = useTrade((st) => st.notice);
  const phase = useTrade((st) => st.phase);
  const connection = useWallet((st) => st.connection);
  const connecting = useWallet((st) => Boolean(st.connecting));
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  useEffect(() => {
    if (connection) setPicking(false);
  }, [connection]);

  const shown = review && review.key === choice.key ? review : null;
  const priced = quote.status === 'ready' && quote.key === choice.key ? quote.body : null;
  const failed = quote.status === 'error' && quote.key === choice.key ? quote.refusal : null;
  const figures = useFigures(choice, quote, review);
  const off = shown ? friendDiscountOf(priced?.order ?? null, shown.order.order) : null;
  const subjectUnit = bare(tower.symbol);
  const counterUnit = bare(unitOf(choice.pay));
  const getUnit = side === 'buy' ? subjectUnit : counterUnit;

  // The rate the engine's amounts imply: the exact order's once it stands, else the price's.
  const amounts = shown?.order.order ?? priced?.order ?? null;
  const body = shown?.order ?? priced ?? null;
  const rate =
    amounts && body && !choice.problem
      ? rateOf({ side, subject: subjectUnit, counter: counterUnit, inRaw: amounts.inAmountRaw, outRaw: amounts.outAmountRaw, inDecimals: decimalsOf(body, choice.inputMint), outDecimals: decimalsOf(body, choice.outputMint) })
      : null;

  const action = actionOf({
    phase,
    side,
    connected: Boolean(connection),
    connecting,
    problem: choice.problem ? (choice.problem.kind === 'balance' ? 'balance' : 'other') : null,
    hasAmount: Boolean(choice.amountRaw),
    empty: choice.sizing.max === '0',
    priced: Boolean(priced),
    exact: Boolean(shown),
    canTopUp: Boolean(onTopUp) && side === 'buy' && choice.pay.mint === USDC.mint,
  });
  const retry = retryShown({ quoteFailed: Boolean(failed), retryable: failed?.retryable === true, exact: Boolean(shown), phase });
  const tap = async () => {
    if (action.does === 'topUp') return onTopUp?.();
    if (action.does !== 'press') return;
    if ((await press()) === 'connect') connectOrPick(() => setPicking(true));
  };

  // Beside «Top up» the balance's own sentence is the same news a second time: the button already answers it.
  const problem = choice.problem && !(action.does === 'topUp' && choice.problem.kind === 'balance') ? choice.problem.text : null;
  const warnings = reviewNotes(shown);
  const caution = shown?.order.risk.verdict === 'REVIEW_REQUIRED' ? shown.order.risk.findings.find((finding) => finding.outcome === 'REVIEW_REQUIRED')?.detail : null;
  const note: Readonly<{ tone: string; text: string }> | null =
    (problem ? { tone: 'error', text: problem } : null) ?? notice ?? (warnings[0] ? { tone: 'warn', text: warnings[0] } : caution ? { tone: 'warn', text: caution } : failed ? { tone: 'error', text: failed.message } : null);

  const labels: Readonly<Record<ActionLabel, string>> = {
    verb: w.go,
    connect: tr.connectWallet,
    connecting: tr.connecting,
    building: tr.gettingOrder,
    wallet: connection?.wallet ? tr.confirmIn(connection.wallet) : tr.confirmInWallet,
    sending: tr.sending,
    checking: tr.readingNetwork,
    short: tr.notEnough(bare(choice.spendUnit)),
    nothing: tr.nothingToSell,
    topUp: w.topUp,
  };
  return (
    <>
      {/* The least the swap brings, read from the engine's price and then from the exact order. A desk says it and the
          fee on their own rows — and the impact when it is not small; the rate, the route and the rest wait behind «i»,
          said once. */}
      {figures && !choice.problem ? (
        desk ? (
          <dl className={s.facts}>
            {figures.impactLevel !== 'low' ? <Fact name={w.impactRow} value={digits(figures.impact)} level={figures.impactLevel} /> : null}
            <Fact name={w.atLeast} value={`${digits(figures.minimum)} ${getUnit}`} />
            <Fact name={w.feeRow} value={figures.fee ? (off ? `${figures.fee} ${off}` : figures.fee) : w.noFee} />
          </dl>
        ) : (
          <div className={s.least} aria-live="polite">
            <span>{w.atLeast}</span>
            {figures.impactLevel !== 'low' ? <span className={s.leastImpact} data-level={figures.impactLevel}>{tw.impact(digits(figures.impact))}</span> : null}
            <b>
              {digits(figures.minimum)} {getUnit}
            </b>
          </div>
        )
      ) : null}
      <div className={s.terms}>
        <span className={s.termsLine} aria-live="polite">
          {retry ? (
            <Quiet size="s" onClick={() => void useTrade.getState().refreshQuote()}>
              {tr.tryAgain}
            </Quiet>
          ) : figures && !choice.problem && !desk ? (
            <>
              {figures.fee ? w.terms(figures.fee, figures.route) : w.termsFree(figures.route)}
              {off ? <span className={t.off}>{off}</span> : null}
            </>
          ) : null}
        </span>
        {figures && !choice.problem && !retry ? <ExplainButton label={w.details} open={details} controls={detailsId} onToggle={() => setDetails((was) => !was)} /> : null}
      </div>
      {details && figures && !choice.problem ? (
        <ExplainBox id={detailsId}>
          {rate ? <p className={s.rate}>{digits(w.rate(rate.one, rate.price, rate.other))}</p> : null}
          <Details figures={figures} off={off} review={shown} quoteAt={quote.status === 'ready' ? quote.at : null} getUnit={getUnit} />
        </ExplainBox>
      ) : null}
      {note ? (
        <p className={t.note} data-tone={note.tone} role={note.tone === 'error' ? 'alert' : 'status'}>
          {note.text}
        </p>
      ) : null}
      {picking && !connection ? (
        <WalletPick onBack={() => setPicking(false)} />
      ) : (
        <Action className={t.go} data-long={labels[action.label].length > LONG_LABEL || undefined} onClick={() => void tap()} disabled={action.does === 'none'} busy={action.busy}>
          {labels[action.label]}
        </Action>
      )}
    </>
  );
}

/** One row of the terms on a desk: its name on the left, its figure on the right; the impact lit by how much it moves. */
function Fact({ name, value, level }: { name: string; value: string; level?: string }) {
  return (
    <div className={s.fact}>
      <dt>{name}</dt>
      <dd data-level={level}>{value}</dd>
    </div>
  );
}
