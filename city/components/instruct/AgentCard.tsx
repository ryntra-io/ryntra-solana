'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { bookNow, contextNow } from '@/city/lib/command/doors';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { feeLine, headline, howLine, priceWords, subline } from '@/city/lib/instruct/face';
import { CADENCE_CHOICES, MOVE_CHOICES, modeOf, SHARE_CHOICES, USD_CHOICES, type Problem } from '@/city/lib/instruct/plan';
import { coinChoices } from '@/city/lib/instruct/read';
import { planNow, useInstruct } from '@/city/lib/instruct/store';
import { INSTRUCT } from '@/city/lib/instruct/words';
import { startWallets, useWallet } from '@/city/lib/trade/wallet';
import { WalletLine, WalletPicker } from '../trade/WalletParts';
import { CheckGlyph, ChevronGlyph } from './glyphs';
import s from './instruct.module.css';

type W = ReturnType<typeof useWords<(typeof INSTRUCT)['en']>>;

/** The plan as the card stands: read from the store's fields and the wallet, worked out once per change. */
function usePlanned() {
  const instruction = useInstruct((st) => st.instruction);
  const facts = useInstruct((st) => st.facts);
  const holdings = useWallet((st) => st.holdings);
  const connection = useWallet((st) => st.connection);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => planNow({ instruction, facts }), [instruction, facts, holdings, connection]);
}

/** A coin's picture from the engine's icon route; its first letter on a disc when there is none. */
export function CoinMark({ symbol, icon, size = 'large' }: { symbol: string; icon: string | null; size?: 'large' | 'small' }) {
  const [failed, setFailed] = useState<string | null>(null);
  const cls = size === 'large' ? s.coin : s.coinSmall;
  if (!icon || failed === icon) return <span className={`${cls} ${s.coinLetter}`}>{symbol === 'SOL' ? '◎' : symbol.slice(0, 1)}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={cls} src={icon} alt="" decoding="async" onError={() => setFailed(icon)} />;
}

function problemText(problem: Problem, symbol: string, w: W, least: string): string | null {
  switch (problem) {
    case 'PRICE':
    case 'DECIMALS':
      return null;
    case 'WALLET':
      return w.problemWallet;
    case 'EMPTY':
      return w.problemEmpty(symbol);
    case 'TOO_MUCH':
      return w.problemTooMuch;
    case 'MIN':
      return w.problemMin(least);
    case 'MAX':
      return w.problemMax;
    case 'PASSED':
      return w.problemPassed;
  }
}

