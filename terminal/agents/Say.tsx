'use client';

import { useAssistant } from '@/city/lib/assistant/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { coinHref, shelfOn } from '@/terminal/shell/shelves';
import { Chip, Icon, Info, Kick, QuietLink, changeText, priceText } from '@/terminal/ui';
import { AGENTS } from './words';
import a from './agents.module.css';

/**
 * Ryntra's answer to a question said here: one line and the coins it is about — advice only. A coin opens its own
 * screen where the Market shelf is on. While Ryntra cannot answer, the line is the market's own read and says so.
 */
export function Answer() {
  const w = useWords(AGENTS);
  const lang = useLang();
  const phase = useAssistant((st) => st.phase);
  const question = useAssistant((st) => st.question);
  const line = useAssistant((st) => st.line);
  const busy = useAssistant((st) => st.busy);
  const details = useAssistant((st) => st.details);
  const shown = useAssistant((st) => st.shown);
  if (phase === 'idle' || !question) return null;
  const market = shelfOn('market');
  const sources = details ? [...details.why.map((row) => row.text), ...details.risks] : [];
  return (
    <div className={a.answer} role="status" aria-busy={phase === 'asking' || undefined}>
      <div className={a.answerHead}>
        <Icon name="agents" size="s" />
        <Kick className={a.grow}>{w.answer}</Kick>
        {sources.length ? (
          <Info label={w.answerDetails}>
            <span className={a.facts}>
              {sources.map((text, index) => (
                <span key={index}>{text}</span>
              ))}
            </span>
          </Info>
        ) : null}
      </div>
      <span className={a.quote}>«{question}»</span>
      <p className={a.answerLine}>{phase === 'asking' ? w.asking : line}</p>
      {phase === 'answered' && busy ? <span className={a.quote}>{w.busyNow}</span> : null}
      {phase === 'answered' && shown.length ? (
        <div className={a.answerCoins}>
          {shown.slice(0, 6).map((tower) =>
            market ? (
              <QuietLink key={tower.id} size="s" href={coinHref(tower.id, 'live')}>
                {tower.symbol} · {priceText(tower.price, lang)} · {changeText(tower.change24h, lang)}
              </QuietLink>
            ) : (
              <Chip key={tower.id}>
                {tower.symbol} · {priceText(tower.price, lang)} · {changeText(tower.change24h, lang)}
              </Chip>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
