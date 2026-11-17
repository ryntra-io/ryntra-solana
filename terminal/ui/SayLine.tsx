import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';
import s from './ui.module.css';

/**
 * A sentence for the agent, ready to say in one tap: «Trade BONK with 0.1 SOL a day». A button that says it
 * (`onSay`), or a link to where it is said (`href`). `tall` for a finger's row on a phone.
 */
export function SayLine({ onSay, href, tall = false, children }: { onSay?: () => void; href?: string; tall?: boolean; children: ReactNode }) {
  const body = (
    <>
      <span>{children}</span>
      <Icon name="arrow" size="s" />
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cx(s.sayline, tall && s.saylineTall)}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className={cx(s.sayline, tall && s.saylineTall)} onClick={onSay}>
      {body}
    </button>
  );
}
