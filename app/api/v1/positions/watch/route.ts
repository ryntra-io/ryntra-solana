import { PositionWatchRequestSchema, type PositionWatch, type PositionWatchResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { setPositionWatch, type PositionWatchRecord } from "@/lib/monitoring/position-watch";
import { productionPositionsDeps } from "@/lib/monitoring/positions.deps.server";
import { readPositions } from "@/lib/monitoring/positions.server";
import { freshPrice } from "@/lib/monitoring/watch-state";
import { isRetiredMint } from "@/lib/stocks/retired";
import { findStockRow } from "@/lib/stocks/universe.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The watch as the contract states it: the person's choice and the figures, never the store's own fields. */
function projectWatch(record: PositionWatchRecord): PositionWatch {
  return {
    mint: record.mint,
    symbol: record.symbol,
    preset: record.preset,
    stopPct: record.stopPct,
    targetPct: record.targetPct,
    basisPerUnit: record.basisPerUnit,
    basisObservedAt: record.basisObservedAt,
    limitPerUnit: record.limitPerUnit,
    targetPerUnit: record.targetPerUnit,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * «Ryntra попередить» on a company the proven wallet holds
 * (`RYN-PROTECT-SIGNAL-001`, contract 1.21.0; canon v5 §6.1): the person
 * chooses a preset; the loss limit and the target are counted here from the
 * token's price now — never from a figure the client sends — and Нагляд warns
 * at them through Telegram, which must be connected first. Nothing is signed,
 * moved or held: the sale stays the person's own signature.
 */
export async function PUT(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const body = await readApiBody(request, PositionWatchRequestSchema, 1_024);
  if (!body.ok) return body.response;
  const runtime = getGuardRuntime();
  /* A watch holds for weeks: the store must outlive the instance, which the runtime's own write gate decides. */
  if (!runtime.writes.allowed || !storeSurvivesColdStart(runtime.store)) return apiFailure("UNAVAILABLE", "«Ryntra попередить» needs a durable store; this deployment does not have one.");
  const deps = productionPositionsDeps(runtime.store);
  const nowMs = Date.now();

  if ((await deps.readTelegram(proof.address).catch(() => null)) !== true) {
    return apiFailure("CHANNEL_REQUIRED", "«Ryntra попередить» warns through Telegram: connect it in Settings first.");
  }
  const found = await findStockRow(body.body.mint).catch(() => null);
  if (!found || !found.ok) return apiFailure("UNAVAILABLE", "The companies could not be read just now; try again in a moment.");
  const row = found.row;
  if (!row || isRetiredMint(body.body.mint) || row.representation.mint !== body.body.mint) {
    return apiFailure("ASSET_UNCONFIRMED", "This token is not a company Ryntra lists, so Нагляд cannot watch it.");
  }
  const price = freshPrice(row.market.priceUsd, row.market.observedAt, nowMs);
  if (price === null || row.market.observedAt === null) {
    return apiFailure("PRICE_UNAVAILABLE", "No fresh price of this token right now, so the loss limit cannot be counted; try again in a minute.");
  }

  const written = await setPositionWatch(runtime.store, proof.address, {
    mint: body.body.mint,
    symbol: row.representation.symbol,
    preset: body.body.preset,
    basisPerUnit: price,
    basisObservedAt: row.market.observedAt,
    locale: body.body.locale,
  }, nowMs);
  const read = await readPositions(runtime.store, proof.address, nowMs, deps).catch(() => null);
  const position = read?.positions.find((entry) => entry.mint === body.body.mint) ?? null;
  return apiJson({ watch: projectWatch(written), position } satisfies PositionWatchResponse);
}
