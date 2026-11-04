'use client';

import { useEffect, useState } from 'react';
import { recentSendRecipients } from '@/lib/solana/send-recipients.client';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { minutesLeft, payMint, SOL_MINT, swapLeg, type Gone, type Intent } from '@/city/lib/intent/check';
import { BUSY_PHASES, transferDecimals, useIntent, type CoinLook } from '@/city/lib/intent/store';
import { INTENT, INTENT_LINES } from '@/city/lib/intent/words';
import { grouped, guardOf, riskLine } from '@/city/lib/money/recipient';
import { decimalsOf, figuresOf, orderWarnings, warningLine } from '@/city/lib/trade/figures';
import { formatUnits, shortAddress } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { WalletLine, WalletPicker } from '../trade/WalletParts';
import t from '../trade/trade.module.css';
import s from './intent.module.css';

/** The price is read again this often while the sheet is open and nothing else is happening. */
const QUOTE_REFRESH_MS = 20_000;
const KNOWN: Readonly<Record<string, string>> = { So11111111111111111111111111111111111111112: 'SOL', EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC', SOL: 'SOL' };

/**
 * How the sheet names a coin: SOL and USDC by name; a coin the engine or the city vouches for by its own words and logo;
 * any other coin — the very field an outside party chooses — by its address cut short, with no logo and «Unverified
 * coin», so a borrowed ticker never stands over somebody else's mint.
 */
function useLook(mint: string, given: CoinLook | null): Readonly<{ symbol: string; icon: string | null; verified: boolean }> {
  const id = mint === 'SOL' ? SOL_MINT : mint;
  const tower = useCity((st) => st.layout.towers.find((placed) => placed.tower.id === id)?.tower ?? null);
  if (KNOWN[mint]) return { symbol: KNOWN[mint]!, icon: tower?.verified && tower.icon ? `/api/icon/${tower.id}` : null, verified: true };
  if (tower?.verified) return { symbol: tower.symbol.replace(/^\$+/, ''), icon: tower.icon ? `/api/icon/${tower.id}` : null, verified: true };
  if (given?.mint === mint && given.verified === true) return { symbol: given.symbol.replace(/^\$+/, ''), icon: given.icon?.startsWith('/') ? given.icon : null, verified: true };
  return { symbol: shortAddress(mint), icon: null, verified: false };
}

/** SOL and USDC by their own signs when no logo was read; any other coin by its first letter. */
const SIGN: Readonly<Record<string, readonly [string, string]>> = { SOL: ['◎', s.coinSol!], USDC: ['$', s.coinUsdc!] };

function CoinMark({ symbol, icon }: { symbol: string; icon: string | null }) {
  const [sign, tone] = SIGN[symbol] ?? [symbol.slice(0, 1), ''];
  return (
    <span className={`${s.coin} ${icon ? '' : tone}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {icon ? <img src={icon} alt="" /> : <span className={s.coinLetter}>{sign}</span>}
    </span>
  );
}

/** A minute clock for «… min left». */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Who prepared it — the only words of the intent the sheet says — its kind, and how long it waits. */
function Origin({ view }: { view: Intent }) {
  const w = useWords(INTENT);
  const now = useMinute();
  const [open, setOpen] = useState(false);
  const kind = view.origin.kind === 'agent' ? w.agent : view.origin.kind === 'chat' ? w.chat : w.partner;
  const left = view.status === 'OPEN' ? minutesLeft(view.expiresAt, now) : null;
  return (
    <div className={s.originBox}>
      <div className={s.origin}>
        <span className={s.originGlyph} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {view.origin.kind === 'agent' ? (
              <>
                <rect x="5" y="8" width="14" height="11" rx="3" />
                <path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" />
              </>
            ) : view.origin.kind === 'chat' ? (
              <path d="M5 5h14v10H9l-4 4z" />
            ) : (
              <>
                <circle cx="8" cy="12" r="4" />
                <circle cx="16" cy="12" r="4" />
              </>
            )}
          </svg>
        </span>
        <span className={s.originText}>
          <span className={s.originName} translate="no">
            {w.preparedBy(view.origin.name)}
          </span>
          <span className={s.originMeta}>
            <span className={s.originWhen}>
              {kind}
              {left !== null ? ` · ${w.minutesLeft(left)}` : ''}
            </span>
            {view.origin.verified ? null : <span className={s.tag}>{w.unverified}</span>}
          </span>
        </span>
        <button type="button" className={`${s.info} ${open ? s.infoOn : ''}`} aria-expanded={open} aria-label={open ? w.hideDetails : w.details} onClick={() => setOpen(!open)}>
          i
        </button>
      </div>
      {open ? <p className={s.originNote}>{view.spec.action === 'transfer' ? w.notOursTransfer : w.notOurs}</p> : null}
    </div>
  );
}

function Rows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className={s.rows}>
      {rows.map(([label, value]) => (
        <div key={label} className={s.rowLine}>
          <dt>{label}</dt>
          <dd translate="no">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SwapFace({ view, coin }: { view: Intent; coin: CoinLook | null }) {
  const w = useWords(INTENT);
  const spec = view.spec;
  const quote = useIntent((st) => st.quote);
  const order = useIntent((st) => st.order);
  const quoteState = useIntent((st) => st.quoteState);
  const [details, setDetails] = useState(false);
  const look = useLook(spec.action === 'swap' ? spec.coin : 'SOL', coin);
  if (spec.action !== 'swap') return null;
  const leg = swapLeg(spec);
  const pay = spec.pay;
  const body = order?.body ?? quote?.body ?? null;
  const priced = order?.body.order ?? quote?.body.order ?? null;
  const inDecimals = body ? decimalsOf(body, leg.inputMint) : leg.inputMint === payMint(spec) ? (pay === 'SOL' ? 9 : 6) : null;
  const outDecimals = body ? decimalsOf(body, leg.outputMint) : null;
  const inSymbol = spec.side === 'buy' ? pay : look.symbol;
  const outSymbol = spec.side === 'buy' ? look.symbol : pay;
  const figures = priced && outDecimals !== null ? figuresOf(priced, outDecimals, order ? 'order' : 'quote') : null;
  // What the engine's own policy says a person should read before signing this exact order, in one line.
  const warnings = order ? orderWarnings(order.body) : [];
  return (
    <>
      <div className={s.head}>
        <CoinMark symbol={look.symbol} icon={look.icon} />
        <h3 className={`${t.display} ${s.title}`} translate="no">
          {spec.side === 'buy' ? w.buy(look.verified ? `$${look.symbol}` : look.symbol) : w.sell(look.verified ? `$${look.symbol}` : look.symbol)}
        </h3>
        {look.verified ? null : <span className={s.tag}>{w.unverifiedCoin}</span>}
      </div>
      <div>
        <div className={s.label}>{w.youPay}</div>
        <div className={s.pay} translate="no">
          <b>{inDecimals !== null ? formatUnits(leg.amountRaw, inDecimals) : '—'}</b> {inSymbol}
        </div>
      </div>
      <div>
        <div className={s.label}>{w.youGetAbout}</div>
        <div className={`${s.figure} ${quoteState === 'reading' && !figures ? t.waiting : ''}`} translate="no">
          <span className={t.display}>{figures ? figures.get : '—'}</span>
          <span className={`${t.display} ${s.unit}`}>{outSymbol}</span>
        </div>
        {figures ? (
          <div className={s.sub}>
            <span>{figures.fee ? w.fee(figures.fee) : w.noFee}</span>
            <span aria-hidden="true"> · </span>
            <span translate="no">{w.atLeast(`${figures.minimum} ${outSymbol}`)}</span>
            <button type="button" className={`${s.info} ${s.infoSmall} ${details ? s.infoOn : ''}`} aria-expanded={details} aria-label={details ? w.hideDetails : w.details} onClick={() => setDetails(!details)}>
              i
            </button>
          </div>
        ) : null}
      </div>
      {warnings.length > 0 && order ? <div className={`${t.notice} ${t.noticeWarn}`}>{warningLine(warnings[0]!, order.body)}</div> : null}
      {figures && details ? (
        <Rows
          rows={[
            [w.ryntraFee, figures.fee ?? '0%'],
            [w.least, `${figures.minimum} ${outSymbol}`],
            [w.route, figures.route],
            [w.impact, figures.impact],
            [w.expires, new Date(view.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })],
          ]}
        />
      ) : null}
    </>
  );
}

function TransferFace({ view, coin }: { view: Intent; coin: CoinLook | null }) {
  const w = useWords(INTENT);
  const spec = view.spec;
  const review = useIntent((st) => st.review);
  const risk = useIntent((st) => st.risk);
  const connection = useWallet((st) => st.connection);
  const look = useLook(spec.action === 'transfer' ? spec.coin : 'SOL', coin);
  const [recents, setRecents] = useState<readonly string[] | null>(null);
  useEffect(() => {
    if (!connection) return setRecents(null);
    try {
      setRecents(recentSendRecipients(window.localStorage, connection.address));
    } catch {
      setRecents([]);
    }
  }, [connection]);
  if (spec.action !== 'transfer') return null;
  const decimals = transferDecimals(spec, review);
  const check = review?.bundle.check ?? null;
  const guard = connection && recents ? guardOf(spec.to, connection.address, recents, true) : null;
  const danger = riskLine(risk);
  // What the transfer costs, said before the signature in one line: the network's fee and, where it opens one, the
  // recipient's new account.
  const costs: string[] = [];
  if (check?.networkFee) costs.push(w.networkFee(check.networkFee.sol));
  if (check?.setup && check.setup.sol) costs.push(w.newAccount(check.setup.sol));
  return (
    <>
      <div className={s.head}>
        <CoinMark symbol={look.symbol} icon={look.icon} />
        <h3 className={`${t.display} ${s.title}`} translate="no">
          {w.send(look.symbol)}
        </h3>
        {look.verified ? null : <span className={s.tag}>{w.unverifiedCoin}</span>}
      </div>
      <div>
        <div className={s.label}>{w.amount}</div>
        <div className={s.figure} translate="no">
          <span className={t.display}>{decimals !== null ? formatUnits(spec.amountRaw, decimals) : '—'}</span>
          <span className={`${t.display} ${s.unit}`}>{look.symbol}</span>
        </div>
        {check?.receive.less ? <div className={s.sub}>{w.arrives(`${check.receive.amount} ${look.symbol}`)}</div> : null}
      </div>
      <div>
        <div className={s.labelRow}>
          <span className={s.label}>{w.to}</span>
          {guard?.isNew ? <span className={s.tag}>{w.firstTime}</span> : null}
        </div>
        <div className={s.address} translate="no">
          {grouped(spec.to)}
        </div>
        {costs.length ? (
          <div className={s.sub} translate="no">
            {costs.join(' · ')}
          </div>
        ) : null}
      </div>
      {danger ? <div className={`${t.notice} ${danger.tone === 'error' ? t.noticeError : t.noticeWarn}`}>{danger.text}</div> : null}
    </>
  );
}

function Ending({ title, line, href, hrefLabel, tone }: { title: string; line: string | null; href: string | null; hrefLabel: string; tone: 'ok' | 'bad' | 'gone' }) {
  const w = useWords(INTENT);
  return (
    <div className={s.ending}>
      <span className={`${s.endMark} ${tone === 'ok' ? s.endOk : tone === 'bad' ? s.endBad : s.endGone}`} aria-hidden="true">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {tone === 'ok' ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : tone === 'bad' ? <path d="M7 7l10 10M17 7L7 17" /> : <path d="M12 7v6M12 16.5h.01" />}
        </svg>
      </span>
      <h3 className={`${t.display} ${s.endTitle}`}>{title}</h3>
      {line ? <p className={s.endLine}>{line}</p> : null}
      {href ? (
        <a className={s.endLink} href={href} target="_blank" rel="noreferrer">
          {hrefLabel}
        </a>
      ) : null}
      <button type="button" className={`${t.display} ${t.action}`} onClick={() => useIntent.getState().close()}>
        {w.backToCity}
      </button>
    </div>
  );
}

function GoneFace({ gone }: { gone: Gone }) {
  const w = useWords(INTENT);
  const title = gone === 'used' ? w.used : gone === 'expired' ? w.expired : gone === 'cancelled' ? w.cancelled : gone === 'changed' ? w.changed : w.missing;
  return <Ending title={title} line={w.askAgain} href={null} hrefLabel="" tone="gone" />;
}

function DoneFace({ view, coin }: { view: Intent; coin: CoinLook | null }) {
  const w = useWords(INTENT);
  const done = useIntent((st) => st.done);
  const quote = useIntent((st) => st.quote);
  const look = useLook(view.spec.coin, coin);
  if (!done) return null;
  let line: string | null = null;
  if (done.failed) line = w.failedLine;
  else if (view.spec.action === 'transfer') {
    const decimals = transferDecimals(view.spec, null);
    line = decimals !== null ? w.sent(`${formatUnits(view.spec.amountRaw, decimals)} ${look.symbol}`) : null;
  } else if (quote && done.outRaw) {
    // Only what actually arrived, as the chain said it — never the quote's figure.
    const leg = swapLeg(view.spec);
    const decimals = decimalsOf(quote.body, leg.outputMint);
    const symbol = view.spec.side === 'buy' ? look.symbol : view.spec.pay;
    line = decimals !== null ? w.bought(`${formatUnits(done.outRaw, decimals)} ${symbol}`) : null;
  }
  return <Ending title={done.failed ? w.failed : w.done} line={line} href={done.signature ? explorerTxUrl('mainnet', done.signature) : null} hrefLabel={w.viewTx} tone={done.failed ? 'bad' : 'ok'} />;
}

function Action({ view }: { view: Intent }) {
  const w = useWords(INTENT);
  const wl = useWords(INTENT_LINES);
  const connection = useWallet((st) => st.connection);
  const phase = useIntent((st) => st.phase);
  const order = useIntent((st) => st.order);
  const quoteState = useIntent((st) => st.quoteState);
  const review = useIntent((st) => st.review);
  const reviewState = useIntent((st) => st.reviewState);
  const risk = useIntent((st) => st.risk);
  const sent = useIntent((st) => st.sent);
  const [picking, setPicking] = useState(false);
  const [recents, setRecents] = useState<readonly string[] | null>(null);

  useEffect(() => {
    if (!connection) return setRecents(null);
    setPicking(false);
    try {
      setRecents(recentSendRecipients(window.localStorage, connection.address));
    } catch {
      setRecents([]);
    }
    void useIntent.getState().refresh();
  }, [connection]);

  if (!connection && picking) return <WalletPicker onBack={() => setPicking(false)} />;
  if (!connection) {
    return (
      <button type="button" className={`${t.display} ${t.action}`} onClick={() => setPicking(true)}>
        {w.connectWallet}
      </button>
    );
  }
  const busy = BUSY_PHASES.has(phase);
  const transfer = view.spec.action === 'transfer';
  const lookalike = transfer && recents ? guardOf(view.spec.action === 'transfer' ? view.spec.to : '', connection.address, recents, true).lookalike : null;
  // A transfer opens the wallet only on the engine's own Review; a sanctioned or look-alike recipient never.
  const elsewhere = Boolean(view.for && view.for !== connection.address);
  // A marked signature is only read back: the button checks it again, it never builds or signs anew.
  const held = sent ? false : elsewhere || (transfer ? !review || reviewState === 'reading' || risk === 'sanctioned' || Boolean(lookalike) : quoteState !== 'ready' && !order);
  const label =
    phase === 'claiming'
      ? w.checking
      : phase === 'preparing'
        ? w.preparing
        : phase === 'wallet'
          ? w.wallet
          : phase === 'sending'
            ? w.sending
            : phase === 'checking'
              ? w.chain
              : phase === 'recording'
                ? w.recording
                : sent
                  ? w.checkAgain
                  : !transfer && quoteState === 'reading' && !order
                  ? w.reading
                  : order
                    ? w.confirmNew
                    : w.confirm;
  return (
    <>
      {elsewhere ? <div className={`${t.notice} ${t.noticeWarn}`}>{wl.otherWallet}</div> : null}
      <button type="button" className={`${t.display} ${t.action} ${busy ? t.waiting : ''}`} disabled={busy || held} onClick={() => void useIntent.getState().confirm()}>
        {label}
      </button>
      <WalletLine />
    </>
  );
}

/** The confirm sheet: who prepared it, the engine's figures, the one action; or how it ended. */
export default function IntentSheet() {
  const w = useWords(INTENT);
  const view = useIntent((st) => st.view);
  const gone = useIntent((st) => st.gone);
  const done = useIntent((st) => st.done);
  const coin = useIntent((st) => st.coin);
  const line = useIntent((st) => st.line);
  const phase = useIntent((st) => st.phase);
  const spec = view?.spec ?? null;

  // A swap's price stays fresh while the sheet waits for the person.
  useEffect(() => {
    if (!view || spec?.action !== 'swap' || gone || done) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && useIntent.getState().phase === 'idle' && !useIntent.getState().order) void useIntent.getState().refresh();
    }, QUOTE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [view, spec?.action, gone, done]);

  if (gone) return <div className={s.body}><GoneFace gone={gone} /></div>;
  if (!view) return <div className={s.body}><p className={s.opening}>{line ? line.text : w.opening}</p></div>;
  if (done) return <div className={s.body}><DoneFace view={view} coin={coin} /></div>;
  return (
    <div className={s.body}>
      <Origin view={view} />
      {view.spec.action === 'swap' ? <SwapFace view={view} coin={coin} /> : <TransferFace view={view} coin={coin} />}
      <div className={s.spacer} />
      <div className={s.dock}>
        {line ? (
          <div role={line.tone === 'error' ? 'alert' : 'status'} className={`${t.notice} ${line.tone === 'error' ? t.noticeError : line.tone === 'warn' ? t.noticeWarn : ''}`}>
            {line.text}
          </div>
        ) : null}
        {phase === 'idle' && line?.tone === 'warn' && view.spec.action === 'swap' && !useIntent.getState().quote ? (
          <button type="button" className={t.quiet} onClick={() => void useIntent.getState().refresh()}>
            {w.tryAgain}
          </button>
        ) : null}
        <Action view={view} />
      </div>
    </div>
  );
}
