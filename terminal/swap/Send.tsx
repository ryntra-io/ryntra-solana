'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { MONEY } from '@/city/components/money/words';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { cleanAmount, shareOf } from '@/city/lib/money/amount';
import { formatAmount, sendable, type MoneyAsset } from '@/city/lib/money/assets';
import { chosenAsset, reviewTotal, sendGate } from '@/city/lib/money/form';
import { grouped, short } from '@/city/lib/money/recipient';
import { settledWord } from '@/city/lib/money/send';
import { useMoneyStore } from '@/city/lib/money/store';
import { USDC } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { iconOf } from '@/terminal/coin/Ticket';
import { ExplainBox, ExplainButton, Rows } from '@/terminal/coin/parts';
import { connectWallet } from '@/terminal/shell/Wallet';
import { AmountField, CoinLogo, Icon, Kick, Panel, Quiet, Shares, Title, cx } from '@/terminal/ui';
import { SendGlyph } from './glyphs';
import { LeadPress, MoneyGo } from './go';
import { showSwap } from './state';
import { DOORS } from './words';
import t from '@/terminal/coin/ticket.module.css';
import s from './swap.module.css';

const SHARES = [
  { id: '25', numerator: 1n, denominator: 4n },
  { id: '50', numerator: 1n, denominator: 2n },
  { id: '75', numerator: 3n, denominator: 4n },
  { id: 'max', numerator: 1n, denominator: 1n },
] as const;

/** A coin of the wallet as the field draws it: the engine's picture, USDC's own, SOL's from the engine's logo proxy. */
function iconOfCoin(coin: MoneyAsset): string | null {
  if (coin.icon) return coin.icon;
  if (coin.mint === USDC.mint) return iconOf(USDC);
  return coin.native ? '/api/icon/So11111111111111111111111111111111111111112' : coin.mint ? `/api/icon/${coin.mint}` : null;
}

/**
 * A transfer: a coin of the wallet to a Solana address or a `.skr` name, on the money logic as it is
 * (`city/lib/money/**`, the money window's Send). The engine reads who it is, builds the exact transfer and its
 * figures — what they get, the fee, an account opened for them — before the wallet opens; the person signs in their
 * own wallet, and the engine sends it once and reads the chain back. What they get and the fee stand in one line; the
 * breakdown behind «i».
 *
 * `bare`: the transfer drawn into the card that holds it (the Swap screen's one card) — no panel, no head and no
 * close of its own: the card's tabs are how a person leaves it.
 */
export function SendPanel({ id, bare = false }: { id?: string; bare?: boolean }) {
  const d = useWords(DOORS);
  const settled = useMoneyStore((st) => st.send.settled);
  const busy = useMoneyStore((st) => st.send.phase !== 'idle');
  const owner = useWallet((st) => st.connection?.address ?? null);
  if (bare) return <LeadPress.Provider value>{settled ? <Sent /> : <Form owner={owner} />}</LeadPress.Provider>;
  return (
    <Panel pad="l" gap={12} edge label={d.sendTitle} className={s.money}>
      <div className={s.head} id={id}>
        <SendGlyph className={s.headSignLilac} />
        <Title as="h2" className={s.headTitle}>
          {d.sendTitle}
        </Title>
        <button type="button" className={s.back} onClick={showSwap} disabled={busy} aria-label={d.back}>
          <Icon name="close" size="s" />
        </button>
      </div>
      {settled ? <Sent /> : <Form owner={owner} />}
    </Panel>
  );
}

