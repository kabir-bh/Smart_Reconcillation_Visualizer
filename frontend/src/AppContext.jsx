import React, { createContext, useContext, useMemo, useState } from "react";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [sessionId, setSessionId] = useState(null);
  const [meta, setMeta] = useState(null);
  const [recon, setRecon] = useState(null);
  const [strategy, setStrategy] = useState("auto");
  const [rules, setRules] = useState({
    amountTolerance: "",
    dateToleranceDays: "",
  });

  const value = useMemo(
    () => ({
      sessionId,
      setSessionId,
      meta,
      setMeta,
      recon,
      setRecon,
      strategy,
      setStrategy,
      rules,
      setRules,
    }),
    [sessionId, meta, recon, strategy, rules]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
