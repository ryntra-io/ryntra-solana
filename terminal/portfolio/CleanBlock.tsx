'use client';

import { useEffect, useId, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { Action, CoinLogo, Figure, Icon, Kick, Panel, Quiet, Switch, Title, cx } from '@/terminal/ui';
import { buildClean, readClean, runClean, setIncluded, useClean } from './clean';
import { estimateSol, feeText, groupsOf, inClean, reviewedSol, solFigure, unwrapOf, type CleanItem, type RiskReason } from './clean-view';
import { CLEAN } from './clean-words';
import { Glyph } from './glyphs';
import { logosFor } from './logos';
import p from './portfolio.module.css';

const solText = (sol: number, lang: Lang) => digits(solFigure(sol), lang);

/**
 * The clean itself: the figure the wallet gets back, the three lists with a switch on each — a marked coin off until
 * the person turns it on, its reasons behind «i» — the fee in one line, and the one amber action. The clean is built
 * while the person reads; the press asks the wallet once for the whole package.
 */
export function CleanPanel({ onClose }: { onClose: () => void }) {
  const w = useWords(CLEAN);
  const lang = useLang();
  const read = useClean((st) => st.read);
  const choice = useClean((st) => st.choice);
  const review = useClean((st) => st.review);
  const phase = useClean((st) => st.phase);
  const outcome = useClean((st) => st.outcome);
  const sent = useClean((st) => st.sent);
  const [how, setHow] = useState(false);
  const howId = useId();

  // Built while the person reads, and again for every change of the choice.
  useEffect(() => {
    if (phase === 'idle' && read?.canClean && estimateSol(read, choice) !== null) void buildClean();
  }, [phase, read, choice]);

  if (!read) return null;
  const groups = groupsOf(read.items);
  const working = phase === 'signing' || phase === 'sending';
  const estimate = estimateSol(read, choice);
  const sol = phase === 'done' && sent ? reviewedSol(sent.review) : review ? reviewedSol(review) : estimate;
  // Wrapped SOL picked by hand: it becomes the person's SOL, said apart from what comes back — and when it waits for
  // the next clean (this one swaps coins first), said so.
  const unwrap = unwrapOf(read, choice);
  const fee = review ? feeText(review.summary.feeBps) : null;

  const status =
    phase === 'building' ? w.building : phase === 'signing' ? w.approve : phase === 'sending' ? w.sending : phase === 'declined' ? w.declined : phase === 'failed' ? w.failed : null;

  return (
    <Panel pad="l" gap={14} label={w.title}>
      <div className={p.panelHead}>
        <Glyph name="sweep" className={p.headGlyph} />
        <Title as="h2" className={p.panelTitle}>
          {w.title}
        </Title>
        <ExplainButton label={w.howInfo} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />
        <button type="button" className={p.close} onClick={onClose} aria-label={w.close} disabled={working}>
          <Icon name="close" size="s" />
        </button>
      </div>
      {how ? <ExplainBox id={howId}>{w.howText}</ExplainBox> : null}

      {phase === 'done' && outcome ? (
        <div className={p.cleanDone} role="status">
          <Figure value={outcome === 'none' ? '—' : `≈ ${solText(sol ?? 0, lang)} SOL`} />
          <p className={p.cleanLine}>{outcome === 'done' ? w.done(solText(sol ?? 0, lang)) : outcome === 'part' ? w.part : w.none}</p>
        </div>
      ) : (
        <>
          <div className={p.cleanFigure}>
            <Kick>{w.youGet}</Kick>
            <Figure value={sol === null ? '—' : `≈ ${solText(sol, lang)} SOL`} />
            {unwrap !== null ? <p className={p.cleanUnwrap}>{unwrap.now ? w.unwrap(solText(unwrap.sol, lang)) : w.unwrapNext(solText(unwrap.sol, lang))}</p> : null}
          </div>
          <div className={p.cleanLists}>
            <Group title={w.small} items={groups.small} disabled={working} />
            <Group title={w.litter} items={groups.litter} disabled={working} />
            <Group title={w.empty} items={groups.empty} disabled={working} folded />
          </div>
        </>
      )}

      {phase !== 'done' ? (
        <>
          <p className={p.cleanFee}>
            {review ? (fee ? w.lineFee(digits(fee, lang)) : w.lineFree) : estimate === null || phase === 'empty' ? w.nothing : ' '}
            {review?.summary.skipped.length ? <span className={p.cleanSkip}>{` · ${w.skipped(review.summary.skipped.length)}`}</span> : null}
            {review?.summary.left ? <span className={p.cleanSkip}>{` · ${w.left(review.summary.left)}`}</span> : null}
          </p>
          {status ? (
            <p className={cx(p.cleanStatus)} role="status" data-tone={phase === 'failed' || phase === 'declined' ? 'warn' : undefined}>
              {status}
            </p>
          ) : null}
          {phase === 'failed' ? (
            <Quiet size="s" onClick={() => void readClean().then(() => buildClean())}>
              {w.tryAgain}
            </Quiet>
          ) : null}
          <Action size="m" disabled={!read.canClean || estimate === null || working || phase === 'building' || phase === 'empty'} onClick={() => void runClean()}>
            {w.clean}
          </Action>
        </>
      ) : (
        <Quiet full onClick={onClose}>
          {w.close}
        </Quiet>
      )}
    </Panel>
  );
}

function Group({ title, items, disabled, folded = false }: { title: string; items: readonly CleanItem[]; disabled: boolean; folded?: boolean }) {
  const lang = useLang();
  const w = useWords(CLEAN);
  const choice = useClean((st) => st.choice);
  const [open, setOpen] = useState(!folded);
  if (!items.length) return null;
  const on = items.filter((item) => inClean(item, choice)).length;
  return (
    <section className={p.cleanGroup} aria-label={title}>
      <button type="button" className={p.cleanGroupHead} aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <Kick>{title}</Kick>
        <span className={p.cleanCount}>{on === items.length ? String(items.length) : `${on}/${items.length}`}</span>
        <span className={p.grow} />
        <Icon name="chevron" size="s" className={cx(p.cleanChevron, open && p.cleanChevronOpen)} />
      </button>
      {open ? (
        <ul className={p.cleanRows}>
          {items.map((item) => (
            <li key={item.account}>
              <CleanRow item={item} on={inClean(item, choice)} disabled={disabled} lang={lang} words={w} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type CW = ReturnType<typeof useWords<(typeof CLEAN)['en']>>;

function CleanRow({ item, on, disabled, lang, words: w }: { item: CleanItem; on: boolean; disabled: boolean; lang: Lang; words: CW }) {
  const [why, setWhy] = useState(false);
  const whyId = useId();
  // Wrapped SOL says its amount with its name: a bare figure beside «SOL» read as what comes back.
  const wrapped = item.kind === 'wrapped' ? Number(item.amountRaw) / 1e9 : null;
  // The coins' own queue of logos by the mint, then the market's: SOL's picture for wSOL even with the market unread.
  const logos = [...new Set([...logosFor(item.mint), item.icon].filter((src): src is string => Boolean(src)))];
  const value = item.kind === 'empty' || wrapped === 0 ? w.emptyWord : wrapped !== null ? `${solText(wrapped, lang)} wSOL` : item.valueUsd === null ? w.noPrice : `$${digits(item.valueUsd < 0.01 ? '<0.01' : item.valueUsd.toFixed(2), lang)}`;
  return (
    <div className={p.cleanRow}>
      <CoinLogo src={logos[0] ?? null} also={logos.slice(1)} symbol={item.symbol} size="s" />
      <span className={p.rowMain}>
        <span className={p.cleanSym}>{item.symbol}</span>
        {item.risk.length ? (
          <button type="button" className={p.riskChip} aria-expanded={why} aria-controls={whyId} aria-label={w.why(item.symbol)} onClick={() => setWhy((was) => !was)}>
            {w.dontTouch}
            <Icon name="info" size="s" />
          </button>
        ) : null}
        {why ? <RiskReasons id={whyId} risk={item.risk} /> : null}
      </span>
      <span className={p.cleanValue}>{value}</span>
      <Switch on={on} onChange={(next) => setIncluded(item, next)} label={w.include(item.symbol)} disabled={disabled} />
    </div>
  );
}

/** Why a coin is marked: each reason one short line. */
export function RiskReasons({ id, risk }: { id?: string; risk: readonly RiskReason[] }) {
  const w = useWords(CLEAN);
  return (
    <span id={id} className={p.riskWhy} role="note">
      {risk.map((reason) => w.reason(reason)).join(' · ')}
    </span>
  );
}

/** A coin's mark where the portfolio lists it and on its ticket: «Don't touch», its reasons behind it. */
export function RiskMark({ symbol, risk, wide = false }: { symbol: string; risk: readonly RiskReason[]; wide?: boolean }) {
  const w = useWords(CLEAN);
  const [why, setWhy] = useState(false);
  const whyId = useId();
  if (!risk.length) return null;
  return (
    <span className={cx(p.riskMark, wide && p.riskWide)}>
      <button type="button" className={p.riskChip} aria-expanded={why} aria-controls={whyId} aria-label={w.why(symbol)} onClick={() => setWhy((was) => !was)}>
        {w.dontTouch}
        <Icon name="info" size="s" />
      </button>
      {why ? <RiskReasons id={whyId} risk={risk} /> : null}
    </span>
  );
}

