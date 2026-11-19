'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { ago, type ScoutRow } from '@/city/lib/scouts/view';
import { Action, Info, Kick, Panel, Quiet } from '@/terminal/ui';
import { countShown, earning, shareShown, solShown, usdShown, type RankId, type RankRead, type Rung, type Shares } from './view';
import { REWARDS } from './words';
import r from './rewards.module.css';

type W = (typeof REWARDS)['en'];

const RANK_WORD: Readonly<Record<RankId, 'bronze' | 'silver' | 'gold' | 'sapphire' | 'diamond'>> = {
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD: 'gold',
  SAPPHIRE: 'sapphire',
  DIAMOND: 'diamond',
};

/** A rank by its name, in the language on screen. */
export function rankName(w: W, id: RankId): string {
  return w[RANK_WORD[id]];
}

/** The head of a panel: its label, and on the right what explains it. */
export function Top({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className={r.top}>
      <Kick>{label}</Kick>
      {children ? <span className={r.topEnd}>{children}</span> : null}
    </div>
  );
}

/**
 * The action panel before the figures: one line and the one action — connect a wallet, or sign the one message that
 * shows the figures. `busy` while the wallet is open; the wallet's own reason in flare when the signature did not go.
 */
export function Ask({ label, line, action, busy = false, message, onAct }: { label: string; line: string; action: string; busy?: boolean; message?: string | null; onAct: () => void }) {
  return (
    <Panel tone="hi" pad="l" gap={24} edge label={label}>
      <Top label={label} />
      <p className={r.line}>{line}</p>
      {message ? <p className={r.bad}>{message}</p> : null}
      <Action busy={busy} disabled={busy} onClick={onAct}>
        {action}
      </Action>
    </Panel>
  );
}

/** The read under way: the action panel holds the figures' rows, the same height, and nothing moves when they come. */
export function Reading({ label }: { label: string }) {
  const w = useWords(REWARDS);
  return (
    <Panel tone="hi" pad="l" gap={24} edge label={label}>
      <Top label={label} />
      <div className={r.bones} aria-busy="true" aria-label={w.reading}>
        <span className={r.boneHero} />
        <span className={r.boneSpan} />
        <span className={r.boneTiles} />
      </div>
    </Panel>
  );
}

/** A read that did not come: one line in flare where the figures stand, and a quiet «Try again» that only reads again. */
export function Failed({ label, onAgain }: { label: string; onAgain: () => void }) {
  const w = useWords(REWARDS);
  return (
    <Panel tone="hi" pad="l" gap={24} edge label={label}>
      <Top label={label} />
      <div className={r.badRow}>
        <p className={r.bad}>{w.failed}</p>
        <Quiet onClick={onAgain}>{w.again}</Quiet>
      </div>
    </Panel>
  );
}

/**
 * The rank over the last 30 days and its ladder: what each rank pays on a friend's trade, the person's own lit. Before
 * a wallet, the ladder by the rules in force; the rank's own bar once the engine said where it stands.
 */
export function RankPanel({ rank, ladder }: { rank: RankRead | null; ladder: readonly Rung[] }) {
  const w = useWords(REWARDS);
  const lang = useLang();
  return (
    <Panel gap={16} label={w.rank}>
      <Top label={w.rank}>
        <Info label={w.rank}>{w.rankRules}</Info>
      </Top>
      {rank ? (
        <div className={r.fact}>
          <span className={r.rankName}>{rankName(w, rank.id)}</span>
          <span className={r.sub}>{rank.next ? w.rankNext(rankName(w, rank.next.id)) : w.rankTop}</span>
        </div>
      ) : null}
      <div className={r.rows}>
        <div className={r.rowHead}>
          <span />
          <Kick>{w.rankShare}</Kick>
        </div>
        {ladder.map((rung) => (
          <div key={rung.id} className={r.row} data-on={rank?.id === rung.id ? '' : undefined}>
            <span className={r.rowName}>{rankName(w, rung.id)}</span>
            <span className={r.rowValue}>{shareShown(rung.share, lang)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** What earns points, by the points policy in force: a dollar traded, a day you trade, a friend who starts trading. */
export function EarnPanel() {
  const w = useWords(REWARDS);
  const lang = useLang();
  const e = earning();
  const rows = [
    { name: w.earnTrade, value: w.perDollar(countShown(e.perDollar, lang)) },
    { name: w.earnDay, value: w.plus(countShown(e.activeDay, lang)) },
    { name: w.earnFriend, value: w.plus(countShown(e.friend, lang)) },
  ];
  return (
    <Panel gap={12} label={w.howToEarn}>
      <Top label={w.howToEarn}>
        <Info label={w.howToEarn}>{w.earnRules(countShown(e.dayCap, lang))}</Info>
      </Top>
      <div className={r.rows}>
        {rows.map((row) => (
          <div key={row.name} className={r.row}>
            <span className={r.rowName}>{row.name}</span>
            <span className={r.rowValue}>{row.value}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** What a friend's trade pays this person: by their rank, in the friend's first days, and a level down. */
export function SharesPanel({ shares }: { shares: Shares }) {
  const w = useWords(REWARDS);
  const lang = useLang();
  const rows = [
    { key: 'friend', name: w.fromFriend, value: shareShown(shares.friend, lang) },
    ...(shares.firstDays ? [{ key: 'first', name: w.firstDays(shares.firstDays.days), value: shareShown(shares.firstDays.share, lang) }] : []),
    { key: 'second', name: w.fromSecond, value: shareShown(shares.second, lang) },
  ];
  return (
    <Panel gap={12} label={w.yourShare}>
      <Top label={w.yourShare}>
        <Info label={w.yourShare}>{w.shareRules}</Info>
      </Top>
      <div className={r.rows}>
        {rows.map((row) => (
          <div key={row.key} className={r.row}>
            <span className={r.rowName}>{row.name}</span>
            <span className={r.rowValue}>{row.value}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

const KIND_WORD: Readonly<Record<ScoutRow['kind'], 'kindCashback' | 'kindFriend' | 'kindSecond' | 'kindPayout'>> = {
  CASHBACK: 'kindCashback',
  REFERRAL_L1: 'kindFriend',
  REFERRAL_L2: 'kindSecond',
  CLAIM: 'kindPayout',
};

/** The latest rows of the history: who, from which coin, how much in SOL (dollars without a price), how long ago. */
export function LatestPanel({ rows, solUsd, now }: { rows: readonly ScoutRow[]; solUsd: number | null; now: number }) {
  const w = useWords(REWARDS);
  const lang = useLang();
  return (
    <Panel gap={12} label={w.latest}>
      <Top label={w.latest} />
      {rows.length ? (
        <div className={r.rows}>
          {rows.map((row, at) => {
            const sol = solShown(row.amount, solUsd, lang);
            const when = ago(row.at, now);
            const note = [row.coin, when].filter(Boolean).join(' · ');
            return (
              <div key={`${row.at}-${at}`} className={r.row}>
                <span className={r.rowName}>
                  {w[KIND_WORD[row.kind]]}
                  {note ? <span className={r.rowNote}>{note}</span> : null}
                </span>
                <span className={r.rowValue} data-out={row.out ? '' : undefined}>
                  {row.out ? '−' : null}
                  {sol ?? usdShown(row.amount, lang)}
                  {sol ? <span className={r.rowUnit}>SOL</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className={r.quiet}>{w.nothingYet}</p>
      )}
    </Panel>
  );
}
