'use client';

import { useId, useState } from 'react';
import { contactFor, targetOf } from '@/lib/contacts/model';
import { COIN_DECIMALS, PAYMENT_MIN, formatAmount, type AutopayCoin, type AutopayEvery } from '@/lib/autopay/schedule';
import type { AutopayRecord } from '@/lib/autopay/record';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { cleanAmount } from '@/city/lib/money/amount';
import { USDC } from '@/city/lib/trade/tiles';
import { iconOf } from '@/terminal/coin/Ticket';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { Action, AmountField, Chip, CoinLogo, Kick, Panel, Quiet, Shares, cx } from '@/terminal/ui';
import { ContactPicks } from '../contacts/Contacts';
import { useContacts } from '../contacts/useContacts';
import { AUTOPAY_COIN_LIST, AUTOPAY_EVERY, dayOf, defaultUntil, planOf, rowOf, whoOf, type AutopayNetwork, type AutopaysRead, type Outcome } from './autopay-view';
import { useAutopay } from './useAutopay';
import { NoWallet } from '../NoWallet';
import { AUTOPAY_WORDS } from './words';
import t from '@/terminal/coin/ticket.module.css';
import s from '@/terminal/swap/swap.module.css';
import m from '../money.module.css';
import a from './autopay.module.css';

type Words = (typeof AUTOPAY_WORDS)['en'];
type Coin = (typeof AUTOPAY_COIN_LIST)[number];

const coinIcon = (coin: Coin): string | null => (coin.mint === USDC.mint ? iconOf(USDC) : '/api/icon/So11111111111111111111111111111111111111112');

const OUTCOME: Readonly<Record<Exclude<Outcome, 'done'>, keyof Words>> = {
  declined: 'declined',
  changed: 'changed',
  refused: 'refused',
  unreachable: 'unreachable',
  locked: 'lockedStart',
};

const nowSeconds = () => BigInt(Math.floor(Date.now() / 1000));

/**
 * «Autopay»: to whom, how much, how often, until when — one signature and
 * the payments go by themselves. The tab's action panel is the new autopay, its one amber press «Start autopay»; the
 * wallet's autopays stand under it, each with its quiet «Stop» — the person's one signature, the rest back to the wallet.
 * Under the hood, one line: only this address, only this amount, stop any time; the rule's whole story behind «i».
 */
export function AutopayTab({ owner, network, onConnect }: { owner: string | null; network: AutopayNetwork; onConnect: () => void }) {
  const w = useWords(AUTOPAY_WORDS);
  const autopay = useAutopay(owner, network);
  return (
    <>
      <Panel tone="hi" pad="l" gap={16} label={w.newAutopay} className={cx(m.form, !owner && m.formBlank)}>
        {owner ? <AutopayForm key={owner} owner={owner} start={autopay.start} /> : <NoWallet tab="autopay" onConnect={onConnect} />}
      </Panel>
      {owner ? <AutopayList list={autopay.list} onUnlock={autopay.unlock} onRead={() => void autopay.read()} stop={autopay.stop} /> : null}
    </>
  );
}

type Start = ReturnType<typeof useAutopay>['start'];

