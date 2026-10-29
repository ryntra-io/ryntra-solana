import type { Metadata } from "next";

import { ChartLicenses } from "@ryntra/core/chart";

import { publicServerLocale } from "@/lib/site/server-locale";

export const metadata: Metadata = {
  title: "Open-source licences",
  description: "The open-source libraries Ryntra's charts draw with, their licences and the notices their terms ask to be shown.",
  alternates: { canonical: "https://ryntra.io/legal/licenses" },
};

/**
 * The licences page (CH-17): the core's charts draw with open-source libraries — KLineChart under Apache-2.0 — whose
 * terms ask for their notice to be shown; the core's `ChartLicenses` gives each one word for word, in the reader's
 * language.
 */
export default async function LicensesPage() {
  const locale = await publicServerLocale();
  const lang = locale === "uk" ? "uk" : "en";
  return (
    <>
      <h1 lang={lang}>{lang === "uk" ? "Ліцензії відкритого коду" : "Open-source licences"}</h1>
      <ChartLicenses lang={lang} />
    </>
  );
}
