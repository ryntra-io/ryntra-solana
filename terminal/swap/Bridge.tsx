'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEPOSIT_MIN_USD, DEPOSIT_NETWORK_LABEL, DEPOSIT_NETWORKS, DEPOSIT_REFERENCE_USD, type DepositNetwork } from '@/lib/relay/deposit-address';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { EVM_EXPLORER_TX } from '@/lib/swap/catalog';
import { MONEY } from '@/city/components/money/words';
import { TRADE } from '@/city/components/trade/words';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { cleanAmount, readAmount } from '@/city/lib/money/amount';
import { formatAmount, formatUsd } from '@/city/lib/money/assets';
import { arrivalCode, bridgeEditable, etaWords, orderLine, orderPhase, orderWord, quoteFacts, readDestination, type BridgeArrive, type BridgeCoin } from '@/city/lib/money/bridge';
import { feeShort, feeWords, progressWords } from '@/city/lib/money/deposit';
import { BRIDGE_WORDS } from '@/city/lib/money/words';
import { grouped, short } from '@/city/lib/money/recipient';
import { bridgeHolding, useMoneyStore } from '@/city/lib/money/store';
import { SOL, USDC } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { iconOf } from '@/terminal/coin/Ticket';
import { ExplainBox, ExplainButton, Rows } from '@/terminal/coin/parts';
import { connectWallet } from '@/terminal/shell/Wallet';
import { useDismiss } from '@/terminal/shell/useDismiss';
import { CoinLogo, Figure, Icon, Kick, Panel, Quiet, Title, amountText, cx } from '@/terminal/ui';
import { BridgeGlyph } from './glyphs';
import { LeadPress, MoneyGo } from './go';
import { useSwapScreen, type Way } from './state';
import { bridgeStep, depositStep, type BridgeSay } from './swap-view';
import { BRIDGE } from './words';
import t from '@/terminal/coin/ticket.module.css';
import s from './swap.module.css';

/** While an address from another network is on screen, the deposit is asked about this often, this many times. */
const PROGRESS_MS = 15_000;
const PROGRESS_LIMIT = 240;
/** A transfer out on its way is read again this often while the screen is open. */
const ORDER_MS = 4_000;
/** How long «Copied» stands after a tap. */
const COPIED_MS = 2_000;

const SOLANA_MARK = '/marks/networks/solana.svg';
const markOf = (network: DepositNetwork) => `/marks/networks/${network}.svg`;
const USDC_ICON = iconOf(USDC);

/** A coin's logo by its ticker on either end: USDC, SOL, or a network's own coin (its network's mark). */
function coinIcon(symbol: string): string | null {
  if (symbol === 'USDC') return USDC_ICON;
  if (symbol === 'SOL') return iconOf(SOL);
  if (symbol === 'ETH') return markOf('ethereum');
  if (symbol === 'BNB') return markOf('bnb');
  if (symbol === 'POL') return markOf('polygon');
  return null;
}

/**
 * A coin of the bridge, chosen by its logo: a short menu of the ones this end may carry. A single coin is shown, not
 * chosen.
 */