function AutopayForm({ owner, start }: { owner: string; start: Start }) {
  const w = useWords(AUTOPAY_WORDS);
  const lang = useLang();
  const { book } = useContacts(owner);
  const [now] = useState(nowSeconds);
  const [to, setTo] = useState('');
  const [coin, setCoin] = useState<Coin>(AUTOPAY_COIN_LIST[0]);
  const [menu, setMenu] = useState(false);
  const [typed, setTyped] = useState('');
  const [every, setEvery] = useState<AutopayEvery>('month');
  const [until, setUntil] = useState(() => defaultUntil('month', now));
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<Readonly<{ tone: 'ok' | 'error'; text: string }> | null>(null);
  const [how, setHow] = useState(false);
  const howId = useId();

  const symbol: AutopayCoin = coin.symbol;
  const plan = planOf({ to, coin: symbol, amount: typed, every, until }, now);
  const target = targetOf(to);
  const contacts = book.state === 'ready' ? book.contacts : [];
  const contact = contactFor(contacts, to);
  const tooSmall = plan !== null && plan.amount < PAYMENT_MIN[symbol];
  const issue = to.trim() && !target ? w.toIssue : tooSmall ? w.amountIssue : typed && until && !plan ? w.untilIssue : null;
  const ready = Boolean(target) && plan !== null && !tooSmall;
  const sum = (raw: bigint, unit: string) => `${digits(formatAmount(raw, unit === 'SOL' ? 'SOL' : 'USDC'), lang)} ${unit}`;
  const day = (seconds: bigint) => dateText(Number(seconds) * 1000, { day: 'numeric', month: 'short', year: 'numeric' }, lang);

  const submit = async () => {
    if (!ready || !plan || !target || busy) return;
    setBusy(true);
    setLine(null);
    const outcome = await start({
      to: target.value,
      label: contact?.name ?? null,
      address: target.kind === 'address' ? target.value : null,
      coin: symbol,
      amount: typed,
      every,
      plan,
    });
    setBusy(false);
    if (outcome === 'done') {
      setLine({ tone: 'ok', text: w.started });
      setTyped('');
      setTo('');
      return;
    }
    setLine({ tone: 'error', text: w[OUTCOME[outcome]] as string });
  };

  const said = issue ? { tone: 'error' as const, text: issue } : line;
  return (
    <>
      <label className={s.big}>
        <span className={s.bigHead}>
          <Kick>{w.to}</Kick>
        </span>
        <input
          className={s.text}
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder={w.toHint}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          translate="no"
          disabled={busy}
        />
      </label>
      <ContactPicks contacts={contacts} typed={to} disabled={busy} onPick={setTo} />
      <fieldset className={t.group} disabled={busy}>
        <AmountField
          label={w.amount}
          value={fieldText(typed, lang)}
          onChange={(text) => setTyped(cleanAmount(fieldValue(text, lang)).slice(0, 24))}
          asset={{ symbol: coin.symbol, icon: coinIcon(coin) }}
          onAsset={() => setMenu((was) => !was)}
          assetLabel={w.pickCoin}
        />
        {menu ? (
          <div className={cx(s.pickList, s.coinList)} role="menu" aria-label={w.pickCoin}>
            {AUTOPAY_COIN_LIST.map((each) => (
              <button
                key={each.symbol}
                type="button"
                role="menuitemradio"
                aria-checked={each.symbol === coin.symbol}
                className={t.menuRow}
                onClick={() => {
                  setMenu(false);
                  setCoin(each);
                  setTyped((was) => (was.split('.')[1]?.length ?? 0) > COIN_DECIMALS[each.symbol] ? '' : was);
                }}
              >
                <CoinLogo src={coinIcon(each)} symbol={each.symbol} size="s" />
                <span className={t.menuName}>{each.symbol}</span>
              </button>
            ))}
          </div>
        ) : null}
      </fieldset>
      <div className={a.pair}>
        <div className={m.expiry}>
          <Kick>{w.every}</Kick>
          <fieldset className={cx(t.group, m.expiryChoice)} disabled={busy}>
            <Shares
              label={w.every}
              options={AUTOPAY_EVERY.map((id) => ({ id, label: w[id] }))}
              value={every}
              onPick={(id) => {
                setEvery(id);
                setUntil(defaultUntil(id, now));
              }}
            />
          </fieldset>
        </div>
        <label className={cx(s.big, a.until)}>
          <span className={s.bigHead}>
            <Kick>{w.until}</Kick>
          </span>
          <input className={cx(s.text, a.date)} type="date" value={until} min={dayOf(now)} onChange={(event) => setUntil(event.target.value)} disabled={busy} />
        </label>
      </div>
      <div className={m.grow} />
      <p className={cx(s.termsLine, a.plan)} data-plan={plan ? 'ready' : 'none'}>
        {plan ? w.plan(w.payments(plan.count), sum(plan.total, coin.symbol), day(plan.lastAt)) : ''}
      </p>
      <div className={s.terms}>
        <span className={s.termsLine}>{w.keys}</span>
        <ExplainButton label={w.how} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />
      </div>
      {how ? (
        <ExplainBox id={howId}>
          <span>{w.howText(digits(formatAmount(plan?.network ?? 0n, 'SOL'), lang))}</span>
        </ExplainBox>
      ) : null}
      <p className={cx(t.note, a.said)} data-tone={said?.tone === 'error' ? 'error' : undefined} data-said={said ? said.tone : 'none'} role={said?.tone === 'error' ? 'alert' : 'status'}>
        {said?.text ?? ''}
      </p>
      <Action onClick={() => void submit()} disabled={!ready} busy={busy}>
        {busy ? w.starting : w.start}
      </Action>
    </>
  );
}

