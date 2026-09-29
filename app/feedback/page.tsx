import type { Metadata } from "next";

import { FrozenFooter } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { PublicHeader } from "@/app/site/frozen/public-header";
import { PageHero } from "@/app/site/parts";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/module.css";

import { FeedbackForm } from "./feedback-form";

export const metadata: Metadata = {
  title: "Feedback — Ryntra",
  description: "Send product feedback to Ryntra. Not a support SLA.",
  robots: { index: false, follow: false },
};

export default function FeedbackPage() {
  return (
    <div className="rx">
      <MarkDefs />
      <PublicHeader />
      <main id="main" tabIndex={-1}>
        <PageHero
          eyebrow="Feedback"
          heading="What should change."
          lead="One inbox for the site, the cabinet and the bot. Security reports belong here too — they are marked, not mixed into marketing."
        />
        <section className="rx-shell" style={{ paddingBottom: "4rem" }}>
          <FeedbackForm source="site" />
        </section>
      </main>
      <FrozenFooter />
    </div>
  );
}
