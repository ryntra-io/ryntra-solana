"use client";

import { useMemo, useState } from "react";
import { CheckCircle, Info, Prohibit, Warning } from "@phosphor-icons/react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { RouteSlice } from "@/lib/agent-control/payments/current";
import type { PaymentFacilitator, PaymentMethod } from "@/lib/agent-control/payments/implementations";

import { useAgentI18n } from "../i18n/provider";
import styles from "./commerce.module.css";

/**
 * The route builder.
 *
 * A page that listed which payment routes are possible in prose would be a
 * paragraph with a border. What a reader needs in two seconds is: pick an
 * implementation, a chain and an asset, and see the sixteen method ×
 * facilitator answers at once. The shape of a provider's real capability shows
 * up as a pattern — two green cells in a column, a whole grid of one refusal —
 * long before anybody reads a word.
 *
 * Every verdict was computed on the server by the real engine. This component
 * chooses which precomputed slice to draw and nothing else: there is no policy
 * logic here, because a second place that decides is a second place to be
 * wrong.
 */

const METHODS: readonly PaymentMethod[] = [
  "EIP_3009",
  "PERMIT2_EXACT",
  "PERMIT2_UP_TO",
  "VISTARA_RELAYER_EIP712",
];

const FACILITATORS: readonly PaymentFacilitator[] = ["BINANCE", "VISTARA", "COINBASE_CDP", "SELF_HOSTED"];

const METHOD_LABEL: Readonly<Record<PaymentMethod, string>> = {
  EIP_3009: "EIP-3009",
  PERMIT2_EXACT: "Permit2 exact",
  PERMIT2_UP_TO: "Permit2 up-to",
  VISTARA_RELAYER_EIP712: "Vistara relayer",
};

type MatrixCopy = Readonly<{
  implementation: string;
  chainAndAsset: string;
  noDeploymentOption: string;
  trustCeiling: (value: string) => string;
  tallyOf: (allowed: number, total: number) => string;
  tallyRoutes: (sliceLabel: string) => string;
  caption: (implementationLabel: string, sliceLabel: string) => string;
  method: string;
  facilitatorLabel: Readonly<Record<PaymentFacilitator, string>>;
  cellAllowed: (methodLabel: string, facilitatorLabel: string) => string;
  resolves: string;
  legendAllowed: string;
  legendProvider: string;
  legendPolicy: string;
  explainLabel: string;
  explainBody: React.ReactNode;
  source: (operator: string, observedAt: string) => string;
  sourceLink: string;
  noAssetPublished: string;
  emptyTitle: string;
  emptyBody: string;
}>;

