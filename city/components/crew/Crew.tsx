'use client';

import { useEffect, useId, useState } from 'react';
import { agentFeeFigures } from '@/city/lib/bots/agent-fee';
import { syncAgents, useAgents } from '@/city/lib/bots/agents';
import { MANDATE_NET, useMandate } from '@/city/lib/bots/mandate';
import { CARE_MODE } from '@/city/lib/earn/care';
import { cityDoors } from '@/city/lib/command/doors';
import { crewGatesNow, useCrew } from '@/city/lib/crew/hire';
import { CREW, ROLE_FACTS, type Role } from '@/city/lib/crew/read';
import { CREW_WORDS } from '@/city/lib/crew/words';
import { useLang } from '@/city/lib/i18n/lang';
import { useWords } from '@/city/lib/i18n/dict';
import { readPilot, usePilot } from '@/city/lib/pilot/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { RoleGlyph } from './glyphs';
import s from './crew.module.css';

type State = 'hire' | 'working' | 'soon';

/**
 * «Your agents» on top of «Bots → Start» (CITY-205): the workers a person hires — the Trader, the Autopilot, the pool
 * keeper, the Launcher — each one job, its state in one word, one tap to its own card. What each may do (its skills),
 * how it is paid (a fee inside its trades, never credits) and that rules decide wait behind «How agents work». The
 * consultant is not here: it is Ryntra in the top bar.
 */
export function Crew() {
  const w = useWords(CREW_WORDS);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const traderOn = useMandate((st) => {
    const record = owner ? st.records[owner] : undefined;
    return Boolean(record && st.status[record.policy]?.active);
  });
  const pilotOn = usePilot((st) => st.view?.status === 'working');
  /* CITY-207: the piers the agent looks after, from the engine's answer for the wallet. */
  const keeperOn = useAgents((st) => (owner && CARE_MODE !== 'closed' ? (st.byOwner[owner]?.networks[CARE_MODE].cares ?? []).some((c) => c.status === 'working') : false));
  const focus = useCrew((st) => st.focus);
  const at = useCrew((st) => st.at);
  const [open, setOpen] = useState(false);
  const [glow, setGlow] = useState<Role | null>(null);
  const howId = useId();
  const gates = crewGatesNow();

  // The wallet's plan, read once the window knows the wallet: the Autopilot's tile says «Working» when it is.
  useEffect(() => {
    if (owner && gates.pilot) void readPilot(owner);
  }, [owner, gates.pilot]);

  // CITY-207: the wallet's agents from the engine, so a new browser or the phone sees the agent hired elsewhere.
  useEffect(() => {
    if (owner && (MANDATE_NET || CARE_MODE !== 'closed')) void syncAgents(owner);
  }, [owner]);

  // Sent here for one agent («торгуй за мене»): its tile glows a moment; the Trader's own card — the budget below — comes into view.
  useEffect(() => {
    if (!at || Date.now() - at > 4_000) return;
    setGlow(focus);
    if (focus === 'trader') document.querySelector('[data-mandate]')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const timer = setTimeout(() => setGlow(null), 2_400);
    return () => clearTimeout(timer);
  }, [at, focus]);

  const stateOf = (role: Role): State => {
    if (!gates[role]) return 'soon';
    if ((role === 'trader' && traderOn) || (role === 'pilot' && pilotOn) || (role === 'keeper' && keeperOn)) return 'working';
    return 'hire';
  };
  const fee = agentFeeFigures(lang);

  return (
    <section className={s.crew} aria-label={w.kicker} data-crew="">
      <h3 className={s.kicker}>{w.kicker}</h3>
      <div className={s.grid}>
        {CREW.map((role) => {
          const state = stateOf(role);
          return (
            <button
              key={role}
              type="button"
              className={s.tile}
              disabled={state === 'soon'}
              data-role={role}
              data-working={state === 'working' ? '' : undefined}
              data-focus={glow === role ? '' : undefined}
              onClick={() => cityDoors.openCrew(role)}
            >
              <span className={s.tileHead}>
                <span className={s.badge}>
                  <RoleGlyph role={role} />
                </span>
              </span>
              <span className={s.tileText}>
                <b>{w[role]}</b>
                <span>{w[`${role}Job`]}</span>
              </span>
              <span className={s.state} data-state={state}>
                {state === 'working' ? w.working : state === 'soon' ? w.soon : w.hire}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" className={s.more} aria-expanded={open} aria-controls={howId} onClick={() => setOpen((v) => !v)}>
        {w.details}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 10l5 5 5-5" />
        </svg>
      </button>
      {open ? (
        <ul id={howId} className={s.how}>
          <li>{w.howBudget}</li>
          <li>{w.howRules}</li>
          <li>{w.howPay(fee.low, fee.high)}</li>
          <li>{w.howAsk}</li>
          <li className={s.skills} aria-label={w.skills}>
            {CREW.map((role) => (
              <span key={role} className={s.skillRow}>
                <b>{w[role]}</b>
                {ROLE_FACTS[role].skills.map((skill) => (
                  <span key={skill} className={s.chip}>
                    {w[skill as keyof typeof w] as string}
                  </span>
                ))}
              </span>
            ))}
          </li>
        </ul>
      ) : null}
    </section>
  );
}
