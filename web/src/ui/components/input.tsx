"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";
import { cn } from "../utils";

export type InputProps = Omit<
  InputPrimitive.Props & React.RefAttributes<HTMLInputElement>,
  "size"
> & {
  size?: "sm" | "default" | "lg" | number;
  /** Drop the field chrome (hairline, radius, focus ring) when the input sits inside another control. */
  unstyled?: boolean;
  nativeInput?: boolean;
};

export type InputButtonProps = Omit<
  React.ComponentPropsWithRef<"button">,
  "size"
> & {
  size?: "sm" | "default" | "lg";
};

function hasControlHeightClass(className: unknown): boolean {
  return typeof className === "string" &&
    /(?:^|\s)(?:[^\s:]+:)*!?h-[^\s]+/.test(className);
}

export function Input({
  className,
  size = "default",
  unstyled = false,
  nativeInput = false,
  style,
  ...props
}: InputProps): React.ReactElement {
  const hasExplicitHeight = hasControlHeightClass(className);

  const inputClassName = cn(
    "h-full w-full min-w-0 self-stretch rounded-[inherit] px-[11px] leading-normal outline-none [transition:background-color_5000000s_ease-in-out_0s] placeholder:text-[color-mix(in_srgb,var(--text-muted)_72%,transparent)]",
    size === "sm" &&
      "px-[9px]",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    props.type === "file" &&
      "text-muted-foreground file:me-3 file:bg-transparent file:font-medium file:text-foreground file:text-sm",
  );

  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full items-stretch rounded-[12px] border border-(--border-default) bg-(--surface-input) text-[14px] text-(--text-strong) shadow-[0_1px_2px_rgba(0,0,0,.05)] outline-none transition-[border-color,box-shadow,outline-color] duration-150 hover:border-(--border-strong) has-focus-visible:border-ring has-focus-visible:shadow-none has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring has-aria-invalid:border-[color-mix(in_srgb,var(--status-alarm-strong)_36%,transparent)] has-focus-visible:has-aria-invalid:outline-(--status-alarm-strong) has-autofill:bg-(--surface-card-muted) has-disabled:opacity-64",
          !hasExplicitHeight && "h-8",
          !hasExplicitHeight && size === "sm" && "h-7",
          !hasExplicitHeight && size === "lg" && "h-9",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      {nativeInput ? (
        <input
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={typeof style === "function" ? undefined : style}
          {...props}
        />
      ) : (
        <InputPrimitive
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={style}
          {...props}
        />
      )}
    </span>
  );
}

export function InputButton({
  className,
  size = "default",
  type = "button",
  ...props
}: InputButtonProps): React.ReactElement {
  const hasExplicitHeight = hasControlHeightClass(className);

  return (
    <button
      className={cn(
        "relative inline-flex w-full cursor-pointer items-center gap-2 px-[11px] text-left rounded-[12px] border border-(--border-default) bg-(--surface-input) text-[14px] text-(--text-strong) shadow-[0_1px_2px_rgba(0,0,0,.05)] outline-none transition-[border-color,box-shadow] duration-150 hover:border-(--border-strong) focus-visible:border-ring focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-invalid:border-[color-mix(in_srgb,var(--status-alarm-strong)_36%,transparent)] disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-(--text-muted)",
        !hasExplicitHeight && "h-8",
        !hasExplicitHeight && size === "sm" && "h-7",
        !hasExplicitHeight && size === "lg" && "h-9",
        className,
      )}
      data-size={size}
      data-slot="input-button"
      type={type}
      {...props}
    />
  );
}

export { InputPrimitive };
