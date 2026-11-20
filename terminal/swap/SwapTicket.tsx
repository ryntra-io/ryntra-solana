'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { lookalikeOf } from '@/lib/world/text-safety/lookalike';
import { TRADE } from '@/city/components/trade/words';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { spotIcon } from '@/city/lib/search/rank';
import { searchCatalog } from '@/city/lib/search/sources';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { decimalsOf, figuresOf, friendDiscountOf, type Figures } from '@/city/lib/trade/figures';
import { formatUnits } from '@/city/lib/trade/format';
import { BUSY, balanceOf, choiceOf, payKey, reviewNotes, useTrade, type Choice, type TowerRef } from '@/city/lib/trade/store';
import { isBase, SOL, unitOf, USDC, type PayAsset, type Side } from '@/city/lib/trade/tiles';
import { MAIN_MINTS, MONEY, WALLET_COINS, payLogo } from '@/terminal/coin/staples';
import { decimalsUnread, knownDecimals } from '@/city/lib/trade/decimals';
import { useWallet, type Holdings } from '@/city/lib/trade/wallet';
import { Details, Done, Failed, Unknown, iconOf } from '@/terminal/coin/Ticket';
import { ExplainBox, ExplainButton, bare, connectOrPick } from '@/terminal/coin/parts';
import { actionOf, retryShown, type ActionLabel } from '@/terminal/coin/ticket-rules';
import { useTicket } from '@/terminal/coin/useTicket';
import { WalletPick } from '@/terminal/coin/WalletPick';
import { TICKET } from '@/terminal/coin/words';
import { logoChain } from '@/terminal/market/depth-view';
import { useMarket } from '@/terminal/shell/useMarket';
import { Action, CoinLogo, Icon, Kick, Quiet, Shares, amountText, cx, priceText } from '@/terminal/ui';
import { FILL_LIFE_MS, pickSubject, putFill, useSwapScreen } from './state';
import { feeShort, flipText, pickList, pickPlan, pickStart, rateOf, reasonOf, searchable, solThin, subjectCarry, unitsOf, usdWorth, withFound, type Field } from './swap-view';
import { useDepthCoins } from './useDepthCoins';
import { SWAP } from './words';
import t from '@/terminal/coin/ticket.module.css';
import s from './swap.module.css';

/** A pick made while the card builds its own order waits this long at most for it to rest. */
const PICK_WAIT_MS = 6_000;

/** The most coins a field's list shows at once; a search narrows the rest. */
const LIST_MOST = 40;

/**
 * The swap: what you pay, one flip, what you get — any coin for any coin (decision 109), at the engine's best price
 * across Solana's markets (Jupiter). It is the trade card's logic as it is (`city/lib/trade/**`) on its plain swap face,
 * through the coin ticket's own rhythm (`useTicket`): the price, the route, Ryntra's fee, the exact order built while
 * the person reads, the wallet's signature and the reading of the outcome. Only the screen is new.
 *
 * Big and plain: two wide fields with
 * their figures large and their coins by logo, the dollars under each, the rate and the fee in one line, the route and
 * the breakdown behind «i», one amber press. A price that did not come says so in plain words, and «Try again» — a
 * quiet control in the line's place — only reads the price again; it never opens the wallet.
 *
 * `onTopUp`: where a person with no USDC to pay with is sent (the bridge into Solana); without it the button says what
 * is short.
 */
export function SwapTicket({ onTopUp }: { onTopUp?: () => void }) {
  const subject = useSwapScreen((st) => st.subject);
  const side = useSwapScreen((st) => st.side);
  const press = useTicket(subject, 'swap', side);
  useSaidFill();
  useSideMirror();
  const card = useTrade((st) => (st.view === 'swap' ? st.tower : null));
  const phase = useTrade((st) => st.phase);
  // Until the card opens on the screen's coin (the first frame), the ticket stands on that coin.
  const tower: TowerRef = card ?? { mint: subject.id, symbol: subject.symbol, name: subject.name, icon: subject.icon };
  return phase === 'done' ? <Done /> : phase === 'failed' ? <Failed /> : phase === 'unknown' ? <Unknown press={press} /> : <Fields tower={tower} press={press} onTopUp={onTopUp} />;
}

