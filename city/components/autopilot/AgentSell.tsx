'use client';

import { useEffect, useState } from 'react';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { MANDATE_NET, useMandate } from '@/city/lib/bots/mandate';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { AUTOPILOT_NET } from '@/city/lib/autopilot/flag';
import { readSaleQuote, SALE_SHARES, shareLabel, useSell, type SaleReceipt, type SellNote } from '@/city/lib/autopilot/sell';
import { readAgentView, useAutopilot } from '@/city/lib/autopilot/store';
import { AUTOPILOT } from '@/city/lib/autopilot/words';
import { formatUnits } from '@/city/lib/trade/format';
import { balanceOf } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { AgentGlyph } from '../instruct/glyphs';
import t from '../trade/trade.module.css';
import s from './autopilot.module.css';

type W = ReturnType<typeof useWords<(typeof AUTOPILOT)['en']>>;

/** The engine's answers that mean there is nothing to sell here: the block steps aside without a word. */
const QUIET: ReadonlySet<string> = new Set(['NOTHING', 'TOO_SMALL']);

/** SOL from lamports: four significant digits below one SOL, so a fee of a few thousand lamports never reads «0». */
const solOf = (raw: string, lang: 'en' | 'uk', round: 'down' | 'nearest' = 'down') => digits(formatUnits(raw, 9, round), lang);

/**
 * «Your agent holds» in the tower's window (CITY-187): where the person's agent bought this tower's coin for her, one
 * press sells a share of it — 25 %, 50 % or all. Before the press: what she gets at least and Ryntra's fee, one line each;
 * how it works behind «i». The press is her one signature, then the agent sells; the receipt is one line, with the sale
 * one tap away. Only where the agent's switch and the mandate's are open, and only for a wallet whose agent this browser
 * turned on.
 */
export function AgentSell({ mint, symbol }: { mint: string; symbol: string }) {
  // Devnet through its pool (CITY-187), mainnet through Jupiter (CITY-195): wherever the agent's switch and the mandate's are open.
  if (!AUTOPILOT_NET || !MANDATE_NET) return null;
  return <AgentSellBlock mint={mint} symbol={symbol} />;
}

