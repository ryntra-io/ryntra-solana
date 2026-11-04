'use client';

import { useEffect, useState } from 'react';
import { useCity } from '@/city/lib/city/store';
import { useFeed } from '@/city/lib/feed/store';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { LANG_LABEL, LANGS, setLang, useLang } from '@/city/lib/i18n/lang';
import { useChannels } from '@/city/lib/notify/channels-store';
import { flashShown, type FeedSide, type Flash } from '@/city/lib/notify/prefs';
import { useNotify } from '@/city/lib/notify/store';
import { PLAY_OPEN } from '@/city/lib/game/flag';
import { cityAccount, useCityAccount, useReadiness } from '@/city/lib/quarter/account-live';
import { BOLT_STEPS, OPEN_STYLES, OWN_SELLS, STYLES, useTradePrefs, type Style } from '@/city/lib/settings/trade';
import { colourOf } from '@/city/lib/trade/colour';
import { shortAddress } from '@/city/lib/trade/format';
import { proveWallet } from '@/city/lib/trade/proof';
import { useWallet } from '@/city/lib/trade/wallet';
import { layout } from '@/city/lib/window/store';
import { Group, Head, Row, Segment, Switch } from './bits';
import { BoltGlyph, CopyGlyph, LockGlyph, PhoneGlyph } from './glyphs';
import { CornerPicker } from './NotifySection';
import { SETTINGS } from './words';
import s from './settings.module.css';

/** The wallet: who is here, signed in or not, and the one action that fits. */
export function WalletSection() {
  const w = useWords(SETTINGS);
  const connection = useWallet((st) => st.connection);
  const ready = useReadiness();
  const step = useCityAccount((st) => st.step);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const busy = step === 'connecting' || step === 'signing' || step === 'opening';

  if (!connection) {
    return (
      <section className={s.section} aria-labelledby="settings-wallet">
        <Head id="settings-wallet" title={w.wallet} info={w.walletInfo} />
        <button type="button" className={s.action} onClick={() => void cityAccount.getState().begin(null, 'top')} disabled={busy} aria-busy={busy}>
          {w.connect}
        </button>
      </section>
    );
  }
  const signed = ready === 'ready';
  return (
    <section className={s.section} aria-labelledby="settings-wallet">
      <Head id="settings-wallet" title={w.wallet} info={w.walletInfo} />
      <div className={s.who}>
        <span className={s.avatar} style={{ ['--player' as string]: colourOf(connection.address) }} aria-hidden="true" />
        <span className={s.whoText}>
          <span className={s.address}>{shortAddress(connection.address)}</span>
          <span className={s.whoLine}>
            <span className={`${s.dot} ${signed ? s.dotOn : ''}`} aria-hidden="true" />
            {connection.wallet} · {signed ? w.signedIn : ready === 'checking' ? w.checking : w.notSignedIn}
          </span>
        </span>
        <button
          type="button"
          className={s.iconBtn}
          aria-label={copied ? w.copied : w.copy}
          onClick={() => {
            void navigator.clipboard?.writeText(connection.address).then(() => setCopied(true), () => undefined);
          }}
        >
          <CopyGlyph />
        </button>
      </div>
      {!signed ? (
        <button type="button" className={s.action} onClick={() => void cityAccount.getState().begin(null, 'top')} disabled={busy || ready === 'checking'} aria-busy={busy}>
          {w.signIn}
        </button>
      ) : null}
      <button type="button" className={s.quietWide} onClick={() => void cityAccount.getState().disconnect()} disabled={busy}>
        {w.disconnect}
      </button>
    </section>
  );
}

