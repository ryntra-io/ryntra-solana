'use client';

import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import type { AttemptResponse, PublicEntry, Title, VaultView } from '@/lib/vault/contract';
import { MAX_ATTEMPT_CHARS, charCount } from '@/lib/vault/size';
import { useVault, vaultStore, type Phase } from '@/city/lib/vault/store';
import { CloseGlyph } from '../hud/glyphs';
import hud from '../hud/hud.module.css';
import { CheckGlyph, LockGlyph } from './glyphs';
import s from './vault.module.css';

const OUTCOME: Record<PublicEntry['outcome'], string> = {
  held: 'Held',
  leaked: 'Slipped',
  caught: 'Caught',
  cracked: 'Cracked',
  screened: 'Plain words only',
};

const TAB: Record<VaultView['id'], string> = { 'practice-1': '1', 'practice-2': '2', 'practice-3': '3', daily: 'Daily' };

/** «Зломщик» in the registry: the title for cracking every practice level. */
const TITLE: Record<Title, string> = { breaker: 'Breaker' };

/**
 * The room: which vault, who guards it, what the guard last said to you, one field for one message and the one amber
 * action, and the live feed of what the guards told everyone, the phrase masked. The guard's words, never the city's,
 * are the room's centre; the city adds only what a person needs to know to try again.
 */