function AgentSellBlock({ mint, symbol }: { mint: string; symbol: string }) {
  const w = useWords(AUTOPILOT);
  const lang = useLang();
  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const record = useMandate((st) => (owner ? (st.records[owner] ?? null) : null));
  const view = useAutopilot((st) => (record ? (st.views[record.policy] ?? null) : null));
  const share = useSell((st) => st.share);
  const quote = useSell((st) => (st.mint === mint ? st.quote : null));
  const phase = useSell((st) => st.phase);
  const receipt = useSell((st) => (st.mint === mint ? st.receipt : null));
  const knownDecimals = useSell((st) => (st.mint === mint ? st.decimals : null));
  const note = useSell((st) => (st.mint === mint ? st.note : null));
  const walletDecimals = useWallet((st) => {
    const balance = balanceOf(st.holdings, mint);
    return balance && balance.spendableRaw !== '0' ? balance.decimals : null;
  });
  const [details, setDetails] = useState(false);

  useEffect(() => useMandate.getState().hydrate(), []);
  useEffect(() => useSell.getState().focus(mint), [mint]);
  // What the agent holds, read when the window opens (the agent's card and «Mine» read it the same way).
  useEffect(() => {
    if (!record) return;
    let live = true;
    void readAgentView(record).then((answer) => {
      if (live && answer) useAutopilot.getState().setView(record.policy, answer);
    });
    return () => {
      live = false;
    };
  }, [record]);

  const ours = view !== null && view.receiveMint === mint;
  const held = ours ? BigInt(view.heldRaw ?? '0') : 0n;
  const policy = record?.policy ?? null;

  // The share on screen, priced by the engine: what she gets at least and Ryntra's fee, before her wallet sees anything.
  // Whether a price is needed never reads the phase the pricing itself sets.
  const needsQuote = held > 0n && policy !== null && owner !== null && quote === null && note === null && receipt === null;
  useEffect(() => {
    if (!needsQuote || !policy || !owner) return;
    let live = true;
    useSell.getState().set({ phase: 'pricing' });
    void readSaleQuote({ owner, policy }, share).then((answer) => {
      if (!live) return;
      if (answer && !('refused' in answer)) useSell.getState().set({ phase: 'idle', quote: answer });
      else useSell.getState().set({ phase: 'idle', note: answer ? (QUIET.has(answer.code) ? 'nothing' : 'refused') : 'unreachable' });
    });
    return () => {
      live = false;
      if (useSell.getState().phase === 'pricing') useSell.getState().set({ phase: 'idle' });
    };
  }, [needsQuote, policy, owner, share]);

  if (!record || !connection || !ours || note === 'nothing' || (held <= 0n && !receipt && note !== 'returned')) return null;

  const who = { wallet: connection.wallet, owner: connection.address };
  const decimals = quote?.figures.decimals ?? knownDecimals ?? walletDecimals;
  const heldText = decimals === null ? null : digits(formatUnits(held.toString(), decimals, 'down'), lang);
  const busy = phase === 'signing' || phase === 'selling' || phase === 'backing';
  const label = phase === 'signing' || phase === 'backing' ? w.sellSigning : phase === 'selling' ? w.sellSelling : w.sellGo(share);
  const sell = () => void import('@/city/lib/autopilot/sell-sign').then(({ tapSell }) => tapSell(who, record));
  const back = () => void import('@/city/lib/autopilot/sell-sign').then(({ tapBack }) => tapBack(who, record));

  return (
    <section className={s.sell} aria-label={w.sellHolds} data-agent-sell="">
      <div className={s.sellHead}>
        <span className={s.sellMark}>
          <AgentGlyph />
        </span>
        <span className={s.sellLabel}>{w.sellHolds}</span>
        <button type="button" className={`${t.info} ${details ? t.infoOn : ''}`} aria-label={w.sellInfo} aria-expanded={details} onClick={() => setDetails((open) => !open)} data-sell-info="">
          i
        </button>
      </div>
      {heldText !== null && held > 0n ? (
        <div className={s.sellHeld} translate="no" data-sell-held="">
          {heldText} {symbol}
        </div>
      ) : null}

      {receipt && phase !== 'idle' ? (
        <Receipt receipt={receipt} symbol={symbol} decimals={decimals} busy={phase === 'backing'} onBack={back} />
      ) : note === 'returned' ? (
        <p className={s.sellDone} role="status">
          {w.sellReturned}
        </p>
      ) : (
        <>
          <div className={s.sellShares} role="radiogroup" aria-label={w.sellHolds}>
            {SALE_SHARES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={share === option}
                className={`${t.share} ${share === option ? t.shareOn : ''}`}
                disabled={busy}
                onClick={() => useSell.getState().pick(option)}
                data-sell-share={option}
              >
                {digits(shareLabel(option, w.sellAll), lang)}
              </button>
            ))}
          </div>
          <p className={s.sellGet} data-sell-get="">
            {quote ? w.sellGet(solOf(quote.figures.floorRaw, lang)) : note ? noteText(w, note) : w.sellPricing}
          </p>
          {quote ? (
            <p className={s.sellFee} data-sell-fee="">
              {w.sellFee(digits(String(quote.figures.feeBps / 100), lang), solOf(quote.figures.feeSolRaw, lang, 'nearest'))}
            </p>
          ) : null}
          <button type="button" className={`${s.sellGo} ${busy ? t.waiting : ''}`} disabled={!quote || busy} aria-busy={busy} onClick={sell} data-sell-go="">
            {label}
          </button>
        </>
      )}

      {details ? (
        <ul className={s.facts} data-sell-details="">
          <li>{w.sellFact1}</li>
          {quote ? <li>{w.sellFact2(solOf(quote.figures.floorRaw, lang))}</li> : null}
          <li>{w.sellFact3}</li>
          <li>{w.sellFact4}</li>
          <li className={s.net}>{MANDATE_NET === 'mainnet' ? w.mainnet : w.devnet}</li>
        </ul>
      ) : null}
    </section>
  );
}

function noteText(w: W, note: Exclude<SellNote, null | 'nothing'>): string {
  return note === 'walletNo' ? w.noteWalletNo : note === 'refused' ? w.noteRefused : note === 'unreachable' ? w.noteUnreachable : w.sellReturned;
}

/** The receipt in one line: sold, with the sale a tap away; signed and on its way; or not sold, with the way back. */
function Receipt({ receipt, symbol, decimals, busy, onBack }: { receipt: SaleReceipt; symbol: string; decimals: number | null; busy: boolean; onBack: () => void }) {
  const w = useWords(AUTOPILOT);
  const lang = useLang();
  if (receipt.status === 'sold') {
    const sold = decimals === null ? '' : digits(formatUnits(receipt.soldRaw, decimals, 'down'), lang);
    const got = receipt.receivedRaw ? solOf(receipt.receivedRaw, lang) : '—';
    return (
      <p className={s.sellDone} role="status" data-sell-receipt="sold">
        <span>{w.sellSold(sold, symbol, got)}</span>
        {receipt.signature ? (
          <a className={s.sellLink} href={explorerTxUrl(MANDATE_NET === 'mainnet' ? 'mainnet' : 'devnet', receipt.signature)} target="_blank" rel="noreferrer" aria-label={w.sellView}>
            ↗
          </a>
        ) : null}
      </p>
    );
  }
  if (receipt.status === 'failed') {
    return (
      <>
        <p className={s.sellLost} role="status" data-sell-receipt="failed">
          {w.sellFailed}
        </p>
        <button type="button" className={`${s.second} ${busy ? t.waiting : ''}`} disabled={busy} aria-busy={busy} onClick={onBack} data-sell-back="">
          {busy ? w.sellSigning : w.sellBack}
        </button>
      </>
    );
  }
  return (
    <p className={s.sellDone} role="status" data-sell-receipt="signed">
      {w.sellWaits}
    </p>
  );
}
