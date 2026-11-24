'use client';

import { type ReactNode } from 'react';
import { planLine, planOfText } from '@/city/lib/autopilot/plan-line';
import { AUTOPILOT } from '@/city/lib/autopilot/words';
import { agentFeeFigures } from '@/city/lib/bots/agent-fee';
import { MANDATE_NET, useMandate } from '@/city/lib/bots/mandate';
import { fundsFor, shortOfFunds, solAbout } from '@/city/lib/crew/funds';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { budgetTotal } from '@/lib/mandate/budget';
import { openPanel } from '@/terminal/shell/frame';
import { NARROW } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { Action, Chip, CoinLogo, Info, Kick, Panel, Quiet, Tile, Title } from '@/terminal/ui';
import { ExitLine, sellsOnItsOwn } from '../Exit';
import { exitRulesOf } from '@/lib/bots/money/gates';
import { budgetText, solPlain } from '../figures';
import { RoleBadge } from '../glyphs';
import { ConnectOnly, Limit } from '../Limit';
import { AGENTS } from '../words';
import a from '../agents.module.css';
import { feesOf, lineOf, liveOpen, signedSol, SIGN_ISSUES, toneOf, type PaperIssue } from './model';
import { budgetOfView, endPaperWeek, goLiveFromPaper, PAPER_OPEN, usePaperWeek } from './store';
import { PAPER } from './words';
import p from './paper.module.css';

/**
 * The agent's week on paper: the bot trading on paper at live prices by the
 * very rules and budget it keeps with money; its result after every fee beside plain holding of the same coin; and one
 * action — «Start with money», the same plan and budget, one signature in her wallet. «Paper» stands on the card's head
 * and on every paper figure, so a paper result never reads as money. How it works stands behind the «i».
 *
 * Where the deployment lets the agent sell, the line of its own exit stands above «Start with money», as on the
 * new agent's ticket — and the signature carries the sale only when that line was shown (`sells`, one figure for both).
 */

function connect(): void {
  if (window.matchMedia(NARROW).matches) openPanel('sheet');
  connectWallet();
}

/** The «i»: how the paper week works, what it counts, what it is not. */
function PaperHow() {
  const w = useWords(PAPER);
  const fee = agentFeeFigures(useLang());
  return (
    <Info label={w.howLabel}>
      <span className={a.facts}>
        <span>{w.howRules}</span>
        <span>{w.howSafe}</span>
        <span>{w.howFees(fee.low, fee.high)}</span>
        <span>{w.howHold}</span>
        <span>{w.howLive}</span>
        <span>{w.howPicture}</span>
      </span>
    </Info>
  );
}

/**
 * A refusal of the route, in one line where the practice's button stands — and, while the wallet is asked for the one
 * signature a start needs, that line, with why behind the «i».
 */
export function PaperNote() {
  const w = useWords(PAPER);
  const issue = usePaperWeek((st) => st.issue);
  const busy = usePaperWeek((st) => st.busy);
  if (!PAPER_OPEN) return null;
  const words: Readonly<Record<PaperIssue, string>> = {
    closed: w.closed,
    price: w.noPrice,
    pair: w.pair,
    full: w.full,
    limited: w.limited,
    wallet: w.wallet,
    declined: w.declined,
    proof: w.proof,
    network: w.network,
  };
  const working = busy === 'start' || busy === 'prove';
  const text = busy === 'prove' ? w.signing : busy === 'start' ? w.starting : issue ? words[issue] : null;
  if (!text) return null;
  const sign = busy === 'prove' || (!working && issue !== null && SIGN_ISSUES.has(issue));
  return (
    <p className={`${a.note} ${p.line}`} data-tone={issue && !working ? 'warn' : undefined} data-paper-note={busy === 'prove' ? 'sign' : (issue ?? 'busy')} role="status">
      <span>{text}</span>
      {sign ? <Info label={w.signLabel}>{w.signWhy}</Info> : null}
    </p>
  );
}

