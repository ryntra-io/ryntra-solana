'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { cleanAmount } from '@/city/lib/money/amount';
import { formatUnits } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { RELAY_SOLANA_NATIVE_ADDRESS } from '@/lib/relay/chains';
import { ExplainBox, ExplainButton, Rows } from '@/terminal/coin/parts';
import { connectWallet } from '@/terminal/shell/Wallet';
import { Action, Icon, Kick, amountText, cx } from '@/terminal/ui';
import { addressOk, costOf, dollarsOf, etaOf, fromRaw, pressOf, shortOf, toRaw, type BridgeCoin, type Press } from './bridge-form';
import { startEvm, useEvm } from './bridge-evm';
import { chainOf, loadChains, move, pickCoin, requestQuote, setRecipient, setTyped, turn, useBridge, type Parties } from './bridge-store';
import { RELAY_BRIDGE } from './bridge-words';
import { BridgePick, BridgeWallets, CoinMark } from './BridgePick';
import { BridgeTrip } from './BridgeTrip';
import t from '@/terminal/coin/ticket.module.css';
import s from './swap.module.css';
import b from './bridge.module.css';

/** The price stands on screen this long before it is asked again. */
const REFRESH_MS = 20_000;

/** Who sends, who receives, and whether money leaves through a deposit address — from the wallets and the form. */
function useParties(): Readonly<Parties & { ownRecipient: string | null }> {
  const chains = useBridge((st) => st.chains);
  const from = useBridge((st) => st.from);
  const to = useBridge((st) => st.to);
  const typed = useBridge((st) => st.recipientTyped);
  const solana = useWallet((st) => st.connection?.address ?? null);
  const evm = useEvm((st) => st.address);
  const origin = chainOf(chains, from.chainId);
  const destination = chainOf(chains, to.chainId);
  const addressOn = (wallet: 'evm' | 'solana' | null | undefined) => (wallet === 'solana' ? solana : wallet === 'evm' ? evm : null);
  const ownRecipient = addressOn(destination?.owner);
  const recipient = typed !== null ? (destination && addressOk(destination.vm, typed) ? typed.trim() : null) : ownRecipient;
  return { user: addressOn(origin?.wallet), recipient, deposit: origin !== null && origin.wallet === null, ownRecipient };
}

