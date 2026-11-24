'use client';

import { useEffect, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useChannels } from '@/city/lib/notify/channels-store';
import { proveWallet } from '@/city/lib/trade/proof';
import { useWallet } from '@/city/lib/trade/wallet';
import { Chip, Kick, Quiet, Switch } from '@/terminal/ui';
import { pushSupported, readPushHere, turnPush, type PushHere } from './push';
import { clockHere, keepSettings, readSettings, type DriveSettingsView, type DriveTopic, type Failure } from './read';
import { DRIVE } from './words';
import d from './drive.module.css';

const TOPICS: readonly DriveTopic[] = ['bought', 'sold', 'paused', 'stopped', 'week'];

/** The wallet's one signed message, from a tap; never a transaction. */
async function prove(): Promise<'ok' | 'declined' | 'failed'> {
  const connection = useWallet.getState().connection;
  if (!connection) return 'failed';
  const proof = await proveWallet(connection);
  return proof.ok ? 'ok' : proof.state === 'declined' ? 'declined' : 'failed';
}

/**
 * What the person hears of her agent, and where: each kind of note on or off at once, Telegram connected in its row,
 * this device's push in its own. Her settings are hers: the first change asks her wallet for one signed message, never
 * a transaction. Her clock and language ride along with it, so the week comes at her hour in her words.
 */
export function DriveSettings({ owner }: { owner: string }) {
  const w = useWords(DRIVE);
  const lang = useLang();
  const [settings, setSettings] = useState<DriveSettingsView | null>(null);
  const [push, setPush] = useState<PushHere | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Failure | null>(null);
  const telegram = useChannels((st) => st.telegram);
  const telegramBusy = useChannels((st) => st.busy === 'connect');
  const telegramOn = telegram.status === 'ready' && telegram.value.connected;

  // What is kept, without asking the wallet: a wallet that has not proved itself yet sees everything on.
  useEffect(() => {
    let live = true;
    void readSettings(false).then((kept) => live && kept?.ok && setSettings(kept.value));
    void readPushHere().then((here) => live && setPush(here));
    void useChannels.getState().read(owner);
    return () => {
      live = false;
    };
  }, [owner]);

  const topics = settings?.topics ?? { bought: true, sold: true, paused: true, stopped: true, week: true };
  const change = async (patch: Parameters<typeof keepSettings>[0]) => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    const kept = await keepSettings({ ...patch, locale: lang, timezone: clockHere() });
    setBusy(false);
    if (kept.ok) setSettings(kept.value);
    else setFailed(kept.why);
  };
  const togglePush = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    const after = await turnPush(on);
    setPush(after);
    setBusy(false);
    if (after === 'on' || after === 'off') await change({ push: after === 'on' });
  };

  return (
    <div className={d.settings} data-drive-settings="">
      <div className={d.group}>
        <Kick>{w.hear}</Kick>
        {TOPICS.map((topic) => (
          <div key={topic} className={d.row}>
            <span id={`drive-${topic}`}>{w[`t_${topic}`]}</span>
            <Switch on={topics[topic]} labelledBy={`drive-${topic}`} disabled={busy} onChange={(on) => void change({ topics: { [topic]: on } })} />
          </div>
        ))}
      </div>
      <div className={d.group}>
        <Kick>{w.where}</Kick>
        <div className={d.row}>
          <span id="drive-telegram">{w.telegram}</span>
          {telegramOn ? (
            <span className={d.rowEnd}>
              <Chip tone="ok" dot>
                {w.telegramOn}
              </Chip>
              <Switch on={settings?.telegram ?? true} labelledBy="drive-telegram" disabled={busy} onChange={(on) => void change({ telegram: on })} />
            </span>
          ) : (
            <Quiet size="s" disabled={telegramBusy} aria-busy={telegramBusy || undefined} onClick={() => void useChannels.getState().connect(owner, lang, prove)}>
              {w.telegramConnect}
            </Quiet>
          )}
        </div>
        <div className={d.row}>
          <span id="drive-phone">{w.phone}</span>
          {!pushSupported() || push === 'none' ? (
            <span className={d.dim}>{w.phoneNo}</span>
          ) : push === 'blocked' ? (
            <span className={d.dim}>{w.phoneBlocked}</span>
          ) : (
            <Switch on={push === 'on' && (settings?.push ?? true)} labelledBy="drive-phone" disabled={busy} onChange={(on) => void togglePush(on)} />
          )}
        </div>
      </div>
      {failed ? (
        <p className={d.note} data-tone="warn" role="status">
          {failed === 'walletNo' ? w.walletNo : failed === 'unreachable' ? w.unreachable : w.notSaved}
        </p>
      ) : null}
    </div>
  );
}
