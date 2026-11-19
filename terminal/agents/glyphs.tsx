import type { Role } from '@/city/lib/crew/read';
import { MenuIcon } from '@/terminal/shell/menu-icons';
import a from './agents.module.css';

/**
 * A worker's mark — the menu's own line icon for it (decision 109): Recurring buys and the money autopilot are bots on
 * «Bots», the pool keeper too; the launcher is Launch's.
 */
export function RoleIcon({ role }: { role: Role }) {
  return <MenuIcon name={role === 'trader' ? 'recurring' : role === 'pilot' ? 'autopilot' : role === 'keeper' ? 'keeper' : 'launchNew'} />;
}

/** «Another»: a plus on the kit's grid, the small size. */
export function PlusIcon() {
  return (
    <svg className={`${a.glyph} ${a.glyphS}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** The mark in its square, lit for the bot the card is about. */
export function RoleBadge({ role, on = false }: { role: Role; on?: boolean }) {
  return (
    <span className={a.badge} data-on={on ? '' : undefined}>
      <RoleIcon role={role} />
    </span>
  );
}
