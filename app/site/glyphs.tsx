/**
 * The section glyphs — the site's argument drawn instead of written.
 *
 * Each one is an abstract mechanism diagram: no prices, no balances, no
 * hashes, no invented values of any kind — only shapes and the same technical
 * vocabulary the copy beside it already uses. They are server-rendered SVG in
 * their final state; the draw-in is a CSS transition gated behind `html.rxm`
 * exactly like the reveals, so no-JS and reduced-motion readers see the
 * finished drawing.
 *
 * Colour is meaning, inherited from the system: cyan for evidence and data,
 * violet for the one human act, mint for a verified result, red only for the
 * boundary that says a plan is wrong.
 */

function Glyph({
  viewBox = "0 0 220 120",
  label,
  children,
}: {
  viewBox?: string;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <svg className="rx-glyph" viewBox={viewBox} aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label} focusable="false">
      {children}
    </svg>
  );
}

/** Evidence bars with one slot honestly empty. */
export function GapsGlyph() {
  return (
    <Glyph>
      <line className="rx-glyph-line" x1="16" y1="96" x2="204" y2="96" />
      <rect className="rx-glyph-bar rx-pop" data-i="0" x="26" y="62" width="22" height="34" />
      <rect className="rx-glyph-bar rx-pop" data-i="1" x="58" y="44" width="22" height="52" />
      <rect className="rx-glyph-bar rx-pop" data-i="2" x="90" y="52" width="22" height="44" />
      <rect className="rx-glyph-ghost rx-pop" data-i="3" x="122" y="34" width="22" height="62" />
      <rect className="rx-glyph-bar rx-pop" data-i="4" x="154" y="38" width="22" height="58" />
      <text className="rx-glyph-label" x="69" y="110" textAnchor="middle">KNOWN</text>
      <text className="rx-glyph-label rx-glyph-label--warn" x="133" y="110" textAnchor="middle">MISSING</text>
      <text className="rx-glyph-label" x="165" y="110" textAnchor="middle">KNOWN</text>
    </Glyph>
  );
}

/** A written plan: entry, invalidation, and the risk between them. */
export function PlanGlyph() {
  return (
    <Glyph>
      <polyline className="rx-glyph-line rx-draw" data-i="0" pathLength={100} points="18,72 58,72 58,50 104,50 104,60 142,60" />
      <line className="rx-glyph-accent rx-pop" data-i="1" x1="104" y1="42" x2="204" y2="42" strokeDasharray="3 4" />
      <line className="rx-glyph-danger rx-pop" data-i="2" x1="104" y1="86" x2="204" y2="86" strokeDasharray="3 4" />
      <path className="rx-glyph-line rx-draw" data-i="3" pathLength={100} d="M188 42 L196 42 L196 86 L188 86" fill="none" />
      <text className="rx-glyph-label rx-glyph-label--accent" x="104" y="34" textAnchor="start">ENTRY</text>
      <text className="rx-glyph-label rx-glyph-label--danger" x="104" y="100" textAnchor="start">INVALIDATION</text>
      <text className="rx-glyph-label" x="202" y="68" textAnchor="end">RISK</text>
    </Glyph>
  );
}

/** The exact payload, and the one signature software never makes. */
export function ApproveGlyph() {
  return (
    <Glyph>
      <rect className="rx-glyph-line rx-draw" data-i="0" pathLength={100} x="18" y="28" width="92" height="64" rx="4" fill="none" />
      <line className="rx-glyph-line rx-pop" data-i="1" x1="30" y1="46" x2="98" y2="46" />
      <line className="rx-glyph-line rx-pop" data-i="2" x1="30" y1="60" x2="98" y2="60" />
      <line className="rx-glyph-line rx-pop" data-i="3" x1="30" y1="74" x2="76" y2="74" />
      <line className="rx-glyph-human rx-draw" data-i="2" pathLength={100} x1="110" y1="60" x2="162" y2="60" />
      <circle className="rx-glyph-human rx-pop rx-glyph-ring" data-i="4" cx="178" cy="60" r="16" fill="none" />
      <rect className="rx-glyph-human-fill rx-pop" data-i="3" x="171" y="53" width="14" height="14" transform="rotate(45 178 60)" />
      <text className="rx-glyph-label" x="64" y="110" textAnchor="middle">EXACT PAYLOAD</text>
      <text className="rx-glyph-label rx-glyph-label--human" x="178" y="94" textAnchor="middle">YOU SIGN</text>
    </Glyph>
  );
}

/** Expected against actual — the comparison that closes the loop. */
export function LearnGlyph() {
  return (
    <Glyph>
      <polyline className="rx-glyph-line rx-pop" data-i="0" points="18,46 76,46 134,56 192,58" strokeDasharray="3 4" />
      <polyline className="rx-glyph-accent rx-draw" data-i="1" pathLength={100} points="18,74 76,68 134,60 192,58" />
      <circle className="rx-glyph-good-fill rx-pop" data-i="3" cx="192" cy="58" r="4.5" />
      <text className="rx-glyph-label" x="18" y="38" textAnchor="start">EXPECTED</text>
      <text className="rx-glyph-label rx-glyph-label--accent" x="18" y="90" textAnchor="start">ACTUAL</text>
    </Glyph>
  );
}

/** How access actually opens: confirm once, plan on paper, review the result. */
export function AccessGlyph() {
  return (
    <Glyph viewBox="0 0 340 132">
      <line className="rx-glyph-accent rx-draw" data-i="0" pathLength={100} x1="58" y1="52" x2="156" y2="52" />
      <line className="rx-glyph-accent rx-draw" data-i="2" pathLength={100} x1="184" y1="52" x2="282" y2="52" />
      <rect className="rx-glyph-accent-fill rx-pop" data-i="0" x="37" y="45" width="14" height="14" transform="rotate(45 44 52)" />
      <rect className="rx-glyph-accent-fill rx-pop" data-i="2" x="163" y="45" width="14" height="14" transform="rotate(45 170 52)" />
      <rect className="rx-glyph-good-fill rx-pop" data-i="4" x="289" y="45" width="14" height="14" transform="rotate(45 296 52)" />
      <text className="rx-glyph-label rx-glyph-label--accent" x="44" y="24" textAnchor="middle">TELEGRAM</text>
      <text className="rx-glyph-label" x="44" y="86" textAnchor="middle">ONE</text>
      <text className="rx-glyph-label" x="44" y="100" textAnchor="middle">CONFIRMATION</text>
      <text className="rx-glyph-label rx-glyph-label--accent" x="170" y="24" textAnchor="middle">PAPER</text>
      <text className="rx-glyph-label" x="170" y="86" textAnchor="middle">PLAN</text>
      <text className="rx-glyph-label" x="170" y="100" textAnchor="middle">FIRST</text>
      <text className="rx-glyph-label rx-glyph-label--good" x="296" y="24" textAnchor="middle">REVIEW</text>
      <text className="rx-glyph-label" x="296" y="86" textAnchor="middle">WHAT</text>
      <text className="rx-glyph-label" x="296" y="100" textAnchor="middle">HAPPENED</text>
    </Glyph>
  );
}
