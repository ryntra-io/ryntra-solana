'use client';

import { useId, useState } from 'react';
import { cleanDraft, contactFor, draftIssue, lookalikeContact, suggestions, NAME_MAX, NOTE_MAX, type Contact, type DraftIssue } from '@/lib/contacts/model';
import { useWords } from '@/city/lib/i18n/dict';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { Action, Kick, Panel, Quiet, QuietLink, cx } from '@/terminal/ui';
import { sendTo, shortTo, type ChangeOutcome, type ContactsRead } from './contacts-view';
import { useContacts } from './useContacts';
import { NoWallet } from '../NoWallet';
import { CONTACTS_WORDS } from './words';
import t from '@/terminal/coin/ticket.module.css';
import s from '@/terminal/swap/swap.module.css';
import m from '../money.module.css';
import c from './contacts.module.css';

type Words = (typeof CONTACTS_WORDS)['en'];

const OUTCOME: Readonly<Record<Exclude<ChangeOutcome, 'done'>, keyof Words>> = {
  declined: 'declined',
  unsupported: 'unsupported',
  locked: 'locked',
  signature: 'badSignature',
  stale: 'stale',
  taken: 'taken',
  full: 'full',
  missing: 'missing',
  failed: 'failed',
};

const ISSUE: Readonly<Record<DraftIssue, keyof Words>> = { name: 'nameIssue', to: 'toIssue', self: 'selfIssue', note: 'noteIssue' };

/**
 * «Contacts»: the tab's action panel — a new contact, or the one being
 * changed — and the wallet's own book under it. One amber press, «Save contact»: one signed message in the wallet, never
 * a transaction. Without a wallet the panel is «Money»'s own blank with «Connect wallet».
 */
export function ContactsTab({ owner, onConnect }: { owner: string | null; onConnect: () => void }) {
  const w = useWords(CONTACTS_WORDS);
  const contacts = useContacts(owner);
  const [editing, setEditing] = useState<Contact | null>(null);
  return (
    <>
      <Panel tone="hi" pad="l" gap={16} label={editing ? w.editContact : w.newContact} className={cx(m.form, !owner && m.formBlank)}>
        {owner ? <ContactForm key={`${owner}:${editing?.id ?? 'new'}`} owner={owner} book={contacts.book} editing={editing} onDone={() => setEditing(null)} change={contacts.change} /> : <NoWallet tab="contacts" onConnect={onConnect} />}
      </Panel>
      {owner ? <ContactList book={contacts.book} onUnlock={contacts.unlock} onRead={() => void contacts.read()} onEdit={setEditing} change={contacts.change} /> : null}
    </>
  );
}

type Change = ReturnType<typeof useContacts>['change'];

