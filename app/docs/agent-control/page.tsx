import type { Metadata } from "next";
import Link from "next/link";

import { sitePageMetadata } from "@/app/site/seo";
import {
  AGENT_CONTROL_DEFERRED,
  AGENT_CONTROL_SURFACES,
  AGENT_CONTROL_WRITE_AUTHORITY,
  AGENT_CONTROL_WRITE_PATH,
} from "@/lib/product/agent-control-surfaces";
import { PROMOTABLE_CAPABILITIES, mainnetPerimeter } from "@/lib/agent-control/mainnet-promotion";
import { Chapter } from "../parts";
import { DocsArticle } from "../article";
import { entryFor } from "../nav";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";
import "../handbook.css";
import "../docs.css";

export const revalidate = 3600;

const HREF = "/docs/agent-control";

export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra Documentation`,
  description:
    "Every Agent Control surface, what it refuses, the one write path that is not a page, and what was designed but is not built.",
});

/**
 * The public product page for Agent Control.
 *
 * It renders `lib/product/agent-control-surfaces.ts` and the real promotion
 * gate, and adds no claim of its own. The finish line's last condition is *no
 * sentence a person can read that a test cannot check*; a page of hand-written
 * prose about a product cannot satisfy it, because every paragraph would be a
 * claim backed by nothing but the day somebody wrote it.
 *
 * Three chapters, and the second and third are the ones that matter. **What is
 * not built** is published rather than omitted: a reader deciding whether to
 * trust this is better served by the enumerated gap than by silence, and the
 * enumeration is what stops a later surface from implying one of these works.
 * **Mainnet promotion** is computed at render time by the same function that
 * would promote a capability, so the table cannot say something the gate does
 * not.
 */
/**
 * A route path with a break opportunity after each slash.
 *
 * `/agents/workspace/adoption` is three times the length of Home's `/app/brief`,
 * and a monospace run with no break opportunity forced the first column wide
 * enough that the *refuses* column — the useful half of this table — was
 * squeezed to a few words per line. `<wbr />` lets the path wrap where a reader
 * would break it anyway, and truncates nothing: the whole path is still there.
 */
function Path({ href }: { href: string }) {
  const parts = href.split("/").filter(Boolean);
  return (
    <code className="rx-fine">
      {parts.map((part, index) => (
        <span key={part + String(index)}>
          /{part}
          {index < parts.length - 1 ? <wbr /> : null}
        </span>
      ))}
    </code>
  );
}

export default function Page() {
  const perimeter = mainnetPerimeter({ asOf: new Date().toISOString() });

  return (
    <DocsArticle
      href={HREF}
      reviewed="2026-08-24"
      lead="Every Agent Control surface, what it refuses to do, and everything designed that is not built."
    >
      <Chapter
        id="surfaces"
        n="10"
        heading="Agent Control"
        meta={`${AGENT_CONTROL_SURFACES.length} surfaces · write authority ${AGENT_CONTROL_WRITE_AUTHORITY}`}
        lead="Control and proof for economic actions proposed by AI agents. Exactly three public artifacts — Agent Passport, Action Passport, Outcome Receipt — and no fourth."
        bare
        source={[
          "Source: lib/product/agent-control-surfaces.ts",
          "Rendered from the register, not written here",
          "Checked by lib/agent-control/finish-battery.test.mjs",
        ]}
      >
        <div className="rx-prose">
          <p>
            Each row names a surface, the route that serves it and the question it answers. The{" "}
            <em>refuses</em> column is the useful half: it is where the product states what it
            will not do, which is the part a reader cannot check by looking at a screenshot.
          </p>
          <p>
            No surface listed here writes, signs, authorizes, executes or moves anything. The
            product does have one write path and it is not a page:{" "}
            {AGENT_CONTROL_WRITE_PATH.where}, whose single effect value is{" "}
            <code>{AGENT_CONTROL_WRITE_PATH.effect}</code>. {AGENT_CONTROL_WRITE_PATH.why}
          </p>
        </div>

        <div className="rx-scroll">
          <table className="rx-table">
            <thead>
              <tr>
                <th scope="col">Surface</th>
                <th scope="col">The question it answers</th>
                <th scope="col">Refuses</th>
              </tr>
            </thead>
            <tbody>
              {AGENT_CONTROL_SURFACES.map((surface) => (
                <tr key={surface.id}>
                  <th scope="row">
                    <Link href={surface.href}>{surface.label}</Link>
                    <br />
                    <Path href={surface.href} />
                  </th>
                  <td>{surface.question}</td>
                  <td>
                    <ul>
                      {surface.refuses.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Chapter>

      <Chapter
        id="mainnet"
        n="11"
        heading="Mainnet promotion"
        meta={`${perimeter.promotable} of ${perimeter.capabilities.length} promotable`}
        lead="Every capability is judged on its own canary. Nothing is promoted because another capability ran, and nothing is promoted because a chain opened."
        bare
        source={[
          "Source: lib/agent-control/mainnet-promotion.ts",
          "Computed while this page renders",
          "Rail: Base Sepolia, testnet only",
        ]}
      >
        <div className="rx-prose">
          <p>
            A capability reaches a mainnet only on a canary that names <em>that</em> capability, on{" "}
            <em>that</em> capability&rsquo;s mainnet, observed by something other than the path
            that submitted it, reconciled, unexpired, and with an owner decision attached. The
            table below is produced by that gate rather than restated beside it.
          </p>
          <p>
            Base Sepolia is the default execution rail for this phase &mdash; testnet only, no
            mainnet execution &mdash; so there is no mainnet run to record and every row is
            refused. That refusal is computed, not written: when a canary exists, the row
            changes because the record changed.
          </p>
        </div>

        {/* Two columns rather than three.
            The first version split capability / what it would mean / state, and
            the third cell's text is long enough that auto layout gave it most of
            the width — the middle column came out about ten characters wide and
            broke one word per line. Two columns, each carrying a heading and its
            detail, reads at the width this template actually has. */}
        <div className="rx-scroll">
          <table className="rx-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Why it is not promoted</th>
              </tr>
            </thead>
            <tbody>
              {perimeter.capabilities.map((verdict) => {
                const capability = PROMOTABLE_CAPABILITIES.find((entry) => entry.id === verdict.capability);
                return (
                  <tr key={verdict.capability}>
                    {/* The row header carries the name and the chain and nothing
                        else. This template renders `th` uppercase and bold, so a
                        sentence put here came out as a wall of capitals — which
                        is the one thing a surface should never show a reader.
                        Prose belongs in the cell. */}
                    <th scope="row">
                      {verdict.label}
                      <br />
                      <code className="rx-fine">{verdict.mainnetChainRef}</code>
                    </th>
                    <td>
                      <p>{capability?.what}</p>
                      <p>
                        <code>{verdict.refusals.join(", ") || "PROMOTABLE"}</code> &mdash;{" "}
                        {verdict.opensWith}
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Chapter>

      <Chapter
        id="not-built"
        n="12"
        heading="What is not built"
        meta={`${AGENT_CONTROL_DEFERRED.length} deferred`}
        lead="Everything designed for this product that it has not built, each with the exact condition that would open it."
        bare
        source={[
          "Source: lib/product/agent-control-surfaces.ts",
          "Rendered from the register, not written here",
        ]}
      >
        <div className="rx-prose">
          <p>
            A finish line is only honest if the unfinished parts are enumerated. A silent omission
            and a deliberate deferral render identically in a feature list and mean opposite
            things, so every item below names its gate and a real path in the repository where the
            work would land.
          </p>
        </div>

        <div className="rx-scroll">
          <table className="rx-table">
            <thead>
              <tr>
                <th scope="col">Not built</th>
                <th scope="col">What would have to exist</th>
              </tr>
            </thead>
            <tbody>
              {AGENT_CONTROL_DEFERRED.map((entry) => (
                <tr key={entry.id}>
                  <th scope="row">
                    {entry.label}
                    <br />
                    <code className="rx-fine">{entry.nearest}</code>
                  </th>
                  <td>{entry.gate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rx-prose">
          <p>
            The registered maturity of every Ryntra capability is at{" "}
            <Link href="/docs/current-capabilities">Current capabilities</Link>. The operating
            surface itself is at <Link href="/agents/workspace">Agent Control</Link>, and the
            developer contract at <Link href="/developers/agent-control">API &amp; MCP</Link>.
          </p>
        </div>
      </Chapter>
    </DocsArticle>
  );
}
