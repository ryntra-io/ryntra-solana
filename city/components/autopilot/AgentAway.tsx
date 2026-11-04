'use client';

import { MANDATE_CHAIN, useMandate } from '@/city/lib/bots/mandate';
import { BRAND } from '@/city/lib/brand';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { agentCard, cardTag } from '@/city/lib/launch/cards';
import { AGENT_REPORT, agentSymbol, daySummary, solFigure } from '@/city/lib/autopilot/report';
import { useAgentReport } from '@/city/lib/autopilot/report-client';
import { useAutopilot } from '@/city/lib/autopilot/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { useShareCard } from '../launch/useShareCard';
import { AgentGlyph } from '../instruct/glyphs';
import s from './autopilot.module.css';

/**
 * «While you were away: 3 trades, +0.012 SOL» (CITY-194): the one card the person meets on her return when her agent
 * traded since she last looked. A tap opens the agent; «Share» makes the card for X from the same real figures; × lets
 * it go. Loaded only when there is something to tell: the city's first frame carries none of it.
 */
export default function AgentAway() {
  const w = useWords(AGENT_REPORT);
  const lang = useLang();
  const away = useAgentReport((st) => st.away);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const record = useMandate((st) => (owner ? (st.records[owner] ?? null) : null));
  const view = useAutopilot((st) => (record ? (st.views[record.policy] ?? null) : null));
  const { share, making, saved, savedLine, label } = useShareCard();
  if (!away || !record || away.policy !== record.policy) return null;
  const day = away.day;
  const earned = day.earnedRaw === null ? null : BigInt(day.earnedRaw);
  const card = view ? agentCard({ coin: { token: view.receiveMint, symbol: agentSymbol(view), logo: false }, trades: day.trades, spentRaw: day.spentRaw, worthRaw: day.worthRaw, tag: cardTag(MANDATE_CHAIN, false), span: 'away' }) : null;
  const open = () => {
    useAgentReport.getState().dismiss();
    useAutopilot.getState().showAgent();
  };
  return (
    <div className={s.away} role="status" aria-live="polite" data-agent-away="">
      <button type="button" className={s.awayBody} onClick={open}>
        <span className={s.mineMark}>
          <AgentGlyph />
        </span>
        <span className={s.awayText}>
          <span className={s.awayKicker}>{w.away}</span>
          <span className={s.awayHead}>
            {w.trades(day.trades)}
            {earned !== null ? (
              <>
                {', '}
                <b data-tone={earned > 0n ? 'up' : earned < 0n ? 'down' : undefined}>{solFigure(day.earnedRaw!, lang)}</b>
              </>
            ) : null}
          </span>
          {saved ? <span className={s.awaySaved}>{savedLine}</span> : null}
        </span>
      </button>
      <div className={s.awayDock}>
        <button
          type="button"
          className={s.awayShare}
          disabled={!card || making !== null}
          aria-label={`${label} · ${daySummary(day, lang)}`}
          onClick={() => card && void share('agent-away', card, `https://${BRAND.domain}`)}
          data-agent-away-share=""
        >
          {label}
        </button>
        <button type="button" className={s.awayClose} aria-label={w.later} onClick={() => useAgentReport.getState().dismiss()}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
