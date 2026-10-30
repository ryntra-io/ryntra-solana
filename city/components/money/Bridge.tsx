'use client';

import { displayAmount } from '@/lib/solana/amounts';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { downloadReceipt } from '@/lib/solana/send-receipt-vault.client';
import { EVM_EXPLORER_TX } from '@/lib/swap/catalog';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText } from '@/city/lib/i18n/figures';
import { cleanAmount, readAmount, shareOf } from '@/city/lib/money/amount';
import { formatAmount, formatUsd } from '@/city/lib/money/assets';
import { BRIDGE_NETWORKS, bridgeEditable, etaWords, NETWORK_LABEL, orderLine, orderPhase, orderWord, quoteFacts, readDestination } from '@/city/lib/money/bridge';
import { MONEY_OPEN } from '@/city/lib/money/flag';
import { useMoney } from '@/city/lib/money/open';
import { short } from '@/city/lib/money/recipient';
import { bridgeUsdc, useMoneyStore } from '@/city/lib/money/store';
import { Note, Soon, Terms } from './bits';
import { MONEY } from './words';
import s from './money.module.css';

/**
 * Bridge: USDC out of Solana to another network, to an address the person types. The engine quotes it — what arrives
 * at least, the rail's fee, Ryntra's fee, the time — builds the one Solana transaction, sends it once and follows the
 * order until the money lands or comes back. Behind the money switch until the owner's canary passes.
 */
export function Bridge() {
  const w = useWords(MONEY);
  if (!MONEY_OPEN) {
    return (
      <Soon title={w.bridge}>
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoney.getState().setTab('topup')}>
          {w.topUpInstead}
        </button>
      </Soon>
    );
  }
  return <BridgeForm />;
}

function BridgeForm() {
  const w = useWords(MONEY);
  const bridge = useMoneyStore((st) => st.bridge);
  const wallet = useMoneyStore((st) => st.wallet);
  const walletRead = useMoneyStore((st) => st.walletRead);
  const usdc = bridgeUsdc(wallet);
  const idle = bridgeEditable(bridge.phase);
  const destination = readDestination(bridge.to);
  const amount = readAmount(bridge.amount, usdc ? { spendableRaw: usdc.spendableRaw, decimals: usdc.decimals, symbol: 'USDC' } : null);
  const quote = bridge.quote?.body.quote ?? null;
  const facts = quote ? quoteFacts(quote) : null;

  if (bridge.order) return <Order />;

  let label = w.reviewAction;
  let action: (() => void) | null = null;
  if (!wallet) label = walletRead === 'failed' ? w.balancesUnavailableShort : w.readingBalancesNow;
  else if (!usdc || BigInt(usdc.spendableRaw) === 0n) label = w.noUsdc;
  else if (!destination.ok) label = w.enterAddressThere;
  else if (!amount.ok) label = amount.problem === 'OVER_BALANCE' ? w.notEnoughUsdc : w.enterAmount;
  else if (bridge.phase === 'quoting' || !bridge.quote) label = w.gettingPrice;
  else if (bridge.phase === 'planning') label = w.preparing;
  else if (bridge.phase === 'wallet') label = w.checkWallet;
  else if (bridge.phase === 'sending') label = w.sending;
  else if (!bridge.quote.body.buildable) label = w.paused;
  else if (bridge.plan) {
    label = w.confirmInWallet;
    action = () => void useMoneyStore.getState().confirmBridge();
  } else action = () => void useMoneyStore.getState().reviewBridge();

  return (
    <section className={s.tabBody} aria-label={w.bridge}>
      <span className={s.label} id="money-bridge-networks">
        {w.to}
      </span>
      <div className={s.chips} role="radiogroup" aria-labelledby="money-bridge-networks">
        {BRIDGE_NETWORKS.map((network) => (
          <button
            key={network}
            type="button"
            role="radio"
            aria-checked={bridge.network === network}
            className={`${s.chipButton} ${bridge.network === network ? s.chipOn : ''}`}
            onClick={() => useMoneyStore.getState().setBridgeNetwork(network)}
            disabled={!idle}
          >
            {NETWORK_LABEL[network]}
          </button>
        ))}
      </div>
      <label className={s.label} htmlFor="money-bridge-to">
        {w.addressOn(NETWORK_LABEL[bridge.network])}
      </label>
      <input
        id="money-bridge-to"
        className={s.input}
        value={bridge.to}
        onChange={(event) => useMoneyStore.getState().setBridgeTo(event.target.value.trim())}
        placeholder="0x…"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        translate="no"
        disabled={!idle}
      />
      {bridge.to && !destination.ok ? <Note line={{ tone: 'error', text: destination.text }} /> : null}

      <div className={s.amountHead}>
        <label className={s.label} htmlFor="money-bridge-amount">
          {w.amount}
        </label>
        {usdc ? <span className={s.balance}>{w.available(formatAmount(usdc.spendableRaw, usdc.decimals), 'USDC')}</span> : null}
      </div>
      <div className={s.field}>
        <input
          id="money-bridge-amount"
          className={`${s.input} ${s.amount}`}
          value={fieldText(bridge.amount)}
          onChange={(event) => useMoneyStore.getState().setBridgeAmount(cleanAmount(event.target.value))}
          placeholder="0"
          inputMode="decimal"
          autoComplete="off"
          disabled={!idle || !usdc}
        />
        <span className={s.unit}>USDC</span>
      </div>
      {usdc ? (
        <div className={s.shares}>
          <button type="button" className={s.share} disabled={!idle} onClick={() => useMoneyStore.getState().setBridgeAmount(shareOf(usdc.spendableRaw, usdc.decimals, 1n, 2n))}>
            50%
          </button>
          <button type="button" className={s.share} disabled={!idle} onClick={() => useMoneyStore.getState().setBridgeAmount(shareOf(usdc.spendableRaw, usdc.decimals, 1n, 1n))}>
            {w.max}
          </button>
        </div>
      ) : null}
      {bridge.amount && !amount.ok && amount.problem !== 'EMPTY' ? <Note line={{ tone: 'error', text: amount.text }} /> : null}

      <div className={s.dock}>
        {facts && destination.ok && amount.ok ? (
          <div className={`${s.review} ${bridge.phase === 'quoting' ? s.dim : ''}`} aria-label={bridge.plan ? w.review : w.price}>
            <span className={`${s.display} ${s.kicker}`}>{w.theyGetLeast}</span>
            <b className={`${s.display} ${s.hero}`}>
              {formatAmount(facts.minimumRaw, facts.decimals)} {facts.symbol}
            </b>
            <span className={s.fine} translate="no">
              {w.onNetwork(NETWORK_LABEL[bridge.network])} · {short(destination.address)} · {etaWords(facts.etaSeconds)}
            </span>
            <Terms
              label={w.transferDetails}
              line={
                <>
                  {w.fee} <b>{facts.providerUsd === null ? w.inAmount : `≈ ${formatUsd(facts.providerUsd)}`}</b>
                  {' · Ryntra '}
                  <b>{digits(facts.ryntraFee)}</b>
                  {` · ${w.networkWord} `}
                  <b>{facts.networkUsd === null ? w.fewCents : `≈ ${formatUsd(facts.networkUsd)}`}</b>
                </>
              }
            >
              <dt>{w.youSend}</dt>
              <dd>{usdc ? digits(displayAmount(amount.raw, usdc.decimals)) : bridge.amount} USDC</dd>
              <dt>{w.theyGetLeast}</dt>
              <dd>
                {formatAmount(facts.minimumRaw, facts.decimals)} {facts.symbol}
              </dd>
              <dt>{w.movingCosts}</dt>
              <dd>{facts.providerUsd === null ? w.insideAmount : w.insideAmountOf(`≈ ${formatUsd(facts.providerUsd)}`)}</dd>
              <dt>{w.ryntraFee}</dt>
              <dd>{digits(facts.ryntraFee)}</dd>
              <dt>{w.solanaFee}</dt>
              <dd>{facts.networkUsd === null ? w.fewCentsSol : w.inSol(`≈ ${formatUsd(facts.networkUsd)}`)}</dd>
              <dt>{w.arrivesIn}</dt>
              <dd>{etaWords(facts.etaSeconds)}</dd>
              <dt>{w.to}</dt>
              <dd translate="no">{destination.address}</dd>
            </Terms>
          </div>
        ) : null}
        <Note line={bridge.line} />

        <button type="button" className={`${s.display} ${s.action} ${s.cta} ${idle ? '' : s.waiting}`} disabled={!action} onClick={action ?? undefined}>
          {label}
        </button>
      </div>
    </section>
  );
}