function Form({ owner }: { owner: string | null }) {
  const m = useWords(MONEY);
  const d = useWords(DOORS);
  const connected = useWallet((st) => Boolean(st.connection) && st.connection?.address === owner);
  const wallet = useMoneyStore((st) => st.wallet);
  const walletRead = useMoneyStore((st) => st.walletRead);
  const send = useMoneyStore((st) => st.send);
  const gate = sendGate({ connected, owner, wallet, walletRead, send });
  const asset = chosenAsset(wallet, send.assetId);
  const coins = useMemo(() => (wallet ? sendable(wallet.assets) : []), [wallet]);
  const idle = send.phase === 'idle';
  // The wallet's coins open under the field, in the panel's flow: a list hanging below would be cut by its corner.
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!idle) setMenu(false);
  }, [idle]);

  const act = () => {
    const store = useMoneyStore.getState();
    if (gate.action === 'connect') return connectWallet();
    if (gate.action === 'review') return void store.reviewSend();
    if (gate.action === 'confirm') return void store.confirmSend();
    if (gate.action === 'accept-lookalike') return store.acceptLookalike();
    if (gate.action === 'accept-fresh') return store.acceptFresh();
  };
  const share = (id: string) => {
    const pick = SHARES.find((each) => each.id === id);
    if (asset && pick) useMoneyStore.getState().setAmount(shareOf(asset.spendableRaw, asset.decimals, pick.numerator, pick.denominator));
  };
  const lines = [gate.toLine, gate.riskLine, gate.amountLine ? { tone: 'error' as const, text: gate.amountLine } : null, send.line].filter((line): line is NonNullable<typeof line> => line !== null);

  return (
    <>
      {send.resumed ? (
        <p className={t.note} data-tone={send.resumed.state === 'LANDED' ? undefined : 'warn'} role="status">
          {send.resumed.state === 'CHECKING' ? m.resumeChecking : send.resumed.state === 'LANDED' ? m.resumeLanded : send.resumed.state === 'FAILED' ? m.resumeFailed : m.resumeUnknown}
        </p>
      ) : null}
      <label className={s.field}>
        <span className={s.fieldHead}>
          <Kick>{m.to}</Kick>
        </span>
        <input
          className={s.text}
          value={send.to}
          onChange={(event) => useMoneyStore.getState().setTo(event.target.value)}
          placeholder={m.toPlaceholder}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          translate="no"
          disabled={!idle}
        />
      </label>
      {send.name?.state === 'FOUND' && gate.recipient ? (
        <p className={s.termsLine} translate="no">
          {send.name.name} → {short(gate.recipient)}
        </p>
      ) : null}
      {gate.recipient && (gate.lookalike || gate.isNew) ? (
        <div className={s.hold} role="alert">
          <span>{gate.lookalike ? (gate.lookalike === owner ? m.looksYours : m.looksRecent) : m.newAddress}</span>
          <span className={s.addressValue} translate="no">
            {grouped(gate.recipient)}
          </span>
          {gate.action === 'accept-lookalike' || gate.action === 'accept-fresh' ? (
            <Quiet size="s" onClick={act}>
              {gate.action === 'accept-lookalike' ? m.rightAddress : m.addressChecked}
            </Quiet>
          ) : null}
        </div>
      ) : null}
      <fieldset className={t.group} disabled={!idle || !asset}>
        <AmountField
          label={m.amount}
          aside={asset ? m.available(formatAmount(asset.spendableRaw, asset.decimals), asset.symbol) : undefined}
          value={fieldText(send.amount)}
          onChange={(text) => useMoneyStore.getState().setAmount(cleanAmount(fieldValue(text)))}
          asset={asset ? { symbol: asset.symbol, icon: iconOfCoin(asset) } : undefined}
          onAsset={coins.length > 1 && idle ? () => setMenu((was) => !was) : undefined}
          assetLabel={d.pickCoin}
        />
        {menu ? (
          <div className={cx(s.pickList, s.coinList)} role="menu" aria-label={d.pickCoin}>
            {coins.map((coin) => (
              <button
                key={coin.id}
                type="button"
                role="menuitemradio"
                aria-checked={coin.id === send.assetId}
                className={t.menuRow}
                onClick={() => {
                  setMenu(false);
                  useMoneyStore.getState().setSendAsset(coin.id);
                }}
              >
                <CoinLogo src={iconOfCoin(coin)} symbol={coin.symbol} size="s" />
                <span className={t.menuName}>{coin.symbol}</span>
                <span className={t.menuAside}>{formatAmount(coin.spendableRaw, coin.decimals)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </fieldset>
      {asset ? (
        <fieldset className={cx(t.group, s.shares)} disabled={!idle}>
          <Shares label={m.amount} options={SHARES.map((each) => ({ id: each.id, label: each.id === 'max' ? m.max : `${each.id}%` }))} value={null} onPick={share} />
        </fieldset>
      ) : null}
      <div className={s.grow} />
      {send.review ? <Review /> : null}
      {lines.map((line, at) => (
        <p key={at} className={t.note} data-tone={line.tone} role={line.tone === 'error' ? 'alert' : 'status'}>
          {line.text}
        </p>
      ))}
      <MoneyGo onClick={act} disabled={gate.action === null || gate.action === 'accept-lookalike' || gate.action === 'accept-fresh'} busy={!idle}>
        {gate.label}
      </MoneyGo>
    </>
  );
}

/** The engine's figures for this exact transfer, before the wallet opens: what they get and the fee in one line. */
function Review() {
  const m = useWords(MONEY);
  const d = useWords(DOORS);
  const lang = useLang();
  const review = useMoneyStore((st) => st.send.review);
  const name = useMoneyStore((st) => (st.send.name?.state === 'FOUND' ? st.send.name.name : null));
  const wallet = useMoneyStore((st) => st.wallet);
  const assetId = useMoneyStore((st) => st.send.assetId);
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  if (!review) return null;
  const check = review.bundle.check;
  const symbol = chosenAsset(wallet, assetId)?.symbol ?? (check.asset.mint === null ? 'SOL' : '');
  const total = reviewTotal(check, symbol);
  const totalText = total.whole ? digits([total.coin, total.sol].filter(Boolean).join(' + ')) : m.notEveryCost;
  const rows: [string, string][] = [
    [m.youSend, `${digits(check.send.amount)} ${symbol}`],
    [m.theyGet, `${digits(check.receive.amount)} ${symbol}`],
    [m.networkFee, `${digits(check.networkFee.sol)} SOL`],
  ];
  if (check.setup) rows.push([m.accountOpens, check.setup.sol === null ? m.unread : `${digits(check.setup.sol)} SOL`]);
  rows.push([m.leaves, totalText]);
  rows.push([m.to, name ? `${name} · ${short(check.to.owner)}` : short(check.to.owner)]);
  return (
    <>
      <div className={s.terms}>
        <span className={s.termsLine}>
          {d.theyGet(`${digits(check.receive.amount)} ${symbol}`)} · {d.fee(`${digits(check.networkFee.sol)} SOL`)}
        </span>
        <ExplainButton label={m.transferDetails} open={open} controls={detailsId} onToggle={() => setOpen((was) => !was)} />
      </div>
      {open ? (
        <ExplainBox id={detailsId}>
          <Rows rows={rows} />
        </ExplainBox>
      ) : null}
      {check.warnings.map((warning) => (
        <p key={warning.code} className={t.note} data-tone={warning.stops ? 'error' : 'warn'} role="alert">
          {warning[lang] ?? warning.en}
        </p>
      ))}
    </>
  );
}

/** What the engine settled: the chain read back, and the way to the next transfer. */
function Sent() {
  const m = useWords(MONEY);
  const settled = useMoneyStore((st) => st.send.settled);
  const line = useMoneyStore((st) => st.send.line);
  if (!settled) return null;
  const word = settledWord(settled);
  return (
    <>
      <div className={t.result} role="status">
        <Kick className={word === 'Sent' ? t.kickUp : word === 'Not sent' ? t.kickDown : t.kickWarn}>{word === 'Sent' ? m.sent : word === 'Not sent' ? m.notSent : m.notConfirmed}</Kick>
        {line ? <span className={t.line}>{line.text}</span> : null}
        <a className={t.link} href={explorerTxUrl('mainnet', settled.signature)} target="_blank" rel="noreferrer">
          {m.onSolana(short(settled.signature))}
          <Icon name="arrow" size="s" />
        </a>
      </div>
      <div className={s.grow} />
      <MoneyGo onClick={() => useMoneyStore.getState().newSend()}>{m.newTransfer}</MoneyGo>
    </>
  );
}
