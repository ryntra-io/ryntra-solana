'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Archetype } from '@/lib/ring/contract';
import type { FindingView, OrderDetail, OrderView, RunFeed } from '@/city/lib/arena/hack/view/contract';
import { hackStore, myAgent, useHack } from '@/city/lib/arena/hack/view/live';
import {
  boardOf,
  canConfirm,
  canReject,
  eventsOf,
  lookOf,
  myTake,
  phaseOf,
  runPhase,
  scopeName,
  severityOf,
  short,
  sortFindings,
  sortOrders,
  stepsOf,
  summaryOf,
  takesAgents,
  timeLeft,
  toneOf,
  turnsOf,
  type Look,
  type Phase,
  type RunPhase,
  type Step,
  type StepKind,
  type Tone,
} from '@/city/lib/arena/hack/view/model';
import type { Problem } from '@/city/lib/arena/hack/view/store';
import { HACK } from '@/city/lib/arena/hack/words';
import { dateText, num, useWords } from '@/city/lib/i18n/dict';
import { useReadiness } from '@/city/lib/quarter/account-live';
import { arenaStore, fighterOf, useArena } from '@/city/lib/ring/arena';
import { RING_OPEN } from '@/city/lib/ring/flag';
import { agentLabel } from '@/city/lib/ring/format';
import a from '../../ring/arena/arena.module.css';
import d from '../../ring/duel/duel.module.css';
import { AgentBody } from '../../ring/AgentBody';
import { BackGlyph, ChevronGlyph, InfoGlyph, StepGlyph } from './glyphs';
import { HACK_UI } from './words';
import s from './hack.module.css';

type W = (typeof HACK_UI)['en'];
type H = (typeof HACK)['en'];
type Severity = NonNullable<FindingView['severity']>;

/** A frame of the city's own scene behind an empty screen: the Arena's quarter at night (`/city/art`). */
const ART = '/city/art/district-ring-800.webp';

const label = (archetype: string) => agentLabel(archetype as Archetype);
const SEVERITY_WORD = { critical: 'severityCritical', high: 'severityHigh', medium: 'severityMedium', low: 'severityLow', info: 'severityInfo' } as const satisfies Record<Severity, keyof H>;
const PHASE_WORD = { draft: 'soon', soon: 'soon', open: 'open', paused: 'paused', closed: 'closed', settled: 'settled' } as const satisfies Record<Phase, keyof W>;
const RUN_WORD = { running: 'runFound', found: 'runFound', clean: 'runClean', stopped: 'runStopped', spent: 'runSpent', fault: 'runFault', void: 'runVoid' } as const satisfies Record<RunPhase, keyof W>;
/** The judge's verdicts and the sandbox's refusals a person may be told, in words. Anything else is not said. */
const VERDICT_WORD: Readonly<Record<string, 'judgePass' | 'judgeFail' | 'judgeReview' | 'judgeBlocked'>> = { PASS: 'judgePass', FAIL: 'judgeFail', NEEDS_REVIEW: 'judgeReview', BLOCKED: 'judgeBlocked' };
const REFUSAL_WORD: Readonly<Record<string, 'refusedTime' | 'refusedOutside' | 'refusedMove'>> = { ENGINE: 'refusedTime', NETWORK: 'refusedOutside', BAD_ATTEMPT: 'refusedMove', BAD_LIMITS: 'refusedMove', LIMITS: 'refusedMove' };
const STEP_WORD = {
  took: 'stepTookAttack',
  read: 'stepRead',
  build: 'stepBuild',
  broke: 'stepBroke',
  held: 'stepHeld',
  unclear: 'stepUnclear',
  filed: 'stepFiled',
  review: 'stepReview',
  refused: 'stepRefused',
  finding: 'stepFinding',
} as const satisfies Record<StepKind, keyof W>;

/** A clock for «time left» that moves on its own, twice a minute. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * A read again every so often while its screen stands — and is looked at: nothing is asked behind a hidden tab, nor of
 * a door that has answered «closed» (opening the window asks again).
 */
function useEvery(ms: number, read: () => void): void {
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const st = hackStore.getState();
      if (st.orders.status === 'closed' || st.order.status === 'closed' || st.board.status === 'closed') return;
      latest.current();
    }, ms);
    return () => clearInterval(timer);
  }, [ms]);
}

/** The person's standing for the main action: signed in, with an agent (the Ring's), or neither yet. */
function useYou() {
  const mine = useArena((st) => st.mine);
  const signing = useArena((st) => st.signing);
  const me = useHack((st) => st.me);
  const agent = useMemo(() => {
    const found = fighterOf(mine);
    return found ? { id: found.id, name: found.name, archetype: found.archetype } : null;
  }, [mine]);
  return { signedIn: mine.signedIn, agent, signing, me, reading: mine.status === 'idle' || mine.status === 'reading' };
}