export function VaultRoom() {
  const state = useVault((st) => st.state);
  const status = useVault((st) => st.status);
  const vault = useVault((st) => st.vault);
  const phase = useVault((st) => st.phase);
  const draft = useVault((st) => st.draft);
  const feed = useVault((st) => st.feed[st.vault]);
  // A used-up limit: the room reads the vaults again when it resets, and Try comes back by itself.
  const out = useVault((st) => st.limited);
  const field = useRef<HTMLTextAreaElement>(null);
  const current = state?.vaults.find((v) => v.id === vault) ?? null;
  const cracked = phase.step === 'answered' && phase.result.outcome === 'cracked';
  const next = cracked ? state?.vaults.find((v) => v.open && !v.cracked) : null;
  const sending = phase.step === 'sending';

  // The field is ready for the first word as soon as the room is.
  useEffect(() => {
    if (status === 'read' && !cracked && window.matchMedia?.('(pointer: fine)').matches) field.current?.focus({ preventScroll: true });
  }, [status, vault, cracked]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (cracked) {
      if (next) vaultStore.getState().choose(next.id);
      else vaultStore.getState().leave();
      return;
    }
    void vaultStore.getState().send();
  };
  // Enter sends; Shift+Enter is a new line.
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  const left = state?.me.limits;

  return (
    <section className={s.room} role="dialog" aria-label="Vault">
      <div className={s.head}>
        <div className={`${hud.kicker} ${s.kicker}`}>
          <span className={s.dot} aria-hidden="true" />
          Vault · {current?.kind === 'daily' ? 'Daily' : 'Practice'}
        </div>
        {state && state.me.points > 0 && (
          <span className={s.points}>
            {state.me.title ? `${TITLE[state.me.title]} · ` : ''}
            <b>{state.me.points}</b> pts
          </span>
        )}
        <button className={hud.close} aria-label="Close" onClick={() => vaultStore.getState().leave()}>
          <CloseGlyph />
        </button>
      </div>

      <nav className={s.tabs} aria-label="Vaults">
        {(state?.vaults ?? []).map((v) => (
          <button
            key={v.id}
            className={[s.tab, v.id === vault && s.tabOn, !v.open && s.tabLocked].filter(Boolean).join(' ')}
            aria-label={`${v.kind === 'daily' ? 'Daily vault' : `Level ${v.level}`}${v.cracked ? ', cracked' : v.open ? '' : ', locked'}`}
            aria-current={v.id === vault}
            disabled={!v.open || sending}
            onClick={() => vaultStore.getState().choose(v.id)}
          >
            {TAB[v.id]}
            {v.cracked ? (
              <span className={s.tabMark}>
                <CheckGlyph />
              </span>
            ) : !v.open ? (
              <span className={s.tabMark}>
                <LockGlyph />
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {current ? (
        <div className={s.guard}>
          <div className={`${hud.display} ${s.guardName}`}>{current.guard.name}</div>
          <div className={s.guardLine}>{current.guard.line}</div>
          <Phrase words={current.words} pressure={phase.step === 'answered' && phase.result.entry.vault === vault ? phase.result.pressure : 0} cracked={cracked} />
        </div>
      ) : (
        <div className={s.guard}>
          <div className={s.guardLine}>{status === 'offline' ? 'The vault could not be reached. Try again in a moment.' : 'Opening the vault…'}</div>
        </div>
      )}

      <Said phase={phase} />

      <form className={s.ask} onSubmit={submit}>
        {!cracked && (
          <>
            <label className={s.hidden} htmlFor="vault-attempt">
              Your message to the guard
            </label>
            <textarea
              id="vault-attempt"
              ref={field}
              className={s.field}
              rows={2}
              value={draft}
              placeholder="Say something to the guard"
              onChange={(e) => vaultStore.getState().setDraft(e.target.value)}
              onKeyDown={onKey}
              disabled={!current}
              enterKeyHint="send"
              autoComplete="off"
              spellCheck
            />
            <div className={s.meta}>
              <span className={charCount(draft) > MAX_ATTEMPT_CHARS - 20 ? s.metaNear : undefined}>
                {charCount(draft)}/{MAX_ATTEMPT_CHARS}
              </span>
              {left && (
                <span>
                  {left.minute.left} this minute · {left.day.left} left today
                </span>
              )}
            </div>
          </>
        )}
        <button className={`${hud.display} ${hud.action} ${s.action}`} type="submit" disabled={!cracked && (!current || sending || !draft.trim() || out)}>
          {cracked ? (next ? `Next: ${next.kind === 'daily' ? 'Daily vault' : `level ${next.level}`}` : 'Back to the city') : sending ? 'The guard reads…' : 'Try'}
        </button>
      </form>

      <Feed entries={feed ?? []} />
    </section>
  );
}

/** The phrase as dots: one per word, lit for each word the guard's last reply gave away. */
function Phrase({ words, pressure, cracked }: { words: number; pressure: number; cracked: boolean }) {
  const lit = cracked ? words : Math.round(pressure * words);
  return (
    <div className={s.phrase} aria-label={`The phrase has ${words} words${lit && !cracked ? `; the last reply gave away ${lit}` : ''}`}>
      {Array.from({ length: words }, (_, i) => (
        <span key={i} className={[s.word, i < lit && s.wordLit, cracked && s.wordOpen].filter(Boolean).join(' ')} />
      ))}
      <span className={s.phraseLabel}>{words}-word phrase</span>
    </div>
  );
}

/** What the guard said to you, or why nothing was said. */
function Said({ phase }: { phase: Phase }) {
  if (phase.step === 'idle') return <p className={`${s.said} ${s.saidIdle}`}>One message, up to 280 characters. Type the phrase itself to open the door. Your words join the feed in 10 minutes.</p>;
  if (phase.step === 'sending') return <p className={`${s.said} ${s.saidIdle}`} aria-live="polite">The guard reads your message…</p>;
  if (phase.step === 'refused') {
    return (
      <p className={`${s.said} ${s.saidRefused}`} role="status">
        {phase.line}
        {phase.retryAfterS && phase.code === 'RATE_LIMITED' && phase.retryAfterS < 120 ? ` ${phase.retryAfterS} s.` : ''}
      </p>
    );
  }
  return <Answer result={phase.result} />;
}

function Answer({ result }: { result: AttemptResponse }) {
  if (result.outcome === 'cracked') {
    return (
      <div className={s.crack} role="status">
        <div className={`${hud.display} ${s.crackWord}`}>Cracked</div>
        <div className={s.crackLine}>
          {result.award ? (
            <>
              <b>+{result.award.points}</b> points{result.award.title ? ` · title: ${TITLE[result.award.title]}` : ''}
            </>
          ) : (
            'The door opens. No points this time: you cracked it before.'
          )}
        </div>
      </div>
    );
  }
  if (result.outcome === 'screened') return <p className={`${s.said} ${s.saidRefused}`} role="status">The guard only hears plain words. That try counted.</p>;
  return (
    <blockquote className={s.said} aria-live="polite">
      <span className={s.quote}>“{result.reply}”</span>
      {result.outcome !== 'held' && <span className={s.slip}>{result.outcome === 'caught' ? 'It slipped, and the vault masked it.' : 'It slipped.'}</span>}
    </blockquote>
  );
}

/** The live feed: what the guards told everyone, newest first; an attempt shows ten minutes after it was made. */
function Feed({ entries }: { entries: readonly PublicEntry[] }) {
  return (
    <div className={s.feed}>
      <div className={s.feedHead}>
        <span className={s.dot} aria-hidden="true" />
        Live
      </div>
      {entries.length ? (
        <ol className={s.feedList}>
          {entries.slice(0, 12).map((e) => (
            <li key={e.id} className={s.entry}>
              <div className={s.entryHead}>
                <span className={s.who}>{e.who}</span>
                <span className={`${s.tag} ${s[`tag_${e.outcome}`] ?? ''}`}>{OUTCOME[e.outcome]}</span>
              </div>
              {e.reply && <p className={s.entryReply}>{e.reply}</p>}
              {e.attempt && <p className={s.entryTry}>Tried: {e.attempt}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p className={s.feedEmpty}>No one has tried this vault today. Be the first.</p>
      )}
    </div>
  );
}
