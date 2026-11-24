'use client';

/* eslint-disable @next/next/no-img-element -- the card is the server's own picture of the trade, drawn once and kept. */
import { useEffect } from 'react';
import { tapFreeze, useControls, type ControlNote } from '@/city/lib/autopilot/controls';
import { useAgents } from '@/city/lib/bots/agents';
import { MANDATE_NET } from '@/city/lib/bots/mandate';
import { dateText, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { solPlain } from '@/lib/agent-drive/figures';
import { resultShown, usdShown } from '@/terminal/agents/figures';
import { RoleBadge } from '@/terminal/agents/glyphs';
import { workerPath, type MineRow, type RowState } from '@/terminal/agents/rows';
import { useSignOnce } from '@/terminal/agents/SignOnce';
import { useAgentsData } from '@/terminal/agents/useAgentsData';
import { AGENTS } from '@/terminal/agents/words';
import { connectWallet } from '@/terminal/shell/Wallet';
import { Action, ActionBody, Chip, CoinLogo, Kick, Page, PageHead, Panel, Quiet, QuietLink, Tile, Title } from '@/terminal/ui';
import { shareCard } from './DriveWeek';
import { DRIVE } from './words';
import d from './drive.module.css';

const WHEN: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };

type W = ReturnType<typeof useWords<(typeof DRIVE)['en']>>;

function stateWord(w: W, state: RowState | 'done'): string {
  return state === 'frozen' || state === 'stopped' ? w.stopped : state === 'paused' ? w.paused : state === 'done' ? w.done : w.working;
}

function noteWord(w: W, note: ControlNote): string | null {
  return note === 'frozen' ? w.stoppedNote : note === 'resumed' ? w.resumedNote : note === 'walletNo' ? w.walletNo : note === 'refused' ? w.refused : note === 'unreachable' ? w.unreachable : null;
}

/** The closed trade's card beside the agent: the server's own picture, and «Share on X». */
function CardSide({ id }: { id: string }) {
  const w = useWords(DRIVE);
  const lang = useLang();
  return (
    <Panel gap={12} label={w.closedTrade}>
      <Kick>{w.closedTrade}</Kick>
      <img className={d.card} src={`/api/v1/agent-drive/card/${id}?l=${lang}`} alt={w.closedTrade} width={1200} height={675} />
      <Quiet full onClick={() => shareCard(id, lang)} data-drive-share={id}>
        {w.share}
      </Quiet>
    </Panel>
  );
}

/** The agent at work: its coin and state, its last move, its trades and result, and its one action — «Stop» or «Resume». */
function Agent({ row, focus, views }: { row: MineRow; focus: boolean; views: ReturnType<typeof useAgentsData>['views'] }) {
  const w = useWords(DRIVE);
  const a = useWords(AGENTS);
  const lang = useLang();
  const connection = useWallet((st) => st.connection);
  const busy = useControls((st) => st.busy === 'freeze');
  const note = useControls((st) => st.note);
  const record = row.stop && 'record' in row.stop ? row.stop.record : null;
  const view = record ? (views[record.policy] ?? null) : null;
  const names: Readonly<Record<MineRow['role'], string>> = { trader: a.trader, pilot: a.pilot, keeper: a.keeper };
  const last = view?.last?.find((trade) => trade.ok) ?? null;
  const result = row.result ? ('usd' in row.result ? usdShown(row.result.usd, lang) : resultShown(row.result.raw, null, lang)) : null;
  const frozen = row.state === 'frozen';
  const canAct = record !== null && connection !== null && row.state !== 'done' && row.state !== 'stopped';

  // A note from another screen's tap is not this page's.
  useEffect(() => useControls.getState().set({ note: null }), []);

  const act = () => {
    if (!record || !connection || busy) return;
    void tapFreeze({ wallet: connection.wallet, owner: connection.address }, record, !frozen);
  };

  const said = note ? noteWord(w, note) : null;
  return (
    <>
      <div className={d.agentHead}>
        {row.coin ? <CoinLogo src={`/api/icon/${row.coin.mint}`} symbol={row.coin.symbol} size="l" /> : <RoleBadge role={row.role} />}
        <span className={d.agentWords}>
          <Title as="h2" className={d.agentName}>
            {row.coin?.symbol ?? names[row.role]}
          </Title>
          {row.coin ? <span className={d.dim}>{names[row.role]}</span> : null}
        </span>
        <Chip tone={row.state === 'working' ? 'ok' : 'warn'} dot={row.state === 'working'}>
          {stateWord(w, row.state)}
        </Chip>
      </div>
      <div className={d.lastMove}>
        <Kick>{w.lastMove}</Kick>
        <span>{last ? w.lastBought(solPlain(last.spentRaw, lang), dateText(last.at, WHEN, lang)) : w.noMove}</span>
      </div>
      <div className={d.tiles}>
        <Tile label={w.tradesAll} value={view?.result.trades ?? row.trades ?? '—'} />
        <Tile label={w.resultAll} value={result ? result.text.replace(/ SOL$/u, '') : '—'} unit={result?.text.endsWith(' SOL') ? 'SOL' : undefined} tone={result?.tone} />
      </div>
      {canAct ? (
        <>
          {/* «Stop» from a message lands here with its action ready: one more tap and the wallet's one message. */}
          <Action busy={busy} disabled={busy} onClick={act} autoFocus={focus && !frozen} data-drive-stop={frozen ? 'resume' : 'stop'}>
            {busy ? w.stopping : frozen ? w.resume : w.stop}
          </Action>
          <p className={d.line}>{w.stopLine}</p>
        </>
      ) : null}
      {said ? (
        <p className={d.note} data-tone={note === 'frozen' || note === 'resumed' ? undefined : 'warn'} role="status">
          {said}
        </p>
      ) : null}
      <QuietLink href={workerPath(row.role)}>{w.myBots}</QuietLink>
    </>
  );
}