/** What the sending wallet holds of the coin sent, raw; null when it is not read. */
function useHeld(coin: BridgeCoin, wallet: 'evm' | 'solana' | null | undefined, user: string | null): string | null {
  const holdings = useWallet((st) => st.holdings);
  const [evmHeld, setEvmHeld] = useState<{ key: string; raw: string } | null>(null);
  const key = `${coin.chainId}:${coin.address}:${user ?? ''}`;
  useEffect(() => {
    if (wallet !== 'evm' || !user) return;
    let live = true;
    fetch(`/api/swap/bridge/balance?chain=${coin.chainId}&token=${encodeURIComponent(coin.address)}&owner=${user}`)
      .then((response) => (response.ok ? (response.json() as Promise<{ raw?: string }>) : null))
      .then((payload) => {
        if (live && payload?.raw && /^\d+$/.test(payload.raw)) setEvmHeld({ key, raw: payload.raw });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [wallet, user, coin.chainId, coin.address, key]);
  if (wallet === 'solana' && user && holdings && holdings.owner === user) {
    if (coin.address === RELAY_SOLANA_NATIVE_ADDRESS) return holdings.sol?.spendableRaw ?? null;
    return holdings.tokens.get(coin.address)?.spendableRaw ?? (holdings.complete ? '0' : null);
  }
  if (wallet === 'evm' && evmHeld?.key === key) return evmHeld.raw;
  return null;
}

/** A field of the form: its name and an aside over it, the figure and the coin in one row, the dollars under it. */
function Field({ label, labelFor, aside, coin, usd, children }: { label: string; labelFor?: string; aside?: ReactNode; coin: ReactNode; usd: string | null; children: ReactNode }) {
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
        {aside}
      </div>
      <div className={s.bigRow}>
        {children}
        {coin}
      </div>
      <div className={s.bigUsd}>{usd ?? ''}</div>
    </div>
  );
}

function CoinButton({ side, coin, network, label, onClick, disabled }: { side: 'from' | 'to'; coin: BridgeCoin; network: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={cx(s.coin, b.coin)} onClick={onClick} disabled={disabled} aria-label={`${label}: ${coin.symbol} ${network}`} data-bridge-coin={side}>
      <CoinMark coin={coin} />
      <span className={b.coinNames}>
        <b>{coin.symbol}</b>
        <span>{network}</span>
      </span>
      <Icon name="chevron" size="s" className={s.coinChevron} />
    </button>
  );
}

type View = 'form' | 'from' | 'to' | 'wallets';

/**
 * The Bridge form: any coin on any network into any coin on another. Two large fields — what is sent and
 * what arrives, each coin with its network — where the money lands, the time and the fee in one line with the rest
 * behind «i», and one amber press that leads to whatever the next step is: the amount, the sending wallet (Solana's,
 * or an EVM wallet the browser carries), where the money lands, then the move. A network no wallet here signs on gives
 * a deposit address for the exact amount.
 */
export function BridgeForm() {
  const w = useWords(RELAY_BRIDGE);
  const chains = useBridge((st) => st.chains);
  const chainsFailed = useBridge((st) => st.chainsFailed);
  const from = useBridge((st) => st.from);
  const to = useBridge((st) => st.to);
  const typed = useBridge((st) => st.typed);
  const recipientTyped = useBridge((st) => st.recipientTyped);
  const quote = useBridge((st) => st.quote);
  const run = useBridge((st) => st.run);
  const moved = useBridge((st) => st.moved);
  const solanaWallet = useWallet((st) => st.connection);
  const parties = useParties();
  const [view, setView] = useState<View>('form');
  const [details, setDetails] = useState(false);
  const payId = useId();
  const detailsId = useId();

  useEffect(() => startEvm(), []);

  const origin = chainOf(chains, from.chainId);
  const destination = chainOf(chains, to.chainId);
  const amountRaw = toRaw(cleanAmount(typed), from.decimals);
  const held = useHeld(from, origin?.wallet, parties.user);
  const { user, recipient, deposit } = parties;

  // The price follows the form; it is asked again while it stands on screen.
  useEffect(() => {
    if (run) return;
    requestQuote({ user, recipient, deposit });
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') requestQuote({ user, recipient, deposit });
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [from, to, typed, user, recipient, deposit, run]);

  const current = quote.status !== 'idle' && 'key' in quote ? quote : null;
  const facts = quote.status === 'ready' ? quote.facts : null;
  const press: Press = pressOf({
    chainsReady: chains !== null,
    origin,
    destination,
    amountRaw,
    heldRaw: held,
    originAddress: user,
    recipient,
    recipientTyped: recipientTyped !== null,
    quote,
  });

  const words: Readonly<Record<Press, string>> = {
    chains: chainsFailed ? w.chainsFailed : w.pricing,
    enter: w.enter,
    notEnough: w.notEnough(from.symbol),
    connectOrigin: origin?.wallet === 'solana' ? w.connectOn('Solana') : w.connect,
    connectDestination: destination?.owner === 'solana' ? w.connectOn('Solana') : w.connect,
    address: w.addressFirst,
    pricing: w.pricing,
    noRoute: w.noRoute,
    tooSmall: w.tooSmall,
    tooLarge: w.tooLarge,
    busy: w.tryAgain,
    unavailable: w.tryAgain,
    move: w.move(destination?.label ?? ''),
    deposit: w.depositFor,
  };
  const act = () => {
    if (press === 'connectOrigin' || press === 'connectDestination') {
      const wallet = press === 'connectOrigin' ? origin?.wallet : destination?.owner;
      if (wallet === 'solana') return connectWallet();
      return setView('wallets');
    }
    if (press === 'busy' || press === 'unavailable') return requestQuote({ user, recipient, deposit }, true);
    if (press === 'move') {
      const wallet = origin?.wallet === 'solana' && solanaWallet ? ({ kind: 'solana', wallet: solanaWallet.wallet, address: solanaWallet.address } as const) : ({ kind: 'evm' } as const);
      return void move({ user, recipient, deposit }, wallet);
    }
    if (press === 'deposit') return void move({ user, recipient, deposit }, null);
    if (press === 'chains' && chainsFailed) return void loadChains();
  };
  const enabled = press === 'connectOrigin' || press === 'connectDestination' || press === 'busy' || press === 'unavailable' || press === 'move' || press === 'deposit' || (press === 'chains' && chainsFailed);

  if (run) return <BridgeTrip />;
  if ((view === 'from' || view === 'to') && chains) {
    return (
      <BridgePick
        side={view}
        chains={chains}
        current={view === 'from' ? from : to}
        other={view === 'from' ? to : from}
        onBack={() => setView('form')}
        onPick={(token) => {
          pickCoin(view, token);
          setView('form');
        }}
      />
    );
  }
  if (view === 'wallets') return <BridgeWallets onBack={() => setView('form')} onDone={() => setView('form')} />;

  const fresh = current && facts && quote.status === 'ready' ? quote : null;
  const getValue = fresh && amountRaw ? digits(formatUnits(fresh.facts.get.expectedRaw, fresh.facts.get.decimals, 'down')) : null;
  const loading = amountRaw !== null && (quote.status === 'loading' || (quote.status === 'ready' && quote.preview && press === 'pricing'));
  const sendUsd = fresh && amountRaw && fresh.facts.send.usd !== null ? `≈ ${digits(dollarsOf(fresh.facts.send.usd) ?? '')}` : null;
  const getUsd = fresh && amountRaw && fresh.facts.get.usd !== null ? `≈ ${digits(dollarsOf(fresh.facts.get.usd) ?? '')}` : null;
  const cost = fresh ? dollarsOf(costOf(fresh.facts)) : null;
  const eta = fresh ? etaOf(fresh.facts.etaSeconds, w) : null;
  const terms = fresh && amountRaw ? [eta, cost ? w.fee(digits(cost)) : null].filter(Boolean).join(' · ') : null;
  const loss = fresh?.facts.impactPercent ?? null;
  const impact = fresh && loss !== null && loss <= -2 ? w.loss(digits(Math.abs(loss).toFixed(1))) : null;
  const canMax = held !== null && held !== '0' && !(origin?.vm === 'evm' && from.address === '0x0000000000000000000000000000000000000000');

  // The landing as its one plain line — the wallet it lands in and «Another address» — not the field.
  const landPlain = destination !== null && destination.owner !== null && recipientTyped === null;
  const info = <ExplainButton label={terms ? w.details : w.how} open={details} controls={detailsId} onToggle={() => setDetails((was) => !was)} />;
  return (
    <>
      <Field
        label={w.send}
        labelFor={payId}
        usd={sendUsd}
        aside={
          held !== null ? (
            <span className={b.aside}>
              {w.balance(digits(formatUnits(held, from.decimals, 'down')))}
              {canMax ? (
                <button type="button" className={b.max} onClick={() => setTyped(fromRaw(held, from.decimals))}>
                  {w.max}
                </button>
              ) : null}
            </span>
          ) : undefined
        }
        coin={<CoinButton side="from" coin={from} network={origin?.label ?? ''} label={w.pickSend} onClick={() => setView('from')} disabled={!chains} />}
      >
        <input
          id={payId}
          data-bridge-amount
          className={s.bigAmount}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0"
          value={fieldText(typed)}
          onChange={(event) => setTyped(cleanAmount(fieldValue(amountText(event.target.value))))}
        />
      </Field>
      <div className={b.turnRow}>
        <button type="button" className={s.turn} onClick={turn} aria-label={w.turn} title={w.turn}>
          <Icon name="swap" size="s" />
        </button>
      </div>
      <Field label={w.get} usd={getUsd} coin={<CoinButton side="to" coin={to} network={destination?.label ?? ''} label={w.pickGet} onClick={() => setView('to')} disabled={!chains} />}>
        <span className={s.bigOut}>
          {loading && !getValue ? <span className={cx(t.shimmer, s.bigShimmer)} aria-hidden="true" /> : <span className={cx(s.bigAmount, !getValue && s.bigNone)}>{getValue ?? '0'}</span>}
        </span>
      </Field>
      {/* The form's one «i»: beside «Another address» while that line stands — never alone on a row of its own
          under it, as a phone showed it; in the line of the time and the fee otherwise. */}
      <Landing ownRecipient={parties.ownRecipient} info={landPlain ? info : null} />
      {/* The time and the fee on the left, the form's one «i» on the right: one line in its own place before a price too
          (eyes pass 20.11, №19: the «i» stood alone in the page's corner, away from the form) — no jump when the price
          comes. Before a price the «i» says how the bridge works; with one, the transfer's breakdown and then that. */}
      <div className={s.terms}>
        <span className={s.termsLine}>{terms ?? (loading ? <span className={cx(t.shimmer, s.rateShimmer)} aria-hidden="true" /> : null)}</span>
        {landPlain ? null : info}
      </div>
      {details ? (
        <ExplainBox id={detailsId}>
          <span className={s.explainLines}>
            {fresh && amountRaw ? (
              <Rows
                rows={[
                  [w.youSend, `${digits(formatUnits(fresh.facts.send.amountRaw, fresh.facts.send.decimals))} ${fresh.facts.send.symbol}`],
                  [w.atLeast, `${digits(formatUnits(fresh.facts.get.minimumRaw, fresh.facts.get.decimals, 'down'))} ${fresh.facts.get.symbol}`],
                  ...(fresh.facts.fees.relayUsd !== null ? [[w.relayFee, digits(dollarsOf(fresh.facts.fees.relayUsd) ?? '')] as const] : []),
                  ...(fresh.facts.fees.gasUsd !== null ? [[w.gasFee, digits(dollarsOf(fresh.facts.fees.gasUsd) ?? '')] as const] : []),
                  ...(fresh.facts.fees.ryntraUsd !== null ? [[w.ryntraFee, digits(dollarsOf(fresh.facts.fees.ryntraUsd) ?? '')] as const] : []),
                  ...(eta ? [[w.arrivesIn, eta] as const] : []),
                  [w.through, 'Relay'],
                ]}
              />
            ) : null}
            <span>{w.howText}</span>
          </span>
        </ExplainBox>
      ) : null}
      {moved || impact ? (
        <p className={b.warn} role="status">
          {moved ? w.moved : impact}
        </p>
      ) : null}
      <Action className={s.go} onClick={act} disabled={!enabled} busy={press === 'pricing' && amountRaw !== null} data-bridge-go={press}>
        {words[press]}
      </Action>
    </>
  );
}

/** Where the money lands: the person's own wallet there by default; another address only typed, checked and warned. */
function Landing({ ownRecipient, info }: { ownRecipient: string | null; info: ReactNode }) {
  const w = useWords(RELAY_BRIDGE);
  const chains = useBridge((st) => st.chains);
  const to = useBridge((st) => st.to);
  const typed = useBridge((st) => st.recipientTyped);
  const destination = chainOf(chains, to.chainId);
  const inputId = useId();
  const needsTyping = destination !== null && destination.owner === null;
  const shown = useMemo(() => typed !== null || needsTyping, [typed, needsTyping]);
  if (!destination) return null;
  if (!shown) {
    return (
      <div className={b.land}>
        <span className={b.landWho}>{ownRecipient ? <>{w.toWallet} <b translate="no">{shortOf(ownRecipient)}</b></> : null}</span>
        <span className={b.landEnd}>
          <button type="button" className={b.link} onClick={() => setRecipient('')} data-bridge-another>
            {ownRecipient ? w.change : w.another}
          </button>
          {info}
        </span>
      </div>
    );
  }
  const value = typed ?? '';
  const ok = value.trim() !== '' && addressOk(destination.vm, value);
  const bad = value.trim() !== '' && !ok;
  return (
    <div className={b.addressBox}>
      <div className={b.land}>
        <label htmlFor={inputId}>
          <Kick>{w.addressOn(destination.label)}</Kick>
        </label>
        {ownRecipient ? (
          <button type="button" className={b.link} onClick={() => setRecipient(null)}>
            {w.mine}
          </button>
        ) : null}
      </div>
      <input
        id={inputId}
        className={cx(s.find, b.address)}
        value={value}
        onChange={(event) => setRecipient(event.target.value.trim())}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        translate="no"
        aria-invalid={bad || undefined}
      />
      {bad ? <p className={b.error}>{w.addressBad(destination.label)}</p> : ok ? <p className={b.warn}>{w.addressWarn}</p> : null}
    </div>
  );
}
