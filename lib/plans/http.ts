/**
 * A plan service refusal as the contract's one error shape. Server only.
 */

import type { NextResponse } from "next/server";

import { apiFailure } from "../api/v1/http.ts";
import type { PlanFailure } from "./service.ts";

export function planFailure(failure: PlanFailure): NextResponse {
  if (failure.code === "PLAN_INVALID") return apiFailure("PLAN_INVALID", failure.message, { issues: failure.issues });
  return apiFailure(failure.code, failure.message);
}