const COPY = {
  en: {
    implementation: "Implementation",
    chainAndAsset: "Chain and asset",
    noDeploymentOption: "no deployment declared",
    trustCeiling: (value) => `Trust ceiling ${value}`,
    tallyOf: (allowed, total) => `${allowed} of ${total}`,
    tallyRoutes: (sliceLabel) => `routes resolve on ${sliceLabel}`,
    caption: (implementationLabel, sliceLabel) =>
      `Payment method by facilitator for ${implementationLabel} on ${sliceLabel}`,
    method: "Method",
    facilitatorLabel: {
      BINANCE: "Binance",
      VISTARA: "Vistara",
      COINBASE_CDP: "Coinbase CDP",
      SELF_HOSTED: "Self-hosted",
    },
    cellAllowed: (methodLabel, facilitatorLabel) =>
      `${methodLabel} via ${facilitatorLabel} resolves. Nothing is paid: this route is declarable, not reachable.`,
    resolves: "resolves",
    legendAllowed: "Declarable",
    legendProvider: "The provider cannot",
    legendPolicy: "This owner will not",
    explainLabel: "Why a cell refuses",
    explainBody: (
      <p>
        Provider capability is checked before owner permission, so a cell that nobody could take
        reports the provider fact rather than a policy one — <em>you may not</em> is misleading
        when the answer is <em>nobody can</em>. Hover any cell for its exact reason code.
      </p>
    ),
    source: (operator, observedAt) => `Declared by ${operator}, read ${observedAt} ·`,
    sourceLink: "source",
    noAssetPublished: "no asset published",
    emptyTitle: "No deployment declared",
    emptyBody:
      "A self-hosted facilitator has no networks and no assets until its operator declares them, so there is no route to draw. That is the correct answer, not an empty state.",
  },
  uk: {
    implementation: "Реалізація",
    chainAndAsset: "Ланцюг і актив",
    noDeploymentOption: "розгортання не задекларовано",
    trustCeiling: (value) => `Стеля довіри ${value}`,
    tallyOf: (allowed, total) => `${allowed} з ${total}`,
    tallyRoutes: (sliceLabel) => `маршрутів розвʼязуються на ${sliceLabel}`,
    caption: (implementationLabel, sliceLabel) =>
      `Метод платежу за фасилітатором для ${implementationLabel} на ${sliceLabel}`,
    method: "Метод",
    facilitatorLabel: {
      BINANCE: "Binance",
      VISTARA: "Vistara",
      COINBASE_CDP: "Coinbase CDP",
      SELF_HOSTED: "Власний хостинг",
    },
    cellAllowed: (methodLabel, facilitatorLabel) =>
      `${methodLabel} через ${facilitatorLabel} розвʼязується. Нічого не сплачується: цей маршрут можна задекларувати, але не досягти.`,
    resolves: "розвʼязується",
    legendAllowed: "Можна задекларувати",
    legendProvider: "Провайдер не може",
    legendPolicy: "Цей власник не дозволяє",
    explainLabel: "Чому клітинка відмовляє",
    explainBody: (
      <p>
        Спроможність провайдера перевіряється до дозволу власника, тож клітинка, яку ніхто не міг би
        виконати, повідомляє факт про провайдера, а не про політику — <em>вам не можна</em> вводить в
        оману, коли відповідь — <em>ніхто не може</em>. Наведіть курсор на клітинку, щоб побачити
        точний код причини.
      </p>
    ),
    source: (operator, observedAt) => `Задекларував ${operator}, прочитано ${observedAt} ·`,
    sourceLink: "джерело",
    noAssetPublished: "актив не опубліковано",
    emptyTitle: "Розгортання не задекларовано",
    emptyBody:
      "Власний фасилітатор не має ні мереж, ні активів, доки оператор їх не задекларує, тож маршруту, який можна намалювати, немає. Це правильна відповідь, а не порожній стан.",
  },
} as const satisfies Record<WorkspaceLocale, MatrixCopy>;

export type ImplementationOption = Readonly<{
  id: string;
  label: string;
  operator: string;
  slices: readonly RouteSlice[];
  limitations: readonly string[];
  trustCeiling: string;
  sourceUrl: string;
  observedAt: string;
}>;

function sliceKey(slice: RouteSlice): string {
  return `${slice.network}::${slice.assetRef ?? "none"}`;
}

function sliceLabel(slice: RouteSlice, noAssetPublished: string): string {
  return `${slice.networkLabel} · ${slice.assetSymbol ?? noAssetPublished}`;
}

