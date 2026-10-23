"use client";

import { motion, useReducedMotion } from "framer-motion";
import * as React from "react";

import { cn } from "../utils";

const TRAVELING_HIGHLIGHT_TRANSITION = {
  duration: 0.04,
  ease: "easeOut",
} as const;

type TravelingHighlightScopeValue = {
  activeItemId: string | null;
  highlightLayoutId: string;
};

const TravelingHighlightContext =
  React.createContext<TravelingHighlightScopeValue | null>(null);

export function TravelingHighlightScope({
  activationMode = "base-ui",
  children,
  className,
}: {
  activationMode?: "base-ui" | "pointer-and-focus";
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [activeItemId, setActiveItemId] = React.useState<string | null>(null);
  const highlightLayoutId = `${React.useId()}-traveling-highlight`;

  React.useEffect(() => {
    const container = containerRef.current;
    if (
      activationMode !== "base-ui" ||
      !container ||
      typeof MutationObserver === "undefined"
    ) {
      return;
    }

    const syncHighlightedItem = () => {
      const highlightedItem = container.querySelector<HTMLElement>(
        "[data-traveling-highlight-id][data-highlighted]",
      );
      const nextItemId =
        highlightedItem?.dataset.travelingHighlightId ?? null;
      setActiveItemId((currentItemId) =>
        currentItemId === nextItemId ? currentItemId : nextItemId,
      );
    };

    syncHighlightedItem();
    const observer = new MutationObserver(syncHighlightedItem);
    observer.observe(container, {
      attributeFilter: ["data-highlighted"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [activationMode]);

  const activateFromTarget = React.useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const item = target.closest<HTMLElement>("[data-traveling-highlight-id]");
    const container = containerRef.current;
    if (!item || !container?.contains(item)) {
      setActiveItemId(null);
      return;
    }

    const disabled =
      item.matches(":disabled, [aria-disabled='true'], [data-disabled]") ||
      item.dataset.travelingHighlightDisabled === "true";
    setActiveItemId(disabled ? null : item.dataset.travelingHighlightId ?? null);
  }, []);

  const contextValue = React.useMemo(
    () => ({ activeItemId, highlightLayoutId }),
    [activeItemId, highlightLayoutId],
  );

  return (
    <TravelingHighlightContext.Provider value={contextValue}>
      <div
        className={className}
        onBlurCapture={(event) => {
          if (activationMode !== "pointer-and-focus") return;
          const nextTarget = event.relatedTarget;
          if (
            !(nextTarget instanceof Node) ||
            !event.currentTarget.contains(nextTarget)
          ) {
            setActiveItemId(null);
          }
        }}
        onFocusCapture={(event) => {
          if (activationMode === "pointer-and-focus") {
            activateFromTarget(event.target);
          }
        }}
        onMouseLeave={() => {
          if (activationMode === "pointer-and-focus") setActiveItemId(null);
        }}
        onMouseMove={(event) => {
          if (activationMode === "pointer-and-focus") {
            activateFromTarget(event.target);
          }
        }}
        ref={containerRef}
      >
        {children}
      </div>
    </TravelingHighlightContext.Provider>
  );
}

export function TravelingHighlightTarget({
  className,
  dataSlot,
  itemId,
  reducedMotion,
}: {
  className?: string;
  dataSlot?: string;
  itemId: string;
  reducedMotion?: boolean | null;
}): React.ReactElement | null {
  const context = React.useContext(TravelingHighlightContext);
  if (!context || context.activeItemId !== itemId) return null;

  return (
    <TravelingHighlight
      className={className}
      dataSlot={dataSlot}
      layoutId={context.highlightLayoutId}
      reducedMotion={reducedMotion}
    />
  );
}

export function TravelingHighlight({
  className,
  dataSlot = "traveling-highlight",
  layoutId,
  reducedMotion,
}: {
  className?: string;
  dataSlot?: string;
  layoutId: string;
  reducedMotion?: boolean | null;
}): React.ReactElement {
  const prefersReducedMotion = useReducedMotion();
  const shouldReduceMotion = reducedMotion ?? prefersReducedMotion;

  return (
    <motion.span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit]",
        className,
      )}
      data-slot={dataSlot}
      initial={false}
      layoutId={layoutId}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : TRAVELING_HIGHLIGHT_TRANSITION
      }
    />
  );
}
