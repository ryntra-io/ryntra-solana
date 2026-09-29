"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import "./widget.css";

import { useShell } from "./shell-state";
import { orderedWidgets, widgetVisible, type WidgetMeta } from "./widget-order";

export { orderedWidgets, widgetVisible };
export type { WidgetMeta };

/**
 * The widget layer.
 *
 * A widget registers itself when it mounts, so the customize panel lists what
 * the workspace actually contains rather than a hand-maintained catalogue that
 * drifts from it. Registration happens whether or not the widget is currently
 * visible — otherwise switching one off would remove the control that switches
 * it back on, which is the classic way this kind of panel eats its own feet.
 *
 * Two rules the modes enforce:
 *
 *   Guided hides the advanced panels and offers no customization at all. A
 *   cautious beginner does not need a layout editor; they need fewer decisions.
 *
 *   Essential widgets cannot be hidden in any mode. The readiness block is what
 *   tells an operator whether they may act at all, and a layout preference is
 *   not a good enough reason to be able to remove it.
 *
 * Order is applied with CSS `order` rather than by rearranging the DOM, so the
 * reading order for a screen reader stays the registered one and reordering
 * cannot desynchronise from what is on screen.
 */

type Registry = {
  widgets: readonly WidgetMeta[];
  register: (meta: WidgetMeta) => void;
  unregister: (id: string) => void;
};

const WidgetRegistry = createContext<Registry | null>(null);

export function WidgetRegistryProvider({ children }: { children: ReactNode }) {
  const [widgets, setWidgets] = useState<readonly WidgetMeta[]>([]);

  const value = useMemo<Registry>(
    () => ({
      widgets,
      register: (meta) =>
        setWidgets((current) =>
          current.some((item) => item.id === meta.id) ? current : [...current, meta],
        ),
      unregister: (id) => setWidgets((current) => current.filter((item) => item.id !== id)),
    }),
    [widgets],
  );

  return <WidgetRegistry.Provider value={value}>{children}</WidgetRegistry.Provider>;
}

export function useWidgetRegistry(): Registry {
  return (
    useContext(WidgetRegistry) ?? {
      widgets: [],
      register: () => {},
      unregister: () => {},
    }
  );
}

export function WorkspaceWidget({
  id,
  title,
  essential,
  advanced,
  children,
}: WidgetMeta & { children: ReactNode }) {
  const { register, unregister } = useWidgetRegistry();
  const { prefs } = useShell();

  useEffect(() => {
    register({ id, title, essential, advanced });
    return () => unregister(id);
    // The identity of `register` changes with the registry contents, which would
    // re-run this on every registration. The meta is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, title, essential, advanced]);

  if (!widgetVisible({ id, title, essential, advanced }, prefs.mode, prefs.hidden)) return null;

  const index = prefs.order.indexOf(id);
  return (
    <div className="rs-widget" data-widget={id} style={index >= 0 ? { order: index } : undefined}>
      {children}
    </div>
  );
}
