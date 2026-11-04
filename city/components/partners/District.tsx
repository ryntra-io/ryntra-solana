'use client';

import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { digits, num, useWords } from '@/city/lib/i18n/dict';
import { useLang, type Lang } from '@/city/lib/i18n/lang';
import { composePartnerCard } from '@/city/lib/partners/card';
import { agoIn, bare, channelLink, CHANNELS, FUNNEL, funnelEmpty, receiptsCsv, type DistrictView, type FunnelStep, type Receipt, type ReceiptKind } from '@/city/lib/partners/district';
import { DISCOUNT_ON } from '@/city/lib/partners/discount';
import { OFFER, percent, PRODUCTS, type ProductId } from '@/city/lib/partners/facts';
import { usePartners } from '@/city/lib/partners/store';
import { figure } from '@/city/lib/scouts/view';
import { shareImage } from '@/city/lib/share';
import { useWallet } from '@/city/lib/trade/wallet';
import { Connect } from '../money/bits';
import { Status, Still } from './bits';
import { BackGlyph, CameraGlyph, CopyGlyph, DownloadGlyph, QrGlyph } from './glyphs';
import s from './partners.module.css';
import { PARTNERS, type PartnersWords } from './words';

const FIRST_ROWS = 5;
const CHANNEL_NAMES: Readonly<Record<(typeof CHANNELS)[number], string>> = { x: 'X', telegram: 'Telegram', youtube: 'YouTube', discord: 'Discord', tiktok: 'TikTok' };
const FUNNEL_WORD = { clicks: 'funnelClicks', wallets: 'funnelWallets', firstTrade: 'funnelFirstTrade', active: 'funnelActive' } as const satisfies Record<FunnelStep, keyof PartnersWords>;
const KIND_WORD = { REFERRAL_L1: 'kindFriend', CLAIM: 'kindPayout' } as const satisfies Record<ReceiptKind, keyof PartnersWords>;
const PRODUCT_WORD = { swap: 'swap', launch: 'launch' } as const satisfies Record<ProductId, keyof PartnersWords>;

/** A dollar figure from the engine, in the language on screen. */
const usd = (text: string, lang: Lang) => digits(figure(text, null).usd, lang);

/**
 * «Мій район» (CITY-127): the partner's own figures from the engine — accrued, claimable, paid, the people brought —
 * the funnel where the engine counts it, the link kit with its QR, channel marks and a card from the live city, the
 * share by product, the season board and the partner's network lit on the map for their eyes only. The history and its
 * CSV wait behind one quiet toggle: what the partner earns is the headline, never the paperwork.
 */
export function District() {
  const lang = useLang();
  const w = useWords(PARTNERS);
  const demo = usePartners((st) => st.demo);
  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const status = usePartners((st) => (st.demo || st.owner === owner ? st.status : 'none'));
  const view = usePartners((st) => (st.demo || st.owner === owner ? st.view : null));
  const message = usePartners((st) => st.message);

  useEffect(() => {
    if (owner && !demo) void usePartners.getState().read(owner);
  }, [owner, demo]);

  const back = (
    <button type="button" className={`${s.display} ${s.chip} ${s.chipBack}`} onClick={() => usePartners.getState().setDistrict(false)}>
      <BackGlyph />
      {w.back}
    </button>
  );

  if (view && (demo || owner)) return <Ready view={view} w={w} lang={lang} back={back} stale={status === 'failed'} />;

  return (
    <div className={s.gated}>
      <Still name="scouts" tall>
        <span className={`${s.display} ${s.kicker}`}>{w.district}</span>
        {back}
      </Still>
      <div className={s.gate}>
        {!owner ? (
          <Connect />
        ) : status === 'proof' || status === 'proving' ? (
          <>
            <button type="button" className={`${s.display} ${s.action}`} disabled={status === 'proving'} onClick={() => connection && void usePartners.getState().prove(connection)}>
              {status === 'proving' ? w.proving : w.prove}
            </button>
            <p className={s.quiet}>{message ?? w.oneSign}</p>
          </>
        ) : status === 'failed' ? (
          <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => void usePartners.getState().read(owner, true)}>
            {w.retry}
          </button>
        ) : (
          <div className={s.bones} aria-busy="true">
            <span />
            <span />
          </div>
        )}
      </div>
    </div>
  );
}

