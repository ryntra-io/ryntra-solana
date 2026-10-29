'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { requestFrame } from '@/city/lib/capture';
import { useCity, useCityEvents } from '@/city/lib/city/store';
import { momentFileName, sourceTime } from '../moment';
import { cityFonts, composeMomentCard } from '../draw';
import { filmMoment, isFilming } from '../stage';
import { postFromCityEvent } from './city-events';
import { X_MAX, xLength } from './post';
import { MEDIA_MAX_BYTES, type Draft, type Switch } from './store';
import d from './desk.module.css';

/**
 * The desk for X, over the city at `/#drafts`: the queue of post drafts the city made, each with its clip, its words
 * and its link; approve one, reject one, approve all ready; and the switch that would let a sender post them. Only an
 * operator signed in to the admin sees anything: the page holds no key, its calls carry the admin session's cookie.
 * Approving all and turning the switch on also ask for a fresh second factor. While the desk is open the city films
 * the drafts still without a clip (it is drawn here, so it is filmed here) and turns its own Ryntra launches into
 * drafts. Nothing is posted from here: the publisher's cron (`city/lib/x`) posts the approved line, once the owner
 * connects it.
 */

type Queue = { drafts: Draft[]; switch: Switch; sender: { connected: boolean; scheduled?: boolean } };
type Door = 'checking' | 'locked' | 'open' | 'down';

/** A card as a JPEG: a photo of the city is a fifth of the PNG, well within what a post and the queue take. */
async function asJpeg(png: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(png);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))) ?? png;
  } catch {
    return png;
  }
}

/**
 * The draft's clip as the director films it, within what the queue takes; the card where this browser cannot encode,
 * the clip came out too big, or the tower is not in the city now.
 */
async function filmDraft(draft: Draft): Promise<Blob | null> {
  const made = await filmMoment(draft.moment);
  if (made?.clip && made.clip.size <= MEDIA_MAX_BYTES) return made.clip;
  let card = made?.card ?? null;
  if (!card) {
    const [frame, fonts] = await Promise.all([requestFrame(), cityFonts()]);
    card = await composeMomentCard(frame, frame.width, frame.height, draft.moment, fonts);
  }
  return card ? asJpeg(card) : null;
}

/** True while the address asks for the desk. */
export function useDeskAsked(): boolean {
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    const read = () => setAsked(location.hash === '#drafts');
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  return asked;
}

const STATUS_LABEL: Record<Draft['status'], string> = {
  filming: 'Filming',
  ready: 'Ready',
  approved: 'Approved · waiting',
  rejected: 'Rejected',
  sending: 'Posting…',
  sent: 'Posted',
  failed: 'Not posted',
};