export function RouteMatrix({ options }: { options: readonly ImplementationOption[] }) {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];
  const [implementationId, setImplementationId] = useState(options[0]?.id ?? "");
  const implementation = useMemo(
    () => options.find((option) => option.id === implementationId) ?? options[0],
    [options, implementationId],
  );
  const [sliceId, setSliceId] = useState(() =>
    options[0]?.slices[0] ? sliceKey(options[0].slices[0]) : "",
  );

  const slice = useMemo(() => {
    if (!implementation) return undefined;
    return (
      implementation.slices.find((candidate) => sliceKey(candidate) === sliceId) ??
      implementation.slices[0]
    );
  }, [implementation, sliceId]);

  const byCell = useMemo(() => {
    const map = new Map<string, RouteSlice["cells"][number]>();
    for (const cell of slice?.cells ?? []) map.set(`${cell.method}::${cell.facilitator}`, cell);
    return map;
  }, [slice]);

  if (!implementation) return null;

  return (
    <div className={styles.matrix}>
      <div className={styles.controls}>
        <label className={styles.control}>
          <span>{copy.implementation}</span>
          <select
            value={implementation.id}
            onChange={(event) => {
              const next = options.find((option) => option.id === event.target.value);
              setImplementationId(event.target.value);
              setSliceId(next?.slices[0] ? sliceKey(next.slices[0]) : "");
            }}
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.control}>
          <span>{copy.chainAndAsset}</span>
          <select
            value={slice ? sliceKey(slice) : ""}
            disabled={implementation.slices.length === 0}
            onChange={(event) => setSliceId(event.target.value)}
          >
            {implementation.slices.length === 0 ? (
              <option value="">{copy.noDeploymentOption}</option>
            ) : (
              implementation.slices.map((candidate) => (
                <option key={sliceKey(candidate)} value={sliceKey(candidate)}>
                  {sliceLabel(candidate, copy.noAssetPublished)}
                </option>
              ))
            )}
          </select>
        </label>

        <div className={styles.controlFacts}>
          <b>{implementation.operator}</b>
          <span>{copy.trustCeiling(implementation.trustCeiling.replace(/_/g, " ").toLowerCase())}</span>
        </div>
      </div>

      {slice ? (
        <>
          <div className={styles.tally} data-tone={slice.allowedCount > 0 ? "some" : "none"}>
            <b>{copy.tallyOf(slice.allowedCount, slice.cells.length)}</b>
            <span>{copy.tallyRoutes(sliceLabel(slice, copy.noAssetPublished))}</span>
            <code>{slice.network}</code>
          </div>

          <div className={styles.gridScroll}>
            <table className={styles.grid}>
              <caption className="sr-only">
                {copy.caption(implementation.label, sliceLabel(slice, copy.noAssetPublished))}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{copy.method}</th>
                  {FACILITATORS.map((facilitator) => (
                    <th key={facilitator} scope="col">
                      {copy.facilitatorLabel[facilitator]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METHODS.map((method) => (
                  <tr key={method}>
                    <th scope="row">{METHOD_LABEL[method]}</th>
                    {FACILITATORS.map((facilitator) => {
                      const cell = byCell.get(`${method}::${facilitator}`);
                      if (!cell) return <td key={facilitator} />;
                      const tone = cell.allowed ? "allowed" : cell.refusedBy === "POLICY" ? "policy" : "provider";
                      const title = cell.allowed
                        ? copy.cellAllowed(METHOD_LABEL[method], copy.facilitatorLabel[facilitator])
                        : `${cell.reasonCode} — ${cell.detail}`;
                      return (
                        <td key={facilitator} data-tone={tone} title={title}>
                          {cell.allowed ? (
                            <CheckCircle size={17} weight="fill" aria-hidden />
                          ) : cell.refusedBy === "POLICY" ? (
                            <Warning size={17} weight="fill" aria-hidden />
                          ) : (
                            <Prohibit size={17} weight="bold" aria-hidden />
                          )}
                          <span className="sr-only">{cell.allowed ? copy.resolves : cell.reasonCode}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className={styles.legend}>
            <li data-tone="allowed">
              <CheckCircle size={15} weight="fill" aria-hidden /> {copy.legendAllowed}
            </li>
            <li data-tone="provider">
              <Prohibit size={15} weight="bold" aria-hidden /> {copy.legendProvider}
            </li>
            <li data-tone="policy">
              <Warning size={15} weight="fill" aria-hidden /> {copy.legendPolicy}
            </li>
          </ul>

          <details className={styles.explain}>
            <summary>
              <Info size={15} weight="bold" aria-hidden />
              <span>{copy.explainLabel}</span>
            </summary>
            <div>
              {copy.explainBody}
              <ul>
                {implementation.limitations.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className={styles.source}>
                {copy.source(implementation.operator, implementation.observedAt)}{" "}
                <a href={implementation.sourceUrl} target="_blank" rel="noreferrer">
                  {copy.sourceLink}
                </a>
              </p>
            </div>
          </details>
        </>
      ) : (
        <div className={styles.noSlice}>
          <Prohibit size={19} weight="bold" aria-hidden />
          <div>
            <b>{copy.emptyTitle}</b>
            <span>{copy.emptyBody}</span>
          </div>
        </div>
      )}
    </div>
  );
}
