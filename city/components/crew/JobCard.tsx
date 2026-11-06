'use client';

import type { Role } from '@/city/lib/crew/read';
import { CREW_WORDS } from '@/city/lib/crew/words';
import { useWords } from '@/city/lib/i18n/dict';
import { CrewGlyph, RoleGlyph } from './glyphs';
import s from './crew.module.css';

/**
 * «This is a job for an agent» (CITY-205): what the consultant shows instead of words when a sentence hands money work
 * over — the agent who does it, and «Hire», which opens that agent's own card. With no agent named: the crew.
 */
export function JobCard({ role, onHire }: Readonly<{ role: Role | null; onHire: () => void }>) {
  const w = useWords(CREW_WORDS);
  return (
    <div className={s.job} role="status" data-job={role ?? 'crew'}>
      <p className={s.jobLine}>{w.job}</p>
      <div className={s.jobAgent}>
        <span className={s.badge}>{role ? <RoleGlyph role={role} size={24} /> : <CrewGlyph size={24} />}</span>
        <span>
          <b>{role ? w[role] : w.kicker}</b>
          {role ? <span>{w[`${role}Job`]}</span> : null}
        </span>
      </div>
      <button type="button" className={s.hire} onClick={onHire} data-job-hire="">
        {role ? w.hire : w.allAgents}
      </button>
    </div>
  );
}
