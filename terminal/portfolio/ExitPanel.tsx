'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { sumText } from '@/terminal/earn/rows';
import { Action, CoinLogo, Figure, Icon, Kick, Panel, Quiet, Segment, Switch, Title } from '@/terminal/ui';
import { FEE } from '@/terminal/ui/words';
import { EXIT_TARGETS, PROTOCOL_NAME, collectLines, exitEstimate, exitLines, exitPicked, exitable, type ExitLine, type ExitTarget, type GroupId } from './all-view';
import { ALL } from './all-words';
import { feeText, solFigure } from './clean-view';
import { askedOf, buildExit, runExit, setExitIncluded, setExitTarget, useExit } from './exit';
import { amountFigure, receiveFigures, rentSol } from './exit-view';
import { Glyph } from './glyphs';
import { logoFor, logosFor } from './Groups';
import type { AllData } from './useAll';
import a from './all.module.css';
import p from './portfolio.module.css';

type W = ReturnType<typeof useWords<(typeof ALL)['en']>>;

const SECTIONS: readonly GroupId[] = ['pools', 'staking', 'lending'];

/** What the picked lines give before the engine built anything: one figure per coin. */
function estimateParts(picked: readonly ExitLine[], collect: boolean, target: ExitTarget, solUsd: number | null, lang: Lang): string[] {
  if (collect) {
    const usd = picked.reduce((sum, line) => sum + (line.row.earnedUsd ?? 0), 0);
    return usd > 0 ? [sumText(usd, lang)] : [];
  }
  const estimate = exitEstimate(picked, target, solUsd);
  if (!estimate) return [];
  return [estimate.sol !== null ? `${digits(solFigure(estimate.sol), lang)} SOL` : null, estimate.usdc !== null ? `${digits(amountFigure(estimate.usdc), lang)} USDC` : null].filter((part): part is string => part !== null);
}

function lineName(line: ExitLine, w: W): string {
  if (line.row.position.protocol === 'native-stake') return w.stake;
  return line.row.name ?? PROTOCOL_NAME[line.row.position.protocol] ?? '—';
}

function whyOf(line: Pick<ExitLine, 'reason' | 'partPct' | 'untilEpoch' | 'untilTime'>, w: W, lang: Lang): string {
  const date = line.untilTime ? new Date(line.untilTime) : null;
  return w.reason(line.reason, {
    pct: line.partPct,
    epoch: line.untilEpoch,
    date: date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
  });
}

/**
 * «Exit everything» and «Collect fees»: the coin to leave into — SOL, USDC or half and half — every position with a
 * switch on it, what stops a position in a person's words, and the whole of it in one line: what comes, the rent that
 * returns, the fee. The package is built while the person reads; the press asks the wallet once for all of it. A
 * position one step cannot take has no switch: it says why.
 */