export function PaperWeek({ note, onAct }: { note: ReactNode; onAct: () => void }) {
  const w = useWords(PAPER);
  const aw = useWords(AGENTS);
  const lang = useLang();
  const view = usePaperWeek((st) => st.view);
  const busy = usePaperWeek((st) => st.busy);
  const signing = useMandate((st) => st.busy === 'enable');
  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const spendable = useWallet((st) => (st.holdingsRead === 'ready' && st.holdings && st.holdings.owner === owner ? (st.holdings.sol?.spendableRaw ?? null) : null));
  if (!view) return null;
  const budget = budgetOfView(view);
  const short = MANDATE_NET === 'mainnet' && Boolean(owner) && shortOfFunds(spendable, budget);
  const plan = planLine(planOfText(view.plan), AUTOPILOT[lang], lang);
  const coin = view.symbol ?? view.coin.slice(0, 4);
  const line = lineOf(view);
  const fees = feesOf(view);
  /* The wallet asked for the proof before the money's signature counts as pressing too: the button never wakes up mid-way. */
  const pressing = busy === 'live' || busy === 'prove' || signing;
  // The agent's own exit — shown in one line before the signature, and signed only when shown.
  const sells = liveOpen(view) && sellsOnItsOwn(view.coin);
  return (
    <Panel tone="hi" pad="l" gap={16} label={w.kick}>
      <div className={a.asideHead}>
        <RoleBadge role="trader" on />
        <div className={a.asideWords}>
          <Kick>{w.kick}</Kick>
          <Title as="h2" className={a.asideTitle}>
            {aw.trader}
          </Title>
          <span className={a.job}>{w.dayOf(digits(String(view.day), lang), digits(String(view.weekDays), lang))}</span>
        </div>
        <span className={p.mark} data-paper-mark="">
          <Chip dot>{w.mark}</Chip>
        </span>
        <PaperHow />
      </div>
      <div className={a.pills}>
        <span className={a.pill}>
          <CoinLogo src={`/api/icon/${view.coin}`} symbol={coin} size="s" />
          {coin}
        </span>
      </div>
      {plan ? <span className={a.plan}>{plan}</span> : null}
      <div className={p.result} data-paper-result="">
        <Kick>{w.result}</Kick>
        <div className={a.tiles}>
          <Tile label={w.agent} value={signedSol(view.net.netRaw, lang)} unit="SOL" tone={toneOf(view.net.netRaw)} />
          <Tile label={w.hold(coin)} value={signedSol(view.net.holdRaw, lang)} unit="SOL" tone={toneOf(view.net.holdRaw)} />
        </div>
        <span className={a.cap}>
          {w.trades(digits(String(view.trades), lang))}
          {fees !== null && view.trades > 0 ? ` · ${w.fees(solPlain(fees, lang))}` : ''}
        </span>
      </div>
      {line ? <span className={a.cap}>{w[line]}</span> : null}
      <Limit budget={budget} />
      {sells ? <ExitLine rules={exitRulesOf(planOfText(view.plan))} /> : null}
      {short ? (
        <p className={a.note} data-tone="warn" role="status">
          {aw.needSol(digits(solAbout(fundsFor(budget).about), lang))}
        </p>
      ) : null}
      {note}
      <PaperNote />
      {liveOpen(view) ? (
        connection ? (
          <Action
            busy={pressing}
            disabled={pressing || short}
            onClick={() => {
              onAct();
              void goLiveFromPaper({ wallet: connection.wallet, owner: connection.address }, { exit: sells });
            }}
            data-paper-live=""
          >
            {pressing ? aw.signing : w.live(budgetText(budgetTotal(budget), lang))}
          </Action>
        ) : (
          <>
            <Action onClick={connect} data-agent-connect="">
              {aw.connectSign}
            </Action>
            <ConnectOnly />
          </>
        )
      ) : null}
      <Quiet full disabled={busy !== null} onClick={() => void endPaperWeek()} data-paper-end="">
        {w.end}
      </Quiet>
    </Panel>
  );
}