/**
 * A sentence's fill, written once the card stands on its coin and side: what pays, then the amount or a share — through
 * the card's own setters, as the person's typing would. Nothing is ordered, nothing is signed.
 */
function useSaidFill(): void {
  const fill = useSwapScreen((st) => st.fill);
  useEffect(() => {
    if (!fill) return;
    const put = (): boolean => putFill(fill);
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
export function pickInto(field: Field, picked: PayAsset, prices: ReadonlyMap<string, number> = new Map()): void {
  const card = useTrade.getState();
  // Under a signature nothing is picked: the card shows how that trade ends.
  if (card.held || BUSY.has(card.phase)) return;
  const subject = useSwapScreen.getState().subject;
  const tower: TowerRef = card.view === 'swap' && card.tower ? card.tower : { mint: subject.id, symbol: subject.symbol, name: subject.name, icon: subject.icon };
  const holdings = useWallet.getState().holdings;
  const choice = choiceOf(tower, card.side, holdings, { pay: card.pay, typed: card.typed, other: card.other, overPriced: true });
  const plan = pickPlan({ side: card.side, subject: tower.mint, counter: choice.pay.mint, field, picked });
  // Another coin for the card: the screen names it, and the card follows it as soon as it rests (`useTicket`).
  // The new coin keeps the other field as the screen showed it — its coin always, its amount where it was typed there
  // (`subjectCarry`): picking what you get never changes what you pay (release check 19.11: 25 USDC became 25 SOL).
  if (plan.kind === 'subject') return pickSubject({ id: plan.asset.mint, symbol: plan.asset.symbol, name: plan.asset.name ?? plan.asset.symbol, icon: plan.asset.icon ?? null }, plan.side, subjectCarry({ field, typed: card.typed, counter: choice.pay }));
  if (plan.kind === 'none') return;
  const side: Side = card.side === 'buy' ? 'sell' : 'buy';
  const usable = plan.kind === 'counter' && (isBase(plan.asset) || choice.options.some((option) => option.mint === plan.asset.mint));
  const apply = () => {
    const now = useTrade.getState();
    if (plan.kind === 'flip') return now.setSide(side, carriedAmount(choice, prices, holdings));
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

/**
 * The amount the flip carries to «You pay» (m1): what «You get» showed — the same value, now paid; without a figure on
 * screen, the field's amount at the market's prices in the coin that pays now; else none — the card's own start, never
 * the same digits in another coin.
 */
function carriedAmount(choice: Choice, prices: ReadonlyMap<string, number>, holdings: Holdings | null): string | undefined {
  const card = useTrade.getState();
  const shown = card.review && card.review.key === choice.key ? card.review.order : card.quote.status === 'ready' && card.quote.key === choice.key ? card.quote.body : null;
  const out = shown && (!choice.problem || choice.problem.kind === 'balance') ? flipText(shown.order.outAmountRaw, decimalsOf(shown, choice.outputMint)) : null;
  if (out) return out;
  const amount = /^\d*\.?\d+$/.test(card.typed) ? Number(card.typed) : 0;
  const priceOf = (mint: string) => (mint === USDC.mint ? 1 : prices.get(mint));
  const given = priceOf(choice.inputMint);
  const got = priceOf(choice.outputMint);
  // The coin's own decimals: the wallet's balance of it, else what is known of it — never a zero balance's stand-in.
  const held = choice.outputMint === SOL.mint ? holdings?.sol : holdings?.tokens.get(choice.outputMint);
  const decimals = held?.decimals ?? knownDecimals(choice.outputMint);
  if (!(amount > 0) || !given || !got || decimals === null) return undefined;
  const places = Math.min(decimals, 9);
  const raw = BigInt(Math.floor(((amount * given) / got) * 10 ** places)) * 10n ** BigInt(decimals - places);
  return flipText(raw.toString(), decimals) ?? undefined;
}

/** A coin as a field's list names it. */
function assetOfTower(tower: TowerRef): PayAsset {
  return { mint: tower.mint, symbol: bare(tower.symbol), decimals: null, name: tower.name, icon: towerLogo(tower.mint, tower.icon) };
}

/**
 * A tower's logo as the Market draws it: its picture through the engine's logo proxy, verified or not — the
 * city's own `/api/icon` serves verified towers alone, and an unverified coin would wear its letter.
 */
function towerLogo(mint: string, icon: string | null): string | null {
  // A coin picked from a list already carries the engine's own address for its logo: it stays as it is.
  if (icon?.startsWith('/api/')) return icon;
  return spotIcon(mint, icon) ?? (icon ? `/api/icon/${mint}` : null);
}

/** The market's dollar price of each coin it lists, by mint: the line under a field's figure. */
function usePrices(): ReadonlyMap<string, number> {
  const towers = useMarket().towers;
  return useMemo(() => new Map(towers.flatMap((tower) => (tower.unread?.includes('price') || !(tower.price > 0) ? [] : [[tower.id, tower.price] as const]))), [towers]);
}

/** «≈ $10.02» under a figure, or nothing — no line is drawn for a coin the market does not price. */
function useUsd(asset: PayAsset, amount: number | null): string | null {
  const lang = useLang();
  const prices = usePrices();
  const worth = usdWorth(amount, prices.get(asset.mint), asset.mint === USDC.mint);
  return worth === null ? null : `≈ ${priceText(worth, lang)}`;
}

function Fields({ tower, press, onTopUp }: { tower: TowerRef; press: () => Promise<'connect' | 'ok'>; onTopUp?: () => void }) {
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
  // A coin's decimals read from the chain (`decimals.ts`): the field typed in it is a real amount now.
  useTrade((st) => st.learned);
  const payId = useId();
  // A field's coins stand in the panel's place while one is picked: a list hanging below would be cut by its corner. The
  // list stands as tall as the form it replaces, so the card does not jump (m4).
  const [menu, setMenu] = useState<Field | null>(null);
  const [tall, setTall] = useState<number | null>(null);
  const pairBox = useRef<HTMLDivElement>(null);

  const choice = choiceOf(tower, side, holdings, { pay, typed, other, overPriced: true });
  const prices = usePrices();
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
  const typedAmount = /^\d+(\.\d+)?$/.test(typed) ? Number(typed) : null;
  const payUsd = useUsd(payAsset, typedAmount);

  const pick = (field: Field, picked: PayAsset) => {
    setMenu(null);
    pickInto(field, picked, prices);
  };
  const open = (field: Field) => {
    const panel = pairBox.current?.parentElement;
    if (panel) {
      const style = window.getComputedStyle(panel);
      setTall(panel.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    }
    setMenu(field);
  };
  // The flip keeps the amount's value (m1, `carriedAmount`).
  const flip = () => useTrade.getState().setSide(side === 'buy' ? 'sell' : 'buy', carriedAmount(choice, prices, holdings));

  if (menu) {
    return (
      <Picker
        field={menu}
        holdings={holdings}
        current={menu === 'pay' ? payAsset : getAsset}
        label={menu === 'pay' ? w.pickPay : w.pickGet}
        tall={tall}
        onPick={(asset) => pick(menu, asset)}
        onBack={() => setMenu(null)}
      />
    );
  }

  return (
    <>
      <div className={s.pair} ref={pairBox}>
        <fieldset className={t.group} disabled={!typable}>
          <BigField
            label={w.pay}
            labelFor={payId}
            aside={spent && choice.spendDecimals !== null ? w.balance(digits(formatUnits(spent.spendableRaw, choice.spendDecimals, 'down'))) : undefined}
            usd={payUsd}
            asset={payAsset}
            onAsset={idle ? () => open('pay') : undefined}
            pickLabel={w.pickPay}
          >
            <input
              id={payId}
              className={s.bigAmount}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={fieldText(typed)}
              placeholder="0"
              onChange={(event) => useTrade.getState().setTyped(fieldValue(amountText(event.target.value)))}
            />
          </BigField>
        </fieldset>
        <button type="button" className={s.flip} onClick={flip} disabled={!idle} aria-label={w.flip}>
          <Icon name="swap" size="m" className={s.flipSign} />
        </button>
        <GetField asset={getAsset} balance={gotBalance} choice={choice} onAsset={idle ? () => open('get') : undefined} />
      </div>
      <fieldset className={cx(t.group, s.shares)} disabled={!typable || choice.sizing.share === null}>
        <Shares label={tr.shareOfBalance} options={shares} value={lit ? String(lit.share) : null} onPick={(id) => useTrade.getState().setShare(Number(id))} />
      </fieldset>
      <MarketPart tower={tower} choice={choice} press={press} onTopUp={onTopUp} />
    </>
  );
}

/**
 * One of the swap's two fields, large: its name and the balance over it, the figure and the coin by its logo in one
 * row, the dollars under the figure. The figure is the field's own: typed for what pays, read for what is got.
 */
function BigField({
  label,
  labelFor,
  aside,
  usd,
  asset,
  onAsset,
  pickLabel,
  children,
}: {
  label: string;
  labelFor?: string;
  aside?: string;
  usd: string | null;
  asset: PayAsset;
  onAsset?: () => void;
  pickLabel: string;
  children: ReactNode;
}) {
  const symbol = bare(unitOf(asset));
  const logo = <CoinLogo {...logoChain(asset.mint, asset.icon, iconOf(asset))} symbol={symbol} size="m" className={s.coinLogo} />;
  return (
    <div className={s.big}>
      <div className={s.bigHead}>
        {labelFor ? (
          <label htmlFor={labelFor}>
            <Kick>{label}</Kick>
          </label>
        ) : (
          <Kick>{label}</Kick>
        )}
        {aside ? <span className={s.bigAside}>{aside}</span> : null}
      </div>
      <div className={s.bigRow}>
        {children}
        {onAsset ? (
          <button type="button" className={s.coin} onClick={onAsset} aria-label={`${pickLabel}: ${symbol}`}>
            {logo}
            <span className={s.coinSymbol}>{symbol}</span>
            <Icon name="chevron" size="s" className={s.coinChevron} />
          </button>
        ) : (
          <span className={s.coin}>
            {logo}
            <span className={s.coinSymbol}>{symbol}</span>
          </span>
        )}
      </div>
      <span className={s.bigUsd} aria-hidden={usd ? undefined : true}>
        {usd ?? ' '}
      </span>
    </div>
  );
}

/** «You get»: the figure the engine's price brings, in the coin picked — read, never typed. */
function GetField({ asset, balance, choice, onAsset }: { asset: PayAsset; balance: { spendableRaw: string; decimals: number } | null; choice: Choice; onAsset?: () => void }) {
  const w = useWords(SWAP);
  const tr = useWords(TRADE);
  const quote = useTrade((st) => st.quote);
  const review = useTrade((st) => st.review);
  const typed = useTrade((st) => st.typed);
  const figures = useFigures(choice, quote, review);
  const failed = quote.status === 'error' && quote.key === choice.key;
  // A shortfall of the balance is its own line: the price for the amount still stands (B1).
  const priceable = !choice.problem || choice.problem.kind === 'balance';
  // The coin's decimals still being read: the amount is a real one a moment later, so the field shimmers, never «0».
  const reading = choice.spendDecimals === null && !choice.problem && !decimalsUnread(choice.inputMint) && /^\d*\.?\d+$/.test(typed) && Number(typed) > 0;
  const waiting = !figures && !failed && (Boolean(choice.askRaw) || reading) && priceable;
  // The dollars: what the engine's own amount out is worth at the market's price.
  const shown = review && review.key === choice.key ? review.order : quote.status === 'ready' && quote.key === choice.key ? quote.body : null;
  const out = shown && figures && priceable ? unitsOf(shown.order.outAmountRaw, decimalsOf(shown, choice.outputMint)) : null;
  const usd = useUsd(asset, out);
  const value = figures && priceable ? digits(figures.get) : null;
  return (
    <BigField
      label={w.get}
      aside={balance && balance.decimals !== null ? w.balance(digits(formatUnits(balance.spendableRaw, balance.decimals, 'down'))) : undefined}
      usd={usd}
      asset={asset}
      onAsset={onAsset}
      pickLabel={w.pickGet}
    >
      <span className={s.bigOut} aria-live="polite">
        {waiting ? (
          <span className={cx(t.shimmer, s.bigShimmer)} role="status" aria-label={tr.gettingPrice} />
        ) : (
          <span className={cx(s.bigAmount, !value && s.bigNone)}>{value ?? '0'}</span>
        )}
      </span>
    </BigField>
  );
}

/** The figures on screen: the exact order's when it stands for this choice, else the price's. */
function useFigures(choice: Choice, quote: ReturnType<typeof useTrade.getState>['quote'], review: ReturnType<typeof useTrade.getState>['review']): Figures | null {
  // The figures are written in the language on screen: a switch of it writes them again (QA 19.11: «Fee 0,1%» in English).
  const lang = useLang();
  const shown = review && review.key === choice.key ? review : null;
  const priced = quote.status === 'ready' && quote.key === choice.key ? quote.body : null;
  const outputDecimals = shown ? decimalsOf(shown.order, choice.outputMint) : priced ? decimalsOf(priced, choice.outputMint) : null;
  return useMemo<Figures | null>(() => {
    if (outputDecimals === null) return null;
    if (shown) return figuresOf(shown.order.order, outputDecimals, 'order');
    return priced ? figuresOf(priced.order, outputDecimals, 'quote') : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `lang` is read by `figuresOf` through the dictionary
  }, [shown, priced, outputDecimals, lang]);
}

/** How long typing rests before the engine's search over every coin is asked. */
const FIND_WAIT_MS = 250;

/**
 * What the engine's search over every Solana coin (Jupiter's catalogue, `GET /api/solana/tokens/search`) finds for the
 * words typed — read only, once the typing rests; nothing found, or no answer, is no more coins.
 */
function useFound(query: string): readonly PayAsset[] {
  const [found, setFound] = useState<Readonly<{ query: string; list: readonly PayAsset[] }>>({ query: '', list: [] });
  useEffect(() => {
    if (!searchable(query)) return;
    const control = new AbortController();
    const timer = setTimeout(() => {
      searchCatalog(query, { signal: control.signal })
        .then((rows) => {
          // Not a coin Jupiter calls suspicious, nor one whose ticker passes for a known coin's on another mint.
          const list = rows.flatMap((row): PayAsset[] =>
            row.symbol && !row.isSuspicious && !lookalikeOf(row.symbol, row.mint)
              ? [{ mint: row.mint, symbol: bare(row.symbol), decimals: null, name: row.name ?? row.symbol, verified: row.isVerified === true, icon: spotIcon(row.mint, row.icon) }]
              : [],
          );
          setFound({ query, list });
        })
        .catch(() => {});
    }, FIND_WAIT_MS);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [query]);
  return found.query === query ? found.list : [];
}

/**
 * A field's coins, in the panel's place — as Jupiter's picker does it: a search over every Solana coin
 * by name or address, then «Your coins» with what each holds and is worth, and «Main» — the coins people trade most
 * (`terminal/coin/staples.ts`, the Spot desk's own) with their prices. A coin Jupiter vouches for wears its check; one it
 * does not, one quiet mark. Nothing the person did not ask for — a meme of the day, a stock — stands at the top; a coin
 * Jupiter calls suspicious, or one whose ticker passes for a known coin's, is not offered by the search. A coin of the
 * other field puts the two in each other's place. Escape, or the back control, returns to the ticket as it was.
 */
function Picker({
  field,
  holdings,
  current,
  label,
  tall,
  onPick,
  onBack,
}: {
  field: Field;
  holdings: Holdings | null;
  current: PayAsset;
  label: string;
  tall: number | null;
  onPick: (asset: PayAsset) => void;
  onBack: () => void;
}) {
  const w = useWords(SWAP);
  const tw = useWords(TICKET);
  const lang = useLang();
  const towers = useMarket().towers;
  const prices = usePrices();
  const [query, setQuery] = useState('');
  const held = useMemo<PayAsset[]>(() => {
    if (!holdings) return [];
    const coins: PayAsset[] = [];
    if (holdings.sol && holdings.sol.spendableRaw !== '0') coins.push(SOL);
    for (const [mint, balance] of holdings.tokens) {
      const name = holdings.names?.get(mint);
      // Wrapped SOL is SOL: the native row already stands for it.
      if (mint === SOL.mint || !name?.symbol || balance.spendableRaw === '0') continue;
      coins.push({ mint, symbol: bare(name.symbol), decimals: balance.decimals, name: name.name, verified: name.verified, icon: name.icon });
    }
    return coins;
  }, [holdings]);
  const found = useFound(query);
  // The Market's engine reads «Main», the wallet's coins and what a search found by mint: their names, logos, prices and
  // Jupiter's word — a price beside every coin of a search, not the first alone (QA 19.11).
  const wanted = useMemo(() => [...MAIN_MINTS, ...held.map((asset) => asset.mint), ...found.map((asset) => asset.mint)].slice(0, 50), [held, found]);
  const depth = useDepthCoins(wanted);
  const byTower = useMemo(() => new Map(towers.map((tower) => [tower.id, tower])), [towers]);
  const main = useMemo<PayAsset[]>(
    () =>
      MAIN_MINTS.flatMap((mint): PayAsset[] => {
        const money = MONEY.find((asset) => asset.mint === mint);
        if (money) return [{ ...money, icon: payLogo(money) }];
        const coin = depth.get(mint);
        if (coin) return [{ mint, symbol: bare(coin.symbol), decimals: null, name: coin.name, verified: coin.verified, icon: spotIcon(mint, coin.icon) }];
        const tower = byTower.get(mint);
        return tower ? [{ mint, symbol: bare(tower.symbol), decimals: null, name: tower.name, verified: tower.verified, icon: towerLogo(mint, tower.icon) }] : [];
      }),
    [depth, byTower],
  );
  const priceOf = (mint: string): number | null => (mint === USDC.mint ? 1 : (depth.get(mint)?.price ?? prices.get(mint) ?? null));
  const worthOf = (asset: PayAsset): number | null => {
    const balance = balanceOf(holdings, asset.mint);
    const units = balance ? unitsOf(balance.spendableRaw, balance.decimals) : null;
    return usdWorth(units, priceOf(asset.mint), asset.mint === USDC.mint);
  };
  const start = pickStart({ field, held, main, worth: worthOf, most: WALLET_COINS });
  // A search: the wallet's coins, «Main» and the Market's coins Jupiter vouches for, then what the catalogue found.
  const market = useMemo<PayAsset[]>(
    () => towers.filter((tower) => tower.verified).map((tower) => ({ mint: tower.id, symbol: bare(tower.symbol), decimals: null, name: tower.id === SOL.mint ? 'Solana' : tower.name, verified: true, icon: towerLogo(tower.id, tower.icon) })),
    [towers],
  );
  const searching = query.trim().length > 0;
  const hits = searching ? withFound(pickList({ field, held, market: [...main, ...market], query, most: LIST_MOST }), searchable(query) ? found : [], LIST_MOST) : [];
  const sections: readonly Readonly<{ title: string | null; list: readonly PayAsset[] }>[] = searching
    ? [{ title: null, list: hits }]
    : field === 'pay'
      ? [
          { title: start.mine.length ? w.mine : null, list: start.mine },
          { title: w.main, list: start.main },
          { title: null, list: start.rest },
        ]
      : [
          { title: w.main, list: start.main },
          { title: start.mine.length ? w.mine : null, list: start.mine },
          { title: null, list: start.rest },
        ];
  // A coin of the list with no logo of its own gets the one the engine's catalogue knows for its mint (`payLogo`).
  const withLogo = (asset: PayAsset): PayAsset => (iconOf(asset) ? asset : { ...asset, icon: payLogo(asset) });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onBack();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onBack]);
  const empty = sections.every((section) => section.list.length === 0);
  return (
    <div className={s.picker} role="dialog" aria-label={label} style={tall ? { height: tall } : undefined}>
      <div className={s.pickerHead}>
        <button type="button" className={s.back} onClick={onBack} aria-label={tw.back}>
          <Icon name="back" size="s" />
        </button>
        <span className={s.findWrap}>
          <Icon name="search" size="s" className={s.findSign} />
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
        </span>
      </div>
      <div role="menu" aria-label={label} className={s.pickList}>
        {empty ? (
          <p className={s.pickEmpty}>{w.noMatch}</p>
        ) : (
          sections.map((section, at) =>
            section.list.length ? (
              <div key={at} role="group" aria-label={section.title ?? undefined} className={s.pickGroup}>
                {section.title ? <span className={s.pickTitle}>{section.title}</span> : null}
                {section.list.map((asset) => {
                  const balance = balanceOf(holdings, asset.mint);
                  const has = balance !== null && balance.spendableRaw !== '0';
                  const symbol = bare(unitOf(asset));
                  const name = asset.mint === SOL.mint ? 'Solana' : asset.name && asset.name !== symbol ? asset.name : null;
                  const price = priceOf(asset.mint);
                  const worth = has ? worthOf(asset) : null;
                  return (
                    <button key={asset.mint} type="button" role="menuitemradio" aria-checked={asset.mint === current.mint} className={s.pickRow} onClick={() => onPick(withLogo(asset))}>
                      <CoinLogo {...logoChain(asset.mint, asset.icon, iconOf(withLogo(asset)))} symbol={symbol} size="m" eager />
                      <span className={s.pickNames}>
                        <b>
                          {symbol}
                          {asset.verified === true ? (
                            <span className={s.verified} role="img" aria-label={w.verified} title={w.verified}>
                              <Icon name="check" size="s" />
                            </span>
                          ) : asset.verified === false ? (
                            <span className={s.unchecked} role="img" aria-label={w.unchecked} title={w.unchecked}>
                              <Icon name="help" size="s" />
                            </span>
                          ) : null}
                        </b>
                        {name ? <span>{name}</span> : null}
                      </span>
                      <span className={s.pickFigures}>
                        {has && balance ? (
                          <>
                            <b>{digits(formatUnits(balance.spendableRaw, balance.decimals, 'down'))}</b>
                            {worth !== null ? <span>{priceText(worth, lang)}</span> : null}
                          </>
                        ) : price !== null ? (
                          <span>{priceText(price, lang)}</span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null,
          )
        )}
      </div>
    </div>
  );
}

/**
 * The swap's terms and its one amber press: the rate and Ryntra's fee in one line, the route and the rest of the
 * breakdown behind «i»; a price impact that is not small stands on screen, before the press.
 */
function MarketPart({ tower, choice, press, onTopUp }: { tower: TowerRef; choice: Choice; press: () => Promise<'connect' | 'ok'>; onTopUp?: () => void }) {
  const tr = useWords(TRADE);
  const tw = useWords(TICKET);
  const w = useWords(SWAP);
  const side = useTrade((st) => st.side);
  const quote = useTrade((st) => st.quote);
  const review = useTrade((st) => st.review);
  const notice = useTrade((st) => st.notice);
  const phase = useTrade((st) => st.phase);
  const autoBuild = useTrade((st) => st.auto);
  const connection = useWallet((st) => st.connection);
  const connecting = useWallet((st) => Boolean(st.connecting));
  const holdings = useWallet((st) => st.holdings);
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const goBox = useRef<HTMLDivElement>(null);
  // «i» opened on a phone pushes the button down: it is brought back into view, above the bottom bar (m6).
  useEffect(() => {
    if (details) goBox.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [details]);
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
  // A shortfall of the balance is its own line under the price, never in its place (B1).
  const priceable = !choice.problem || choice.problem.kind === 'balance';
  const rate =
    amounts && body && priceable
      ? rateOf({ side, subject: subjectUnit, counter: counterUnit, inRaw: amounts.inAmountRaw, outRaw: amounts.outAmountRaw, inDecimals: decimalsOf(body, choice.inputMint), outDecimals: decimalsOf(body, choice.outputMint) })
      : null;

  const action = actionOf({
    phase,
    auto: autoBuild,
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
  // A wallet without any SOL cannot pay the network's fee: the button says so before a press (M14).
  const noSol = Boolean(connection) && phase === 'idle' && !choice.problem && feeShort(holdings?.sol, choice.inputMint);
  const tap = async () => {
    if (noSol) return;
    if (action.does === 'topUp') return onTopUp?.();
    if (action.does !== 'press') return;
    if ((await press()) === 'connect') connectOrPick(() => setPicking(true));
  };

  // Beside «Top up» the balance's own sentence is the same news a second time: the button already answers it.
  const problem = choice.problem && !(action.does === 'topUp' && choice.problem.kind === 'balance') ? choice.problem.text : null;
  const warnings = reviewNotes(shown);
  const caution = shown?.order.risk.verdict === 'REVIEW_REQUIRED' ? shown.order.risk.findings.find((finding) => finding.outcome === 'REVIEW_REQUIRED')?.detail : null;
  const impact = figures && priceable && figures.impactLevel !== 'low' ? { tone: figures.impactLevel === 'high' ? 'error' : 'warn', text: tw.impact(digits(figures.impact)) } : null;
  // A refused press in the person's terms: the wallet's own read beside the engine's code (M14).
  const frozen = holdings?.frozen ? [choice.inputMint, choice.outputMint].find((mint) => holdings.frozen?.has(mint)) : undefined;
  const reason = notice?.code ? reasonOf({ code: notice.code, solThin: solThin(holdings?.sol), frozen: Boolean(frozen) }) : null;
  const frozenUnit = frozen ? (frozen === choice.inputMint ? (side === 'buy' ? counterUnit : subjectUnit) : getUnit) : '';
  const said = notice && reason ? { ...notice, text: reason === 'needSol' ? w.needSolLine : reason === 'frozen' ? w.frozen(frozenUnit) : w.notBuilt } : notice;
  const note: Readonly<{ tone: string; text: string }> | null =
    (problem ? { tone: 'error', text: problem } : null) ??
    said ??
    (warnings[0] ? { tone: 'warn', text: warnings[0] } : caution ? { tone: 'warn', text: caution } : failed ? { tone: 'error', text: failed.message } : impact);

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
  const terms = Boolean(figures) && priceable && !retry;
  const label = noSol ? w.needSol : labels[action.label];
  return (
    <>
      {/* The rate on the left, Ryntra's fee and its «i» on the right: one line, the same height whether a price is here
          or not — the route and the rest wait behind «i», said once. */}
      <div className={s.terms}>
        <span className={s.rateLine} aria-live="polite">
          {retry ? (
            <Quiet size="s" onClick={() => void useTrade.getState().refreshQuote()}>
              {tr.tryAgain}
            </Quiet>
          ) : terms && rate ? (
            digits(w.rate(rate.one, rate.price, rate.other))
          ) : null}
        </span>
        {terms && figures ? (
          <span className={s.feeLine}>
            {figures.fee ? w.fee(figures.fee) : w.noFeeLine}
            {off ? <span className={t.off}>{off}</span> : null}
            <ExplainButton label={w.details} open={details} controls={detailsId} onToggle={() => setDetails((was) => !was)} />
          </span>
        ) : null}
      </div>
      {details && figures && priceable ? (
        <ExplainBox id={detailsId}>
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
        // One size for every word the button says: it never jumps between them (m3).
        <div ref={goBox} className={s.goBox}>
          <Action className={cx(t.go, s.go)} onClick={() => void tap()} disabled={noSol || action.does === 'none'} busy={action.busy}>
            {label}
          </Action>
        </div>
      )}
    </>
  );
}
