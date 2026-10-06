"use client";

import { createContext, useContext } from "react";
import type { CaseView } from "@blueberrychain/bbc-api";

export interface CockpitApi {
  view: CaseView;
  /** "Now" on the case's clock (ms). */
  now: number;
  fixture: boolean;
  openEvidence(id: string): void;
  /** Run a console command (panel buttons use the same path as typing). */
  run(input: string): void;
  /** Put a command in the console for the person to finish (e.g. a reason) and send. */
  prefill(input: string): void;
  goStage(stage: string): void;
}

export const CockpitContext = createContext<CockpitApi | null>(null);

export function useCockpit(): CockpitApi {
  const ctx = useContext(CockpitContext);
  if (!ctx) throw new Error("useCockpit outside the cockpit");
  return ctx;
}