function ContactForm({ owner, book, editing, onDone, change }: { owner: string; book: ContactsRead; editing: Contact | null; onDone: () => void; change: Change }) {
  const w = useWords(CONTACTS_WORDS);
  const [name, setName] = useState(editing?.name ?? '');
  const [to, setTo] = useState(editing?.to ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<Readonly<{ tone: 'ok' | 'error'; text: string }> | null>(null);
  const [how, setHow] = useState(false);
  const howId = useId();

  const draft = { name, to, note };
  const issue = draftIssue(draft, owner);
  // A field is judged once something is in it: an empty form says nothing yet.
  const shownIssue = issue && ((issue === 'name' && name.trim()) || ((issue === 'to' || issue === 'self') && to.trim()) || issue === 'note') ? issue : null;
  const kept = book.state === 'ready' ? book.contacts : [];
  const alike = issue === null ? lookalikeContact(kept, to, editing?.id ?? null) : null;

  const submit = async () => {
    const clean = cleanDraft(draft, owner);
    if (!clean || busy) return;
    setBusy(true);
    setLine(null);
    const outcome = await change(editing ? 'edit' : 'add', clean, editing?.id ?? null);
    setBusy(false);
    if (outcome === 'done') {
      setLine({ tone: 'ok', text: w.saved });
      setName('');
      setTo('');
      setNote('');
      if (editing) onDone();
      return;
    }
    setLine({ tone: 'error', text: w[OUTCOME[outcome]] as string });
  };

  const said = shownIssue ? { tone: 'error' as const, text: w[ISSUE[shownIssue]] as string } : alike ? { tone: 'warn' as const, text: w.lookalike(alike.name) } : line;
  return (
    <>
      <label className={s.big}>
        <span className={s.bigHead}>
          <Kick>{w.name}</Kick>
        </span>
        <input className={s.text} value={name} maxLength={NAME_MAX * 2} onChange={(event) => setName(event.target.value)} placeholder={w.nameHint} autoComplete="off" disabled={busy} />
      </label>
      <label className={s.big}>
        <span className={s.bigHead}>
          <Kick>{w.to}</Kick>
        </span>
        <input
          className={s.text}
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder={w.toHint}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          translate="no"
          disabled={busy}
        />
      </label>
      <label className={s.big}>
        <span className={s.bigHead}>
          <Kick>{w.note}</Kick>
        </span>
        <input className={s.text} value={note} maxLength={NOTE_MAX * 2} onChange={(event) => setNote(event.target.value)} placeholder={w.noteHint} autoComplete="off" disabled={busy} />
      </label>
      <div className={m.grow} />
      <div className={s.terms}>
        <span className={s.termsLine}>{w.signed}</span>
        <ExplainButton label={w.how} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />
      </div>
      {how ? (
        <ExplainBox id={howId}>
          <span>{w.howText}</span>
        </ExplainBox>
      ) : null}
      <p className={cx(t.note, c.said)} data-tone={said?.tone === 'ok' ? undefined : said?.tone} role={said?.tone === 'error' ? 'alert' : 'status'} data-said={said?.tone ?? 'none'}>
        {said?.text ?? ''}
      </p>
      {editing ? (
        <Quiet full onClick={onDone} disabled={busy}>
          {w.cancel}
        </Quiet>
      ) : null}
      <Action onClick={() => void submit()} disabled={issue !== null} busy={busy}>
        {busy ? w.saving : editing ? w.saveEdit : w.save}
      </Action>
    </>
  );
}

/** «Your contacts»: every contact of the wallet, the newest change first — send to one, change it, remove it. */
function ContactList({ book, onUnlock, onRead, onEdit, change }: { book: ContactsRead; onUnlock: () => Promise<'ok' | 'declined' | 'failed'>; onRead: () => void; onEdit: (contact: Contact) => void; change: Change }) {
  const w = useWords(CONTACTS_WORDS);
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  let body;
  if (book.state === 'reading')
    body = (
      <div className={s.bones} aria-busy="true" aria-label={w.reading}>
        <span />
        <span />
      </div>
    );
  else if (book.state === 'locked')
    body = (
      <div className={m.listBlank}>
        <p className={m.line}>{w.locked}</p>
        <Quiet
          size="s"
          disabled={asking}
          onClick={() => {
            setAsking(true);
            void onUnlock().finally(() => setAsking(false));
          }}
        >
          {w.show}
        </Quiet>
      </div>
    );
  else if (book.state === 'failed')
    body = (
      <div className={m.listBlank}>
        <p className={m.line} data-tone="down">
          {w.unread}
        </p>
        <Quiet size="s" onClick={onRead}>
          {w.again}
        </Quiet>
      </div>
    );
  else if (!book.contacts.length) body = <p className={cx(m.line, m.listLine)}>{w.none}</p>;
  else
    body = (
      <ul className={m.links}>
        {book.contacts.map((contact) => (
          <li key={contact.id} className={cx(m.link, c.row)} data-contact="">
            <span className={m.linkNames}>
              <b>{contact.name}</b>
              <span translate="no">{contact.note ? `${shortTo(contact.to)} · ${contact.note}` : shortTo(contact.to)}</span>
            </span>
            <span className={m.linkActs}>
              <QuietLink size="s" href={sendTo(contact)}>
                {w.send}
              </QuietLink>
              <Quiet size="s" aria-label={w.editOne(contact.name)} onClick={() => onEdit(contact)} disabled={removing !== null}>
                {w.edit}
              </Quiet>
              <Quiet
                size="s"
                aria-label={w.removeOne(contact.name)}
                disabled={removing !== null}
                onClick={() => {
                  setRemoving(contact.id);
                  setLine(null);
                  void change('remove', null, contact.id).then((outcome) => {
                    setRemoving(null);
                    if (outcome !== 'done') setLine(w[OUTCOME[outcome]] as string);
                  });
                }}
              >
                {removing === contact.id ? w.removing : w.remove}
              </Quiet>
            </span>
          </li>
        ))}
      </ul>
    );
  return (
    <Panel pad="none" label={w.yours} className={m.list}>
      <div className={m.listHead}>
        <Kick className={m.listKick}>{w.yours}</Kick>
      </div>
      {line ? (
        <p className={cx(m.line, m.listLine)} data-tone="down" role="alert">
          {line}
        </p>
      ) : null}
      {body}
    </Panel>
  );
}

/**
 * The mount point in «Send»: the wallet's contacts under «To» — a tap puts the address in the field — and,
 * when «To» is a contact's address, its name. Read only behind the proof the wallet already gave; without one nothing
 * is asked and nothing shows. The warning on a new recipient stays «Send»'s own, as it was.
 */
export function ContactSuggest({ owner, typed, disabled, onPick }: { owner: string | null; typed: string; disabled?: boolean; onPick: (to: string) => void }) {
  const { book } = useContacts(owner);
  if (!owner || book.state !== 'ready') return null;
  return <ContactPicks contacts={book.contacts} typed={typed} disabled={disabled} onPick={onPick} />;
}

/** The contacts that answer what «To» holds, one quiet press each — or the contact's name once «To» is one of them. */
export function ContactPicks({ contacts, typed, disabled, onPick }: { contacts: readonly Contact[]; typed: string; disabled?: boolean; onPick: (to: string) => void }) {
  const w = useWords(CONTACTS_WORDS);
  if (!contacts.length) return null;
  const known = contactFor(contacts, typed);
  if (known) {
    return (
      <p className={cx(s.termsLine, c.known)} data-contact-known="">
        {w.known(known.name)}
      </p>
    );
  }
  const found = suggestions(contacts, typed, 4);
  if (!found.length) return null;
  return (
    <div className={c.picks} role="group" aria-label={w.pick}>
      {found.map((contact) => (
        <Quiet key={contact.id} size="s" aria-label={w.pickOne(contact.name)} disabled={disabled} onClick={() => onPick(contact.to)}>
          {contact.name}
        </Quiet>
      ))}
    </div>
  );
}
