'use client';

import { useEffect, useMemo, useState } from 'react';
import { canDoFromDraft } from '@/city/lib/bots/decode';
import {
  AMOUNTS,
  CEILINGS,
  draftIssues,
  EVERY_HOURS,
  EXIT_POLICIES,
  GRID_LEVELS,
  LADDER_SHAPES,
  LADDER_STEPS,
  levelsOf,
  priceRound,
  SMART_LADDER_PCTS,
  smartParts,
  type BotDraft,
  type SmartDcaDraft,
} from '@/city/lib/bots/draft';
import { KIND_FACTS } from '@/city/lib/bots/kinds';
import { simulate, tradesOf, type Run } from '@/city/lib/bots/sim';
import { preflight, SIGNATURE_SOL, stressTest } from '@/city/lib/bots/stress';
import { useBots } from '@/city/lib/bots/store';
import { fitOf } from '@/city/lib/bots/weather';
import { pct, price, signedUsd, sol, usd, type Lang } from '@/city/lib/bots/format';
import type { Bar } from '@/city/lib/bots/path';
import type { Words } from '@/city/lib/bots/words';
import { BotChart } from './BotChart';
import { BackGlyph, ChainGlyph, KindGlyph } from './glyphs';
import { useCoinByMint, useWords } from './hooks';
import { LadderStart, placesLive, useLadderPool } from './Ladder';
import s from './bots.module.css';

const NO_BARS: readonly Bar[] = [];

/** A bot's page: the draft on the week's price, its settings, what it may do, and the start — on paper. */
export function BotDetail() {
  const draft = useBots((st) => st.draft);
  const editing = useBots((st) => st.editing);
  const strategies = useBots((st) => st.strategies);
  const path = useBots((st) => (draft ? st.paths[draft.pair.mint] : undefined));
  const coinBy = useCoinByMint();
  const mint = draft?.pair.mint ?? null;
  // A draft for another coin than the hub's (a copied strategy, a bot to finish) reads its own week.
  useEffect(() => {
    const coin = mint ? coinBy(mint) : null;
    if (coin) void useBots.getState().loadPath(coin);
  }, [mint, coinBy]);
  const bars = path?.bars ?? NO_BARS;
  const run = useMemo(() => (draft && bars.length ? simulate(draft, bars) : null), [draft, bars]);
  if (!draft) return null;
  const set = (patch: Partial<BotDraft>) => useBots.getState().setDraft({ ...draft, ...patch } as BotDraft);
  const issues = draftIssues(draft);
  const current = bars.length ? bars[bars.length - 1]!.c : null;
  const fit = fitOf(draft.kind, path?.weather ?? null);
  const own = editing ? strategies.find((x) => x.id === editing && x.owner === 'me') : undefined;
  return <DetailBody draft={draft} set={set} issues={issues} current={current} fit={fit} own={Boolean(own)} bars={bars} path={path} run={run} />;
}