function Ready({ view, w, lang, back, stale }: { view: DistrictView; w: PartnersWords; lang: Lang; back: ReactNode; stale: boolean }) {
  return (
    <>
      <Still name="scouts">
        <span className={`${s.display} ${s.kicker}`}>{w.district}</span>
        <b className={`${s.display} ${s.big}`}>{usd(view.accrued, lang)}</b>
        <span className={s.bigLabel}>{w.accrued}</span>
        <div className={s.heroFoot}>
          <Status open={view.state === 'OPEN'} weekly={view.state === 'WEEKLY'} />
        </div>
        {back}
      </Still>
      {stale ? <div className={s.stale} role="status" /> : null}

      <div className={s.stats}>
        <Stat label={view.state === 'WEEKLY' ? w.pending : w.claimable} value={usd(view.claimable, lang)} />
        <Stat label={w.paid} value={usd(view.paid, lang)} />
        <Stat label={w.brought} value={view.brought === null ? '—' : num(view.brought, undefined, lang)} />
      </div>

      <Funnel view={view} w={w} lang={lang} />
      <Kit view={view} w={w} lang={lang} />
      <ByProduct view={view} w={w} lang={lang} />
      <History receipts={view.receipts} w={w} lang={lang} />
      <Board w={w} />
      <Streets w={w} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <b className={`${s.display} ${s.statValue}`}>{value}</b>
    </div>
  );
}

function Funnel({ view, w, lang }: { view: DistrictView; w: PartnersWords; lang: Lang }) {
  if (funnelEmpty(view.funnel)) {
    return (
      <section className={s.empty} aria-label={w.funnelClicks}>
        <div className={s.emptySteps} aria-hidden="true">
          {FUNNEL.map((step) => (
            <span key={step} />
          ))}
        </div>
        <p>{w.funnelEmpty}</p>
      </section>
    );
  }
  return (
    <section className={s.funnel} aria-label={w.funnelClicks}>
      {FUNNEL.map((step) => {
        const value = view.funnel[step];
        return (
          <div key={step} className={`${s.step} ${value === null ? s.stepSoon : ''}`}>
            <b className={s.display}>{value === null ? '—' : num(value, undefined, lang)}</b>
            <span>{w[FUNNEL_WORD[step]]}</span>
            {value === null ? <em>{w.soon}</em> : null}
          </div>
        );
      })}
    </section>
  );
}

