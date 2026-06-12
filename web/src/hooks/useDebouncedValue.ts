import { useEffect, useState } from 'react';

/** Trails `value` by `delayMs` — for keeping rapid UI input (e.g. a slider
 *  being dragged) from firing a network request per pixel. */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
