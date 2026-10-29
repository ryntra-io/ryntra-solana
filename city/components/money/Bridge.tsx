'use client';

import { displayAmount } from '@/lib/solana/amounts';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { downloadReceipt } from '@/lib/solana/send-receipt-vault.client';
import { EVM_EXPLORER_TX } from '@/lib/swap/catalog';
import { cleanAmount, readAmount, shareOf } from '@/city/lib/money/amount';
import { formatAmount, formatUsd } from '@/city/lib/money/assets';
import { BRIDGE_NETWORKS, bridgeEditable, etaWords, NETWORK_LABEL, ORDER_WORD, ORDER_WORDS, orderPhase, quoteFacts, readDestination } from '@/city/lib/money/bridge';
import { MONEY_OPEN } from '@/city/lib/money/flag';
import { useMoney } from '@/city/lib/money/open';
import { short } from '@/city/lib/money/recipient';
import { bridgeUsdc, useMoneyStore } from '@/city/lib/money/store';
import { Note, Soon, Terms } from './bits';
import s from './money.module.css';

/**
 * Bridge: USDC out of Solana to another network, to an address the person types. The engine quotes it — what arrives
 * at least, the rail's fee, Ryntra's fee, the time — builds the one Solana transaction, sends it once and follows the
 * order until the money lands or comes back. Behind the money switch until the owner's canary passes.
 */
export function Bridge() {
  if (!MONEY_OPEN) {
    return (
      <Soon title="Bridge">
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoney.getState().setTab('topup')}>
          Top up instead
        </button>
      </Soon>
    );
  }
  return <BridgeForm />;
}

function BridgeForm() {
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

  let label = 'Review';
  let action: (() => void) | null = null;
  if (!wallet) label = walletRead === 'failed' ? 'Balances unavailable' : 'Reading your balances…';
  else if (!usdc || BigInt(usdc.spendableRaw) === 0n) label = 'No USDC to move';
  else if (!destination.ok) label = 'Enter the address there';
  else if (!amount.ok) label = amount.problem === 'OVER_BALANCE' ? 'Not enough USDC' : 'Enter an amount';
  else if (bridge.phase === 'quoting' || !bridge.quote) label = 'Getting a price…';
  else if (bridge.phase === 'planning') label = 'Preparing transfer…';
  else if (bridge.phase === 'wallet') label = 'Check your wallet…';
  else if (bridge.phase === 'sending') label = 'Sending…';
  else if (!bridge.quote.body.buildable) label = 'Paused right now';
  else if (bridge.plan) {
    label = 'Confirm in wallet';
    action = () => void useMoneyStore.getState().confirmBridge();
  } else action = () => void useMoneyStore.getState().reviewBridge();

  return (
    <section className={s.tabBody} aria-label="Bridge">
      <span className={s.label} id="money-bridge-networks">
        To
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
        Address on {NETWORK_LABEL[bridge.network]}
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
          Amount
        </label>
        {usdc ? <span className={s.balance}>{formatAmount(usdc.spendableRaw, usdc.decimals)} USDC available</span> : null}
      </div>
      <div className={s.field}>
        <input
          id="money-bridge-amount"
          className={`${s.input} ${s.amount}`}
          value={bridge.amount}
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
            Max
          </button>
        </div>
      ) : null}
      {bridge.amount && !amount.ok && amount.problem !== 'EMPTY' ? <Note line={{ tone: 'error', text: amount.text }} /> : null}

      {facts && destination.ok && amount.ok ? (
        <div className={`${s.review} ${bridge.phase === 'quoting' ? s.dim : ''}`} aria-label={bridge.plan ? 'Review' : 'Price'}>
          <span className={`${s.display} ${s.kicker}`}>They get at least</span>
          <b className={`${s.display} ${s.hero}`}>
            {formatAmount(facts.minimumRaw, facts.decimals)} {facts.symbol}
          </b>
          <span className={s.fine} translate="no">
            on {NETWORK_LABEL[bridge.network]} · {short(destination.address)} · {etaWords(facts.etaSeconds)}
          </span>
          <Terms
            label="Transfer details"
            line={
              <>
                Fee <b>{facts.providerUsd === null ? 'in the amount' : `≈ ${formatUsd(facts.providerUsd)}`}</b>
                {' · Ryntra '}
                <b>{facts.ryntraFee}</b>
                {' · network '}
                <b>{facts.networkUsd === null ? 'a few cents' : `≈ ${formatUsd(facts.networkUsd)}`}</b>
              </>
            }
          >
            <dt>You send</dt>
            <dd>{usdc ? displayAmount(amount.raw, usdc.decimals) : bridge.amount} USDC</dd>
            <dt>They get at least</dt>
            <dd>
              {formatAmount(facts.minimumRaw, facts.decimals)} {facts.symbol}
            </dd>
            <dt>Moving it costs</dt>
            <dd>{facts.providerUsd === null ? 'Inside the amount' : `≈ ${formatUsd(facts.providerUsd)}, inside the amount`}</dd>
            <dt>Ryntra fee</dt>
            <dd>{facts.ryntraFee}</dd>
            <dt>Solana network fee</dt>
            <dd>{facts.networkUsd === null ? 'A few cents of SOL' : `≈ ${formatUsd(facts.networkUsd)} in SOL`}</dd>
            <dt>Arrives in</dt>
            <dd>{etaWords(facts.etaSeconds)}</dd>
            <dt>To</dt>
            <dd translate="no">{destination.address}</dd>
          </Terms>
        </div>
      ) : null}
      <Note line={bridge.line} />

      <button type="button" className={`${s.display} ${s.action} ${s.cta} ${idle ? '' : s.waiting}`} disabled={!action} onClick={action ?? undefined}>
        {label}
      </button>
    </section>
  );
}

