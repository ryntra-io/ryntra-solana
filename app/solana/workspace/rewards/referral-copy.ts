import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * The words of invitations, in both languages, beside the card that says them.
 *
 * Kept here rather than in the workspace catalogue for the same reason as
 * `rank-copy.ts`: the catalogue is the core's file and the referral programme
 * is the Growth line's. Sentences the card already said before stay in the
 * catalogue; the ones that are new, or that had to stop saying something
 * untrue, live here.
 */

type Copy = Readonly<{
  /** Carried, not bound yet: it binds on its own once the wallet is confirmed. */
  autoLead: string;
  autoLeadUntil: (until: string) => string;
  /** Too late: the first trade was more than seven days ago. Never "already has an inviter". */
  windowClosed: (inviter: string) => string;
  /** The same, as the answer to a binding that was refused for it. */
  refusedLate: string;
  /** The one change was already made. */
  refusedChanged: string;
  /** Bound: the one change, while the window is open. */
  changeHint: string;
  changeHintUntil: (until: string) => string;
  changeAction: string;
  changeTitle: string;
  changeOnce: string;
  changeConfirm: string;
  /** A link for somebody else opened after binding, offered as the one change. */
  changeOffer: (inviter: string, until: string | null) => string;
  changeTo: (inviter: string) => string;
  keep: string;
  /** Before the wallet is even connected: connect, then confirm. */
  autoLeadVisitor: string;
  /** The inviter row's mark: set on its own, so "set", not "confirmed". */
  setMark: string;
  /** The editor's preview of the code being switched to. */
  newInviter: string;
  /** For a proven wallet a chosen code binds at once: say so. */
  linkCode: string;
  hide: string;
  /** The field takes a code or the whole link a friend sent. */
  codeOrLink: string;
  /** Lookup found nothing in what was typed or pasted. */
  notFound: string;
  /** The inviter's own code, beside their link. */
  yourCode: string;
  copyCode: string;
  copied: string;
  /** The banner outside «Винагороди». */
  bannerLead: (inviter: string) => string;
  bannerBound: (inviter: string) => string;
  bannerAction: string;
  bannerHide: string;
  bannerLabel: string;
}>;

const COPY: Readonly<Record<WorkspaceLocale, Copy>> = {
  en: {
    autoLead: "Set automatically once you confirm your wallet — a new one, or one whose first trade or reward was within the last 7 days.",
    autoLeadUntil: (until) => `It is set automatically once you confirm your wallet — until ${until}.`,
    windowClosed: (inviter) => `The invitation from ${inviter} came too late: first trade or reward over 7 days ago.`,
    refusedLate: "Too late for this wallet: its first trade or reward was more than 7 days ago.",
    refusedChanged: "This wallet has already changed its inviter once.",
    changeHint: "You can change it once, before your first trade or reward or within 7 days after it.",
    changeHintUntil: (until) => `You can change it once, until ${until}.`,
    changeAction: "Change",
    changeTitle: "Change inviter",
    changeOnce: "An inviter can be changed only once; the current one keeps their share of trades made before the change.",
    changeConfirm: "Switch to this code",
    changeOffer: (inviter, until) => `Invitation from ${inviter} — you can switch once${until ? `, until ${until}` : ""}.`,
    changeTo: (inviter) => `Switch to ${inviter}`,
    keep: "Keep current",
    autoLeadVisitor: "Set automatically when you sign in with a wallet — a new one, or one whose first trade or reward was within the last 7 days.",
    setMark: "Linked",
    newInviter: "New inviter",
    linkCode: "Link this code",
    hide: "Hide",
    codeOrLink: "Code or link",
    notFound: "No invitation found in that code or link.",
    yourCode: "Your code",
    copyCode: "Copy code",
    copied: "Copied",
    bannerLead: (inviter) => `${inviter} invited you to Ryntra`,
    bannerBound: (inviter) => `Invited to Ryntra by ${inviter}`,
    bannerAction: "Rewards",
    bannerHide: "Hide invitation",
    bannerLabel: "Invitation",
  },
  uk: {
    autoLead: "Закріпиться автоматично після підтвердження гаманця — нового або з першою угодою чи винагородою за останні 7 днів.",
    autoLeadUntil: (until) => `Закріпиться автоматично, щойно ви підтвердите гаманець, — до ${until}.`,
    windowClosed: (inviter) => `Запрошення від ${inviter} запізнилося: перша угода чи винагорода — понад 7 днів тому.`,
    refusedLate: "Для цього гаманця вже пізно: перша угода чи винагорода була понад 7 днів тому.",
    refusedChanged: "Запрошувача вже змінювали — вдруге не можна.",
    changeHint: "Змінити можна один раз — до першої угоди чи винагороди й ще 7 днів після неї.",
    changeHintUntil: (until) => `Змінити можна один раз — до ${until}.`,
    changeAction: "Змінити",
    changeTitle: "Змінити запрошувача",
    changeOnce: "Запрошувача можна змінити лише один раз; теперішній лишає собі частку з угод до зміни.",
    changeConfirm: "Змінити на цей код",
    changeOffer: (inviter, until) => `Запрошення від ${inviter} — змінити можна один раз${until ? `, до ${until}` : ""}.`,
    changeTo: (inviter) => `Змінити на ${inviter}`,
    keep: "Залишити як є",
    autoLeadVisitor: "Закріпиться автоматично після входу гаманцем — новим або з першою угодою чи винагородою за останні 7 днів.",
    setMark: "Закріплено",
    newInviter: "Новий запрошувач",
    linkCode: "Закріпити цей код",
    hide: "Сховати",
    codeOrLink: "Код або посилання",
    notFound: "У цьому коді чи посиланні запрошення не знайдено.",
    yourCode: "Ваш код",
    copyCode: "Копіювати код",
    copied: "Скопійовано",
    bannerLead: (inviter) => `${inviter} запрошує вас у Ryntra`,
    bannerBound: (inviter) => `Ви в Ryntra за запрошенням ${inviter}`,
    bannerAction: "Винагороди",
    bannerHide: "Сховати запрошення",
    bannerLabel: "Запрошення",
  },
};

export function referralCopy(locale: WorkspaceLocale): Copy {
  return COPY[locale] ?? COPY.en;
}

/** The window's last moment as this language writes a day and a time. */
export function referralDeadline(iso: string, locale: WorkspaceLocale): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return iso;
  /* Held together on one line: a deadline split as «13 жовтня о / 13:07»
     reads as two things. */
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
    day: "numeric",
    month: "long",
    hour: locale === "uk" ? "2-digit" : "numeric",
    minute: "2-digit",
  }).format(at).replace(/[ \u202f]/g, "\u00a0");
}
