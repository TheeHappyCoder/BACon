"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "../utils";

export const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border-0 bg-(--surface-card-muted) px-3 py-0.5 text-[12px] font-normal leading-5 text-(--text-strong) outline-none transition-[background-color,color] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [button&,a&]:cursor-pointer [button&,a&]:pointer-coarse:after:absolute [button&,a&]:pointer-coarse:after:size-full [button&,a&]:pointer-coarse:after:min-h-11 [button&,a&]:pointer-coarse:after:min-w-11",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "min-h-[22px]",
        lg: "min-h-8 px-5 py-1.5 text-[14px]",
        sm: "min-h-5 px-2.5 py-0 text-[12px]",
        xs: "min-h-4 px-1.5 py-0 text-[10px] leading-3 [&_svg]:size-2.5",
      },
      /* novacore badges and status pills: pill shape, pastel tint, ink label. Status is never coloured text. */
      variant: {
        default: "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--surface-card-muted) text-(--text-muted) [button&,a&]:hover:bg-(--surface-track) [button&,a&]:hover:text-(--text-strong)",
        secondary: "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--surface-card-muted) text-(--text-muted) [button&,a&]:hover:bg-(--surface-track) [button&,a&]:hover:text-(--text-strong)",
        tag: "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--surface-card-muted) text-(--text-muted) [button&,a&]:hover:bg-(--surface-track) [button&,a&]:hover:text-(--text-strong)",
        outline: "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-transparent text-(--text-muted) ring-1 ring-inset ring-(--border-default)",
        glass: "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-white/55 text-(--text-strong) backdrop-blur-[17px] dark:bg-white/10",
        kbd: "rounded-full border-0 bg-(--surface-card-muted) px-2 text-[11px] text-(--text-muted)",
        primary: "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--action-primary-soft) text-(--status-ink)",
        success: "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-ok-bg) text-(--status-ink)",
        "tone-success": "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-ok-bg) text-(--status-ink)",
        warning: "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-warn-bg) text-(--status-ink)",
        "status-warning": "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-warn-bg) text-(--status-ink)",
        "tone-warning": "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-warn-bg) text-(--status-ink)",
        destructive: "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-alarm-bg) text-(--status-ink)",
        error: "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-alarm-bg) text-(--status-ink)",
        "status-danger": "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-alarm-bg) text-(--status-ink)",
        "tone-danger": "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-alarm-bg) text-(--status-ink)",
        info: "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-info-bg) text-(--status-ink)",
        status: "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-info-bg) text-(--status-ink)",
        "status-info": "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-info-bg) text-(--status-ink)",
        "tone-info": "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-info-bg) text-(--status-ink)",
        "status-neutral": "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-offline-bg) text-(--text-muted)",
        "tone-neutral": "rounded-full border-0 px-3 py-0.5 text-[12px] font-normal leading-5 bg-(--status-offline-bg) text-(--text-muted)",
      },
    },
  },
);

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
  size?: VariantProps<typeof badgeVariants>["size"];
  /** A status pill in the novacore tones. Overrides `variant`. */
  tone?: BadgeTone;
}

export function Badge({
  className,
  variant,
  size,
  tone,
  render,
  ...props
}: BadgeProps): React.ReactElement {
  const defaultProps = {
    className: cn(badgeVariants({ className, size, variant: tone ? `tone-${tone}` : variant })),
    "data-slot": "badge",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}

const STATUS_DOT_COLORS: Record<string, string> = {
  dot: "bg-(--status-offline-strong)",
  "dot-accent": "bg-(--action-primary)",
  "dot-danger": "bg-(--status-alarm-strong)",
  "dot-warning": "bg-(--status-warn-strong)",
  "dot-success": "bg-(--status-ok-strong)",
  status: "bg-(--status-info-strong)",
  "status-danger": "bg-(--status-alarm-strong)",
  "status-info": "bg-(--status-info-strong)",
  "status-neutral": "bg-(--status-offline-strong)",
  "status-warning": "bg-(--status-warn-strong)",
};

export function StatusDot({
  variant,
  pulse = false,
  className,
}: {
  variant?: string;
  pulse?: boolean;
  className?: string;
}): React.ReactElement {
  const color = STATUS_DOT_COLORS[variant ?? ""] ?? STATUS_DOT_COLORS.dot;

  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", color, pulse && "animate-pulse", className)}
    />
  );
}
