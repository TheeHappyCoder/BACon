'use client';

import { useEffect, useState } from 'react';

/**
 * True only once `active` has been true for `delayMs`. Skeletons use it so a load that lands quickly (cached
 * data) never flashes one. It turns false the moment `active` does.
 */
export function useDelayedFlag(active: boolean, delayMs = 150): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && shown;
}
