import type { ReactNode } from "react";
import { AgentsFrame } from "./agents-frame";

import "./agents.css";

export default function AgentsLayout({ children }: { children: ReactNode }) {
  return <AgentsFrame>{children}</AgentsFrame>;
}
