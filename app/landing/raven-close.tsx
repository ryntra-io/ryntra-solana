"use client";

import Image from "next/image";
import { ArrowUpRight, ArrowRight } from "@phosphor-icons/react/dist/ssr";

import type { RavenCloseCopy } from "./raven-copy";

/**
 * Closing call to action.
 *
 * The character returns here, in close-up, after sitting out the middle of the
 * page. He opens the argument and closes it; the sections in between are where
 * the product has to speak for itself.
 *
 * The last line is where a landing page normally puts a promise. This one puts
 * the absence of promises: free during beta, non-custodial, no token, and no
 * date we have not earned. That is the whole positioning in one sentence, and
 * it belongs at the point of highest intent rather than in the footer.
 */
export function RavenClose({
  copy,
  betaHref,
  methodologyHref,
  onPrimary,
}: {
  /** Resolved on the server so the three-locale dictionary stays out of the bundle. */
  copy: RavenCloseCopy;
  betaHref: string;
  methodologyHref: string;
  onPrimary: () => void;
}) {

  return (
    <section className="rv-section rv-close" id="start">
      <div className="rv-close-glow" aria-hidden />
      <div className="rv-section-inner rv-close-inner">
        <div className="rv-close-copy rv-reveal">
          <span className="rv-eyebrow mono">{copy.eyebrow}</span>
          <h2 className="rv-h2 rv-close-title">{copy.title}</h2>
          <p className="rv-section-lead">{copy.lead}</p>

          <div className="rv-cta-row">
            <a href={betaHref} className="rv-btn rv-btn-primary" onClick={onPrimary}>
              {copy.primary}
              <ArrowUpRight size={17} weight="bold" aria-hidden />
            </a>
            <a href={methodologyHref} className="rv-btn rv-btn-ghost">
              {copy.secondary}
              <ArrowRight size={17} weight="bold" aria-hidden />
            </a>
          </div>

          <p className="rv-no-promise mono">{copy.noPromise}</p>
        </div>

        <div className="rv-close-figure">
          <Image
            src="/brand/ryn-closeup.webp"
            alt=""
            width={900}
            height={1158}
            className="rv-raven-close"
            sizes="(max-width: 900px) 70vw, 42vw"
          />
        </div>
      </div>
    </section>
  );
}
