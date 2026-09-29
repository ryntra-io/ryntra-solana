"use client";

import { useMemo, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { ToolProjection } from "@/lib/agent-control/mcp/current";

import { useAgentI18n } from "../i18n/provider";
import styles from "./tools.module.css";

/**
 * The tool inventory, filtered by what a tool can do.
 *
 * The filter is the whole interaction and it exists for one reason: the answer
 * a reader needs in two seconds is *how many of these write, and what can a
 * write do* — not twelve names in a list. Selecting Write is the fastest way to
 * see that all five produce the same thing.
 */
type Filter = "ALL" | "READ" | "WRITE";

const FILTER_IDS: readonly Filter[] = ["ALL", "READ", "WRITE"];

/** 1 дія, 2–4 дії, 5+ дій — the three Ukrainian plural forms. */
function ukPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

type InventoryCopy = Readonly<{
  filterGroupLabel: string;
  filterLabel: Readonly<Record<Filter, string>>;
  oneEffect: (effect: string) => string;
  manyEffects: (count: number) => string;
  write: string;
  read: string;
  effectTitle: string;
  producesTitle: string;
  readNoAction: string;
  pinnedNoAction: string;
  actionCount: (count: number) => string;
  noActionRef: string;
  refs: (count: number) => string;
  classTitle: string;
}>;

const COPY = {
  en: {
    filterGroupLabel: "Filter tools by what they can do",
    filterLabel: { ALL: "All", READ: "Read", WRITE: "Write" },
    oneEffect: (effect) => `Every write carries one effect: ${effect}.`,
    manyEffects: (count) => `Writes carry ${count} effects.`,
    write: "write",
    read: "read",
    effectTitle: "What this tool may do at all",
    producesTitle: "The one kind of record it produces",
    readNoAction: "A read names no registry action.",
    pinnedNoAction: "This tool names no action: the record it touches was pinned when it was created.",
    actionCount: (count) => `${count} allowlisted registry action${count === 1 ? "" : "s"}`,
    noActionRef: "no action ref",
    refs: (count) => `${count} refs`,
    classTitle: "The canonical class a verifier reads without knowing the provider",
  },
  uk: {
    filterGroupLabel: "Фільтрувати інструменти за тим, що вони можуть робити",
    filterLabel: { ALL: "Усі", READ: "Читання", WRITE: "Запис" },
    oneEffect: (effect) => `Кожен запис несе один ефект: ${effect}.`,
    manyEffects: (count) => `Записи несуть ${count} ${ukPlural(count, "ефект", "ефекти", "ефектів")}.`,
    write: "запис",
    read: "читання",
    effectTitle: "Що цей інструмент узагалі може робити",
    producesTitle: "Єдиний тип запису, який він створює",
    readNoAction: "Читання не називає жодної дії реєстру.",
    pinnedNoAction: "Цей інструмент не називає дії: запис, якого він торкається, закріплено під час створення.",
    actionCount: (count) =>
      `${count} ${ukPlural(count, "дозволена дія реєстру", "дозволені дії реєстру", "дозволених дій реєстру")}`,
    noActionRef: "без посилання на дію",
    refs: (count) => `${count} ${ukPlural(count, "посилання", "посилання", "посилань")}`,
    classTitle: "Канонічний клас, який верифікатор читає, не знаючи провайдера",
  },
} as const satisfies Record<WorkspaceLocale, InventoryCopy>;

export function ToolInventory({ tools }: { tools: readonly ToolProjection[] }) {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  const [filter, setFilter] = useState<Filter>("ALL");

  const shown = useMemo(
    () => (filter === "ALL" ? tools : tools.filter((tool) => tool.kind === filter)),
    [filter, tools],
  );

  const effects = useMemo(
    () => [...new Set(shown.filter((tool) => tool.kind === "WRITE").map((tool) => tool.effect))],
    [shown],
  );

  return (
    <div className={styles.inventory}>
      <div className={styles.filters} role="group" aria-label={copy.filterGroupLabel}>
        {FILTER_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={styles.filter}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {copy.filterLabel[id]}
            <span>{id === "ALL" ? tools.length : tools.filter((tool) => tool.kind === id).length}</span>
          </button>
        ))}
        {effects.length > 0 ? (
          <p className={styles.filterFact}>
            {effects.length === 1
              ? copy.oneEffect(effects[0].replace(/_/g, " ").toLowerCase())
              : copy.manyEffects(effects.length)}
          </p>
        ) : null}
      </div>

      <ul className={styles.toolList}>
        {shown.map((tool) => (
          <li key={tool.name} className={styles.tool} data-kind={tool.kind}>
            <div className={styles.toolHead}>
              <code>{tool.name}</code>
              <span className={styles.kind} data-kind={tool.kind}>
                {tool.kind === "WRITE" ? copy.write : copy.read}
              </span>
            </div>
            <div className={styles.toolFacts}>
              <span title={copy.effectTitle}>{tool.effect.replace(/_/g, " ").toLowerCase()}</span>
              <span title={copy.producesTitle}>
                {tool.produces.replace(/_/g, " ").toLowerCase()}
              </span>
              <span
                title={
                  tool.kind === "READ"
                    ? copy.readNoAction
                    : tool.actionCount === 0
                      ? copy.pinnedNoAction
                      : copy.actionCount(tool.actionCount)
                }
              >
                {tool.actionCount === 0 ? copy.noActionRef : copy.refs(tool.actionCount)}
              </span>
            </div>
            {tool.classes.length > 0 ? (
              <div className={styles.classes}>
                {tool.classes.map((klass) => (
                  <span key={klass} title={copy.classTitle}>
                    {klass.replace(/_/g, " ").toLowerCase()}
                  </span>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
