import type { AggClient, VenueEventWithMarkets } from "@agg-build/sdk";

import type { LabSelection } from "./lab-context";

/*
 * The console over the aggregator's official capabilities — tab 2.
 *
 * Every action is one documented SDK call with the real response rendered
 * readably (a summary line, key/value rows, a table) and the raw JSON behind
 * a disclosure. Nothing is interpreted for the Owner: the labels are the
 * API's own fields. The actions that need a signed-in AGG user say so and
 * are built in `agents-data.tsx` as components, because they hold live
 * state (a WebSocket, a multi-step paper trade).
 */

export type ConsoleField = {
  key: string;
  label: string;
  kind?: "text" | "number" | "select";
  options?: readonly { value: string; label: string }[];
  placeholder?: string;
  /* Filled from the lab's current selection when the field is empty. */
  fromSelection?: keyof LabSelection;
};

export type ConsoleTable = {
  columns: readonly string[];
  rows: readonly (readonly (string | number | null)[])[];
  /* Optional per-row selection the console can apply to the lab. */
  select?: readonly (Partial<LabSelection> | null)[];
};

export type ConsoleResult = {
  summary: string;
  rows?: readonly { label: string; value: string }[];
  tables?: readonly { title: string; table: ConsoleTable }[];
  raw: unknown;
};

export type ConsoleAction = {
  id: string;
  group: string;
  title: string;
  what: string;
  sdk: string;
  needsAuth?: boolean;
  fields: readonly ConsoleField[];
  run: (client: AggClient, values: Record<string, string>) => Promise<ConsoleResult>;
};

