import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublicDemoTour } from "./public-tour";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Search = { t?: string; lang?: string };

export const metadata: Metadata = {
  title: "Decision Ledger Tour — Ryntra",
  description:
    "A deterministic read-only tour of Ryntra’s decision structure: risk state, plan constraints, evidence and journal context. No wallet, receipt or order action.",
  robots: { index: false, follow: false },
  alternates: { canonical: "https://ryntra.io/demo" },
};

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;

  if (sp.t) {
    const params = new URLSearchParams({ t: sp.t, next: "/robinhood/workspace/terminal" });
    if (sp.lang) params.set("lang", sp.lang);
    redirect(`/api/session?${params.toString()}`);
  }

  return <PublicDemoTour />;
}
