import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from 'react';

/**
 * "View as" mode (formerly "historical view"): when `asOf` is set
 * (YYYY-MM-DD), every page shows the portfolio as it stood at the end of that
 * day — entries added later vanish and values are read as of the date. The
 * mode survives page changes (kept in sessionStorage) and is left via the
 * floating reset button in the Layout. Entered by dragging the scrubber that
 * sits along the dashboard chart's X axis.
 */
interface HistoricalViewState {
  asOf: string | null;
  setAsOf: (date: string | null) => void;
}

const STORAGE_KEY = 'concise.historicalAsOf';

const HistoricalViewContext = createContext<HistoricalViewState>({
  asOf: null,
  setAsOf: () => {},
});

export function HistoricalViewProvider({ children }: { children: ReactNode }) {
  const [asOf, setAsOfState] = useState<string | null>(
    () => sessionStorage.getItem(STORAGE_KEY),
  );
  const setAsOf = useCallback((date: string | null) => {
    setAsOfState(date);
    if (date) sessionStorage.setItem(STORAGE_KEY, date);
    else sessionStorage.removeItem(STORAGE_KEY);
  }, []);
  const value = useMemo(() => ({ asOf, setAsOf }), [asOf, setAsOf]);
  return (
    <HistoricalViewContext.Provider value={value}>{children}</HistoricalViewContext.Provider>
  );
}

export function useHistoricalView(): HistoricalViewState {
  return useContext(HistoricalViewContext);
}