/** One question, answered with taps: the coin, how often, the price, how much. */
function Ask() {
  const w = useWords(INSTRUCT);
  const instruction = useInstruct((st) => st.instruction);
  const choose = useInstruct((st) => st.choose);
  const planned = usePlanned();
  if (!instruction || !planned || planned.ok || !('missing' in planned)) return null;
  const missing = planned.missing;
  let question = '';
  let chips: { key: string; label: string; icon?: { symbol: string; icon: string | null }; pick: () => void }[] = [];
  if (missing === 'coin') {
    question = w.whichCoin;
    chips = coinChoices(bookNow(), contextNow()).map((coin) => ({ key: coin.mint, label: coin.symbol, icon: { symbol: coin.symbol, icon: coin.icon }, pick: () => choose({ field: 'coin', coin }) }));
  } else if (missing === 'cadence' && instruction.kind === 'recurring') {
    question = w.howOften;
    chips = (instruction.options.cadences ?? CADENCE_CHOICES).map((cadence) => ({ key: cadence, label: w.every(cadence), pick: () => choose({ field: 'cadence', cadence }) }));
  } else if (missing === 'trigger' && instruction.kind === 'order') {
    question = w.atWhat;
    const prices = instruction.options.prices;
    if (prices?.length) chips = prices.map((price) => ({ key: price, label: `$${digits(price)}`, pick: () => choose({ field: 'trigger', price }) }));
    else {
      // Moves in the order's own direction: a buy waits for a dip, a stop for a fall, a take-profit for a rise.
      const mode = instruction.mode ?? (instruction.side === 'buy' ? 'limit' : 'stop');
      const sign = (instruction.side === 'buy') === (mode === 'limit') ? '−' : '+';
      chips = MOVE_CHOICES.map((pct) => ({ key: String(pct), label: w.move(sign, String(pct)), pick: () => choose({ field: 'trigger', pct }) }));
    }
  } else if (missing === 'size') {
    question = w.howMuch;
    const buying = instruction.kind === 'recurring' || instruction.side === 'buy';
    chips = buying
      ? USD_CHOICES.map((usd) => ({ key: usd, label: w.usd(usd), pick: () => choose({ field: 'size', usd }) }))
      : SHARE_CHOICES.map((share) => ({ key: String(share), label: share === 100 ? w.all.replace(/^./u, (c) => c.toUpperCase()) : share === 50 ? w.half.replace(/^./u, (c) => c.toUpperCase()) : w.share(String(share)), pick: () => choose({ field: 'size', share }) }));
  }
  return (
    <div className={s.ask} role="group" aria-label={question}>
      <p className={s.question}>{question}</p>
      <div className={s.chips}>
        {chips.map((chip) => (
          <button key={chip.key} type="button" className={s.chip} onClick={chip.pick}>
            {chip.icon && <CoinMark symbol={chip.icon.symbol} icon={chip.icon.icon} size="small" />}
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The one button: connect, wait for the engine, sign — never two actions at once. */
function Action() {
  const w = useWords(INSTRUCT);
  const connection = useWallet((st) => st.connection);
  const phase = useInstruct((st) => st.phase);
  const review = useInstruct((st) => st.review);
  const notice = useInstruct((st) => st.notice);
  const factsStatus = useInstruct((st) => st.facts?.status ?? 'reading');
  const planned = usePlanned();
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (connection) {
      setPicking(false);
      void useInstruct.getState().readFacts();
    }
  }, [connection]);

  if (!connection && picking) return <WalletPicker onBack={() => setPicking(false)} />;
  if (!connection) {
    return (
      <button type="button" className={s.action} onClick={() => setPicking(true)}>
        {w.connect}
      </button>
    );
  }
  const ready = planned?.ok === true;
  const limit = ready && planned.plan.kind === 'limit';
  const reading = !ready && planned && !planned.ok && 'problem' in planned && (planned.problem === 'PRICE' || planned.problem === 'DECIMALS') && factsStatus === 'reading';
  let label = w.sign;
  let enabled = ready;
  let onPress = () => void useInstruct.getState().sign();
  if (phase === 'wallet') [label, enabled] = [w.inWallet, false];
  else if (phase === 'sending') [label, enabled] = [w.sending, false];
  else if (phase === 'reviewing') [label, enabled] = [w.preparing, false];
  else if (reading) [label, enabled] = [w.reading, false];
  else if (limit && !review) {
    // The engine's order is not on the card yet: asked again, never signed unseen.
    [label, enabled] = notice ? [w.again, true] : [w.preparing, false];
    onPress = () => void useInstruct.getState().prepare();
  }
  return (
    <>
      <button type="button" className={`${s.action} ${!enabled && (phase !== 'idle' || reading) ? s.waiting : ''}`} disabled={!enabled} onClick={onPress}>
        {label}
      </button>
      <WalletLine />
    </>
  );
}

function Details() {
  const w = useWords(INSTRUCT);
  const instruction = useInstruct((st) => st.instruction);
  const facts = useInstruct((st) => st.facts?.facts ?? null);
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!instruction) return null;
  const limit = instruction.kind === 'order' && modeOf(instruction, facts?.price ?? null) === 'limit';
  return (
    <div className={s.detailsBox}>
      <button type="button" className={s.more} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {open ? w.hideDetails : w.details}
        <span className={open ? s.chevronUp : ''}>
          <ChevronGlyph />
        </span>
      </button>
      {open && (
        <dl className={s.details} id={id}>
          <div>
            <dt>{w.yourWords}</dt>
            <dd>«{instruction.said}»</dd>
          </div>
          {facts?.price != null && (
            <div>
              <dt>{w.priceNow}</dt>
              <dd translate="no">${priceWords(facts.price, w)}</dd>
            </div>
          )}
          <div>
            <dt>{w.keeps}</dt>
            <dd>{limit ? w.keepsLimit : w.keepsWallet}</dd>
          </div>
          <p className={s.how}>{howLine(instruction, facts, w)}</p>
          <p className={s.how}>{w.cancelAny}</p>
        </dl>
      )}
    </div>
  );
}

function Done() {
  const w = useWords(INSTRUCT);
  const instruction = useInstruct((st) => st.instruction);
  const facts = useInstruct((st) => st.facts?.facts ?? null);
  return (
    <div className={s.ending}>
      <span className={s.endMark}>
        <CheckGlyph />
      </span>
      <p className={s.endTitle}>{w.done}</p>
      {instruction && <p className={s.endLine}>{headline(instruction, facts, w)}</p>}
      <button
        type="button"
        className={s.action}
        onClick={() => {
          useInstruct.getState().close();
          useInstruct.getState().openList();
        }}
      >
        {w.seeList}
      </button>
    </div>
  );
}

/**
 * The agent's card (CITY-176): what it will set from the sentence — the coin, the amount, how often or at what price —
 * the fee and the least in one line, and one button. A missing word is one question with taps. The person signs in
 * their own wallet; the card never presses anything by itself.
 */
export default function AgentCard() {
  const w = useWords(INSTRUCT);
  const instruction = useInstruct((st) => st.instruction);
  const facts = useInstruct((st) => st.facts?.facts ?? null);
  const review = useInstruct((st) => st.review?.review.fee ?? null);
  const phase = useInstruct((st) => st.phase);
  const notice = useInstruct((st) => st.notice);
  const planned = usePlanned();
  useEffect(() => startWallets(), []);

  if (!instruction) return null;
  if (phase === 'done') return <Done />;
  const plan = planned?.ok ? planned.plan : null;
  const problem = planned && !planned.ok && 'problem' in planned ? planned.problem : null;
  const least = instruction.kind === 'recurring' ? '1' : '5';
  const problemLine = problem ? problemText(problem, instruction.coin?.symbol ?? '', w, least) : null;
  const sub = subline(instruction, facts, plan, w);
  const fee = feeLine(instruction, facts, review, w);
  return (
    <div className={s.body} data-instruct="">
      <div className={s.hero}>
        {instruction.coin ? <CoinMark symbol={instruction.coin.symbol} icon={instruction.coin.icon} /> : <span className={`${s.coin} ${s.coinLetter}`}>?</span>}
        <div className={s.heroText}>
          <span className={s.kicker}>{w.agent}</span>
          <h2 className={s.headline}>{headline(instruction, facts, w)}</h2>
          {sub && <p className={s.sub}>{sub}</p>}
        </div>
      </div>
      <Ask />
      {problemLine && <p className={s.problem}>{problemLine}</p>}
      {notice && <p className={notice.tone === 'error' ? s.problem : s.notice}>{notice.text}</p>}
      <div className={s.dock}>
        {fee && <p className={s.fee}>{fee}</p>}
        <Action />
      </div>
      <Details />
    </div>
  );
}