type Stop = ReturnType<typeof useAutopay>['stop'];

/** «Your autopays»: each one's recipient, amount and rhythm, how far it has paid and its next payment — and «Stop». */
function AutopayList({ list, onUnlock, onRead, stop }: { list: AutopaysRead; onUnlock: () => Promise<'ok' | 'declined' | 'failed'>; onRead: () => void; stop: Stop }) {
  const w = useWords(AUTOPAY_WORDS);
  const lang = useLang();
  const [asking, setAsking] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [line, setLine] = useState<Readonly<{ tone: 'ok' | 'down'; text: string }> | null>(null);
  const now = nowSeconds();
  const day = (seconds: bigint) => dateText(Number(seconds) * 1000, { day: 'numeric', month: 'short' }, lang);
  const each = (record: AutopayRecord) => `${digits(formatAmount(BigInt(record.amount), record.coin), lang)} ${record.coin}`;
  let body;
  if (list.state === 'reading')
    body = (
      <div className={s.bones} aria-busy="true" aria-label={w.reading}>
        <span />
        <span />
      </div>
    );
  else if (list.state === 'locked')
    body = (
      <div className={m.listBlank}>
        <p className={m.line}>{w.locked}</p>
        <Quiet
          size="s"
          disabled={asking}
          onClick={() => {
            setAsking(true);
            void onUnlock().finally(() => setAsking(false));
          }}
        >
          {w.show}
        </Quiet>
      </div>
    );
  else if (list.state === 'failed')
    body = (
      <div className={m.listBlank}>
        <p className={m.line} data-tone="down">
          {w.unread}
        </p>
        <Quiet size="s" onClick={onRead}>
          {w.again}
        </Quiet>
      </div>
    );
  else if (!list.autopays.length) body = <p className={cx(m.line, m.listLine)}>{w.none}</p>;
  else
    body = (
      <ul className={m.links}>
        {list.autopays.map((record) => {
          const row = rowOf(record, now);
          const who = whoOf(record);
          const parts = [w.each(each(record), w[record.every]), w.progress(digits(String(row.paid), lang), digits(String(row.of), lang)), ...(row.next !== null ? [w.next(day(row.next))] : [])];
          return (
            <li key={record.id} className={m.link} data-autopay={row.state}>
              <span className={m.linkNames}>
                <b translate="no">{who}</b>
                <span>{parts.join(' · ')}</span>
              </span>
              <span className={m.linkState}>
                <Chip tone={row.tone} dot={row.state === 'working'}>
                  {w[row.state]}
                </Chip>
              </span>
              <span className={m.linkActs}>
                {record.status === 'working' && row.state !== 'ended' ? (
                  <Quiet
                    size="s"
                    aria-label={w.stopOne(who)}
                    disabled={stopping !== null}
                    onClick={() => {
                      setStopping(record.id);
                      setLine(null);
                      void stop(record.id).then((outcome) => {
                        setStopping(null);
                        setLine(outcome === 'done' ? { tone: 'ok', text: w.stopDone } : { tone: 'down', text: outcome === 'declined' ? w.declined : w.stopFailed });
                      });
                    }}
                  >
                    {stopping === record.id ? w.stopping : w.stop}
                  </Quiet>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    );
  return (
    <Panel pad="none" label={w.yours} className={m.list}>
      <div className={m.listHead}>
        <Kick className={m.listKick}>{w.yours}</Kick>
      </div>
      {line ? (
        <p className={cx(m.line, m.listLine, line.tone === 'ok' && a.ok)} data-tone={line.tone === 'down' ? 'down' : undefined} role={line.tone === 'down' ? 'alert' : 'status'}>
          {line.text}
        </p>
      ) : null}
      {body}
    </Panel>
  );
}
