"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { MotionConfig } from "framer-motion";

export type MotionPreference = "system" | "reduced";

type MotionPreferenceContextValue = {
  preference: MotionPreference;
  reducedMotion: boolean;
  setPreference: (preference: MotionPreference) => void;
};

const MotionPreferenceContext = createContext<MotionPreferenceContextValue | null>(null);

function readPreference(storageKey: string): MotionPreference {
  if (typeof window === "undefined") return "system";
  try {
    return window.localStorage.getItem(storageKey) === "reduced" ? "reduced" : "system";
  } catch {
    return "system";
  }
}

export function MotionPreferenceProvider({
  storageKey,
  children,
}: {
  storageKey: string;
  children: ReactNode;
}) {
  const [preference, setPreferenceState] = useState<MotionPreference>("system");
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    setPreferenceState(readPreference(storageKey));
  }, [storageKey]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setSystemReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const reducedMotion = preference === "reduced" || systemReduced;

  useEffect(() => {
    document.documentElement.dataset.motionPreference = preference;
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
  }, [preference, reducedMotion]);

  const setPreference = useCallback((nextPreference: MotionPreference) => {
    setPreferenceState(nextPreference);
    try {
      window.localStorage.setItem(storageKey, nextPreference);
    } catch {
      // Motion preference remains active in memory when storage is blocked.
    }
  }, [storageKey]);

  const value = useMemo(
    () => ({ preference, reducedMotion, setPreference }),
    [preference, reducedMotion, setPreference],
  );

  return (
    <MotionPreferenceContext.Provider value={value}>
      <MotionConfig reducedMotion={preference === "reduced" ? "always" : "user"}>
        {children}
      </MotionConfig>
    </MotionPreferenceContext.Provider>
  );
}

export function useMotionPreference() {
  const context = useContext(MotionPreferenceContext);
  if (!context) throw new Error("useMotionPreference must be used inside MotionPreferenceProvider.");
  return context;
}