/** The page under its draft: the chart, the result, the stress test, the card; the settings and the start beside them. */
function DetailBody({
  draft,
  set,
  issues,
  current,
  fit,
  own,
  bars,
  path,
  run,
}: Readonly<{
  draft: BotDraft;
  set: (patch: Partial<BotDraft>) => void;
  issues: ReturnType<typeof draftIssues>;
  current: number | null;
  fit: ReturnType<typeof fitOf>;
  own: boolean;
  bars: readonly Bar[];
  path: { status: string } | undefined;
  run: Run | null;
}>) {
  const { w, lang } = useWords();
  // A ladder on a coin the engine has a devnet pool for is placed live (CITY-135); anything else stays practice.
  const pool = useLadderPool(placesLive(draft) ? draft.pair.mint : null);
  const save = () => void (own ? useBots.getState().saveVersion() : useBots.getState().saveAsStrategy(`${w.kind[draft.kind]} · ${draft.pair.symbol}`));

  return (
    <div className={s.detail}>
      <header className={s.detailHead}>
        <button type="button" className={s.iconButton} onClick={() => useBots.getState().back()} aria-label={w.back}>
          <BackGlyph />
        </button>
        <span className={s.detailGlyph}>
          <KindGlyph kind={draft.kind} />
        </span>
        <div className={s.detailName}>
          <b>{w.kind[draft.kind]}</b>
          <span translate="no">{draft.pair.symbol}/USDC</span>
        </div>
        {fit !== 'fair' ? <i className={s.fit} data-fit={fit}>{w.fit[fit]}</i> : null}
        {KIND_FACTS[draft.kind].standalone ? (
          <i className={s.standalone}>
            <ChainGlyph />
            {w.standalone}
          </i>
        ) : null}
        {pool ? <i className={s.devnet}>{w.devnet}</i> : null}
      </header>

      <div className={s.detailGrid}>
        <div className={s.detailMain}>
          <div className={s.chartCard}>
            {bars.length ? (
              <BotChart bars={bars} draft={draft} run={run} lang={lang} label={`${w.kind[draft.kind]} · ${draft.pair.symbol}`} />
            ) : path?.status === 'ready' ? (
              <div className={s.chartPending}>
                <span>{w.noHistory(draft.pair.symbol)}</span>
              </div>
            ) : (
              <div className={s.chartPending} aria-busy="true" />
            )}
            <div className={s.legend}>
              <span>
                <i className={s.dotBuy} />
                {w.bought}
              </span>
              <span>
                <i className={s.dotSell} />
                {w.sold}
              </span>
              {KIND_FACTS[draft.kind].ranged ? (
                <span>
                  <i className={s.dotRange} />
                  {w.range}
                </span>
              ) : null}
            </div>
          </div>
          <Result run={run} w={w} lang={lang} alerts={draft.kind === 'priceAlert'} />
          <Stress draft={draft} current={current} w={w} lang={lang} />
          <CanDoCard draft={draft} w={w} lang={lang} />
        </div>

        <div className={s.detailSide}>
          <section className={s.panel} aria-label={w.settings}>
            <Fields draft={draft} set={set} current={current} w={w} lang={lang} />
          </section>
          {KIND_FACTS[draft.kind].ranged ? (
            <section className={s.panel} aria-label={w.exitTitle}>
              <h4 className={s.panelTitle}>{w.exitTitle}</h4>
              <div className={s.segment} role="radiogroup" aria-label={w.exitTitle}>
                {EXIT_POLICIES.map((p) => (
                  <button key={p} type="button" role="radio" aria-checked={draft.exit === p} className={draft.exit === p ? s.segOn : undefined} onClick={() => set({ exit: p })}>
                    {w.exit[p]}
                  </button>
                ))}
              </div>
              <p className={s.hint}>{w.exitWhat[draft.exit]}</p>
            </section>
          ) : null}
          <div className={s.startBlock}>
            {pool ? (
              <>
                <RiskLine draft={draft} current={current} w={w} lang={lang} />
                <LadderStart
                  draft={draft}
                  pool={pool}
                  paperIssue={issues.length ? w.issue[issues[0]!] : null}
                  canPractice={issues.length === 0 && bars.length > 0}
                  onSave={save}
                  saveLabel={own ? w.saveVersion : w.saveStrategy}
                />
              </>
            ) : (
              <>
                <CostLine draft={draft} w={w} lang={lang} />
                <RiskLine draft={draft} current={current} w={w} lang={lang} />
                {issues.length ? <p className={s.issue}>{w.issue[issues[0]!]}</p> : null}
                <button type="button" className={s.primary} disabled={issues.length > 0 || !bars.length} onClick={() => useBots.getState().startPaper()}>
                  {w.start}
                </button>
                <button type="button" className={s.quiet} disabled={issues.length > 0} onClick={save}>
                  {own ? w.saveVersion : w.saveStrategy}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Result({ run, w, lang, alerts }: Readonly<{ run: Run | null; w: Words; lang: Lang; alerts: boolean }>) {
  const [open, setOpen] = useState(false);
  return (
    <section className={s.result} aria-label={w.lastWeek}>
      <div className={s.resultHead}>
        <h4 className={s.panelTitle}>{w.lastWeek}</h4>
        <button type="button" className={s.details} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {w.details}
        </button>
      </div>
      <div className={s.figures}>
        <Figure label={w.bot} value={run ? signedUsd(run.pnlUsd, lang) : '—'} tone={run ? (run.pnlUsd >= 0 ? 'up' : 'down') : undefined} big />
        <Figure label={w.hold} value={run ? signedUsd(run.holdPnlUsd, lang) : '—'} />
        <Figure label={alerts ? w.alerts : w.fills} value={run ? String(alerts ? run.alerts.length : tradesOf(run).length) : '—'} />
        <Figure label={w.drawdown} value={run ? pct(-run.maxDrawdownPct, lang) : '—'} />
      </div>
      {open ? (
        <ul className={s.detailsList}>
          <li>{w.detailsLines.market}</li>
          <li>{w.detailsLines.weather}</li>
          <li>{w.detailsLines.fees}</li>
          <li>{w.detailsLines.paper}</li>
        </ul>
      ) : null}
    </section>
  );
}

export function Figure({ label, value, tone, big = false }: Readonly<{ label: string; value: string; tone?: 'up' | 'down'; big?: boolean }>) {
  return (
    <div className={`${s.figure} ${big ? s.figureBig : ''}`} data-tone={tone}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Stress({ draft, current, w, lang }: Readonly<{ draft: BotDraft; current: number | null; w: Words; lang: Lang }>) {
  const rows = useMemo(() => (current ? stressTest(draft, current) : []), [draft, current]);
  if (!rows.length) return null;
  return (
    <section className={s.stress} aria-label={w.stressTitle}>
      <h4 className={s.panelTitle}>{w.stressTitle}</h4>
      <div className={s.stressRows}>
        {rows.map((r) => (
          <div key={r.movePct} className={s.stressRow} data-tone={r.movePct < 0 ? 'down' : 'up'}>
            <span className={s.stressMove}>{pct(r.movePct, lang, true)}</span>
            <span>
              <i>{w.bot}</i>
              <b>{usd(r.botUsd, lang)}</b>
            </span>
            <span>
              <i>{w.hold}</i>
              <b>{usd(r.holdUsd, lang)}</b>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CanDoCard({ draft, w, lang, compact = false }: Readonly<{ draft: BotDraft; w: Words; lang: Lang; compact?: boolean }>) {
  const card = canDoFromDraft(draft);
  return (
    <section className={`${s.canDo} ${compact ? s.canDoCompact : ''}`} aria-label={w.canDoTitle}>
      <h4 className={s.panelTitle}>{w.canDoTitle}</h4>
      <dl>
        <div>
          <dt>{w.canDo.pair}</dt>
          <dd translate="no">{card.pair}</dd>
        </div>
        <div>
          <dt>{w.canDo.max}</dt>
          <dd>{usd(card.maxUsd, lang)}</dd>
        </div>
        <div>
          <dt>{w.canDo.sits}</dt>
          <dd>{w.custody[card.custody]}</dd>
        </div>
        <div>
          <dt>{w.canDo.trades}</dt>
          <dd>{card.trades === 'alone' ? w.tradesAlone : card.trades === 'both' ? w.tradesBoth : w.tradesTap}</dd>
        </div>
        {card.exit && !compact ? (
          <div>
            <dt>{w.canDo.exit}</dt>
            <dd>{w.exit[card.exit]}</dd>
          </div>
        ) : null}
        <div>
          <dt>{w.canDo.close}</dt>
          <dd>{w.close[card.close]}</dd>
        </div>
      </dl>
      <p className={s.source}>{w.readFrom[card.source]}</p>
    </section>
  );
}

export function CostLine({ draft, w, lang }: Readonly<{ draft: BotDraft; w: Words; lang: Lang }>) {
  const cost = preflight(draft);
  const live = cost.perTrade ? w.costTap(sol(SIGNATURE_SOL, lang)) : w.costLive(sol(cost.networkSol, lang), cost.depositSol ? sol(cost.depositSol, lang) : null);
  return (
    <p className={s.cost}>
      <b>{w.costPaper}</b>
      <span>{live}</span>
    </p>
  );
}

export function RiskLine({ draft, current, w, lang }: Readonly<{ draft: BotDraft; current: number | null; w: Words; lang: Lang }>) {
  const low = draft.kind === 'grid' || draft.kind === 'lpRange' ? draft.lower : current ? (levelsOf(draft, current)[0] ?? current) : 0;
  const text = (w.risk[draft.kind] as (low: string, sym: string) => string)(price(low, lang), draft.pair.symbol);
  return <p className={s.risk}>{text}</p>;
}

/** The settings of each bot: taps on sensible values, a typed number only where a price is the setting. */
function Fields({ draft, set, current, w, lang }: Readonly<{ draft: BotDraft; set: (patch: Partial<BotDraft>) => void; current: number | null; w: Words; lang: Lang }>) {
  return (
    <div className={s.fields}>
      <Field label={w.field.amount}>
        <Chips values={AMOUNTS} value={draft.amountUsd} format={(v) => usd(v, lang).replace(/\.00$/, '').replace(/,00$/, '')} onPick={(v) => set({ amountUsd: v })} />
      </Field>
      {draft.kind === 'grid' || draft.kind === 'lpRange' ? (
        <>
          <div className={s.pairFields}>
            <PriceField label={w.field.lower} value={draft.lower} onChange={(v) => set({ lower: v })} lang={lang} />
            <PriceField label={w.field.upper} value={draft.upper} onChange={(v) => set({ upper: v })} lang={lang} />
          </div>
          {draft.kind === 'grid' ? (
            <Field label={w.field.levels}>
              <Chips values={GRID_LEVELS} value={draft.levels} onPick={(v) => set({ levels: v })} />
            </Field>
          ) : null}
          {current ? <RangeHint lower={draft.lower} upper={draft.upper} current={current} w={w} lang={lang} /> : null}
        </>
      ) : draft.kind === 'buyLadder' || draft.kind === 'exitLadder' ? (
        <>
          <Field label={w.field.steps}>
            <Chips values={LADDER_STEPS} value={draft.steps} onPick={(v) => set({ steps: v })} />
          </Field>
          <div className={s.pairFields}>
            <PctField label={`${w.field.firstPct} ${draft.kind === 'buyLadder' ? '−' : '+'}`} value={draft.firstPct} onChange={(v) => set({ firstPct: v })} />
            <PctField label={`${w.field.lastPct} ${draft.kind === 'buyLadder' ? '−' : '+'}`} value={draft.lastPct} onChange={(v) => set({ lastPct: v })} />
          </div>
          <ShapeField value={draft.shape ?? 'even'} onPick={(shape) => set({ shape })} w={w} />
        </>
      ) : draft.kind === 'smartDca' ? (
        <SmartFields draft={draft} set={set} w={w} />
      ) : draft.kind === 'recurring' ? (
        <>
          <Field label={w.field.everyHours}>
            <Chips values={EVERY_HOURS} value={draft.everyHours} format={(v) => w.every(v)} onPick={(v) => set({ everyHours: v })} />
          </Field>
          <Field label={w.field.buys}>
            <Chips values={[4, 5, 8, 12]} value={draft.buys} onPick={(v) => set({ buys: v })} />
          </Field>
        </>
      ) : draft.kind === 'rebalancer' ? (
        <>
          <Field label={w.field.targetPct}>
            <Chips values={[30, 50, 70]} value={draft.targetPct} format={(v) => `${v}%`} onPick={(v) => set({ targetPct: v })} />
          </Field>
          <Field label={w.field.driftPct}>
            <Chips values={[3, 5, 10]} value={draft.driftPct} format={(v) => `±${v}%`} onPick={(v) => set({ driftPct: v })} />
          </Field>
        </>
      ) : draft.kind === 'priceAlert' ? (
        <Field label={w.field.movePct}>
          <Chips values={[-5, -10, -15, -20, 10, 20]} value={draft.movePct} format={(v) => pct(v, lang, true)} onPick={(v) => set({ movePct: v })} />
        </Field>
      ) : draft.kind === 'signal' ? (
        <Field label={`${w.field.fast} / ${w.field.slow}`}>
          <Chips values={[9, 12, 20]} value={draft.fast} format={(v) => `${v} / ${v === 9 ? 21 : v === 12 ? 26 : 50}`} onPick={(v) => set({ fast: v, slow: v === 9 ? 21 : v === 12 ? 26 : 50 })} />
        </Field>
      ) : null}
    </div>
  );
}

/** Even, or more on the far steps. */
function ShapeField({ value, onPick, w }: Readonly<{ value: (typeof LADDER_SHAPES)[number]; onPick: (shape: (typeof LADDER_SHAPES)[number]) => void; w: Words }>) {
  return (
    <Field label={w.field.shape}>
      <div className={s.chips} role="radiogroup">
        {LADDER_SHAPES.map((shape) => (
          <button key={shape} type="button" role="radio" aria-checked={shape === value} className={shape === value ? s.chipOn : undefined} onClick={() => onPick(shape)}>
            {w.shape[shape]}
          </button>
        ))}
      </div>
    </Field>
  );
}

/** Smart DCA: the ladder's share and its steps, then the reminders and their ceiling. */
function SmartFields({ draft, set, w }: Readonly<{ draft: SmartDcaDraft; set: (patch: Partial<BotDraft>) => void; w: Words }>) {
  const parts = smartParts(draft);
  const patch = (change: Partial<SmartDcaDraft>) => set({ ...parts, ...change } as Partial<BotDraft>);
  return (
    <>
      <Field label={w.field.ladderPct}>
        <Chips values={SMART_LADDER_PCTS} value={parts.ladderPct} format={(v) => `${v}%`} onPick={(v) => patch({ ladderPct: v })} />
      </Field>
      {parts.ladderPct > 0 ? (
        <>
          <Field label={w.field.steps}>
            <Chips values={LADDER_STEPS} value={parts.steps} onPick={(v) => patch({ steps: v })} />
          </Field>
          <div className={s.pairFields}>
            <PctField label={`${w.field.firstPct} −`} value={parts.firstPct} onChange={(v) => patch({ firstPct: v })} />
            <PctField label={`${w.field.lastPct} −`} value={parts.lastPct} onChange={(v) => patch({ lastPct: v })} />
          </div>
        </>
      ) : null}
      <Field label={w.field.everyHours}>
        <Chips values={EVERY_HOURS} value={draft.everyHours} format={(v) => w.every(v)} onPick={(v) => set({ everyHours: v })} />
      </Field>
      <Field label={w.field.buys}>
        <Chips values={[4, 5, 8, 12]} value={draft.buys} onPick={(v) => set({ buys: v })} />
      </Field>
      <Field label={w.field.ceilingPct}>
        <div className={s.chips} role="radiogroup">
          {CEILINGS.map((c) => (
            <button key={String(c)} type="button" role="radio" aria-checked={c === parts.ceilingPct} className={c === parts.ceilingPct ? s.chipOn : undefined} onClick={() => patch({ ceilingPct: c })}>
              {w.ceiling(c)}
            </button>
          ))}
        </div>
      </Field>
    </>
  );
}

function RangeHint({ lower, upper, current, w, lang }: Readonly<{ lower: number; upper: number; current: number; w: Words; lang: Lang }>) {
  const down = (1 - lower / current) * 100;
  const up = (upper / current - 1) * 100;
  return (
    <p className={s.hint}>
      {pct(-down, lang, true)} {w.below} · {pct(up, lang, true)} {w.above}
    </p>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      {children}
    </div>
  );
}

function Chips({ values, value, onPick, format = String }: Readonly<{ values: readonly number[]; value: number; onPick: (v: number) => void; format?: (v: number) => string }>) {
  return (
    <div className={s.chips} role="radiogroup">
      {values.map((v) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={v === value ? s.chipOn : undefined} onClick={() => onPick(v)}>
          {format(v)}
        </button>
      ))}
    </div>
  );
}

/** A price typed or nudged a percent at a time. */
function PriceField({ label, value, onChange, lang }: Readonly<{ label: string; value: number; onChange: (v: number) => void; lang: Lang }>) {
  const [text, setText] = useState<string | null>(null);
  const nudge = (k: number) => onChange(priceRound(value * k));
  return (
    <label className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <span className={s.stepper}>
        <button type="button" onClick={() => nudge(1 / 1.01)} aria-label="−1%">
          −
        </button>
        <input
          inputMode="decimal"
          value={text ?? price(value, lang).replace('$', '')}
          onFocus={() => setText(String(value))}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = Number((text ?? '').replace(',', '.').replace(/[^\d.]/g, ''));
            if (v > 0) onChange(priceRound(v));
            setText(null);
          }}
        />
        <button type="button" onClick={() => nudge(1.01)} aria-label="+1%">
          +
        </button>
      </span>
    </label>
  );
}

function PctField({ label, value, onChange }: Readonly<{ label: string; value: number; onChange: (v: number) => void }>) {
  const step = (d: number) => onChange(Math.max(0.5, Math.round((value + d) * 10) / 10));
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <span className={s.stepper}>
        <button type="button" onClick={() => step(-1)} aria-label="−1">
          −
        </button>
        <output>{`${value}%`}</output>
        <button type="button" onClick={() => step(1)} aria-label="+1">
          +
        </button>
      </span>
    </div>
  );
}
