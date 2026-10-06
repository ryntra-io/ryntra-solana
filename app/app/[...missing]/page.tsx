import { notFound } from "next/navigation";

/**
 * Any address under `/app` that no page answers is the cabinet's own «not
 * found» (`app/app/not-found.tsx`), inside its shell — the menu, the search
 * and the wallet around it — rather than the framework's bare page. A page
 * that exists always wins over this catch-all.
 */
export default function MissingCabinetPage(): never {
  notFound();
}
