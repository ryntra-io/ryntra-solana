'use client';

import { useId, useState } from 'react';
import { useRyntraApp } from '@/city/lib/app-mode';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { CONTACT_MAX, HELP_MAX, HELP_TOPICS, helpPayload, helpReady, sendHelp, type HelpOutcome, type HelpTopic } from '@/city/lib/pages/help';
import { CONTACTS, contactMailto } from '@/lib/site/contacts';
import { Hero, More, PageDoor, PageFrame } from './parts';
import s from './pages.module.css';
import { HELP } from './words';

/**
 * «Help» (CITY-157): Support and Feedback in one form, on the engine's inbox (`POST /api/feedback`). Pick what it is,
 * write, send — one amber action. The answer is the inbox's reference. What to know before writing, the email and what
 * the phone keeps are behind one quiet «Before you write».
 */
export function HelpBody() {
  const w = useWords(HELP);
  const lang = useLang();
  const inApp = useRyntraApp();
  const ids = useId();
  const [topic, setTopic] = useState<HelpTopic>('question');
  const [body, setBody] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<HelpOutcome | null>(null);
  const draft = { topic, body, contact };
  const ready = helpReady(draft) && !busy;

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    setOutcome(null);
    const result = await sendHelp(helpPayload(draft, { source: inApp ? 'app' : 'site', route: location.pathname, locale: lang }), (url, init) => fetch(url, init));
    setBusy(false);
    setOutcome(result);
    if (result.kind === 'sent') {
      setBody('');
      setContact('');
    }
  };

  return (
    <PageFrame id="help">
      <Hero id="help" kicker={w.kicker} title={w.title} />
      {outcome?.kind === 'sent' ? (
        <div className={s.done} role="status" data-words="">
          <span className={s.doneMark} aria-hidden="true" />
          <b className={`${s.display} ${s.doneTitle}`}>{w.sent}</b>
          <span className={s.doneRef}>{w.reference(outcome.ref)}</span>
          <button type="button" className={s.secondary} onClick={() => setOutcome(null)}>
            {w.another}
          </button>
        </div>
      ) : (
        <form
          className={s.form}
          data-words=""
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className={s.topics} role="radiogroup" aria-label={w.topic}>
            {HELP_TOPICS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={topic === id} className={s.topicBtn} onClick={() => setTopic(id)}>
                {w[id]}
              </button>
            ))}
          </div>
          <label className={s.hiddenLabel} htmlFor={`${ids}-body`}>
            {w.message}
          </label>
          <textarea
            id={`${ids}-body`}
            className={s.field}
            rows={6}
            maxLength={HELP_MAX}
            placeholder={w.placeholder}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <label className={s.hiddenLabel} htmlFor={`${ids}-contact`}>
            {w.contact}
          </label>
          <input
            id={`${ids}-contact`}
            className={s.field}
            type="text"
            autoComplete="email"
            maxLength={CONTACT_MAX}
            placeholder={w.contact}
            value={contact}
            onChange={(event) => setContact(event.target.value)}
          />
          {outcome ? (
            <p className={s.alert} role="alert">
              {outcome.kind === 'busy' ? w.busy : outcome.kind === 'offline' ? w.offline(CONTACTS.email) : w.failed}
            </p>
          ) : null}
          <button type="submit" className={`${s.display} ${s.action}`} disabled={!ready}>
            {busy ? w.sending : w.send}
          </button>
        </form>
      )}
      <More label={w.before}>
        <p className={s.moreLine}>{w.never}</p>
        <p className={s.moreLine}>{w.securityFirst}</p>
        <a className={s.moreRow} href={contactMailto()}>
          <span>{w.email}</span>
          <span className={s.moreValue}>{CONTACTS.email}</span>
        </a>
        <PageDoor id="privacy" hash="android" className={s.moreRow}>
          <span>{w.phone}</span>
        </PageDoor>
      </More>
    </PageFrame>
  );
}