const usd = (value: number | null | undefined, digits = 2) =>
  value == null || Number.isNaN(value) ? "—" : `$${value.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
const pct = (price: number | null | undefined) => (price == null ? "—" : `${(price * 100).toFixed(1)}%`);
const cents = (price: number | null | undefined) => (price == null ? "—" : `${(price * 100).toFixed(1)}¢`);
const short = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
const num = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

function eventRow(event: VenueEventWithMarkets) {
  return [
    event.title,
    (event.venues ?? [event.venue]).join(", "),
    usd(event.volume ?? null, 0),
    event.venueMarkets?.length ?? event.marketCount ?? "—",
    event.endDate ? event.endDate.slice(0, 10) : "—",
  ] as const;
}

export const CONSOLE_ACTIONS: readonly ConsoleAction[] = [
  {
    id: "search",
    group: "Discovery",
    title: "Search markets",
    what: "Гібридний пошук (trigram + full-text + vector) по подіях або ринках.",
    sdk: "client.search({ q, type })",
    fields: [
      { key: "q", label: "Запит", placeholder: "Bitcoin", kind: "text" },
      {
        key: "type",
        label: "Що шукати",
        kind: "select",
        options: [
          { value: "events", label: "events" },
          { value: "markets", label: "markets" },
        ],
      },
    ],
    run: async (client, values) => {
      const type = values.type === "markets" ? "markets" : "events";
      const q = values.q?.trim() || "Bitcoin";
      const result = await client.search<VenueEventWithMarkets>({ q, type, limit: 12 });
      const items = result.data ?? [];
      return {
        summary: `${items.length} результат(ів) на «${q}» (${type}); hasMore: ${String(result.hasMore)}`,
        tables: [
          {
            title: type === "events" ? "Події" : "Ринки",
            table: {
              columns: ["Назва", "Майданчики", "Обсяг", "Ринків", "Кінець"],
              rows: items.map(eventRow),
              select: items.map((event) => ({ eventId: event.id, marketId: null, outcomeId: null })),
            },
          },
        ],
        raw: result,
      };
    },
  },
  {
    id: "events",
    group: "Discovery",
    title: "List events",
    what: "Пагінований список подій з фільтрами за майданчиком, статусом, категорією (id категорії — з /categories).",
    sdk: "client.getCategories() · client.getVenueEvents({ status, categoryIds, sortBy })",
    fields: [
      {
        key: "category",
        label: "Категорія",
        kind: "select",
        options: [
          { value: "", label: "усі" },
          { value: "crypto", label: "crypto" },
          { value: "politics", label: "politics" },
          { value: "finance", label: "finance" },
          { value: "sports", label: "sports" },
          { value: "world", label: "world" },
          { value: "entertainment", label: "entertainment" },
        ],
      },
      { key: "limit", label: "Ліміт", kind: "number", placeholder: "12" },
    ],
    run: async (client, values) => {
      /* The API filters by category id (a cuid), not by the slug the chip
         shows — the slug is resolved through the categories list first. */
      let categoryIds: string[] | undefined;
      if (values.category) {
        const categories = await client.getCategories({ limit: 100 });
        const match = (categories.data ?? []).find((c) => c.name === values.category);
        if (!match) throw new Error(`Категорії «${values.category}» немає у відповіді /categories.`);
        categoryIds = [match.id];
      }
      const result = await client.getVenueEvents({
        status: ["open"] as never,
        categoryIds,
        sortBy: "volume24hr",
        sortDir: "desc",
        limit: num(values.limit, 12),
      });
      const items = (result.data ?? []) as VenueEventWithMarkets[];
      return {
        summary: `${items.length} відкритих подій${values.category ? ` у «${values.category}»` : ""}, за 24-годинним обсягом`,
        tables: [
          {
            title: "Події",
            table: {
              columns: ["Назва", "Майданчики", "Обсяг", "Ринків", "Кінець"],
              rows: items.map(eventRow),
              select: items.map((event) => ({ eventId: event.id, marketId: null, outcomeId: null })),
            },
          },
        ],
        raw: result,
      };
    },
  },
  {
    id: "event",
    group: "Discovery",
    title: "Get event / markets",
    what: "Одна подія з її ринками та наслідками; ціна наслідку — остання відома.",
    sdk: "client.getVenueEventById(id) · client.getVenueMarkets({ venueEventId })",
    fields: [{ key: "eventId", label: "Event id", kind: "text", fromSelection: "eventId" }],
    run: async (client, values) => {
      const id = values.eventId?.trim();
      if (!id) throw new Error("Потрібен event id — вибери подію в Search або List events.");
      const event = (await client.getVenueEventById(id)) as VenueEventWithMarkets;
      const markets = await client.getVenueMarkets({ venueEventId: id, limit: 50 });
      const list = markets.data ?? [];
      return {
        summary: `${event.title} — ${(event.venues ?? [event.venue]).length} майданчик(и), ${list.length} ринків у кластері`,
        rows: [
          { label: "Майданчик-якір", value: event.venue },
          { label: "Майданчики", value: (event.venues ?? []).join(", ") || "—" },
          { label: "Обсяг", value: usd(event.volume ?? null, 0) },
          { label: "Статус", value: event.status ?? "—" },
          { label: "Кінець", value: event.endDate ?? "—" },
          { label: "Категорії", value: (event.categories ?? []).map((c) => c.category.name).join(", ") || "—" },
        ],
        tables: [
          {
            title: "Ринки (клік — обрати ринок і перший наслідок)",
            table: {
              columns: ["Майданчик", "Питання", "Статус", "Наслідки · ціна"],
              rows: list.map((market) => [
                market.venue,
                market.question,
                market.status ?? "—",
                market.venueMarketOutcomes.map((o) => `${o.label} ${pct(o.price)}`).join(" · "),
              ]),
              select: list.map((market) => ({
                eventId: id,
                marketId: market.id,
                outcomeId: market.venueMarketOutcomes[0]?.id ?? null,
              })),
            },
          },
        ],
        raw: { event, markets },
      };
    },
  },
  {
    id: "midpoints",
    group: "Market data",
    title: "Get midpoints",
    what: "Живі середини книги (ціна Yes 0–1) для кількох ринків одним запитом.",
    sdk: "client.getMidpoints({ venueMarketIds })",
    fields: [{ key: "eventId", label: "Event id", kind: "text", fromSelection: "eventId" }],
    run: async (client, values) => {
      const id = values.eventId?.trim();
      if (!id) throw new Error("Потрібен event id.");
      const markets = await client.getVenueMarkets({ venueEventId: id, limit: 20 });
      const ids = (markets.data ?? []).map((m) => m.id);
      const result = (await client.getMidpoints({ venueMarketIds: ids })) as { data?: unknown[] } & Record<string, unknown>;
      const data = (Array.isArray(result.data) ? result.data : []) as Record<string, unknown>[];
      const byId = new Map((markets.data ?? []).map((m) => [m.id, m.question] as const));
      return {
        summary: `${data.length} midpoint(ів) для ${ids.length} ринків`,
        tables: [
          {
            title: "Midpoints",
            table: {
              columns: ["Ринок", "Midpoint (Yes)", "Поля відповіді"],
              rows: data.map((row) => [
                byId.get(String(row.venueMarketId ?? "")) ?? short(String(row.venueMarketId ?? "")),
                typeof row.midpoint === "number" ? pct(row.midpoint) : "—",
                Object.keys(row).join(", "),
              ]),
            },
          },
        ],
        raw: result,
      };
    },
  },
  {
    id: "orderbook",
    group: "Market data",
    title: "Get orderbook",
    what: "Живі книги ордерів по кожному майданчику для ринку та його матчів.",
    sdk: "client.getOrderbooks({ venueMarketIds, depth })",
    fields: [
      { key: "marketId", label: "Venue market id", kind: "text", fromSelection: "marketId" },
      { key: "depth", label: "Глибина", kind: "number", placeholder: "5" },
    ],
    run: async (client, values) => {
      const id = values.marketId?.trim();
      if (!id) throw new Error("Потрібен venue market id — обери ринок у Get event / markets.");
      const result = await client.getOrderbooks({ venueMarketIds: [id], depth: num(values.depth, 5) });
      const item = result.data?.[0];
      if (!item) throw new Error("Порожня відповідь.");
      const venues = Object.entries(item.venueOrderbooks ?? {});
      return {
        summary: `${item.status} · ${venues.length} книг(и) · ринок ${item.requestedMarket?.venue ?? "—"} (${item.requestedMarket?.marketStatus ?? "—"})`,
        rows: [
          { label: "Tick size", value: String(item.requestedMarket?.tickSize ?? "—") },
          { label: "Помилка", value: item.error ? JSON.stringify(item.error) : "немає" },
          { label: "Матчі", value: (item.matchedMarkets ?? []).map((m) => `${m.venue}${m.hasOrderbook ? "" : " (без книги)"}`).join(", ") || "—" },
        ],
        tables: venues.map(([venue, book]) => ({
          title: `${venue} · bid/ask`,
          table: {
            columns: ["Bid ціна", "Bid обсяг", "Ask ціна", "Ask обсяг"],
            rows: Array.from({ length: Math.max(book.orderbook.bids.length, book.orderbook.asks.length) }, (_, i) => [
              book.orderbook.bids[i] ? cents(book.orderbook.bids[i].price) : "",
              book.orderbook.bids[i] ? book.orderbook.bids[i].size.toFixed(2) : "",
              book.orderbook.asks[i] ? cents(book.orderbook.asks[i].price) : "",
              book.orderbook.asks[i] ? book.orderbook.asks[i].size.toFixed(2) : "",
            ]),
          },
        })),
        raw: result,
      };
    },
  },
  {
    id: "chart",
    group: "Market data",
    title: "Get chart / history",
    what: "OHLCV-бари для наслідку одного ринку.",
    sdk: "client.getChartBars({ venueMarketOutcomeId, resolution, to, countBack })",
    fields: [
      { key: "outcomeId", label: "Outcome id", kind: "text", fromSelection: "outcomeId" },
      {
        key: "resolution",
        label: "Роздільність",
        kind: "select",
        options: [
          { value: "1m", label: "1 хвилина" },
          { value: "5m", label: "5 хвилин" },
          { value: "1h", label: "1 година" },
          { value: "1d", label: "1 день" },
        ],
      },
      { key: "countBack", label: "Барів", kind: "number", placeholder: "48" },
    ],
    run: async (client, values) => {
      const id = values.outcomeId?.trim();
      if (!id) throw new Error("Потрібен outcome id — обери ринок у Get event / markets.");
      const resolution = (["1m", "5m", "1h", "1d"].includes(values.resolution) ? values.resolution : "1h") as "1m" | "5m" | "1h" | "1d";
      const result = await client.getChartBars({ venueMarketOutcomeId: id, resolution, to: Date.now(), countBack: num(values.countBack, 48) });
      const bars = result.data ?? [];
      const closes = bars.map((b) => b.c);
      return {
        summary: `${bars.length} барів (${result.resolution}) з ${result.venue}; ${bars.length ? `${cents(bars[0].c)} → ${cents(closes[closes.length - 1])}` : "порожньо"}`,
        rows: [
          { label: "Максимум", value: bars.length ? cents(Math.max(...bars.map((b) => b.h))) : "—" },
          { label: "Мінімум", value: bars.length ? cents(Math.min(...bars.map((b) => b.l))) : "—" },
          { label: "Останній бар", value: result.meta?.lastBarOpenTime ? new Date(result.meta.lastBarOpenTime).toISOString() : "—" },
          { label: "Застарілість", value: result.meta?.staleSeconds != null ? `${result.meta.staleSeconds} с` : "—" },
        ],
        tables: [
          {
            title: "Бари",
            table: {
              columns: ["Час", "O", "H", "L", "C", "V"],
              rows: bars.slice(-24).map((b) => [new Date(b.t).toISOString().slice(0, 16).replace("T", " "), cents(b.o), cents(b.h), cents(b.l), cents(b.c), b.v == null ? "—" : b.v.toFixed(0)]),
            },
          },
        ],
        raw: result,
      };
    },
  },
  {
    id: "signals",
    group: "Correlated markets",
    title: "Generated signals",
    what: "Згенеровані Yes/No-сигнали: які стани світу стають імовірнішими, якщо ринок вирішиться.",
    sdk: "client.getMarketCorrelatedSignals(venueMarketId)",
    fields: [{ key: "marketId", label: "Venue market id", kind: "text", fromSelection: "marketId" }],
    run: async (client, values) => {
      const id = values.marketId?.trim();
      if (!id) throw new Error("Потрібен venue market id.");
      const batch = await client.getMarketCorrelatedSignals(id);
      return {
        summary: `${batch.signals.length} сигнал(ів) · модель ${batch.sourceModel} · prompt v${batch.promptVersion} · ${batch.createdAt.slice(0, 10)}`,
        tables: [
          {
            title: "Сигнали",
            table: {
              columns: ["Сторона", "Напрям", "Домен", "Текст"],
              rows: batch.signals.map((s) => [s.side, s.direction, s.domain, s.text]),
            },
          },
        ],
        raw: batch,
      };
    },
  },
  {
    id: "related",
    group: "Correlated markets",
    title: "Find related markets",
    what: "Семантичний пошук ринків, чиї сигнали перетинаються з запитом.",
    sdk: "client.queryCorrelatedMarkets({ text })",
    fields: [{ key: "text", label: "Запит", kind: "text", placeholder: "Fed cuts rates in December" }],
    run: async (client, values) => {
      const text = values.text?.trim() || "Fed cuts rates in December";
      const result = await client.queryCorrelatedMarkets({ text, limit: 12 });
      const items = result.results ?? [];
      return {
        summary: `${items.length} пов'язаних ринків на «${text}»`,
        tables: [
          {
            title: "Ринки",
            table: {
              columns: ["Оцінка", "Майданчик", "Ринок", "Подія", "Збіг", "Сигнал"],
              rows: items.map((r) => [r.score.toFixed(3), r.venue, r.marketQuestion, r.eventTitle, r.matchSource, r.matchedSignal?.text ?? ""]),
              select: items.map((r) => ({ marketId: r.venueMarketId })),
            },
          },
        ],
        raw: result,
      };
    },
  },
  {
    id: "cascade",
    group: "Correlated markets",
    title: "Ripple effect",
    what: "Кандидати «розширити» або «хеджувати» для ринку, що вирішується.",
    sdk: "client.getCorrelatedMarketCascade({ venueMarketId, side, mode })",
    fields: [
      { key: "marketId", label: "Venue market id", kind: "text", fromSelection: "marketId" },
      {
        key: "mode",
        label: "Режим",
        kind: "select",
        options: [
          { value: "expand", label: "expand" },
          { value: "hedge", label: "hedge" },
        ],
      },
    ],
    run: async (client, values) => {
      const id = values.marketId?.trim();
      if (!id) throw new Error("Потрібен venue market id.");
      const mode = values.mode === "hedge" ? "hedge" : "expand";
      const result = await client.getCorrelatedMarketCascade({ venueMarketId: id, mode, limit: 12 });
      const items = result.data ?? [];
      return {
        summary: `${items.length} кандидат(ів) у режимі ${mode}`,
        tables: [
          {
            title: "Події",
            table: {
              columns: ["Оцінка", "Дія", "Подія", "Статус", "Причина", "Домен"],
              rows: items.map((r) => [r.score.toFixed(3), r.action, r.eventTitle, r.eventStatus, r.reason, r.reasonDomain]),
              select: items.map((r) => ({ eventId: r.venueEventId, marketId: null, outcomeId: null })),
            },
          },
        ],
        raw: result,
      };
    },
  },
  {
    id: "news",
    group: "Correlated markets",
    title: "Market news",
    what: "Новини з підсумком впливу на ринок.",
    sdk: "client.getMarketNews({ venueMarketIds })",
    fields: [{ key: "marketId", label: "Venue market id", kind: "text", fromSelection: "marketId" }],
    run: async (client, values) => {
      const id = values.marketId?.trim();
      if (!id) throw new Error("Потрібен venue market id.");
      const result = (await client.getMarketNews({ venueMarketIds: [id], limit: 5 })) as unknown as {
        results?: { question?: string; timeRangeLabel?: string; searchQuery?: string; articles?: Record<string, unknown>[] }[];
      };
      const groups = result.results ?? [];
      const pick = (row: Record<string, unknown>, keys: string[]) => {
        for (const key of keys) if (typeof row[key] === "string") return row[key] as string;
        return "";
      };
      const articles = groups.flatMap((group) => group.articles ?? []);
      return {
        summary: `${articles.length} статт(і) за ${groups.length} ринк(ом/ами); вікно ${groups[0]?.timeRangeLabel ?? "—"}; запит AGG «${groups[0]?.searchQuery ?? "—"}»`,
        tables: [
          {
            title: "Новини (articles)",
            table: {
              columns: ["Заголовок", "Джерело", "Дата", "Вплив / підсумок"],
              rows: articles.map((row) => [pick(row, ["title", "headline"]), pick(row, ["source", "publisher", "domain"]), pick(row, ["publishedAt", "date", "published"]).slice(0, 10), pick(row, ["impactSummary", "summary", "marketImpact", "snippet"])]),
            },
          },
        ],
        raw: result,
      };
    },
  },
  {
    id: "status",
    group: "Correlated markets",
    title: "Engine status",
    what: "Покриття сигналів і вбудовувань; конфігурація застосунку (режим торгівлі).",
    sdk: "client.getCorrelatedMarketsStatus() · client.getAppConfig()",
    fields: [],
    run: async (client) => {
      const [status, config] = await Promise.all([client.getCorrelatedMarketsStatus(), client.getAppConfig()]);
      const cfg = config as unknown as Record<string, unknown>;
      return {
        summary: `сигнали: ${status.markets.processed.toLocaleString()} з ${status.markets.total.toLocaleString()} ринків (${status.markets.coverage}%) · tradingMode: ${String(cfg.tradingMode)}`,
        rows: [
          { label: "Сигналів", value: status.signals.total.toLocaleString() },
          { label: "З вбудовуваннями", value: status.signals.withEmbeddings.toLocaleString() },
          { label: "Фонові задачі", value: status.config.jobsEnabled ? "увімкнені" : "вимкнені" },
          { label: "Режим застосунку", value: String(cfg.tradingMode) },
          { label: "Стартовий paper-баланс", value: usd(Number(cfg.paperStartingBalance ?? 0), 0) },
          { label: "Вимкнені майданчики", value: Array.isArray(cfg.disabledVenues) ? (cfg.disabledVenues as string[]).join(", ") : "—" },
        ],
        raw: { status, config },
      };
    },
  },
  {
    id: "route",
    group: "Routing",
    title: "Smart route (quote)",
    what: "Маршрут виконання по майданчиках із перевіреним сертифікатом; без входу — лише попередній перегляд.",
    sdk: 'client.getSmartRoute({ venueMarketOutcomeId, tradeSide, maxSpend, mode: "paper" })',
    fields: [
      { key: "outcomeId", label: "Outcome id", kind: "text", fromSelection: "outcomeId" },
      {
        key: "side",
        label: "Сторона",
        kind: "select",
        options: [
          { value: "buy", label: "buy" },
          { value: "sell", label: "sell" },
        ],
      },
      { key: "maxSpend", label: "Бюджет, $", kind: "number", placeholder: "5" },
    ],
    run: async (client, values) => {
      const id = values.outcomeId?.trim();
      if (!id) throw new Error("Потрібен outcome id.");
      const side = values.side === "sell" ? "sell" : "buy";
      const route = await client.getSmartRoute(
        side === "buy"
          ? { venueMarketOutcomeId: id, tradeSide: "buy", maxSpend: num(values.maxSpend, 5), mode: "paper", compareVenues: true }
          : { venueMarketOutcomeId: id, tradeSide: "sell", sellShares: num(values.maxSpend, 5), mode: "paper", compareVenues: true },
      );
      const fills = route.fills ?? [];
      return {
        summary: `${route.status} · заповнено ${route.totalFilled?.toFixed(2) ?? "—"} акцій · вартість ${usd(route.rawExecCost)} · quote ${short(route.quoteId ?? "")} діє до ${route.expiresAt ?? "—"}`,
        rows: [
          { label: "Майданчиків у маршруті", value: String(fills.length) },
          { label: "Розв'язано за", value: `${route.solveTimeMs} мс · перевірка ${route.verifyTimeMs} мс` },
          { label: "Попередження", value: (route.warnings ?? []).map((w) => `${w.venue}: ${w.reason}`).join("; ") || "немає" },
          { label: "Помилка", value: route.error ?? route.message ?? "немає" },
        ],
        tables: [
          {
            title: "Заповнення по майданчиках",
            table: {
              columns: ["Майданчик", "Ланцюг", "Середня ціна", "Акцій", "Комісії"],
              rows: fills.map((f) => [f.venue, f.chain, cents(f.avgPrice), f.venueQty.toFixed(2), [f.venueFee, f.builderFee, f.settlementFee].filter((x) => x != null).map((x) => usd(x!, 4)).join(" / ") || "—"]),
            },
          },
          ...(route.venueSoloQuotes?.length
            ? [
                {
                  title: "Порівняння: кожен майданчик окремо",
                  table: {
                    columns: ["Майданчик", "Поля"],
                    rows: (route.venueSoloQuotes as unknown as Record<string, unknown>[]).map((q) => [String(q.venue ?? "—"), Object.entries(q).filter(([k]) => k !== "venue").map(([k, v]) => `${k}: ${typeof v === "number" ? v.toFixed(4) : String(v)}`).join(" · ")]),
                  },
                },
              ]
            : []),
        ],
        raw: route,
      };
    },
  },
];
