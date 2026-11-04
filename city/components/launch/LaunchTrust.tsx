'use client';

import { useEffect, useState } from 'react';
import type { LaunchFlowResponse } from '@/lib/api/v1/contract';
import { launchEngine } from '@/city/lib/launch/district';
import { devStrip, flowMethod, trustPills } from '@/city/lib/launch/trust';
import { TRUST_WORDS } from '@/city/lib/launch/words';
import { useLang } from '@/city/lib/i18n/lang';
import s from './launch.module.css';

/** How often an open tower reads the flow again: the engine keeps one answer for two minutes. */
const FLOW_MS = 60_000;

/**
 * The flow of the picked launch, read when its tower opens and again while it stays open. `settled`: the engine answered
 * this token once, with the flow or without it.
 */
export function useLaunchFlow(token: string): Readonly<{ flow: LaunchFlowResponse | null; settled: boolean }> {
  const [read, setRead] = useState<Readonly<{ token: string; flow: LaunchFlowResponse | null }> | null>(null);
  useEffect(() => {
    let live = true;
    const ask = async () => {
      const answer = await launchEngine().flow(token);
      if (!live) return;
      /* A later read that fails keeps the flow already shown. */
      setRead((last) => (answer.ok ? { token, flow: answer.data } : last?.token === token ? last : { token, flow: null }));
    };
    void ask();
    const timer = setInterval(ask, FLOW_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [token]);
  return read?.token === token ? { flow: read.flow, settled: true } : { flow: null, settled: false };
}

/**
 * The launch's flow on its tower (L3, CITY-140): a few facts as pills and the creator's strip, the method behind one
 * «i». While the engine reads, the place is held so the window does not jump; a flow the engine could not read leaves
 * nothing.
 */
export function LaunchTrust({ flow, settled, omit }: { flow: LaunchFlowResponse | null; settled: boolean; omit?: readonly string[] }) {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  if (!flow) return settled ? null : <div className={s.trustHold} aria-hidden="true" />;
  /* A fact the window already says elsewhere is not said again here (`omit`, by the pill's id). */
  const pills = trustPills(flow, lang).filter((pill) => !omit?.includes(pill.id));
  const dev = devStrip(flow, lang);
  return (
    <div className={s.trust}>
      <div className={s.pills}>
        {pills.map((pill) => (
          <span key={pill.id} className={`${s.pill} ${pill.tone === 'watch' ? s.pillWatch : ''}`}>
            {pill.text}
          </span>
        ))}
        <button className={`${s.info} ${open ? s.infoOpen : ''}`} aria-expanded={open} aria-label={TRUST_WORDS[lang].howCounted} onClick={() => setOpen(!open)}>
          i
        </button>
      </div>
      {dev && (
        <div className={s.dev}>
          <span className={s.devBought}>{dev.bought}</span>
          <span className={dev.soldTone === 'watch' ? s.devWatch : undefined}>{dev.sold}</span>
          <span>{dev.holds}</span>
          {dev.linked && <span className={s.devLinked}>{dev.linked}</span>}
        </div>
      )}
      {open && (
        <ul className={s.method}>
          {flowMethod(flow, lang).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