const sevWord = (h: H, severity: Severity | null) => (severity ? h[SEVERITY_WORD[severity]] : h.finding);

function toneWord(f: FindingView, w: W, h: H): string {
  const tone = toneOf(f.status);
  if (tone === 'confirmed') return h.statusConfirmed;
  if (tone === 'duplicate') return h.statusDuplicate;
  if (tone === 'blocked') return h.statusBlocked;
  if (tone === 'review') return h.statusOnReview;
  if (f.sealed) return w.notCounted;
  return f.reason === 'OWNER_REJECTED' ? w.rejected : h.statusNotReproduced;
}

function leftWord(w: W, closesAt: number, now: number): string | null {
  const left = timeLeft(closesAt, now);
  if (!left) return null;
  return left.unit === 'd' ? w.leftD(left.n) : left.unit === 'h' ? w.leftH(left.n) : w.leftM(left.n);
}

function scopeWord(w: W, order: Pick<OrderView, 'scope'>): string {
  const name = scopeName(order.scope);
  if (name.kind === 'whole') return name.programs > 1 ? w.scopePrograms(name.programs) : w.scopeWhole;
  return [...name.names, ...(name.more ? [w.more(name.more)] : [])].join(' · ');
}

const when = (ms: number) => dateText(ms, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * The Arena's third door, Hack (CITY-227): a protocol's own contract, broken as a copy by agents of other owners — the
 * orders, an order's card, an agent's run live, a finding's card, the board. One main action a screen: take an order,
 * send your agent, stop the order (its owner), confirm a finding (its owner). The figures and the technical words live
 * behind «i». No money anywhere: the reward is a description until SOL rewards open.
 */
export default function HackWindow() {
  const screen = useHack((st) => st.screen);
  const readiness = useReadiness();

  // A sign-in anywhere in the city changes whose agent goes and what of a finding may be seen.
  useEffect(() => {
    if (readiness !== 'ready' && readiness !== 'wallet') return;
    if (RING_OPEN) void arenaStore.getState().readMine();
    const st = hackStore.getState();
    if (st.screen === 'order' || st.screen === 'run') void st.readOrder();
  }, [readiness]);

  return (
    <div className={`${d.framed} ${s.framed}`} data-hack-screen={screen}>
      {screen === 'orders' || screen === 'board' ? <Tabs /> : null}
      {screen === 'orders' ? <Orders /> : screen === 'board' ? <Board /> : screen === 'order' ? <OrderCard /> : screen === 'run' ? <RunLive /> : <FindingCard />}
    </div>
  );
}

function Tabs() {
  const w = useWords(HACK_UI);
  const h = useWords(HACK);
  const screen = useHack((st) => st.screen);
  return (
    <nav className={a.tabs} role="tablist" aria-label={h.hack}>
      {(['orders', 'board'] as const).map((id) => (
        <button key={id} type="button" role="tab" aria-selected={screen === id} className={[a.tab, screen === id && a.tabOn].filter(Boolean).join(' ')} onClick={() => hackStore.getState().setTab(id)} data-hack-tab={id}>
          {id === 'orders' ? w.tabOrders : h.leaderboard}
        </button>
      ))}
    </nav>
  );
}

/** The head of a screen inside an order: back, its name, and «i» where there is something behind it. */
function Bar({ title, info = true }: { title: string; info?: boolean }) {
  const w = useWords(HACK_UI);
  const details = useHack((st) => st.details);
  return (
    <nav className={s.bar}>
      <button type="button" className={s.barButton} aria-label={w.back} onClick={() => hackStore.getState().back()} data-hack-back="">
        <BackGlyph />
      </button>
      <b className={s.barTitle}>{title}</b>
      {info ? (
        <button type="button" className={[s.barButton, details && s.barOn].filter(Boolean).join(' ')} aria-label={details ? w.close : w.info} aria-expanded={details} onClick={() => hackStore.getState().toggleDetails()} data-hack-info="">
          <InfoGlyph />
        </button>
      ) : (
        <span className={s.barSpace} aria-hidden />
      )}
    </nav>
  );
}

/** The foot of a screen: what went wrong with its way on, then the one main action. */
function Foot({ problem, children, line }: { problem?: Problem | null; children?: ReactNode; line?: string }) {
  const w = useWords(HACK_UI);
  if (!problem && !children && !line) return null;
  return (
    <footer className={d.foot}>
      {problem ? (
        <p className={d.error} role="alert" data-hack-problem={problem}>
          {w[problem]}
          {problem === 'agentOff' && RING_OPEN ? (
            <button type="button" className={s.inline} onClick={() => hackStore.getState().makeAgent()}>
              {w.toHangar}
            </button>
          ) : null}
        </p>
      ) : null}
      {children ? <div className={d.actions}>{children}</div> : null}
      {line ? <p className={s.honest}>{line}</p> : null}
    </footer>
  );
}

/** An empty screen: the Arena's quarter at night, an attacker and a defender, one title, one way on. */
function Empty({ title, line, children }: { title: string; line?: string; children?: ReactNode }) {
  return (
    <div className={`${a.hero} ${s.empty}`} data-hack-empty="">
      <div className={s.emptyArt} style={{ backgroundImage: `url(${ART})` }} aria-hidden />
      <div className={a.heroGlow} aria-hidden />
      <div className={s.duo} aria-hidden>
        <AgentBody archetype="engineer" size={112} />
        <AgentBody archetype="tactician" size={112} dim />
      </div>
      <h3 className={a.heroTitle}>{title}</h3>
      {line ? <p className={a.heroLine}>{line}</p> : null}
      {children}
    </div>
  );
}

function Failed({ retry }: { retry: () => void }) {
  const w = useWords(HACK_UI);
  return (
    <div className={a.note}>
      <span>{w.readFailed}</span>
      <button type="button" className={a.retry} onClick={retry}>
        {w.tryAgain}
      </button>
    </div>
  );
}

type You = ReturnType<typeof useYou>;
type Ready = 'connect' | 'make' | null;

/** What a person who is not ready yet does first: the wallet, then the agent. Null once ready (or still reading). */
function readyOf(you: You): Ready {
  if (you.reading) return null;
  if (!you.signedIn) return 'connect';
  if (!you.agent && RING_OPEN) return 'make';
  return null;
}

function ReadyButton({ kind, you }: { kind: NonNullable<Ready>; you: You }) {
  const w = useWords(HACK_UI);
  const busy = useHack((st) => st.busy);
  if (kind === 'connect') {
    const signing = busy === 'signIn' || you.signing;
    return (
      <button type="button" className={d.primary} disabled={signing} aria-busy={signing} onClick={() => void hackStore.getState().signIn()} data-hack-primary="connect">
        {signing ? w.connecting : w.connect}
      </button>
    );
  }
  return (
    <button type="button" className={d.primary} onClick={() => hackStore.getState().makeAgent()} data-hack-primary="make">
      {w.makeAgent}
    </button>
  );
}

/* ------------------------------------------------------------------------------------------------ The orders */

function Orders() {
  const w = useWords(HACK_UI);
  const h = useWords(HACK);
  const orders = useHack((st) => st.orders);
  const you = useYou();
  const now = useNow();
  useEvery(20_000, () => void hackStore.getState().readOrders());

  const sorted = useMemo(() => sortOrders(orders.value.filter((o) => o.status !== 'draft'), now), [orders.value, now]);
  const { open } = summaryOf(sorted, now);
  const first = sorted.find((o) => takesAgents(o, now)) ?? null;

  if (orders.status === 'closed') return <Empty title={h.soon} />;
  if (orders.status === 'failed' && !sorted.length) return <Failed retry={() => void hackStore.getState().readOrders()} />;
  if (!sorted.length && orders.status !== 'read') return <div className={a.pane} aria-busy="true" />;
  if (!sorted.length) {
    // Not ready yet: the wallet, then the agent. Ready: the board, while the next order comes.
    const ready = readyOf(you);
    return (
      <Empty title={w.noOrders} line={w.noOrdersLine}>
        <div className={s.heroAction}>
          {ready ? (
            <ReadyButton kind={ready} you={you} />
          ) : you.reading ? null : (
            <button type="button" className={d.quiet} onClick={() => hackStore.getState().setTab('board')} data-hack-primary="board">
              {h.leaderboard}
            </button>
          )}
        </div>
      </Empty>
    );
  }

  return (
    <>
      <div className={`${d.feed} ${s.feed}`}>
        <header className={s.head}>
          <b className={s.big} data-hack-open={open}>
            {h.ordersOpen(open)}
          </b>
          <span className={s.reward}>
            {h.totalReward}
            <i className={s.coming}>{w.coming}</i>
          </span>
        </header>
        <ol className={s.list}>
          {sorted.map((order) => (
            <li key={order.id}>
              <OrderRow order={order} now={now} />
            </li>
          ))}
        </ol>
      </div>
      <Foot>
        {first ? (
          <button type="button" className={d.primary} onClick={() => hackStore.getState().openOrder(first.id)} data-hack-primary="take">
            {h.takeOrder}
          </button>
        ) : null}
      </Foot>
    </>
  );
}

function OrderRow({ order, now }: { order: OrderView; now: number }) {
  const w = useWords(HACK_UI);
  const phase = phaseOf(order, now);
  const left = phase === 'open' ? leftWord(w, order.closesAt, now) : null;
  return (
    <button type="button" className={s.row} data-phase={phase} onClick={() => hackStore.getState().openOrder(order.id)} data-hack-order={order.id}>
      <span className={s.rowMain}>
        <b>{order.title}</b>
        <span>{scopeWord(w, order)}</span>
      </span>
      <span className={s.state} data-phase={phase}>
        {left ?? w[PHASE_WORD[phase]]}
      </span>
      <span className={s.chevron}>
        <ChevronGlyph />
      </span>
    </button>
  );
}

/* --------------------------------------------------------------------------------------------- An order's card */

function OrderCard() {
  const w = useWords(HACK_UI);
  const read = useHack((st) => st.order);
  const id = useHack((st) => st.orderId);
  useEvery(10_000, () => void hackStore.getState().readOrder());

  const title = read.value?.order.title ?? '';
  if (read.status === 'read' && !read.value) {
    return (
      <>
        <Bar title="" info={false} />
        <Empty title={w.goneTitle}>
          <button type="button" className={`${d.quiet} ${s.heroAction}`} onClick={() => hackStore.getState().setTab('orders')}>
            {w.back}
          </button>
        </Empty>
      </>
    );
  }
  if (!read.value || read.value.order.id !== id) {
    return (
      <>
        <Bar title={title} info={false} />
        {read.status === 'failed' ? <Failed retry={() => void hackStore.getState().readOrder()} /> : <div className={a.pane} aria-busy="true" />}
      </>
    );
  }
  return <OrderBody detail={read.value} />;
}

function OrderBody({ detail }: { detail: OrderDetail }) {
  const w = useWords(HACK_UI);
  const h = useWords(HACK);
  const you = useYou();
  const now = useNow();
  const details = useHack((st) => st.details);
  const role = useHack((st) => st.role);
  const busy = useHack((st) => st.busy);
  const problem = useHack((st) => st.problem);
  const { order } = detail;
  const phase = phaseOf(order, now);
  const owner = !!you.me && you.me === order.protocol;
  const mineOn = myTake(detail, you.agent);
  const left = phase === 'open' ? leftWord(w, order.closesAt, now) : null;
  const findings = sortFindings(detail.findings, owner);

  let primary: ReactNode = null;
  let line: string | undefined;
  if (owner && (phase === 'open' || phase === 'paused')) {
    const move = phase === 'open' ? 'pause' : 'resume';
    primary = (
      <button type="button" className={d.primary} disabled={!!busy} aria-busy={busy === move} onClick={() => void hackStore.getState().moveOrder(move)} data-hack-primary={move}>
        {busy === 'pause' ? w.stopping : move === 'pause' ? h.stop : w.resume}
      </button>
    );
  } else if (mineOn && you.agent) {
    const agent = you.agent.id;
    primary = (
      <button type="button" className={d.primary} onClick={() => hackStore.getState().watch(agent)} data-hack-primary="watch">
        {h.watch}
      </button>
    );
  } else if (phase === 'open' && !owner) {
    const ready = readyOf(you);
    if (ready) primary = <ReadyButton kind={ready} you={you} />;
    else if (you.agent) {
      primary = (
        <button type="button" className={d.primary} disabled={!!busy} aria-busy={busy === 'take'} onClick={() => void hackStore.getState().sendAgent()} data-hack-primary="send">
          {busy === 'take' ? w.sending : h.sendAgent}
        </button>
      );
      line = h.targetIsCopy;
    }
  }
  const choosing = phase === 'open' && !owner && !mineOn && !!you.agent;

  return (
    <>
      <Bar title={order.title} />
      <div className={`${d.feed} ${s.feed}`}>
        <section className={s.card}>
          <div className={s.chips}>
            {owner ? <span className={`${s.chip} ${s.chipYours}`}>{w.yourOrder}</span> : null}
            <span className={s.state} data-phase={phase}>
              {left ?? w[PHASE_WORD[phase]]}
            </span>
            <span className={s.chip}>{scopeWord(w, order)}</span>
          </div>
          <dl className={s.facts}>
            <div>
              <dt>{h.reward}</dt>
              <dd>
                {order.reward.note ?? w.rewardRating}
                <i className={s.coming}>{`${w.rewardSol} · ${w.coming}`}</i>
              </dd>
            </div>
          </dl>
          {mineOn ? <p className={s.mineOn}>{w.yourAgentOn}</p> : null}
        </section>

        {details ? (
          <>
            <OrderDetails order={order} />
            <p className={s.fine}>{`${h.targetIsCopy} ${h.feeLine}`}</p>
          </>
        ) : null}

        {choosing ? (
          <div className={s.roles} role="radiogroup" aria-label={h.sendAgent}>
            {(['attacker', 'defender'] as const).map((id) => (
              <button key={id} type="button" role="radio" aria-checked={role === id} className={[s.role, role === id && s.roleOn].filter(Boolean).join(' ')} disabled={!!busy} onClick={() => hackStore.getState().setRole(id)} data-hack-role={id}>
                {id === 'attacker' ? h.attacker : h.defender}
              </button>
            ))}
          </div>
        ) : null}

        <Agents detail={detail} />
        <section className={s.section} aria-label={w.findings}>
          <h3 className={s.sectionTitle}>{w.findings}</h3>
          {findings.length ? (
            <ol className={s.list}>
              {findings.map((f) => (
                <li key={f.id}>
                  <FindingRow finding={f} detail={detail} />
                </li>
              ))}
            </ol>
          ) : (
            <p className={s.quietLine}>{w.noFindings}</p>
          )}
        </section>
      </div>
      <Foot problem={problem} line={line}>
        {primary}
      </Foot>
    </>
  );
}

function OrderDetails({ order }: { order: OrderView }) {
  const w = useWords(HACK_UI);
  const h = useWords(HACK);
  const { scope, target } = order;
  return (
    <dl className={`${d.details} ${s.details}`} data-hack-details="">
      <div>
        <dt>{w.instructions}</dt>
        <dd>{scope.instructions?.length ? scope.instructions.join(' · ') : w.everything}</dd>
      </div>
      <div>
        <dt>{w.programs}</dt>
        <dd className={d.mono}>{scope.programs.map((p) => short(p)).join(' · ')}</dd>
      </div>
      {scope.excluded?.length ? (
        <div>
          <dt>{w.outOfBounds}</dt>
          <dd>{scope.excluded.join(' · ')}</dd>
        </div>
      ) : null}
      <div>
        <dt>{w.copy}</dt>
        <dd>{target.kind === 'fork' ? w.forkAt(num(target.slot)) : w.devnetCopy}</dd>
      </div>
      <div>
        <dt>{h.permission}</dt>
        <dd>{w.signedBy(short(order.permission.signature.signer))}</dd>
      </div>
      <div>
        <dt>{w.window}</dt>
        <dd>{w.span(when(order.opensAt), when(order.closesAt))}</dd>
      </div>
    </dl>
  );
}

function Agents({ detail }: { detail: OrderDetail }) {
  const w = useWords(HACK_UI);
  const h = useWords(HACK);
  const you = useYou();
  const takes = [...detail.takes].sort((x, y) => Number(y.hunter === you.agent?.id) - Number(x.hunter === you.agent?.id) || x.takenAt - y.takenAt);
  return (
    <section className={s.section} aria-label={w.onIt}>
      <h3 className={s.sectionTitle}>{w.onIt}</h3>
      {takes.length ? (
        <ol className={s.agents}>
          {takes.map((t) => {
            const look = lookOf(t.hunter, t.role, you.agent, label);
            return (
              <li key={t.hunter}>
                <button type="button" className={[s.agent, look.mine && s.agentMine].filter(Boolean).join(' ')} aria-label={`${h.watch} · ${look.name}`} onClick={() => hackStore.getState().watch(t.hunter)} data-hack-agent={t.hunter}>
                  <AgentBody archetype={look.archetype as Archetype} size={44} />
                  <span className={s.agentWords}>
                    <b>
                      {look.name}
                      {look.mine ? <i className={d.tag}>{w.you}</i> : null}
                    </b>
                    <span data-role={t.role}>{t.role === 'attacker' ? h.attacker : h.defender}</span>
                  </span>
                  <span className={s.watch}>{h.watch}</span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={s.quietLine}>{w.noAgents}</p>
      )}
    </section>
  );
}

function FindingRow({ finding, detail }: { finding: FindingView; detail: OrderDetail }) {
  const w = useWords(HACK_UI);
  const h = useWords(HACK);
  const you = useYou();
  const take = detail.takes.find((t) => t.hunter === finding.hunter);
  const look = lookOf(finding.hunter, take?.role ?? 'attacker', you.agent, label);
  const severity = severityOf(finding);
  const tone = toneOf(finding.status);
  return (
    <button type="button" className={s.row} onClick={() => hackStore.getState().openFinding(finding.id)} data-hack-finding={finding.id}>
      <span className={s.sev} data-severity={severity ?? 'none'}>
        {sevWord(h, severity)}
      </span>
      <span className={s.rowMain}>
        <b>{finding.title ?? look.name}</b>
        <span>{finding.title ? look.name : when(finding.submittedAt)}</span>
      </span>
      <span className={s.tone} data-tone={tone}>
        {toneWord(finding, w, h)}
      </span>
      <span className={s.chevron}>
        <ChevronGlyph />
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------------------------------------- The run, live */

function RunLive() {
  const w = useWords(HACK_UI);
  const h = useWords(HACK);
  const you = useYou();
  const hunter = useHack((st) => st.hunter) ?? '';
  const run = useHack((st) => st.run);
  const detail = useHack((st) => st.order.value);
  const details = useHack((st) => st.details);
  const busy = useHack((st) => st.busy);
  const problem = useHack((st) => st.problem);
  const now = useNow();
  const feed: RunFeed | null = run.value && run.value.hunter === hunter ? run.value : null;
  const live = feed?.status === 'running';
  useEvery(live || run.status === 'idle' || run.status === 'reading' ? 1_500 : 10_000, () => void hackStore.getState().readRun());

  const take = detail?.takes.find((t) => t.hunter === hunter) ?? null;
  const role = feed?.role ?? take?.role ?? null;
  const look: Look = lookOf(hunter, role, you.agent ?? myAgent(), label);
  const steps = useMemo(() => (feed ? stepsOf(feed.history) : eventsOf(detail, hunter)), [feed, detail, hunter]);
  const phase = feed ? runPhase(feed) : null;
  const turns = feed ? turnsOf(feed) : null;
  const order = detail?.order ?? null;
  const owner = !!order && !!you.me && you.me === order.protocol;
  const orderPhase = order ? phaseOf(order, now) : null;
  const filed = feed?.finding ?? null;

  let primary: ReactNode = null;
  if (owner && orderPhase === 'open') {
    primary = (
      <button type="button" className={d.primary} disabled={!!busy} aria-busy={busy === 'pause'} onClick={() => void hackStore.getState().moveOrder('pause')} data-hack-primary="pause">
        {busy === 'pause' ? w.stopping : h.stop}
      </button>
    );
  } else if (filed) {
    primary = (
      <button type="button" className={d.primary} onClick={() => hackStore.getState().openFinding(filed)} data-hack-primary="finding">
        {w.seeFinding}
      </button>
    );
  } else if (feed && !live) {
    primary = (
      <button type="button" className={d.quiet} onClick={() => hackStore.getState().back()} data-hack-primary="order">
        {w.toOrder}
      </button>
    );
  }

  const bodyState = live ? 'thinking' : phase === 'found' ? 'acting' : phase ? 'done' : 'ready';
  return (
    <>
      <Bar title={order?.title ?? h.hack} info={!!feed} />
      <div className={`${d.feed} ${s.feed}`}>
        <section className={s.runHead} data-run={phase ?? 'record'}>
          <div className={s.runBody}>
            <div className={d.halo} aria-hidden />
            <AgentBody archetype={look.archetype as Archetype} state={bodyState} size={112} />
          </div>
          <div className={s.runWords}>
            <b className={s.runName}>
              {look.name}
              {look.mine ? <i className={d.tag}>{w.you}</i> : null}
            </b>
            {role ? <span data-role={role}>{role === 'attacker' ? h.attacker : h.defender}</span> : null}
            {feed && turns ? (
              <span className={s.runState} data-run={phase ?? ''}>
                {live ? <i className={a.liveDot}>{w.live}</i> : null}
                {live ? h.stepOf(turns.n, turns.max) : w[RUN_WORD[phase ?? 'void']]}
              </span>
            ) : null}
          </div>
        </section>

        {details && feed ? (
          <dl className={`${d.details} ${s.details}`} data-hack-details="">
            <div>
              <dt>{w.window}</dt>
              <dd>{w.turnsCap(feed.maxTurns)}</dd>
            </div>
            <div>
              <dt>{w.copy}</dt>
              <dd>{order?.target.kind === 'fork' ? w.forkAt(num(order.target.slot)) : w.devnetCopy}</dd>
            </div>
          </dl>
        ) : null}
        {details && feed ? <p className={s.fine}>{h.targetIsCopy}</p> : null}

        <ol className={s.steps} aria-live="polite">
          {!steps.length && run.status !== 'failed' ? (
            <li className={`${d.pending} ${s.pending}`}>
              <span>{w.firstStep}</span>
            </li>
          ) : null}
          {[...steps].reverse().map((step) => (
            <li key={step.n}>
              <StepRow step={step} />
            </li>
          ))}
        </ol>
      </div>
      <Foot problem={problem}>{primary}</Foot>
    </>
  );
}

function StepRow({ step }: { step: Step }) {
  const w = useWords(HACK_UI);
  const h = useWords(HACK);
  const [open, setOpen] = useState(false);
  const lines = factLines(step, w, h);
  const word = step.kind === 'took' && step.role === 'defender' ? w.stepTookDefend : w[STEP_WORD[step.kind]];
  const finding = step.finding;
  const act = finding ? () => hackStore.getState().openFinding(finding) : lines.length ? () => setOpen(!open) : undefined;
  return (
    <button type="button" className={s.step} data-step={step.kind} aria-expanded={finding ? undefined : lines.length ? open : undefined} disabled={!act} onClick={act}>
      <span className={s.stepGlyph}>
        <StepGlyph kind={step.kind} />
      </span>
      <span className={s.stepWords}>
        <b>{word}</b>
        {step.kind === 'finding' ? (
          <span className={s.stepChips}>
            <i className={s.sev} data-severity={step.severity ?? 'none'}>
              {sevWord(h, step.severity ?? null)}
            </i>
            <i className={s.tone} data-tone={step.tone}>
              {toneTitle(step.tone ?? 'review', w, h)}
            </i>
          </span>
        ) : null}
        {open && lines.length ? <span className={s.stepFacts}>{lines.join(' · ')}</span> : null}
      </span>
      <span className={s.stepNo}>{step.n}</span>
    </button>
  );
}

function toneTitle(tone: Tone, w: W, h: H): string {
  return tone === 'confirmed' ? h.statusConfirmed : tone === 'duplicate' ? h.statusDuplicate : tone === 'blocked' ? h.statusBlocked : tone === 'missed' ? w.notCounted : h.statusOnReview;
}

/** What «i» on a step says: its figures, in the language on screen. */
function factLines(step: Step, w: W, h: H): string[] {
  const f = step.facts;
  const lines: string[] = [];
  if (typeof f.size === 'number') lines.push(`${w.size} ${w.bytes(f.size)}`);
  if (typeof f.bytes === 'number') lines.push(w.bytes(f.bytes));
  if (typeof f.steps === 'number') lines.push(w.runSteps(f.steps));
  if (typeof f.units === 'number') lines.push(w.units(num(f.units)));
  if (typeof f.severity === 'string' && f.severity in SEVERITY_WORD) lines.push(h[SEVERITY_WORD[f.severity as Severity]]);
  // The judge's word and a refusal's reason in the person's language — never the harness's own codes.
  const judged = typeof f.verdict === 'string' ? VERDICT_WORD[f.verdict] : undefined;
  if (judged) lines.push(`${w.judge}: ${w[judged]}`);
  if (typeof f.journal === 'string' && f.journal !== '—') lines.push(`${w.journal} ${f.journal}`);
  const refused = typeof f.why === 'string' ? REFUSAL_WORD[f.why.split(':')[0]!.trim()] : undefined;
  if (refused) lines.push(w[refused]);
  return lines;
}

/* ------------------------------------------------------------------------------------------- A finding's card */

function FindingCard() {
  const read = useHack((st) => st.finding);
  const id = useHack((st) => st.findingId);
  const w = useWords(HACK_UI);
  if (read.status === 'read' && !read.value) {
    return (
      <>
        <Bar title="" info={false} />
        <Empty title={w.goneTitle}>
          <button type="button" className={`${d.quiet} ${s.heroAction}`} onClick={() => hackStore.getState().back()}>
            {w.back}
          </button>
        </Empty>
      </>
    );
  }
  if (!read.value || read.value.id !== id) {
    return (
      <>
        <Bar title="" info={false} />
        {read.status === 'failed' ? <Failed retry={() => void hackStore.getState().readFinding()} /> : <div className={a.pane} aria-busy="true" />}
      </>
    );
  }
  return <FindingBody finding={read.value} />;
}

function FindingBody({ finding }: { finding: FindingView }) {
  const w = useWords(HACK_UI);
  const h = useWords(HACK);
  const you = useYou();
  const detail = useHack((st) => (st.order.value?.order.id === finding.order ? st.order.value : null));
  const details = useHack((st) => st.details);
  const busy = useHack((st) => st.busy);
  const problem = useHack((st) => st.problem);
  const take = detail?.takes.find((t) => t.hunter === finding.hunter);
  const look = lookOf(finding.hunter, take?.role ?? 'attacker', you.agent, label);
  const severity = severityOf(finding);
  const tone = toneOf(finding.status);
  const order = detail?.order ?? null;
  const confirm = !!order && canConfirm(finding, order, you.me);
  const reject = !!order && canReject(finding, order, you.me);

  return (
    <>
      <Bar title={h.finding} info={!finding.sealed} />
      <div className={`${d.feed} ${s.feed}`}>
        <section className={s.findingHero} data-severity={severity ?? 'none'}>
          <span className={`${s.sev} ${s.sevBig}`} data-severity={severity ?? 'none'}>
            {sevWord(h, severity)}
          </span>
          <b className={s.findingTitle}>{finding.title ?? h.finding}</b>
          <span className={s.tone} data-tone={tone}>
            {toneWord(finding, w, h)}
          </span>
          {finding.sealed ? <p className={s.quietLine}>{w.sealedLine}</p> : null}
        </section>

        <button type="button" className={s.by} onClick={() => hackStore.getState().watch(finding.hunter)} data-hack-agent={finding.hunter}>
          <AgentBody archetype={look.archetype as Archetype} size={52} />
          <span className={s.agentWords}>
            <span>{w.foundBy}</span>
            <b>
              {look.name}
              {look.mine ? <i className={d.tag}>{w.you}</i> : null}
            </b>
          </span>
          <span className={s.when}>{when(finding.submittedAt)}</span>
        </button>

        {details && !finding.sealed ? (
          <dl className={`${d.details} ${s.details}`} data-hack-details="">
            <div>
              <dt>{w.replay}</dt>
              <dd className={d.mono}>{short(finding.logHash ?? null, 10, 6)}</dd>
            </div>
            {finding.vulnClass ? (
              <div>
                <dt>{w.vulnClass}</dt>
                <dd>{finding.vulnClass}</dd>
              </div>
            ) : null}
            {finding.target ? (
              <div>
                <dt>{w.where}</dt>
                <dd className={d.mono}>{[short(finding.target.program), finding.target.instruction].filter(Boolean).join(' · ')}</dd>
              </div>
            ) : null}
            {finding.claimed ? (
              <div>
                <dt>{w.claimed}</dt>
                <dd>{sevWord(h, finding.claimed)}</dd>
              </div>
            ) : null}
            <div>
              <dt>{w.countsAt}</dt>
              <dd>{finding.severity ? sevWord(h, finding.severity) : '—'}</dd>
            </div>
            {finding.detail ? (
              <div className={s.wide}>
                <dt>{w.judge}</dt>
                <dd>{finding.detail}</dd>
              </div>
            ) : null}
            {finding.resolvedBy ? (
              <div>
                <dt>{w.decidedBy}</dt>
                <dd className={d.mono}>{short(finding.resolvedBy)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
      <Foot problem={problem}>
        {reject ? (
          <button type="button" className={d.quiet} disabled={!!busy} aria-busy={busy === 'reject'} onClick={() => void hackStore.getState().resolve('reject')} data-hack-primary="reject">
            {w.reject}
          </button>
        ) : null}
        {confirm ? (
          <button type="button" className={d.primary} disabled={!!busy} aria-busy={busy === 'confirm'} onClick={() => void hackStore.getState().resolve('confirm')} data-hack-primary="confirm">
            {h.confirm}
          </button>
        ) : null}
      </Foot>
    </>
  );
}

/* ----------------------------------------------------------------------------------------------- The board */

function Board() {
  const w = useWords(HACK_UI);
  const h = useWords(HACK);
  const board = useHack((st) => st.board);
  const side = useHack((st) => st.side);
  const you = useYou();
  const now = useNow();
  const rows = useMemo(() => boardOf(board.value, side, now), [board.value, side, now]);

  const toOrders = (
    <button type="button" className={d.primary} onClick={() => hackStore.getState().setTab('orders')} data-hack-primary="orders">
      {h.takeOrder}
    </button>
  );

  return (
    <>
      <div className={d.formats}>
        <div className={a.pills} role="tablist" aria-label={h.leaderboard}>
          {(['attacker', 'defender'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={side === id} className={`${d.format} ${side === id ? d.formatOn : ''}`} onClick={() => hackStore.getState().setSide(id)} data-hack-side={id}>
              {id === 'attacker' ? w.attackers : w.defenders}
            </button>
          ))}
        </div>
      </div>
      {board.status === 'closed' ? (
        <Empty title={h.soon} />
      ) : board.status === 'failed' && !rows.length ? (
        <Failed retry={() => void hackStore.getState().readBoard()} />
      ) : board.status === 'read' && !rows.length ? (
        <Empty title={w.boardEmpty}>
          <div className={s.heroAction}>{toOrders}</div>
        </Empty>
      ) : !rows.length ? (
        <div className={a.pane} aria-busy="true" />
      ) : (
        <>
          <div className={`${d.feed} ${a.boardFeed}`}>
            <ol className={a.board} aria-label={h.leaderboard}>
              {rows.map((row) => {
                const look = lookOf(row.hunter, row.role, you.agent, label);
                return (
                  <li key={row.hunter} className={[a.row, look.mine && a.rowMine, row.rank <= 3 && a[`podium${row.rank}`]].filter(Boolean).join(' ')} data-hack-board-row={row.rank}>
                    <span className={a.rank}>{num(row.rank)}</span>
                    <span className={a.rowBody}>
                      <AgentBody archetype={look.archetype as Archetype} size={40} />
                    </span>
                    <span className={a.rowWords}>
                      <b>
                        {look.name}
                        {look.mine ? <i className={d.tag}>{w.you}</i> : null}
                      </b>
                      <span>{row.role === 'attacker' ? [h.findingsCount(row.count), row.best ? sevWord(h, row.best) : null].filter(Boolean).join(' · ') : w.held(row.score, row.count)}</span>
                    </span>
                    <span className={a.rowScore}>
                      <b>{row.role === 'attacker' ? w.points(row.score) : num(row.score)}</b>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
          <Foot>{toOrders}</Foot>
        </>
      )}
    </>
  );
}
