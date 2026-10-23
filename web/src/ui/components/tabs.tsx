"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { LayoutGroup, motion, MotionConfigContext, useReducedMotion } from "framer-motion";
import * as React from "react";
import { cn } from "../utils";

type TabsVariant = "pill" | "underline";

const TabsVariantContext = React.createContext<TabsVariant>("pill");

/** The segmented thumb's glide: quick and critically damped, so it settles without overshoot (nothing bounces). */
const THUMB_SPRING = { type: "spring", stiffness: 520, damping: 34, mass: 0.45 } as const;

export function Tabs({ className, ...props }: TabsPrimitive.Root.Props): React.ReactElement {
  return (
    <TabsPrimitive.Root
      className={cn("flex min-w-0 flex-col gap-2 data-[orientation=vertical]:flex-row", className)}
      data-slot="tabs"
      {...props}
    />
  );
}

/**
 * The tab track. `pill` (the default): a recessed segmented track, inset shadow and hairline, whose ink thumb glides
 * between tabs while the active label turns white. `underline` (categories): tabs on a stroke-4 hairline with a 2px
 * violet underline under the active one.
 */
export function TabsList({ className, variant = "pill", ...props }: TabsPrimitive.List.Props & { variant?: TabsVariant }): React.ReactElement {
  const id = React.useId();
  return (
    <TabsVariantContext.Provider value={variant}>
      <LayoutGroup id={id}>
        <TabsPrimitive.List
          className={cn(
            "relative isolate inline-flex max-w-full shrink-0 items-center overflow-x-auto text-(--text-muted)",
            "data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            variant === "pill"
              ? "w-fit gap-0.5 rounded-full bg-(--surface-track) p-[3px]"
              : "w-full gap-7 overflow-y-hidden border-b border-(--border-subtle)",
            className,
          )}
          data-slot="tabs-list"
          data-variant={variant}
          {...props}
        />
      </LayoutGroup>
    </TabsVariantContext.Provider>
  );
}

export function TabsTab({
  className,
  children,
  ...props
}: Omit<TabsPrimitive.Tab.Props, "render">): React.ReactElement {
  const variant = React.useContext(TabsVariantContext);
  const pill = variant === "pill";
  const systemReducedMotion = useReducedMotion();
  const { reducedMotion } = React.useContext(MotionConfigContext);
  const shouldReduceMotion = reducedMotion === "always" || (reducedMotion !== "never" && systemReducedMotion);

  return (
    <TabsPrimitive.Tab
      className={cn(
        "relative flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap font-normal outline-none",
        "transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 data-disabled:pointer-events-none data-disabled:opacity-50 motion-reduce:transition-none",
        "data-[orientation=vertical]:justify-start [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:pointer-events-none",
        pill
          ? "h-[26px] rounded-full px-3 text-[12px] transition-colors duration-150 hover:text-(--text-strong) data-active:text-white dark:data-active:text-(--surface-card)"
          : "pb-2.5 text-[13px] hover:text-(--text-strong) data-active:text-(--text-strong)",
        className,
      )}
      data-slot="tabs-tab"
      {...props}
      render={(buttonProps, state) => (
        <button {...buttonProps}>
          {state.active ? (
            <motion.span
              aria-hidden="true"
              data-slot="tab-indicator"
              className={cn(
                "pointer-events-none absolute",
                pill ? "inset-0 rounded-full bg-[#292929] dark:bg-(--text-strong)" : "inset-x-0 top-auto -bottom-px h-0.5 bg-(--action-primary)",
              )}
              initial={false}
              layoutId={shouldReduceMotion ? undefined : "tab-indicator"}
              transition={shouldReduceMotion ? { duration: 0 } : THUMB_SPRING}
            />
          ) : null}
          <span className="relative z-10 flex min-w-0 items-center justify-center gap-[inherit]">{children}</span>
        </button>
      )}
    />
  );
}

/** A tab's count: a small pill that lights with its tab. */
/** A count inside a tab or segment: always a small badge with its own background, never a raw number. */
export function TabsCount({ className, children }: { className?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <span
      data-slot="tabs-count"
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-(--surface-card) px-1.5 text-[10.5px] leading-none tabular-nums text-(--text-muted) transition-colors duration-150 in-data-active:bg-white/15 in-data-active:text-white dark:in-data-active:bg-black/10 dark:in-data-active:text-(--surface-card)",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props): React.ReactElement {
  return (
    <TabsPrimitive.Panel
      className={cn("flex-1 outline-none", className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}
