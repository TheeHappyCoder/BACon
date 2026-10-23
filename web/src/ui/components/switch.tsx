"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import type React from "react";
import { cn } from "../utils";

export function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "default" | "lg" | "sm" | string;
}): React.ReactElement {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 items-center rounded-full p-px outline-none transition-shadow duration-200 [--thumb-size:--spacing(4)] [--switch-travel:calc(var(--thumb-size)-4px)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-disabled:cursor-not-allowed data-checked:bg-(--action-primary) data-unchecked:bg-(--border-default) data-disabled:opacity-64 sm:[--thumb-size:--spacing(4)]",
        size === "sm" && "[--thumb-size:--spacing(3.5)]",
        size === "lg" && "[--thumb-size:--spacing(6)] sm:[--thumb-size:--spacing(4)]",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          // https://transitions.dev/detail.html?t=toggle
          // 350ms overshoot, return, settle. A continuous
          // transition also reverses from the current position on rapid input.
          "pointer-events-none block aspect-square h-full rounded-(--thumb-size) bg-white shadow-(--shadow-1) transition-[translate] duration-350 ease-[linear(0,0.45_10%,0.8_20%,1_30%,1.08_40%,1.07_55%,1.02_65%,0.995_75%,1_80%,1)] data-checked:translate-x-(--switch-travel) motion-reduce:transition-none [[data-reduced-motion=true]_&]:transition-none",
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { SwitchPrimitive };
