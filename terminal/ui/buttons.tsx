import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { children: ReactNode };

/**
 * The screen's one amber action — one per screen, the thing the person came to do. Full width by default; `size="m"`
 * for a narrower place, `full={false}` to take its own width. `busy` keeps it pressed while the action is on its way.
 */
export function Action({ size = 'l', full = true, busy = false, className, type = 'button', children, ...rest }: ButtonProps & { size?: 'l' | 'm'; full?: boolean; busy?: boolean }) {
  return (
    <button type={type} className={cx(s.act, size === 'm' && s.actM, !full && s.auto, className)} aria-busy={busy || undefined} {...rest}>
      {children}
    </button>
  );
}

/** A quiet link that looks like a quiet button: a door to another screen («Launch» on the phone's market). */
export function QuietLink({ href, size = 'm', className, children }: { href: string; size?: 'm' | 's'; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx(s.quiet, size === 's' && s.quietS, className)}>
      {children}
    </Link>
  );
}

/** A quiet button: everything on a screen that is not its one action. `size="s"` inside a row, `full` across its column. */
export function Quiet({ size = 'm', full = false, className, type = 'button', children, ...rest }: ButtonProps & { size?: 'm' | 's'; full?: boolean }) {
  return (
    <button type={type} className={cx(s.quiet, size === 's' && s.quietS, full && s.wide, className)} {...rest}>
      {children}
    </button>
  );
}
