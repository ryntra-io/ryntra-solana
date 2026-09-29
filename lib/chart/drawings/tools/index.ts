/* Tool registry: every ToolType maps to its ToolImpl. */

import type { ToolImpl, ToolType } from "../types";
import { fibTool } from "./fib";
import { hlineTool } from "./hline";
import { positionTool } from "./position";
import { rayTool } from "./ray";
import { rectTool } from "./rect";
import { rulerTool } from "./ruler";
import { textTool } from "./text";
import { trendlineTool } from "./trendline";
import { vlineTool } from "./vline";

export const TOOL_IMPLS: Record<ToolType, ToolImpl> = {
  trend: trendlineTool,
  ray: rayTool,
  hline: hlineTool,
  vline: vlineTool,
  rect: rectTool,
  fib: fibTool,
  text: textTool,
  ruler: rulerTool,
  position: positionTool,
};
