import Link from "next/link";
import type { ReactNode } from "react";

import { Mark } from "@/city/components/hud/Mark";
import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { BUNDLED_CITY } from "@/city/lib/market/bundled";
import { CITY_FONTS } from "@/city/styles/fonts";
import { terminalOpen } from "@/terminal/shell/flag";
import { TerminalShell } from "@/terminal/shell/TerminalShell";
import t from "@/terminal/styles/terminal.module.css";
import { ZERO } from "@/terminal/styles/zero";

import b from "./book.module.css";

/**
 * The frame of the documentation and the roadmap: the terminal's own — its rail, its header with the agent's
 * line and, on a phone, its five tabs — so a person reading about a section is one tap from it. Where the build keeps
 * the terminal shut (its switch, `terminal/shell/flag.ts`), the pages stand on the terminal's colours and faces with a
 * bar of their own, so they still answer.
 */
export function TerminalFrame({ children }: { children: ReactNode }) {
  return (
    <div className={`${t.root} ${CITY_FONTS.className} ${ZERO.variable}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      {terminalOpen() ? (
        <TerminalShell initial={BUNDLED_CITY}>{children}</TerminalShell>
      ) : (
        <div className={b.plain}>
          <Link className={b.plainBrand} href="/" aria-label="Ryntra">
            <Mark size={28} glow={false} />
            <span>RYNTRA</span>
          </Link>
          <main className={b.plainMain}>{children}</main>
        </div>
      )}
    </div>
  );
}
