"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type * as React from "react";
import { cn } from "../utils";
import { POPUP_SURFACE_STYLES } from "./popup-surface";

/* A popover in the menu material (popup-surface.tsx): white, ink-8% hairline, radius 14, the popover shadow, and the
   same scale + blur entrance as menus. Added for BACon's filter builder. */

export const Popover: typeof PopoverPrimitive.Root = PopoverPrimitive.Root;

export function PopoverTrigger(props: PopoverPrimitive.Trigger.Props): React.ReactElement {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

export function PopoverPopup({
  className,
  children,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Popup.Props & {
  side?: PopoverPrimitive.Positioner.Props["side"];
  align?: PopoverPrimitive.Positioner.Props["align"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
}): React.ReactElement {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner className="z-50" side={side} align={align} sideOffset={sideOffset}>
        <PopoverPrimitive.Popup
          className={cn(
            "overflow-hidden rounded-[14px] outline-none",
            POPUP_SURFACE_STYLES.surface,
            POPUP_SURFACE_STYLES.menuShadow,
            POPUP_SURFACE_STYLES.popupMotion,
            className,
          )}
          data-slot="popover-popup"
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { PopoverPrimitive };