/**
 * The agent's own page — where every note of its moves opens, and «Stop» lands: the agent, its last move, its trades
 * and result, and one action. «Stop» is the person's own switch over its new actions: one signed message of her wallet,
 * no transaction, no key on Ryntra's side; «Resume» takes it off. A closed trade's note brings its «×» card beside it.
 * No wallet: one line and «Connect wallet»; an agent not of this wallet: one line and the way to her bots.
 */
export function PulseScreen({ policy, card, stop }: { policy: string | null; card: string | null; stop: boolean }) {
  const w = useWords(DRIVE);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const data = useAgentsData();
  const engine = useAgents((st) => (owner && MANDATE_NET ? (st.byOwner[owner]?.networks[MANDATE_NET] ?? null) : null));
  const row = policy ? (data.rows.find((one) => one.stop && 'record' in one.stop && one.stop.record.policy === policy) ?? null) : null;
  const past = policy ? (data.past.find((one) => one.key === policy) ?? null) : null;
  const reading = owner !== null && MANDATE_NET !== null && engine === null && !row;
  // The engine refused this wallet for want of this device's proof — not a read still on its way.
  const sign = useSignOnce(owner);
  const aw = useWords(AGENTS);

  let body;
  if (!owner) {
    body = (
      <>
        <p className={d.line}>{w.connectLine}</p>
        <Action onClick={connectWallet} data-drive-connect="">
          {w.connect}
        </Action>
      </>
    );
  } else if (row) {
    body = <Agent row={row} focus={stop} views={data.views} />;
  } else if (sign.shown) {
    const asking = sign.said === 'asking';
    body = (
      <>
        <p className={d.line}>{aw.signOnce}</p>
        <Action busy={asking} disabled={asking} onClick={sign.sign} data-agents-sign-go="">
          {aw.signOnceAction}
        </Action>
        {sign.said === 'declined' || sign.said === 'failed' ? (
          <p className={d.note} data-tone="warn" role="status">
            {sign.said === 'declined' ? aw.signOnceNo : aw.signOnceFailed}
          </p>
        ) : null}
      </>
    );
  } else if (reading) {
    body = <div className={d.bones} aria-busy="true" />;
  } else if (past) {
    body = (
      <>
        <div className={d.agentHead}>
          <Title as="h2" className={d.agentName}>
            {w.pulse}
          </Title>
          <Chip tone="warn">{stateWord(w, past.state)}</Chip>
        </div>
        <QuietLink href={workerPath('trader')}>{w.myBots}</QuietLink>
      </>
    );
  } else {
    body = (
      <>
        <p className={d.line}>{w.notYours}</p>
        <QuietLink href={workerPath('trader')}>{w.myBots}</QuietLink>
      </>
    );
  }

  return (
    <Page data-agent-pulse="">
      <PageHead title={w.pulse} />
      <ActionBody side={card ? <CardSide id={card} /> : undefined} sideLabel={w.closedTrade}>
        <Panel tone="hi" pad="l" gap={16} label={w.pulse}>
          {body}
        </Panel>
      </ActionBody>
    </Page>
  );
}