/** One order out of Solana, followed until it lands or comes back. */
function Order() {
  const w = useWords(MONEY);
  const order = useMoneyStore((st) => st.bridge.order);
  const receipt = useMoneyStore((st) => st.bridge.receipt);
  if (!order) return null;
  const phase = orderPhase(order.state);
  const evm = order.to.network === 'solana' ? null : order.to.network;
  return (
    <section className={s.tabBody} aria-label={w.betweenNetworks}>
      <div className={`${s.result} ${phase === 'done' ? s.resultGood : phase === 'failed' ? s.resultBad : ''}`}>
        <span className={`${s.display} ${s.resultWord}`}>{orderWord(phase)}</span>
        <p className={s.lead}>
          {formatAmount(order.from.amountRaw, order.from.decimals)} {order.from.symbol} → {order.to.symbol} {w.onNetwork(evm ? (NETWORK_LABEL[evm as keyof typeof NETWORK_LABEL] ?? evm) : 'Solana')}
        </p>
        {orderLine(phase) ? <p className={s.note}>{orderLine(phase)}</p> : null}
        <div className={s.links}>
          {order.sourceTxHash ? (
            <a className={s.link} href={explorerTxUrl('mainnet', order.sourceTxHash)} target="_blank" rel="noreferrer">
              {w.onSolana(short(order.sourceTxHash))}
            </a>
          ) : null}
          {order.destinationTxHash && evm ? (
            <a className={s.link} href={`${EVM_EXPLORER_TX[evm]}${order.destinationTxHash}`} target="_blank" rel="noreferrer">
              {w.there(short(order.destinationTxHash))}
            </a>
          ) : null}
          {receipt ? (
            <button type="button" className={s.link} onClick={() => downloadReceipt(receipt)}>
              {w.downloadReceipt}
            </button>
          ) : null}
        </div>
      </div>
      {phase === 'moving' || phase === 'recovery' ? null : (
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoneyStore.getState().newBridge()}>
          {w.newTransfer}
        </button>
      )}
    </section>
  );
}