/** The link, one amber action to copy it, its QR, a mark for each channel and a card filmed from the city. */
function Kit({ view, w, lang }: { view: DistrictView; w: PartnersWords; lang: Lang }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = view.link;
  useEffect(() => {
    if (!link) return;
    let alive = true;
    void QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: '#0b0a14', light: '#eef1ff' } }).then((url) => alive && setQr(url));
    return () => {
      alive = false;
    };
  }, [link]);
  if (!link) return null;
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1_800);
    } catch {
      // The link is on screen whole.
    }
  };
  const card = async () => {
    if (!OFFER) return;
    setBusy(true);
    try {
      const discount = percent(OFFER.discountPercent, lang);
      const blob = await composePartnerCard(link, { big: discount, line: w.cardLine(discount, !DISCOUNT_ON), tag: w.cardTag });
      if (blob) await shareImage(blob, 'ryntra-partner.png', link);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={s.kit} aria-label={w.kit}>
      <span className={s.sectionHead}>{w.kit}</span>
      <span className={s.link} translate="no">
        {bare(link)}
      </span>
      <div className={s.kitRow}>
        <button type="button" className={`${s.display} ${s.action}`} onClick={() => void copy(link, 'main')}>
          {copied === 'main' ? w.copied : w.copy}
        </button>
        <button type="button" className={`${s.secondary} ${s.square}`} aria-label={w.qr} aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}>
          <QrGlyph />
        </button>
        {OFFER ? (
          <button type="button" className={`${s.secondary} ${s.square}`} aria-label={busy ? w.cardBusy : w.card} disabled={busy} onClick={() => void card()}>
            <CameraGlyph />
          </button>
        ) : null}
      </div>
      {showQr && qr ? (
        <div className={s.qr}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={w.qr} width={180} height={180} />
        </div>
      ) : null}
      {view.code ? (
        <div className={s.channels}>
          {CHANNELS.map((channel) => (
            <button key={channel} type="button" className={s.channel} onClick={() => void copy(channelLink(link, view.code!, channel), channel)}>
              {copied === channel ? <span className={s.channelDone}>{w.copied}</span> : CHANNEL_NAMES[channel]}
              <CopyGlyph />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** The partner's share by product (decision 93: launches and swaps): what is counted, and what is still coming. */
function ByProduct({ view, w, lang }: { view: DistrictView; w: PartnersWords; lang: Lang }) {
  return (
    <section className={s.byProduct} aria-label={w.byProduct}>
      <span className={s.sectionHead}>{w.byProduct}</span>
      {PRODUCTS.map((p) => (
        <div key={p.id} className={s.productLine} data-state={p.state}>
          <span className={s.productName}>{w[PRODUCT_WORD[p.id]]}</span>
          {p.state === 'counting' || (p.id === 'launch' && view.launch !== null) ? (
            <b>{usd(p.id === 'launch' ? (view.launch ?? '0.00') : view.swap, lang)}</b>
          ) : (
            <span className={s.productState}>
              <span className={s.dot} aria-hidden="true" />
              {w.soon}
            </span>
          )}
        </div>
      ))}
    </section>
  );
}

/** The history and its CSV, behind one quiet toggle. */
function History({ receipts, w, lang }: { receipts: readonly Receipt[]; w: PartnersWords; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [now] = useState(() => Date.now());
  const rows = all ? receipts : receipts.slice(0, FIRST_ROWS);
  const download = () => {
    const url = URL.createObjectURL(new Blob([receiptsCsv(receipts)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ryntra-partner-history.csv';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  };
  return (
    <section className={s.receipts}>
      <button type="button" className={s.disclose} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{w.history}</span>
        <span className={s.chevron} aria-hidden="true" />
      </button>
      {open ? (
        <>
          {receipts.length ? (
            <ul className={s.rows}>
              {rows.map((r, i) => {
                const f = figure(r.amount, null);
                return (
                  <li key={`${r.at}-${r.kind}-${i}`} className={`${s.row} ${r.out ? s.out : ''}`}>
                    <span className={s.what}>
                      <b>{w[KIND_WORD[r.kind]]}</b>
                      {r.coin ? <span translate="no">{r.coin}</span> : null}
                    </span>
                    <b className={s.amount}>{f.usd === '—' ? '—' : digits(`${r.out ? '−' : '+'}${f.usd}`, lang)}</b>
                    <time className={s.when} dateTime={r.at}>
                      {agoIn(r.at, now, lang)}
                    </time>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={s.quietLeft}>{w.historyEmpty}</p>
          )}
          <div className={s.sectionRow}>
            {receipts.length > FIRST_ROWS ? (
              <button type="button" className={s.moreToggle} aria-expanded={all} onClick={() => setAll((v) => !v)}>
                {all ? w.less : w.all}
              </button>
            ) : (
              <span />
            )}
            {receipts.length ? (
              <button type="button" className={s.csv} onClick={download}>
                <DownloadGlyph />
                {w.csv}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Board({ w }: { w: PartnersWords }) {
  const handle = usePartners((st) => st.choices.handle);
  return (
    <section className={s.board} aria-label={w.board}>
      <span className={s.sectionHead}>{w.board}</span>
      <div className={s.podium} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className={s.quietLeft}>{w.boardEmpty}</p>
      <Switch label={w.showHandle} on={handle} onChange={(on) => usePartners.getState().choose('handle', on)} />
    </section>
  );
}

function Streets({ w }: { w: PartnersWords }) {
  const on = usePartners((st) => st.choices.streets);
  return (
    <section className={s.streets}>
      <Switch label={w.streets} sub={w.streetsLine} on={on} onChange={(next) => usePartners.getState().choose('streets', next)} />
    </section>
  );
}

function Switch({ label, sub, on, onChange }: { label: string; sub?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className={s.switchRow}>
      <span className={s.switchText}>
        <b>{label}</b>
        {sub ? <span>{sub}</span> : null}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={s.switch} onClick={() => onChange(!on)}>
        <span className={s.knob} />
      </button>
    </div>
  );
}
