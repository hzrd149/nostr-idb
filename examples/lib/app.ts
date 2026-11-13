import { createContext, useContext } from "react";
import type { Filter } from "../../src/index.ts";

export type Tab = "query" | "store" | "import" | "sync" | "stress" | "inspect";

export type AppContext = {
  tab: Tab;
  goto: (tab: Tab) => void;
  /** Load filters into the query page and run them */
  openQuery: (filters: Filter[]) => void;
};

export const AppCtx = createContext<AppContext>({
  tab: "query",
  goto: () => {},
  openQuery: () => {},
});

export function useApp() {
  return useContext(AppCtx);
}