/** Trading: the ⚡ amount, the sale chips and the style. */
export function TradingSection() {
  const w = useWords(SETTINGS);
  const prefs = useTradePrefs((st) => st.prefs);
  const custom = !(BOLT_STEPS as readonly string[]).includes(prefs.bolt);
  const [other, setOther] = useState(custom ? prefs.bolt : '');
  const styleWord: Readonly<Record<Style, string>> = { safe: w.safe, fast: w.fast, sniper: w.sniper };
  return (
    <section className={s.section} aria-labelledby="settings-trading">
      <Head id="settings-trading" title={w.trading} info={w.tradingInfo} />
      <Group label={w.bolt}>
        <div className={s.chips} role="radiogroup" aria-label={w.bolt}>
          {BOLT_STEPS.map((step) => (
            <button key={step} type="button" role="radio" aria-checked={prefs.bolt === step} className={`${s.chip} ${prefs.bolt === step ? s.chipOn : ''}`} onClick={() => (useTradePrefs.getState().setBolt(step), setOther(''))}>
              <BoltGlyph />
              {digits(step)}
            </button>
          ))}
        </div>
        <label className={`${s.field} ${custom ? s.fieldOn : ''}`}>
          <span className={s.fieldLabel}>{w.boltOther}</span>
          <input
            className={s.fieldInput}
            inputMode="decimal"
            autoComplete="off"
            placeholder={digits('0.3')}
            value={other}
            onChange={(e) => setOther(e.target.value.replace(',', '.'))}
            onBlur={() => {
              if (other && !useTradePrefs.getState().setBolt(other)) setOther(custom ? prefs.bolt : '');
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <span className={s.fieldUnit}>SOL</span>
        </label>
      </Group>
      <Group label={w.sells}>
        <div className={s.sells}>
          {prefs.sells.slice(0, OWN_SELLS).map((value, index) => (
            <SellChip key={`${index}-${value}`} index={index} value={value} />
          ))}
          <span className={s.sellMax}>{w.max}</span>
        </div>
      </Group>
      <Group label={w.style}>
        <Segment<Style>
          label={w.style}
          value={prefs.style}
          onChange={(style) => useTradePrefs.getState().setStyle(style)}
          choices={STYLES.map((id) => ({ id, label: styleWord[id], disabled: !OPEN_STYLES.includes(id), icon: OPEN_STYLES.includes(id) ? undefined : <LockGlyph /> }))}
        />
      </Group>
    </section>
  );
}

/** One sale chip: a whole percentage; one the four cannot keep goes back to what it was. */
function SellChip({ index, value }: { index: number; value: number }) {
  const w = useWords(SETTINGS);
  const [text, setText] = useState(String(value));
  return (
    <label className={s.sell}>
      <input
        className={s.sellInput}
        inputMode="numeric"
        autoComplete="off"
        aria-label={`${w.sells} ${index + 1}`}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 3))}
        onBlur={() => {
          const n = Number(text);
          if (!text || !useTradePrefs.getState().setSell(index, n)) setText(String(value));
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className={s.sellUnit}>%</span>
    </label>
  );
}

export function LayoutsSection() {
  const w = useWords(SETTINGS);
  return (
    <section className={s.section} aria-labelledby="settings-layouts">
      <Head id="settings-layouts" title={w.layouts} info={w.layoutsInfo} />
      <button type="button" className={s.quietWide} onClick={() => layout('grid')}>
        {w.snap}
      </button>
    </section>
  );
}

export function LanguageSection() {
  const w = useWords(SETTINGS);
  const lang = useLang();
  return (
    <section className={s.section} aria-labelledby="settings-language">
      <Head id="settings-language" title={w.language} />
      <div className={s.tiles} role="radiogroup" aria-label={w.language}>
        {LANGS.map((code) => (
          <button key={code} type="button" role="radio" lang={code} aria-checked={lang === code} className={`${s.tile} ${lang === code ? s.tileOn : ''}`} onClick={() => lang !== code && setLang(code)}>
            {LANG_LABEL[code]}
          </button>
        ))}
      </div>
    </section>
  );
}

export function SoundSection({ onSound }: { onSound: (on: boolean) => void }) {
  const w = useWords(SETTINGS);
  const sound = useCity((st) => st.sound);
  return (
    <section className={s.section} aria-labelledby="settings-sound">
      <Head id="settings-sound" title={w.sound} />
      <Group>
        <Row label={w.sound}>
          <Switch on={sound} label={w.sound} onChange={onSound} />
        </Row>
      </Group>
    </section>
  );
}

/**
 * What stands on the screen: where the banners stand, which side the event feed opens on, how big the city's flashes
 * are, and the Play layer's «Arrivals» card where Play is open.
 */
export function DisplaySection() {
  const w = useWords(SETTINGS);
  const prefs = useNotify((st) => st.prefs);
  const settings = useFeed((st) => st.settings);
  const flip = useFeed((st) => st.set);
  const st = useNotify.getState();
  return (
    <section className={s.section} aria-labelledby="settings-display">
      <Head id="settings-display" title={w.display} info={w.displayInfo} />
      <Group label={w.banners}>
        <CornerPicker />
      </Group>
      <Group>
        <Row label={w.feed}>
          <Segment<FeedSide>
            label={w.feed}
            value={prefs.feed}
            onChange={st.setFeedSide}
            choices={[
              { id: 'left', label: w.feedLeft },
              { id: 'right', label: w.feedRight },
              { id: 'hidden', label: w.feedHidden },
            ]}
          />
        </Row>
        <Row label={w.flashes}>
          <Segment<Flash>
            label={w.flashes}
            value={flashShown(prefs, settings.flashing)}
            onChange={st.setFlash}
            choices={[
              { id: 'off', label: w.flashOff },
              { id: 'small', label: w.flashSmall },
              { id: 'cinema', label: w.flashCinema },
            ]}
          />
        </Row>
        {PLAY_OPEN ? (
          <Row label={w.arrivals}>
            <Switch on={settings.arrivals} label={w.arrivals} onChange={(on) => flip('arrivals', on)} />
          </Row>
        ) : null}
      </Group>
    </section>
  );
}

/** Guard under the hood, in one line: the keys stay with you; and the phones that get pushes. */
export function SecuritySection() {
  const w = useWords(SETTINGS);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const devices = useChannels((st) => st.devices);
  const busy = useChannels((st) => st.busy);
  useEffect(() => {
    void useChannels.getState().read(owner);
  }, [owner]);
  const prove = async (): Promise<'ok' | 'declined' | 'failed'> => {
    const connection = useWallet.getState().connection;
    if (!connection) return 'failed';
    const proof = await proveWallet(connection);
    return proof.ok ? 'ok' : proof.state === 'declined' ? 'declined' : 'failed';
  };
  return (
    <section className={s.section} aria-labelledby="settings-security">
      <Head id="settings-security" title={w.security} info={w.securityInfo} />
      <p className={s.lead}>{w.securityLine}</p>
      {owner ? (
        <Group label={w.phones}>
          {devices.status === 'reading' ? (
            <span className={s.boneWide} aria-busy="true" />
          ) : devices.status === 'ready' && devices.value.length ? (
            devices.value.map((device) => (
              <div className={s.device} key={device.deviceId}>
                <span className={s.channelIcon}>
                  <PhoneGlyph />
                </span>
                <span className={s.channelName}>{w.phone(device.appVersion)}</span>
                <button type="button" className={s.quiet} disabled={busy !== null} onClick={() => void useChannels.getState().removeDevice(owner, device.deviceId, prove)}>
                  {w.remove}
                </button>
              </div>
            ))
          ) : devices.status === 'ready' ? (
            <p className={s.muted}>{w.noPhones}</p>
          ) : null}
        </Group>
      ) : null}
    </section>
  );
}
