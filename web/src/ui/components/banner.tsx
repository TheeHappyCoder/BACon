"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";

import { cn } from "../utils";

const bannerVariants = cva(
  "relative flex min-h-8 w-full items-center gap-2 overflow-hidden rounded-[10px] border px-3 py-2 text-[0.75rem] leading-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_1px_2px_rgba(0,0,0,0.04)]",
  {
    variants: {
      variant: {
        neutral:
          "border-black/10 bg-gradient-to-b from-white/60 to-white/35 text-zinc-600 backdrop-blur-[12px] dark:border-white/[0.07] dark:from-white/[0.07] dark:to-white/[0.035] dark:text-white/62",
        info:
          "border-sky-900/10 bg-gradient-to-b from-sky-300/55 to-sky-500/18 text-sky-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_1px_2px_rgba(14,165,233,0.10)] dark:border-sky-300/10 dark:from-sky-300/18 dark:to-sky-500/10 dark:text-sky-100",
        success:
          "border-emerald-900/10 bg-gradient-to-b from-emerald-300/55 to-emerald-500/18 text-emerald-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_1px_2px_rgba(16,185,129,0.10)] dark:border-emerald-300/10 dark:from-emerald-300/18 dark:to-emerald-500/10 dark:text-emerald-100",
        warning:
          "border-amber-900/10 bg-gradient-to-b from-amber-300/60 to-amber-500/18 text-amber-950 dark:border-amber-300/10 dark:from-amber-300/18 dark:to-amber-500/10 dark:text-amber-100",
        destructive:
          "border-red-900/10 bg-gradient-to-b from-red-300/60 to-red-500/18 text-red-950 dark:border-red-300/10 dark:from-red-300/18 dark:to-red-500/10 dark:text-red-100",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

type BannerProps = Omit<React.HTMLAttributes<HTMLDivElement>, "title"> &
  VariantProps<typeof bannerVariants> & {
    description?: React.ReactNode;
    right?: React.ReactNode;
    rightAccent?: boolean;
    title?: React.ReactNode;
  };

function Banner({
  children,
  className,
  description,
  right,
  rightAccent = false,
  title,
  variant,
  ...props
}: BannerProps) {
  return (
    <div
      data-slot="banner"
      className={cn(bannerVariants({ variant }), className)}
      {...props}
    >
      {title || description || right ? (
        <>
          <div className="min-w-0 flex-1">
            {title ? (
              <p className="truncate text-[0.75rem] font-medium leading-5">
                {title}
              </p>
            ) : null}
            {description ? (
              <p className="truncate text-[0.6875rem] leading-4 opacity-70">
                {description}
              </p>
            ) : null}
            {children}
          </div>
          {right ? (
            <div
              className={cn(
                "shrink-0 text-[0.6875rem] font-medium leading-4 opacity-70",
                rightAccent &&
                  "rounded-[7px] border border-current/10 bg-white/28 px-2 py-1 opacity-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)] dark:bg-white/8",
              )}
            >
              {right}
            </div>
          ) : null}
        </>
      ) : (
        children
      )}
    </div>
  );
}

export { Banner, bannerVariants };
export type { BannerProps };
