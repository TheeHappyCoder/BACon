"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import * as React from "react";
import { cn } from "../utils";
import { DARK_ACTION_SURFACE_STYLES } from "./dark-action-surface";

export const TooltipCreateHandle: typeof TooltipPrimitive.createHandle =
  TooltipPrimitive.createHandle;

export function TooltipProvider({
  delayDuration,
  delay,
  ...props
}: TooltipPrimitive.Provider.Props & {
  delayDuration?: TooltipPrimitive.Provider.Props["delay"];
}): React.ReactElement {
  return (
    <TooltipPrimitive.Provider
      delay={delay ?? delayDuration}
      {...props}
    />
  );
}

export function Tooltip({
  delayDuration,
  ...props
}: TooltipPrimitive.Root.Props & {
  delayDuration?: TooltipPrimitive.Provider.Props["delay"];
}): React.ReactElement {
  if (delayDuration === undefined) {
    return <TooltipPrimitive.Root {...props} />;
  }

  return (
    <TooltipProvider delay={delayDuration}>
      <TooltipPrimitive.Root {...props} />
    </TooltipProvider>
  );
}

export function TooltipTrigger({
  render,
  ...props
}: Omit<TooltipPrimitive.Trigger.Props, "render"> & {
  render?: React.ReactNode | TooltipPrimitive.Trigger.Props["render"];
}): React.ReactElement {
  const resolvedRender =
    React.isValidElement(render) || typeof render === "function"
      ? (render as TooltipPrimitive.Trigger.Props["render"])
      : undefined;

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      render={resolvedRender}
      {...props}
    />
  );
}

export function TooltipPopup({
  className,
  align = "center",
  sideOffset = 4,
  side = "top",
  anchor,
  children,
  portalProps,
  ...props
}: TooltipPrimitive.Popup.Props & {
  align?: TooltipPrimitive.Positioner.Props["align"];
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
  anchor?: TooltipPrimitive.Positioner.Props["anchor"];
  portalProps?: TooltipPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <TooltipPrimitive.Portal {...portalProps}>
      <TooltipPrimitive.Positioner
        align={align}
        anchor={anchor}
        className="z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] data-instant:transition-none motion-reduce:transition-none"
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            "relative flex h-(--popup-height,auto) w-(--popup-width,auto) text-balance rounded-lg text-xs",
            DARK_ACTION_SURFACE_STYLES.surface,
            "text-white/90",
            DARK_ACTION_SURFACE_STYLES.tooltipContext,
            DARK_ACTION_SURFACE_STYLES.tooltipMotion,
            DARK_ACTION_SURFACE_STYLES.tooltipShadow,
            className,
          )}
          data-slot="tooltip-popup"
          {...props}
        >
          <TooltipPrimitive.Viewport
            className="relative size-full overflow-clip px-(--viewport-inline-padding) py-1 [--viewport-inline-padding:--spacing(2)] data-instant:transition-none motion-reduce:**:transition-none **:data-current:data-ending-style:opacity-0 **:data-current:data-starting-style:opacity-0 **:data-previous:data-ending-style:opacity-0 **:data-previous:data-starting-style:opacity-0 **:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:truncate **:data-current:opacity-100 **:data-previous:opacity-100 **:data-current:transition-opacity **:data-previous:transition-opacity"
            data-slot="tooltip-viewport"
          >
            {children}
          </TooltipPrimitive.Viewport>
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { TooltipPrimitive, TooltipPopup as TooltipContent };
