"use client";

import { Button, EmptyState, Page } from "@ryntra/core/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";

const WORDS = {
  title: { en: "This page did not load", uk: "Сторінка не завантажилась" },
  text: {
    en: "Something went wrong while this page was drawn. Try again; anything your wallet signed is in",
    uk: "Під час показу сторінки сталася помилка. Спробуй ще раз; усе, що підписав твій гаманець, — в",
  },
  again: { en: "Try again", uk: "Спробувати знову" },
  history: { en: "History", uk: "«Історії»" },
} as const;

/**
 * A page of the cabinet that failed while it was drawn (B15): inside the frame — the menu, the search and the wallet
 * stay around it — with one sentence and one way out, never the framework's bare error page. It catches every page of
 * the cabinet, an action's page after a signature too, so it claims nothing it cannot know: what the wallet did is in
 * «Історія».
 */
export default function CabinetError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale } = useSolanaI18n();
  const word = (key: keyof typeof WORDS) => WORDS[key][locale];
  const router = useRouter();
  /* A server page that failed is asked again: its data read anew, then the boundary drawn again. */
  const again = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Page kind="action" title={word("title")} lang={locale === "uk" ? "uk" : "en"} data-surface-state="ERROR">
      <EmptyState
        icon="circle-x"
        role="alert"
        text={
          <>
            {word("text")}{" "}
            <Link href="/app/activity" prefetch={false}>
              {word("history")}
            </Link>
            .
          </>
        }
        action={
          <Button variant="secondary" onClick={again} lang={locale === "uk" ? "uk" : "en"}>
            {word("again")}
          </Button>
        }
      />
    </Page>
  );
}
