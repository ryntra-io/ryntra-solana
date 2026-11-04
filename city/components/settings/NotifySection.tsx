'use client';

import { useEffect, useState } from 'react';
import { useBeacons } from '@/city/lib/beacon/store';
import { EARN_OPEN } from '@/city/lib/earn/flag';
import { useFeed } from '@/city/lib/feed/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { liveLink, useChannels } from '@/city/lib/notify/channels-store';
import { CAPS, GROUPS, kindsShown, type Cap, type KindSpec, type NoteGroup, type Place } from '@/city/lib/notify/kinds';
import { CORNERS, routeShown, type Corner } from '@/city/lib/notify/prefs';
import { useNotify } from '@/city/lib/notify/store';
import { cityAccount } from '@/city/lib/quarter/account-live';
import { proveWallet } from '@/city/lib/trade/proof';
import { useWallet } from '@/city/lib/trade/wallet';
import { Group, Head, Row, Segment, Switch } from './bits';
import { CityGlyph, DeskGlyph, LockGlyph, OffGlyph, TelegramGlyph } from './glyphs';
import { SETTINGS } from './words';
import s from './settings.module.css';

type W = (typeof SETTINGS)['en'];

const PLACE_ICON: Readonly<Record<Place, () => React.JSX.Element>> = { city: CityGlyph, desk: DeskGlyph, off: OffGlyph };
const PLACE_WORD: Readonly<Record<Place, keyof W>> = { city: 'placeCity', desk: 'placeDesk', off: 'placeOff' };
const GROUP_WORD: Readonly<Record<NoteGroup, keyof W>> = { market: 'groupMarket', yours: 'groupYours', earn: 'groupEarn', safety: 'groupSafety' };
const CAP_WORD: Readonly<Record<Cap, keyof W>> = { all: 'cap_all', few: 'cap_few', rare: 'cap_rare' };
const CORNER_WORD: Readonly<Record<Corner, keyof W>> = {
  'top-left': 'corner_top_left',
  top: 'corner_top',
  'top-right': 'corner_top_right',
  'bottom-left': 'corner_bottom_left',
  'bottom-right': 'corner_bottom_right',
};

const say = (w: W, key: keyof W): string => w[key] as string;

/** The wallet's one signed message, from a tap; never a transaction. */
async function prove(): Promise<'ok' | 'declined' | 'failed'> {
  const connection = useWallet.getState().connection;
  if (!connection) return 'failed';
  const proof = await proveWallet(connection);
  return proof.ok ? 'ok' : proof.state === 'declined' ? 'declined' : 'failed';
}

/**
 * The notification centre (`docs/research/ryntra-city-helm-2026-10-29/SPEC.md` §10): «Mute all» and the quiet hours, the
 * channels — Telegram connected in its row, the computer's permission — and every kind to the city, the computer or
 * nowhere. The liquidation risk has a lock where «off» is. Telegram is Ryntra's server's: a small mark beside the kinds
 * it tells there, never a choice the page pretends to make.
 */
