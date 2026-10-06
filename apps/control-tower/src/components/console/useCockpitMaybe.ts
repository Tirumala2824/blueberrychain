"use client";

import { useContext } from "react";
import { CockpitContext } from "@/components/cockpit/context";

/** The cockpit's API when the console sits inside a case, otherwise null (e.g. on the policy page). */
export const useCockpitMaybe = () => useContext(CockpitContext);
