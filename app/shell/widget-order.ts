/**
 * The two pure rules behind the widget layer, kept out of the component file so
 * they can be exercised directly by `node --test` — Node strips types but not
 * JSX, and these are exactly the rules worth a test: which panels a mode shows,
 * and what a saved order does to panels it has never heard of.
 */

export type WidgetMeta = Readonly<{
  id: string;
  title: string;
  /** Cannot be hidden, in any mode. */
  essential?: boolean;
  /** Hidden in Guided mode. */
  advanced?: boolean;
}>;

/**
 * Applies a saved order to the registered widgets.
 *
 * Ids the order has never seen keep their registered position at the end rather
 * than jumping to the front, so adding a panel to a workspace cannot silently
 * rearrange the layout of everyone who had already customised it.
 */
export function orderedWidgets(
  widgets: readonly WidgetMeta[],
  order: readonly string[],
): readonly WidgetMeta[] {
  if (!order.length) return widgets;
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...widgets].sort((a, b) => {
    const left = rank.get(a.id);
    const right = rank.get(b.id);
    if (left === undefined && right === undefined) return 0;
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return left - right;
  });
}

/**
 * Whether a widget renders.
 *
 * Essential always renders: the readiness block is what tells an operator
 * whether they may act at all, and a layout preference is not a good enough
 * reason to be able to remove it.
 *
 * Guided is a curated set rather than a personalised one — it shows the
 * non-advanced panels and deliberately ignores what was hidden elsewhere, so
 * switching into it always produces the same, explainable screen.
 */
export function widgetVisible(
  meta: WidgetMeta,
  mode: string,
  hidden: readonly string[],
): boolean {
  if (meta.essential) return true;
  if (mode === "guided") return !meta.advanced;
  return !hidden.includes(meta.id);
}