function CoinPick<T extends string>({ value, options, labelOf, label, onPick, disabled = false }: { value: T; options: readonly T[]; labelOf: (option: T) => string; label: string; onPick: (option: T) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, box, () => setOpen(false));
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const symbol = labelOf(value);
  const face = (
    <>
      <CoinLogo src={coinIcon(symbol)} symbol={symbol} size="m" className={s.coinLogo} />
      <span className={s.coinSymbol}>{symbol}</span>
    </>
  );
  if (options.length < 2) return <span className={s.coin}>{face}</span>;
  return (
    <div className={t.anchor} ref={box}>
      <button type="button" className={s.coin} onClick={() => setOpen((was) => !was)} disabled={disabled} aria-label={`${label}: ${symbol}`} aria-expanded={open}>
        {face}
        <Icon name="chevron" size="s" className={s.coinChevron} />
      </button>
      {open ? (
        <div className={cx(t.menu, s.coinMenu)} role="menu" aria-label={label}>
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === value}
              className={t.menuRow}
              onClick={() => {
                setOpen(false);
                onPick(option);
              }}
            >
              <CoinLogo src={coinIcon(labelOf(option))} symbol={labelOf(option)} size="s" />
              <span className={t.menuName}>{labelOf(option)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A field of the bridge in the swap's own shape: its name and an aside over it, the figure and the coin in one row.
 * `children` is the figure — typed, or read.
 */
function MoneyField({ label, aside, coin, children }: { label: string; aside: string; coin: ReactNode; children: ReactNode }) {
  return (
    <div className={s.big}>
      <div className={s.bigHead}>
        <Kick>{label}</Kick>
        <span className={s.bigAside}>{aside}</span>
      </div>
      <div className={s.bigRow}>
        {children}
        {coin}
      </div>
    </div>
  );
}

/**
 * The bridge: USDC between Solana and another network, both ways, on the money logic as it is (`city/lib/money/**`).
 * Into Solana is an address on the other network that pays USDC into this wallet (Relay) — nothing to sign. Out of
 * Solana is one signature: the engine prices it, builds the exact transfer, sends it once and follows it until the
 * money lands or comes back. The time and the fee stand in one line; the breakdown behind «i».
 *
 * `onClose`: a screen that opens the bridge as a panel of its own (the Portfolio's «Top up») closes it here — never while
 * the wallet is open or the transfer is being sent.
 *
 * `bare`: the bridge drawn into the card that holds it (the Swap screen's one card) — no panel and no head of
 * its own; the card's head keeps the «i», and `how` says whether its words stand open (`howId` names them).
 */
export function BridgePanel({ id, onClose, closeLabel, bare = false, how = false, howId: howOf }: { id?: string; onClose?: () => void; closeLabel?: string; bare?: boolean; how?: boolean; howId?: string }) {
  const w = useWords(BRIDGE);
  const way = useSwapScreen((st) => st.way);
  const network = useSwapScreen((st) => st.network);
  const order = useMoneyStore((st) => st.bridge.order);
  const phase = useMoneyStore((st) => st.bridge.phase);
  const [howOpen, setHowOpen] = useState(false);
  const ownHow = useId();
  const howId = howOf ?? ownHow;
  const editable = bridgeEditable(phase) && !order;

  if (bare) {
    return (
      <LeadPress.Provider value>
        {how ? (
          <ExplainBox id={howId}>
            <span className={t.line}>{w.howText}</span>
          </ExplainBox>
        ) : null}
        {way === 'out' && order ? (
          <Order />
        ) : (
          <>
            <Networks way={way} network={network} editable={editable} />
            {way === 'in' ? <Into network={network} /> : <OutOf network={network} />}
          </>
        )}
      </LeadPress.Provider>
    );
  }

  return (
    <Panel pad="l" gap={12} edge label={w.title} className={s.money}>
      <div className={s.head} id={id}>
        <BridgeGlyph className={s.headSignLilac} />
        <Title as="h2" className={s.headTitle}>
          {w.title}
        </Title>
        <ExplainButton label={w.how} open={howOpen} controls={howId} onToggle={() => setHowOpen((was) => !was)} />
        {onClose ? (
          <button type="button" className={s.back} onClick={onClose} disabled={phase === 'planning' || phase === 'wallet' || phase === 'sending'} aria-label={closeLabel}>
            <Icon name="close" size="s" />
          </button>
        ) : null}
      </div>
      {howOpen ? (
        <ExplainBox id={howId}>
          <span className={t.line}>{w.howText}</span>
        </ExplainBox>
      ) : null}
      {way === 'out' && order ? (
        <Order />
      ) : (
        <>
          <Networks way={way} network={network} editable={editable} />
          {way === 'in' ? <Into network={network} /> : <OutOf network={network} />}
        </>
      )}
    </Panel>
  );
}

/** The two ends: the other network to pick, Solana fixed, and the arrow between them turns the direction. */
function Networks({ way, network, editable }: { way: Way; network: DepositNetwork; editable: boolean }) {
  const w = useWords(BRIDGE);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, box, () => setOpen(false));
  useEffect(() => {
    if (!editable) setOpen(false);
  }, [editable]);
  const pickNetwork = (next: DepositNetwork) => {
    setOpen(false);
    useSwapScreen.setState({ network: next });
  };
  const other = (
    <div className={cx(t.anchor, s.end)} ref={box}>
      <button type="button" className={s.endPill} onClick={() => setOpen((was) => !was)} disabled={!editable} aria-label={w.pickNetwork} aria-expanded={open}>
        <span className={s.endName}>
          <CoinLogo src={markOf(network)} symbol={DEPOSIT_NETWORK_LABEL[network]} size="s" />
          {DEPOSIT_NETWORK_LABEL[network]}
        </span>
        <Icon name="chevron" size="s" />
      </button>
      {open ? (
        <div className={cx(t.menu, s.netMenu)} role="menu" aria-label={w.pickNetwork}>
          {DEPOSIT_NETWORKS.map((each) => (
            <button key={each} type="button" role="menuitemradio" aria-checked={each === network} className={t.menuRow} onClick={() => pickNetwork(each)}>
              <CoinLogo src={markOf(each)} symbol={DEPOSIT_NETWORK_LABEL[each]} size="s" />
              <span className={t.menuName}>{DEPOSIT_NETWORK_LABEL[each]}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
  const solana = (
    <div className={s.end}>
      <span className={cx(s.endPill, s.endFixed)}>
        <span className={s.endName}>
          <CoinLogo src={SOLANA_MARK} symbol="Solana" size="s" />
          Solana
        </span>
      </span>
    </div>
  );
  // «From» and «To» over the two ends, and between them the same square turn the swap has: the direction is a choice
  // a person sees at once, not an arrow to discover.
  return (
    <div className={s.ends}>
      <div className={s.endSide}>
        <Kick>{w.fromEnd}</Kick>
        {way === 'in' ? other : solana}
      </div>
      <button type="button" className={s.turn} onClick={() => useSwapScreen.setState({ way: way === 'in' ? 'out' : 'in' })} disabled={!editable} aria-label={w.turn} title={w.turn}>
        <Icon name="swap" size="s" />
      </button>
      <div className={s.endSide}>
        <Kick>{w.toEnd}</Kick>
        {way === 'in' ? solana : other}
      </div>
    </div>
  );
}

/** A coin field that is read, never typed: what arrives, or nothing yet. */
function ReadField({ label, aside, value, coin }: { label: string; aside: string; value: string | null; coin: ReactNode }) {
  return (
    <MoneyField label={label} aside={aside} coin={coin}>
      <span className={s.bigOut}>
        <span className={cx(s.bigAmount, value === null && s.bigNone)}>{value ?? '0'}</span>
      </span>
    </MoneyField>
  );
}

/** A typed amount in the bridge's field. */
function AmountInput({ value, onChange, label, disabled = false }: { value: string; onChange: (text: string) => void; label: string; disabled?: boolean }) {
  return (
    <input
      className={s.bigAmount}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      placeholder="0"
      aria-label={label}
      value={fieldText(value)}
      disabled={disabled}
      onChange={(event) => onChange(cleanAmount(fieldValue(amountText(event.target.value))))}
    />
  );
}

/* ── into Solana: an address there ────────────────────────────────────── */

function Into({ network }: { network: DepositNetwork }) {
  const w = useWords(BRIDGE);
  const m = useWords(MONEY);
  const label = DEPOSIT_NETWORK_LABEL[network];
  const owner = useWallet((st) => st.connection?.address ?? null);
  const deposit = useMoneyStore((st) => st.deposit);
  const [amount, setAmount] = useState('');
  const [copied, setCopied] = useState(false);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const shown = owner && deposit.address && deposit.address.recipient === owner && deposit.address.network === network && deposit.network === network ? deposit.address : null;
  const loading = deposit.network === network && deposit.status === 'loading';
  const failed = deposit.network === network && deposit.status === 'failed';
  const say = depositStep({ connected: Boolean(owner), status: loading ? 'loading' : failed ? 'failed' : 'idle', shown: Boolean(shown) });
  // The amount only says how much the person means to send: an open address takes any amount from the least.
  const sum = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 ? `${digits(amount)} USDC` : null;

  // Arrivals at the address on screen are read while it stands there.
  useEffect(() => {
    if (!shown) return;
    let count = 0;
    const ask = () => {
      if (document.visibilityState !== 'visible' || count >= PROGRESS_LIMIT) return;
      count += 1;
      void useMoneyStore.getState().readDepositProgress();
    };
    ask();
    const timer = setInterval(ask, PROGRESS_MS);
    return () => clearInterval(timer);
  }, [shown]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.address);
      setCopied(true);
    } catch {
      // A refused clipboard leaves the address on screen to be copied by hand.
    }
  };
  const act = () => {
    if (say === 'connect') return connectWallet();
    if (say === 'move') return void useMoneyStore.getState().pickDeposit(network);
    if (say === 'copy') return void copy();
  };
  const eta = shown?.seconds !== null && shown?.seconds !== undefined ? etaWords(shown.seconds) : null;
  const fee = shown ? feeShort(shown.feeUsd) : null;
  const terms = [m.fromMin(digits(`$${DEPOSIT_MIN_USD}`)), eta, fee].filter(Boolean).join(' · ');
  const progress = deposit.progress && shown ? progressWords(deposit.progress.progress) : '';
  const words: Readonly<Record<'connect' | 'move' | 'asking' | 'copy', string>> = {
    connect: w.connect,
    move: w.moveTo('Solana'),
    asking: m.askingAddress,
    copy: copied ? w.copied : w.copy,
  };

  return (
    <>
      <MoneyField label={w.send} aside={w.from(label)} coin={<CoinPick value="USDC" options={['USDC']} labelOf={(x) => x} label={w.pickSend} onPick={() => {}} />}>
        <AmountInput value={amount} onChange={setAmount} label={w.send} />
      </MoneyField>
      {shown ? (
        <div className={s.address} aria-live="polite">
          <Kick>{sum ? w.sendTo(sum, label) : w.sendAny(label)}</Kick>
          <p className={s.addressValue} translate="no">
            {grouped(shown.address)}
          </p>
        </div>
      ) : (
        <ReadField label={w.get} aside={w.on('Solana')} value={null} coin={<CoinPick value="USDC" options={['USDC']} labelOf={(x) => x} label={w.pickGet} onPick={() => {}} />} />
      )}
      <div className={s.grow} />
      {shown ? (
        <div className={s.terms}>
          <span className={s.termsLine}>{terms}</span>
          <ExplainButton label={w.details} open={details} controls={detailsId} onToggle={() => setDetails((was) => !was)} />
        </div>
      ) : null}
      {details && shown ? (
        <ExplainBox id={detailsId}>
          <span className={s.explainLines}>
            <span>{feeWords(shown.feeUsd, DEPOSIT_REFERENCE_USD)}</span>
            <span>{w.arrives}</span>
          </span>
        </ExplainBox>
      ) : null}
      {failed ? (
        <p className={t.note} data-tone="error" role="alert">
          {m.addressFailed}
        </p>
      ) : progress ? (
        <p className={t.note} data-tone={deposit.progress?.progress === 'FAILED' ? 'error' : deposit.progress?.progress === 'ARRIVED' ? undefined : 'warn'} role="status">
          {progress}
          {deposit.progress?.amount ? ` ${digits(deposit.progress.amount)} USDC.` : ''}
        </p>
      ) : null}
      <MoneyGo onClick={act} disabled={say === 'asking'} busy={say === 'asking'}>
        {words[say]}
      </MoneyGo>
    </>
  );
}

/* ── out of Solana: one signature ─────────────────────────────────────── */

function OutOf({ network }: { network: DepositNetwork }) {
  const w = useWords(BRIDGE);
  const m = useWords(MONEY);
  const tr = useWords(TRADE);
  const none = useWords(BRIDGE_WORDS).none;
  const label = DEPOSIT_NETWORK_LABEL[network];
  const connection = useWallet((st) => st.connection);
  const bridge = useMoneyStore((st) => st.bridge);
  const wallet = useMoneyStore((st) => st.wallet);
  const walletRead = useMoneyStore((st) => st.walletRead);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const held = bridgeHolding(wallet, bridge.coin);
  const editable = bridgeEditable(bridge.phase);
  const coin = bridge.coin;

  // The money store prices the network on screen — again whenever the two part (a wallet followed anew resets it).
  const pricedOn = useMoneyStore((st) => st.bridge.network);
  useEffect(() => {
    if (pricedOn !== network) useMoneyStore.getState().setBridgeNetwork(network);
  }, [network, pricedOn]);

  const destination = readDestination(bridge.to);
  const amount = readAmount(bridge.amount, held ? { spendableRaw: held.spendableRaw, decimals: held.decimals, symbol: coin } : null);
  const quote = bridge.quote?.body.quote ?? null;
  const facts = useMemo(() => (quote ? quoteFacts(quote) : null), [quote]);
  const priced = Boolean(facts && destination.ok && amount.ok && bridge.network === network);
  // A price the engine refused for exactly this: its plain words stand, and «Try again» only asks for the price again.
  const refused = bridge.phase === 'idle' && bridge.quote === null && bridge.line?.tone === 'error' && destination.ok && amount.ok && bridge.network === network;
  const step = bridgeStep({
    connected: Boolean(connection),
    walletRead,
    read: Boolean(wallet),
    usdc: held ? held.spendableRaw : null,
    destinationOk: destination.ok,
    amount: amount.ok ? 'ok' : amount.problem === 'OVER_BALANCE' ? 'over' : 'none',
    phase: bridge.phase,
    quoted: priced && bridge.quote !== null,
    refused: refused,
    buildable: bridge.quote?.body.buildable === true,
    planned: bridge.plan !== null,
  });
  const words: Readonly<Record<BridgeSay, string>> = {
    connect: w.connect,
    reading: m.readingBalancesNow,
    unread: m.balancesUnavailableShort,
    noUsdc: coin === 'USDC' ? m.noUsdc : w.noCoin(coin),
    address: m.enterAddressThere,
    short: coin === 'USDC' ? m.notEnoughUsdc : w.notEnough(coin),
    amount: m.enterAmount,
    pricing: m.gettingPrice,
    refused: w.moveTo(label),
    preparing: m.preparing,
    wallet: m.checkWallet,
    sending: m.sending,
    paused: m.paused,
    confirm: connection?.wallet ? tr.confirmIn(connection.wallet) : m.confirmInWallet,
    move: w.moveTo(label),
  };
  const act = () => {
    if (step.act === 'connect') return connectWallet();
    if (step.act === 'review') return void useMoneyStore.getState().reviewBridge();
    if (step.act === 'confirm') return void useMoneyStore.getState().confirmBridge();
  };

  const fee = facts ? (facts.providerUsd === null ? w.feeInside : w.fee(formatUsd(facts.providerUsd))) : null;
  const ryntra = facts && facts.ryntraFee !== none ? `Ryntra ${digits(facts.ryntraFee.split(' · ')[0] ?? facts.ryntraFee)}` : null;
  const terms = facts && priced ? [etaWords(facts.etaSeconds), fee, ryntra].filter(Boolean).join(' · ') : null;
  const problem = bridge.to && !destination.ok ? destination.text : bridge.amount && !amount.ok && amount.problem !== 'EMPTY' ? amount.text : null;
  // What the way loses, as the engine's own bands say it (`crossSwapImpactBand`): 2% and more is said before the press.
  const loss = priced && quote?.priceImpactBps !== null && quote?.priceImpactBps !== undefined ? -quote.priceImpactBps : 0;
  const impact = loss >= 200 ? { tone: loss >= 1_000 ? 'error' : 'warn', text: w.loss(digits((loss / 100).toFixed(1))) } : null;
  const line = problem ? { tone: 'error', text: problem } : (bridge.line ?? impact);

  return (
    <>
      <MoneyField
        label={w.send}
        aside={held ? m.available(formatAmount(held.spendableRaw, held.decimals), coin) : w.from('Solana')}
        coin={<CoinPick<BridgeCoin> value={coin} options={['USDC', 'SOL']} labelOf={(x) => x} label={w.pickSend} disabled={!editable} onPick={(next) => useMoneyStore.getState().setBridgeCoin(next)} />}
      >
        <AmountInput value={bridge.amount} onChange={(text) => editable && useMoneyStore.getState().setBridgeAmount(text)} label={w.send} disabled={!editable} />
      </MoneyField>
      <label className={s.big}>
        <span className={s.bigHead}>
          <Kick>{w.addressOn(label)}</Kick>
        </span>
        <input
          className={s.text}
          value={bridge.to}
          onChange={(event) => useMoneyStore.getState().setBridgeTo(event.target.value.trim())}
          placeholder="0x…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          translate="no"
          disabled={!editable}
        />
      </label>
      <ReadField
        label={w.get}
        aside={w.on(label)}
        value={facts && priced ? formatAmount(facts.minimumRaw, facts.decimals) : null}
        coin={<CoinPick<BridgeArrive> value={bridge.arrive} options={['USDC', 'NATIVE']} labelOf={(x) => arrivalCode(network, x)} label={w.pickGet} disabled={!editable} onPick={(next) => useMoneyStore.getState().setBridgeArrive(next)} />}
      />
      <div className={s.grow} />
      {refused ? (
        <div className={s.terms}>
          <span />
          <Quiet size="s" onClick={() => void useMoneyStore.getState().quoteBridge()}>
            {tr.tryAgain}
          </Quiet>
        </div>
      ) : terms ? (
        <div className={s.terms}>
          <span className={s.termsLine}>{terms}</span>
          <ExplainButton label={w.details} open={details} controls={detailsId} onToggle={() => setDetails((was) => !was)} />
        </div>
      ) : null}
      {details && facts && priced && destination.ok && amount.ok ? (
        <ExplainBox id={detailsId}>
          <Rows
            rows={[
              [m.youSend, `${formatAmount(amount.raw, held?.decimals ?? 6)} ${coin}`],
              [m.theyGetLeast, `${formatAmount(facts.minimumRaw, facts.decimals)} ${facts.symbol}`],
              [m.movingCosts, facts.providerUsd === null ? m.insideAmount : m.insideAmountOf(`≈ ${formatUsd(facts.providerUsd)}`)],
              [m.ryntraFee, digits(facts.ryntraFee)],
              [m.solanaFee, facts.networkUsd === null ? m.fewCentsSol : m.inSol(`≈ ${formatUsd(facts.networkUsd)}`)],
              [m.arrivesIn, etaWords(facts.etaSeconds)],
              [m.to, short(destination.address)],
            ]}
          />
        </ExplainBox>
      ) : null}
      {line ? (
        <p className={t.note} data-tone={line.tone} role={line.tone === 'error' ? 'alert' : 'status'}>
          {line.text}
        </p>
      ) : null}
      <MoneyGo onClick={act} disabled={step.act === null} busy={step.busy}>
        {words[step.say]}
      </MoneyGo>
    </>
  );
}

/** One transfer out, followed until it lands or comes back. */
function Order() {
  const m = useWords(MONEY);
  const w = useWords(BRIDGE);
  const order = useMoneyStore((st) => st.bridge.order);
  // While it moves, the engine is asked again; the money store follows one order at a time.
  const moving = order ? orderPhase(order.state) === 'moving' || orderPhase(order.state) === 'recovery' : false;
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void useMoneyStore.getState().followOrder();
    }, ORDER_MS);
    return () => clearInterval(timer);
  }, [moving]);
  if (!order) return null;
  const phase = orderPhase(order.state);
  const evm = order.to.network === 'solana' ? null : order.to.network;
  const there = evm ? (DEPOSIT_NETWORK_LABEL[evm as DepositNetwork] ?? evm) : 'Solana';
  return (
    <>
      <div className={t.result} role="status">
        <Kick className={phase === 'done' ? t.kickUp : phase === 'failed' ? t.kickDown : t.kickWarn}>{orderWord(phase)}</Kick>
        <Figure value={formatAmount(order.from.amountRaw, order.from.decimals)} unit={order.from.symbol} />
        <span className={t.line}>{w.order(formatAmount(order.from.amountRaw, order.from.decimals), order.from.symbol, there)}</span>
        {orderLine(phase) ? <span className={t.line}>{orderLine(phase)}</span> : null}
        {order.sourceTxHash ? (
          <a className={t.link} href={explorerTxUrl('mainnet', order.sourceTxHash)} target="_blank" rel="noreferrer">
            {m.onSolana(short(order.sourceTxHash))}
            <Icon name="arrow" size="s" />
          </a>
        ) : null}
        {order.destinationTxHash && evm && evm in EVM_EXPLORER_TX ? (
          <a className={t.link} href={`${EVM_EXPLORER_TX[evm as keyof typeof EVM_EXPLORER_TX]}${order.destinationTxHash}`} target="_blank" rel="noreferrer">
            {m.there(short(order.destinationTxHash))}
            <Icon name="arrow" size="s" />
          </a>
        ) : null}
      </div>
      <div className={s.grow} />
      {moving ? null : (
        <MoneyGo onClick={() => useMoneyStore.getState().newBridge()}>{m.newTransfer}</MoneyGo>
      )}
    </>
  );
}
