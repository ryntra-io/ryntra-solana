import type { Role } from '@/city/lib/crew/read';
import { Icon } from '@/terminal/ui';
import a from './agents.module.css';

/**
 * An agent's mark, as the approved design draws it: the trader's candles and the launcher's rocket are the kit's own;
 * the autopilot's wheel and the keeper's waves are drawn here on the same grid, with the same stroke.
 */
export function RoleIcon({ role }: { role: Role }) {
  if (role === 'trader') return <Icon name="market" />;
  if (role === 'launcher') return <Icon name="launch" />;
  return (
    <svg className={a.glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {role === 'pilot' ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 3.5V10M5 16l5.3-3M19 16l-5.3-3" />
        </>
      ) : (
        <path d="M3 9c2 0 2 2 4.5 2S10 9 12 9s2 2 4.5 2S19 9 21 9M3 15c2 0 2 2 4.5 2s2.500-2 4.500-2 2 2 4.500 2 2.500-2 4.500-2" />
      )}
    </svg>
  );
}

/** «Another»: a plus on the kit's grid, the small size. */
export function PlusIcon() {
  return (
    <svg className={`${a.glyph} ${a.glyphS}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** The mark in its square, lit amber for the agent the screen is about. */
export function RoleBadge({ role, on = false }: { role: Role; on?: boolean }) {
  return (
    <span className={a.badge} data-on={on ? '' : undefined}>
      <RoleIcon role={role} />
    </span>
  );
}