export function ExitPanel({ data, onClose }: { data: AllData; onClose: () => void }) {
  const w = useWords(ALL);
  const fw = useWords(FEE);
  const lang = useLang();
  const ask = useExit((st) => st.ask);
  const target = useExit((st) => st.target);
  const off = useExit((st) => st.off);
  const review = useExit((st) => st.review);
  const phase = useExit((st) => st.phase);
  const outcome = useExit((st) => st.outcome);
  const declined = useExit((st) => st.declined);
  const asked = useExit((st) => st.asked);
  const only = useExit((st) => st.only);
  const changed = useExit((st) => st.changed);
  const refused = useExit((st) => st.refused);
  const unrouted = useExit((st) => st.unrouted);
  const [how, setHow] = useState(false);
  const howId = useId();
  const collect = ask?.mode === 'collect';
  const lines = useMemo(() => (collect ? collectLines(data.groups) : exitLines(data.groups, unrouted)), [collect, data.groups, unrouted]);
  const picked = useMemo(() => exitPicked(lines, off, only), [lines, off, only]);
  const key = picked.map((line) => line.id).join(',');

  // Built while the person reads, and again for every change of the choice — a position that came or went with a
  // re-read of the wallet among them: the package on screen is always the one for what stands now.
  useEffect(() => {
    if (!ask) return;
    const ids = key ? key.split(',') : [];
    if (phase === 'idle' || ((phase === 'ready' || phase === 'empty') && asked !== askedOf(ask.mode, target, ids))) void buildExit(ids);
  }, [ask, phase, key, target, asked]);

  if (!ask) return null;
  const ids = key ? key.split(',') : [];
  const working = phase === 'signing' || phase === 'sending';
  const title = collect ? w.collectTitle : w.exitTitle;
  // What comes, one figure per coin: the screen's estimate until the engine built the package — then only the engine's
  // own. An exit whose package brings nothing in the target's coins says «—», never the estimate. Collected fees come
  // in the pools' own coins, so their worth stands until the package names SOL or USDC.
  const built = review ? receiveFigures(review).map((figure) => digits(figure, lang)) : [];
  // The engine said there is nothing to build: «—», never the estimate beside a button that cannot be pressed.
  const figures = phase === 'empty' ? [] : review && !collect ? built : built.length ? built : estimateParts(picked, collect, target, data.answer?.solUsd ?? null, lang);
  const received = built.length ? built.join(' + ') : null;
  const rent = review ? rentSol(review) : null;
  const fee = review ? feeText(review.summary.feeBps) : null;
  const summary = review ? [rent !== null ? w.rentBack(digits(solFigure(rent), lang)) : null, fee ? fw.ryntra(digits(fee, lang)) : fw.none, review.summary.others ? w.others(review.summary.others) : null].filter(Boolean).join(' · ') : phase === 'building' ? w.afterBuild : null;
  const byId = new Map(lines.map((line) => [line.id, line]));
  // The coins Jupiter carries no route for now — found by the overview, or by the build — in one line, never as rows that sell.
  const noRouteIds = [...new Set([...lines.filter((line) => line.reason === 'NO_SWAP').map((line) => line.id), ...(review ? review.summary.left.filter((step) => step.reason === 'NO_ROUTE').map((step) => step.id) : [])])];
  const noRouteNames = noRouteIds.flatMap((id) => {
    const line = byId.get(id);
    return line ? [lineName(line, w)] : [];
  });
  // What the engine left out or only started — said once: a line that already says the same under its name is not repeated.
  const left = review ? review.summary.left.filter((step) => step.reason !== 'NO_ROUTE' && step.reason !== byId.get(step.id)?.reason) : [];
  const warn = phase === 'failed' ? w.failed : declined ? w.declined : refused ? w.notSent : changed ? w.changed : null;
  // Nothing to build because Jupiter takes none of the coins: the one line about them says why, «nothing to do» is not added.
  const status = phase === 'signing' ? w.approve : phase === 'sending' ? (collect ? w.collecting : w.exiting) : phase === 'empty' ? (noRouteIds.length ? null : w.nothing) : (warn ?? (phase === 'building' ? w.building : null));
  const on = new Set(picked.map((line) => line.id));

  return (
    <Panel tone="hi" pad="l" gap={14} label={title}>
      <div className={a.panelHead}>
        <Glyph name={collect ? 'collect' : 'exit'} className={a.headGlyph} />
        <Title as="h2">{title}</Title>
        <ExplainButton label={collect ? w.collectInfo : w.exitInfo} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />
        <button type="button" className={p.close} onClick={onClose} aria-label={w.closePanel} disabled={working}>
          <Icon name="close" size="s" />
        </button>
      </div>
      {how ? <ExplainBox id={howId}>{collect ? w.collectText : w.exitText}</ExplainBox> : null}

      {phase === 'done' && outcome ? (
        <div className={a.exitDone} role="status">
          <p className={a.exitLine}>{outcome === 'done' ? (received ? (collect ? w.collectDone : w.exitDone)(received) : w.donePlain) : outcome === 'unsure' ? w.unsure : outcome === 'part' ? w.part : w.none}</p>
          <Quiet full onClick={onClose}>
            {w.closePanel}
          </Quiet>
        </div>
      ) : (
        <>
          {collect ? null : <Segment<ExitTarget> label={w.into} value={target} onChange={setExitTarget} items={EXIT_TARGETS.map((id) => ({ id, label: id === 'SPLIT' ? w.half : id }))} />}
          <div className={a.exitFigure}>
            <Kick>{collect ? w.youCollect : w.youGet}</Kick>
            {figures.length ? figures.map((figure, at) => <Figure key={figure} value={`${at === 0 ? '≈' : '+'} ${figure}`} size={figures.length > 1 ? 'm' : 'l'} />) : <Figure value="—" />}
            {summary ? <p className={a.exitLine}>{summary}</p> : null}
          </div>
          <div className={a.exitLists}>
            {SECTIONS.map((section) => {
              const rows = lines.filter((line) => line.row.group === section && line.reason !== 'NO_SWAP');
              if (!rows.length) return null;
              return (
                <section key={section} className={a.exitGroup} aria-label={section === 'pools' ? w.pools : section === 'staking' ? w.staking : w.lendingGroup}>
                  <Kick>{section === 'pools' ? w.pools : section === 'staking' ? w.staking : w.lendingGroup}</Kick>
                  <ul className={a.exitRows}>
                    {rows.map((line) => {
                      const isOn = on.has(line.id);
                      const name = lineName(line, w);
                      const worth = collect ? line.row.earnedUsd : line.row.usd;
                      return (
                        <li key={line.id} className={a.exitRow} data-off={isOn ? undefined : ''}>
                          <span className={a.pair} aria-hidden="true">
                            {line.row.coins.map((coin) => (
                              <CoinLogo key={coin.mint} src={logoFor(coin.mint)} also={logosFor(coin.mint).slice(1)} symbol={coin.symbol ?? '?'} size="s" />
                            ))}
                          </span>
                          <span className={a.words}>
                            <span className={a.name}>{name}</span>
                            {line.can !== 'now' && line.reason ? <span className={a.exitWhy}>{whyOf(line, w, lang)}</span> : PROTOCOL_NAME[line.row.position.protocol] ? <span className={a.sub}>{PROTOCOL_NAME[line.row.position.protocol]}</span> : null}
                          </span>
                          <span className={a.exitValue}>{worth === null ? '—' : sumText(worth, lang)}</span>
                          {exitable(line) ? <Switch on={isOn} onChange={(next) => setExitIncluded(line.id, next)} label={w.include(name)} disabled={working} /> : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
          {noRouteIds.length ? (
            <p className={a.exitWhy} role="note">
              {w.noRoute(noRouteNames.join(', '), noRouteIds.length)}
            </p>
          ) : null}
          {left.length ? (
            <ul className={a.exitRows}>
              {left.map((step) => {
                const line = byId.get(step.id);
                return (
                  <li key={step.id} className={a.exitWhy}>
                    {`${line ? lineName(line, w) : '—'}: ${w.reason(step.reason, { epoch: step.untilEpoch, pct: line?.partPct })}`}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {status ? (
            <p className={a.exitStatus} role="status" data-tone={warn && !working && phase !== 'empty' ? 'warn' : undefined}>
              {status}
            </p>
          ) : null}
          {phase === 'failed' ? (
            <Quiet size="s" onClick={() => void buildExit(ids)}>
              {w.retry}
            </Quiet>
          ) : null}
          <Action size="m" disabled={!ids.length || working || phase === 'building' || phase === 'empty' || phase === 'failed'} busy={working} onClick={() => void runExit(ids)}>
            {collect ? w.collectNow : w.exitNow}
          </Action>
        </>
      )}
    </Panel>
  );
}
