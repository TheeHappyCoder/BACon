"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import type React from "react";
import { cn } from "../utils";
import "./checkbox.css";

export function Checkbox({
  checked,
  className,
  indeterminate,
  ...props
}: Omit<CheckboxPrimitive.Root.Props, "checked" | "indeterminate"> & {
  checked?: boolean | "indeterminate";
  indeterminate?: boolean;
}): React.ReactElement {
  const isIndeterminate = checked === "indeterminate" || indeterminate;

  return (
    <CheckboxPrimitive.Root
      checked={checked === "indeterminate" ? false : checked}
      className={cn(
        "t-check relative inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-(--border-default) bg-(--surface-card) shadow-[0_1px_2px_rgba(0,0,0,.05)] text-primary-foreground outline-none ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/48 data-disabled:cursor-not-allowed data-disabled:opacity-64 dark:border-foreground/35 dark:data-checked:border-primary dark:data-indeterminate:border-primary dark:aria-invalid:border-destructive/64 dark:aria-invalid:ring-destructive/24",
        className,
      )}
      data-slot="checkbox"
      indeterminate={isIndeterminate}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        keepMounted
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        data-slot="checkbox-indicator"
      >
        <svg
          aria-hidden="true"
          className="size-2.5 sm:size-2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
          viewBox="0 0 10.1668 10.1668"
        >
          {/* Path length is 14.39; the recipe's rounded-up dash length is 15. */}
          <path d="M1 5.52L3.92 9.17L9.17 1" />
          <line className="t-check-mixed" x1="2" y1="5.0834" x2="8.1668" y2="5.0834" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { CheckboxPrimitive };
