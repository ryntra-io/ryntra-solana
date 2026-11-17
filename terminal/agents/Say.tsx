'use client';

import { useState } from 'react';
import { useAssistant } from '@/city/lib/assistant/store';
import { COMMAND_MAX } from '@/city/lib/command/parse';
import type { Say } from '@/city/lib/crew/say';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { coinHref, shelfOn } from '@/terminal/shell/shelves';
import { Chip, Icon, Info, Kick, QuietLink, SayLine, changeText, priceText } from '@/terminal/ui';
import { AGENTS } from './words';
import a from './agents.module.css';

/**
 * «Say what to do» — the screen's own big line, and under it the sentences ready to say in one tap. Saying a sentence
 * is the frame's own `say`: the city's reading, then the screen that does it — this one for an agent's job or a
 * question, another shelf for a trade. The line opens and fills; it never signs.
 */
export function SayField({ onSay, tall = false }: { onSay: (sentence: string) => boolean; tall?: boolean }) {
  const w = useWords(AGENTS);
  const [text, setText] = useState('');
  const send = () => {
    if (text.trim() && onSay(text)) setText('');
  };
  return (
    <label className={a.sayBox}>
      <Icon name="agents" size="l" />
      <input
        className={a.sayInput}
        type="text"
        value={text}
        maxLength={COMMAND_MAX}
        placeholder={w.sayHere}
        aria-label={w.sayHere}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        data-tall={tall ? '' : undefined}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          send();
        }}
      />
      <button type="button" className={a.sayGo} aria-label={w.saySend} onClick={send}>
        <Icon name="arrow" />
      </button>
    </label>
  );
}

/** The ready sentences: the city's first sentences for the agents open here, each one tap. */
export function ReadySays({ says, onSay, tall = false }: { says: readonly Say[]; onSay: (sentence: string) => boolean; tall?: boolean }) {
  if (!says.length) return null;
  return (
    <div className={a.says}>
      {says.map((say) => (
        <SayLine key={say.key} tall={tall} onSay={() => onSay(say.text)}>
          {say.text}
        </SayLine>
      ))}
    </div>
  );
}

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