/** One order out of Solana, followed until it lands or comes back. */
function Order() {
  const order = useMoneyStore((st) => st.bridge.order);
  const receipt = useMoneyStore((st) => st.bridge.receipt);
  if (!order) return null;
  const phase = orderPhase(order.state);
  const evm = order.to.network === 'solana' ? null : order.to.network;
  return (
    <section className={s.tabBody} aria-label="Transfer between networks">
      <div className={`${s.result} ${phase === 'done' ? s.resultGood : phase === 'failed' ? s.resultBad : ''}`}>
        <span className={`${s.display} ${s.resultWord}`}>{ORDER_WORD[phase]}</span>
        <p className={s.lead}>
          {formatAmount(order.from.amountRaw, order.from.decimals)} {order.from.symbol} → {order.to.symbol} on {evm ? NETWORK_LABEL[evm as keyof typeof NETWORK_LABEL] ?? evm : 'Solana'}
        </p>
        {ORDER_WORDS[phase] ? <p className={s.note}>{ORDER_WORDS[phase]}</p> : null}
        <div className={s.links}>
          {order.sourceTxHash ? (
            <a className={s.link} href={explorerTxUrl('mainnet', order.sourceTxHash)} target="_blank" rel="noreferrer">
              {short(order.sourceTxHash)} on Solana
            </a>
          ) : null}
          {order.destinationTxHash && evm ? (
            <a className={s.link} href={`${EVM_EXPLORER_TX[evm]}${order.destinationTxHash}`} target="_blank" rel="noreferrer">
              {short(order.destinationTxHash)} there
            </a>
          ) : null}
          {receipt ? (
            <button type="button" className={s.link} onClick={() => downloadReceipt(receipt)}>
              Download receipt
            </button>
          ) : null}
        </div>
      </div>
      {phase === 'moving' || phase === 'recovery' ? null : (
        <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useMoneyStore.getState().newBridge()}>
          New transfer
        </button>
      )}
    </section>
  );
}
