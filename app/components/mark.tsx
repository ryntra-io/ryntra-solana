/* Tiny inline-SVG status marks — replace unicode dingbats (✓ ✗) used as UI glyphs.
   Pure SVG, no hooks/context → safe in both server and client components (unlike the
   Phosphor icon components, which can't be imported into an RSC). Colour via currentColor.
   See docs/archive/design-pre-reset-2026-08-18/ryntra-design-bar.md §2 (no emoji/dingbats as UI icons). */

type MarkProps = { size?: number; className?: string; "aria-label"?: string };

export function CheckMark({ size = 13, className, ...rest }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}
      role={rest["aria-label"] ? "img" : undefined} aria-hidden={rest["aria-label"] ? undefined : true} {...rest}>
      <path d="M3 8.5l3 3 7-7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* The "go here" affordance. Exists so a link never has to reach for `→`, which
   is a dingbat standing in for an icon — screen readers announce it as
   "rightwards arrow" mid-sentence, and it inherits none of the icon weight the
   rest of the interface uses. */
export function ArrowMark({ size = 13, className, ...rest }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}
      role={rest["aria-label"] ? "img" : undefined} aria-hidden={rest["aria-label"] ? undefined : true} {...rest}>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* Leaves Ryntra. Replaces `↗`, which a screen reader announces as "north east
   arrow" in the middle of a link label. */
export function ExternalMark({ size = 13, className, ...rest }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}
      role={rest["aria-label"] ? "img" : undefined} aria-hidden={rest["aria-label"] ? undefined : true} {...rest}>
      <path d="M6.5 3H13v6.5M13 3L6 10M11 9.5V13H3V5h3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrossMark({ size = 13, className, ...rest }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}
      role={rest["aria-label"] ? "img" : undefined} aria-hidden={rest["aria-label"] ? undefined : true} {...rest}>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** A non-terminal state: evidence exists, but one or more bindings do not. */
export function AttentionMark({ size = 13, className, ...rest }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}
      role={rest["aria-label"] ? "img" : undefined} aria-hidden={rest["aria-label"] ? undefined : true} {...rest}>
      <path d="M8 2.5l6 11H2l6-11z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 6v3.5M8 11.6v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
