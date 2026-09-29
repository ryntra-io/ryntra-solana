import { LEGAL_PACKAGE } from "../../lib/legal/release";

import type { PublicLocale } from "@/lib/site/locale";

/**
 * The notice on every review candidate: it is not in force, it replaces
 * nothing published, and what it waits for — the operator's identity, the
 * governing law, the transfer and retention schedules, and the signatures of
 * the founder and a qualified lawyer on this exact version.
 */
export function LegalReviewNotice({ locale = "en" }: { locale?: PublicLocale }) {
  return (
    <aside className="legal-review" role="status" aria-label={locale === "uk" ? "Статус юридичного перегляду" : "Legal review status"}>
      {locale === "uk" ? (
        <>
          <strong>Кандидат на юридичний перегляд — не чинний</strong>
          <p>
            Версія {LEGAL_PACKAGE.id} — чернетка, звірена з продуктом. Вона не замінює опублікованих
            документів і не є юридичним схваленням. Щоб набути чинності, їй потрібні: особа оператора й
            відповідального за дані, право й суд, графіки передачі та зберігання даних і підписи засновника
            та кваліфікованого юриста саме на цій версії.
          </p>
        </>
      ) : (
        <>
          <strong>Legal review candidate - not effective</strong>
          <p>
            Version {LEGAL_PACKAGE.id} is a draft checked against the product. It does not replace the
            published documents and must not be treated as legal approval. To take effect it needs the
            operator and controller identified, the governing law and forum, the transfer and retention
            schedules, and the founder&apos;s and a qualified lawyer&apos;s signatures on this exact version.
          </p>
        </>
      )}
    </aside>
  );
}