export function NotifySection() {
  const w = useWords(SETTINGS);
  const prefs = useNotify((st) => st.prefs);
  const desk = useNotify((st) => st.desk);
  const feed = useFeed((st) => st.settings);
  const telegram = useChannels((st) => st.telegram);
  const telegramOn = telegram.status === 'ready' && telegram.value.connected;
  // A beacon goes to Telegram only when its own switch is on and the server keeps it: the mark stands only then.
  const beaconTelegram = useBeacons((b) => b.sync !== 'local' && b.rules.some((rule) => rule.on && rule.notify));
  const tellsTelegram = (kind: KindSpec) => kind.telegram && telegramOn && (kind.id !== 'beacons' || beaconTelegram);
  const st = useNotify.getState();
  const columns: readonly Place[] = desk === 'unsupported' ? ['city', 'off'] : ['city', 'desk', 'off'];

  return (
    <section className={s.section} aria-labelledby="settings-notifications">
      {/* Earn's notes may come late from the server (CITY-100): said here, behind the «i», never on the screen. */}
      <Head id="settings-notifications" title={w.notifications} info={EARN_OPEN ? [w.notifyInfo, w.notifyInfoEarn] : w.notifyInfo} />
      <Group>
        <Row label={w.muteAll}>
          <Switch on={prefs.muted} label={w.muteAll} onChange={st.setMuted} />
        </Row>
        <Row label={w.quietHours}>
          {prefs.quiet.on ? (
            <span className={s.clocks}>
              <input type="time" className={s.clock} aria-label={w.from} value={prefs.quiet.from} onChange={(e) => st.setQuiet({ from: e.target.value })} />
              <span className={s.clockDash} aria-hidden="true" />
              <input type="time" className={s.clock} aria-label={w.to} value={prefs.quiet.to} onChange={(e) => st.setQuiet({ to: e.target.value })} />
            </span>
          ) : null}
          <Switch on={prefs.quiet.on} label={w.quietHours} onChange={(on) => st.setQuiet({ on })} />
        </Row>
      </Group>

      <Channels />

      <div className={s.table} style={{ ['--cols' as string]: columns.length }} data-settings-table="">
        <div className={s.tableHead} aria-hidden="true">
          <span />
          {columns.map((place) => {
            const Icon = PLACE_ICON[place];
            return (
              <span key={place} className={s.placeHead}>
                <Icon />
                <span>{say(w, PLACE_WORD[place])}</span>
              </span>
            );
          })}
        </div>
        {GROUPS.map((group) => {
          const kinds = kindsShown(group);
          if (!kinds.length) return null;
          return (
            <div key={group} className={s.kindGroup} role="group" aria-label={say(w, GROUP_WORD[group])}>
              <div className={s.groupLabel} aria-hidden="true">
                {say(w, GROUP_WORD[group])}
              </div>
              {kinds.map((kind) => (
                <KindRow
                  key={kind.id}
                  kind={kind}
                  columns={columns}
                  route={routeShown(prefs, kind.id, () => (kind.feed ? feed[kind.feed] : true))}
                  cap={prefs.caps[kind.id]}
                  telegram={tellsTelegram(kind)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * One kind: where it goes, one tap per place; its name opens how often it may speak — where a cap holds anything (a
 * banner or the computer; a market kind in the city is the live feed, which no cap holds).
 */
function KindRow({ kind, columns, route, cap, telegram }: { kind: KindSpec; columns: readonly Place[]; route: Place; cap: Cap; telegram: boolean }) {
  const w = useWords(SETTINGS);
  const [open, setOpen] = useState(false);
  const name = say(w, `kind_${kind.id}` as keyof W);
  const nameId = `settings-kind-${kind.id}`;
  const capped = !kind.locked && route !== 'off' && !(kind.feed && route === 'city');
  return (
    <>
      <div className={s.kindRow} role="radiogroup" aria-labelledby={nameId} data-locked={kind.locked ? '' : undefined}>
        <span className={s.kindCell}>
          {capped ? (
            <button type="button" className={s.kindName} id={nameId} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {name}
            </button>
          ) : (
            <span className={s.kindName} id={nameId}>
              {name}
              {kind.locked ? <span className={s.always}>{w.alwaysOn}</span> : null}
            </span>
          )}
          {telegram ? (
            <span className={s.alsoTelegram} role="img" aria-label={w.alsoTelegram} title={w.alsoTelegram}>
              <TelegramGlyph />
            </span>
          ) : null}
        </span>
        {columns.map((place) => {
          const can = kind.places.includes(place);
          if (!can && place === 'off' && kind.locked) {
            return (
              <span key={place} className={s.cell} data-lock="" aria-hidden="true">
                <LockGlyph />
              </span>
            );
          }
          if (!can) return <span key={place} className={s.cell} data-none="" aria-hidden="true" />;
          const on = route === place;
          return (
            <span key={place} className={s.cell}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={say(w, PLACE_WORD[place])}
                className={`${s.pick} ${on ? s.pickOn : ''}`}
                data-place={place}
                onClick={() => !on && useNotify.getState().setRoute(kind.id, place)}
              >
                <span className={s.pickDot} />
              </button>
            </span>
          );
        })}
      </div>
      {open && capped ? (
        <div className={s.capRow}>
          <Segment<Cap> label={`${name} · ${w.often}`} value={cap} onChange={(next) => useNotify.getState().setCap(kind.id, next)} choices={CAPS.map((id) => ({ id, label: say(w, CAP_WORD[id]) }))} />
        </div>
      ) : null}
    </>
  );
}

/** Telegram, connected in its row, and the computer's own notifications. */
function Channels() {
  const w = useWords(SETTINGS);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const telegram = useChannels((st) => st.telegram);
  const link = liveLink(useChannels((st) => st.link));
  const busy = useChannels((st) => st.busy);
  const failure = useChannels((st) => st.failure);
  const desk = useNotify((st) => st.desk);

  useEffect(() => {
    void useChannels.getState().read(owner);
    const again = () => {
      if (document.visibilityState === 'visible') void useChannels.getState().read(owner);
    };
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [owner]);

  let status: string | null = null;
  let action: { label: string; run: () => void } | null = null;
  if (!owner) action = { label: w.telegramConnect, run: () => void cityAccount.getState().begin(null, 'top') };
  else if (telegram.status === 'signedOut') {
    action = {
      label: w.telegramSignIn,
      run: () =>
        void prove().then((r) => {
          if (r === 'ok') void useChannels.getState().read(owner);
        }),
    };
  } else if (telegram.status === 'ready' && telegram.value.connected) {
    status = telegram.value.username ? w.telegramConnected(telegram.value.username) : w.telegramOn;
    action = { label: w.telegramOff, run: () => void useChannels.getState().disconnect(owner, prove) };
  } else if (telegram.status === 'ready' || telegram.status === 'failed') {
    action = { label: link ? w.telegramOpen : w.telegramConnect, run: () => void useChannels.getState().connect(owner, lang, prove) };
  }

  return (
    <div className={s.channels} aria-label={w.channels} role="group">
      <div className={s.channel} data-on={status ? '' : undefined}>
        <span className={s.channelIcon}>
          <TelegramGlyph />
        </span>
        <span className={s.channelName}>
          Telegram
          {status ? <span className={s.channelState}>{status}</span> : null}
        </span>
        {telegram.status === 'reading' ? (
          <span className={s.bone} aria-busy="true" />
        ) : action ? (
          <button type="button" className={s.quiet} onClick={action.run} disabled={busy !== null} aria-busy={busy === 'connect' || busy === 'disconnect'}>
            {action.label}
          </button>
        ) : null}
      </div>
      {desk !== 'unsupported' ? (
        <div className={s.channel} data-on={desk === 'granted' ? '' : undefined}>
          <span className={s.channelIcon}>
            <DeskGlyph />
          </span>
          <span className={s.channelName}>{w.desk}</span>
          {desk === 'default' ? (
            <button type="button" className={s.quiet} onClick={() => void useNotify.getState().askDesk()}>
              {w.deskAllow}
            </button>
          ) : (
            <span className={s.channelState}>{desk === 'granted' ? w.deskOn : w.deskBlocked}</span>
          )}
        </div>
      ) : null}
      {failure ? <p className={s.line}>{failure === 'declined' ? w.declined : w.failed}</p> : null}
    </div>
  );
}

/** Where the banners stand: a small screen with its five places. */
export function CornerPicker() {
  const w = useWords(SETTINGS);
  const value = useNotify((st) => st.prefs.corner);
  return (
    <div className={s.screen} role="radiogroup" aria-label={w.banners}>
      {CORNERS.map((corner) => (
        <button
          key={corner}
          type="button"
          role="radio"
          aria-checked={value === corner}
          aria-label={say(w, CORNER_WORD[corner])}
          className={`${s.spot} ${value === corner ? s.spotOn : ''}`}
          data-corner={corner}
          onClick={() => value !== corner && useNotify.getState().setCorner(corner)}
        >
          <span />
        </button>
      ))}
    </div>
  );
}