export function DraftsDesk() {
  const [door, setDoor] = useState<Door>('checking');
  const [queue, setQueue] = useState<Queue | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(new Set<string>());

  /** Same origin, the admin session's cookie and nothing else. */
  const call = useCallback(
    async (path: string, init: RequestInit = {}) => fetch(`/api/moments${path}`, { ...init, credentials: 'same-origin', cache: 'no-store' }),
    [],
  );

  const load = useCallback(async () => {
    try {
      const res = await call('/drafts');
      if (res.status === 401 || res.status === 403) {
        setDoor('locked');
        return;
      }
      if (!res.ok) {
        setDoor('down');
        return;
      }
      setQueue((await res.json()) as Queue);
      setDoor('open');
    } catch {
      setDoor('down');
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The city's own launches become drafts while the desk is open. */
  useCityEvents((e) => {
    if (door !== 'open') return;
    const tower = useCity.getState().snapshot.towers.find((t) => t.id === e.towerId);
    const event = postFromCityEvent(e, tower);
    if (!event) return;
    void call('/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) }).then((res) => {
      if (res.status === 201) void load();
    });
  });

  /** Films the drafts without a clip, one after another: the city stages each; where it cannot film, the card goes. */
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (door !== 'open' || !queue || working.current) return;
    // A studio post (CITY-38) is filmed by the studio's batch script, which sends its clip itself.
    const next = queue.drafts.find((x) => x.status === 'filming' && x.kind !== 'studio' && !tried.current.has(x.id));
    if (!next) return;
    working.current = true;
    tried.current.add(next.id);
    void (async () => {
      try {
        // Someone's own clip is being made: the draft waits its turn.
        while (isFilming()) await new Promise((r) => setTimeout(r, 500));
        setNote(`Filming ${next.moment.kicker.toLowerCase()}…`);
        const file = await filmDraft(next);
        if (!file) {
          setNote('This browser could not make a clip or a card.');
          return;
        }
        const res = await call(`/drafts/${next.id}/clip`, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        setNote(res.ok ? null : `The clip was not saved (${res.status}).`);
      } finally {
        working.current = false;
        if (mounted.current) await load();
      }
    })();
  }, [door, queue, call, load]);

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      const res = await call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!res.ok) {
        const code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
        setNote(code === 'reverify' ? 'Confirm your second factor in the admin, then try again.' : `Refused (${res.status}).`);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    history.replaceState(null, '', location.pathname + location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  const drafts = queue?.drafts ?? [];
  const ready = drafts.filter((x) => x.status === 'ready').length;
  const on = queue?.switch.on ?? false;
  const connected = queue?.sender.connected ?? false;

  return (
    <aside className={d.desk} aria-label="Drafts for X" onKeyDown={(e) => e.stopPropagation()}>
      <header className={d.head}>
        <div>
          <div className={d.kicker}>Drafts for X</div>
          <div className={d.sub}>{door === 'open' ? `${drafts.length} in the queue · ${ready} ready` : 'The desk'}</div>
        </div>
        <button className={d.close} aria-label="Close the desk" onClick={close}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {door === 'locked' && (
        <div className={d.lock}>
          <p className={d.small}>The desk is for operators. Sign in to the admin, then open it again.</p>
          <button className={d.primary} type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {door === 'down' && <p className={d.small}>The queue is not reachable right now.</p>}
      {door === 'checking' && <p className={d.small}>Opening…</p>}

      {door === 'open' && queue && (
        <>
          <div className={d.switchRow}>
            <button
              role="switch"
              aria-checked={on}
              className={d.switch}
              data-on={on}
              disabled={busy}
              onClick={() => void act('/switch', { on: !on })}
            >
              <span className={d.knob} aria-hidden="true" />
              <span>Autopost {on ? 'on' : 'off'}</span>
            </button>
            <button className={d.primary} disabled={busy || ready === 0} onClick={() => void act('/drafts/approve-all')}>
              Approve all{ready ? ` (${ready})` : ''}
            </button>
          </div>
          <p className={d.small} data-tone={connected ? undefined : 'warn'}>
            {connected
              ? on
                ? queue?.sender.scheduled
                  ? 'Approved drafts go out on the day’s schedule, one per slot.'
                  : 'Approved drafts are posted as they are approved.'
                : 'Autopost is off: approved drafts wait.'
              : 'No sender is connected: X keys and publishing are the owner’s word. Approved drafts wait here.'}
          </p>
          {note && (
            <p className={d.small} aria-live="polite">
              {note}
            </p>
          )}
          <ul className={d.list}>
            {drafts.map((x) => (
              <DraftCard key={x.id} draft={x} call={call} busy={busy} onAct={act} />
            ))}
            {!drafts.length && <li className={d.empty}>No drafts yet. A Ryntra launch, its move into the skyline, a big x or an agent’s find lands here.</li>}
          </ul>
        </>
      )}
    </aside>
  );
}

function DraftCard({ draft, call, busy, onAct }: { draft: Draft; call: (path: string) => Promise<Response>; busy: boolean; onAct: (path: string) => Promise<void> }) {
  const [still, setStill] = useState<string | null>(null);
  const type = draft.media?.type ?? null;
  const video = type === 'video/mp4';
  // The page's policy shows pictures from data addresses and plays media only from this origin: a card is read in as
  // data, a clip plays from its own route (the operator's session cookie goes with it).
  useEffect(() => {
    if (!type || video) return;
    let alive = true;
    void call(`/drafts/${draft.id}/clip`).then(async (res) => {
      if (!res.ok || !alive) return;
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => alive && setStill(String(reader.result));
      reader.readAsDataURL(blob);
    });
    return () => {
      alive = false;
    };
  }, [draft.id, type, video, call]);
  const save = async () => {
    const res = await call(`/drafts/${draft.id}/clip`);
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = momentFileName(draft.moment, 'mp4');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const m = draft.moment;
  const length = xLength(draft.text);
  return (
    <li className={d.card} data-status={draft.status}>
      <div className={d.media} data-kind={video || !type ? 'clip' : 'card'}>
        {video ? (
          <video src={`/api/moments/drafts/${draft.id}/clip`} muted loop autoPlay playsInline aria-label="The clip" />
        ) : still ? (
          // eslint-disable-next-line @next/next/no-img-element -- the city's own card, read in as data
          <img src={still} alt="The card" />
        ) : (
          <span className={d.filming}>{draft.status === 'filming' ? 'Filming…' : '—'}</span>
        )}
      </div>
      <div className={d.body}>
        <div className={d.meta}>
          <span className={d.chip} data-status={draft.status}>
            {STATUS_LABEL[draft.status]}
          </span>
          <span>{m.kicker}</span>
        </div>
        <div className={d.title}>{m.title}</div>
        <div className={d.figure}>
          {m.figure} · {m.source} · {sourceTime(m.sourceAt)}
        </div>
        <p className={d.text}>{draft.text}</p>
        <div className={d.foot}>
          <span className={d.count} data-over={length > X_MAX}>
            {length}/{X_MAX}
          </span>
          <a className={d.link} href={draft.link} target="_blank" rel="noreferrer">
            {draft.link.replace(/^https:\/\//, '')}
          </a>
        </div>
        <div className={d.mediaMeta}>
          {draft.media ? `${video ? 'Clip 9:16' : 'Card 4:5'} · ${Math.max(0.1, Math.round(draft.media.bytes / 100_000) / 10)} MB` : 'Clip being filmed'}
          {video && (
            <button className={d.save} onClick={() => void save()}>
              Save
            </button>
          )}
        </div>
        {draft.note && <p className={d.small}>{draft.note}</p>}
        {draft.status === 'ready' && (
          <div className={d.actions}>
            <button className={d.approve} disabled={busy} onClick={() => void onAct(`/drafts/${draft.id}/approve`)}>
              Approve
            </button>
            <button className={d.reject} disabled={busy} onClick={() => void onAct(`/drafts/${draft.id}/reject`)}>
              Reject
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
