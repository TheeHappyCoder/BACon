"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import { isValidElement, useLayoutEffect, useRef, useState } from "react";

import { cn } from "../utils";
import { Hugeicons } from "./hugeicons";
import { EASE_OUT, SPRING_SWAP } from "../motion";
import LoadingIndicator from "../loading-indicator";

const ROLL_BLUR = "blur(6px)";
const { ChevronRight } = Hugeicons;

const ICON_VARIANTS: Variants = {
  initial: { opacity: 0, width: 0, scale: 0.7, filter: ROLL_BLUR },
  animate: { opacity: 1, width: "auto", scale: 1, filter: "blur(0px)", transition: SPRING_SWAP },
  exit: { opacity: 0, width: 0, scale: 0.7, filter: ROLL_BLUR, transition: { duration: 0.16, ease: EASE_OUT } },
};

function ButtonIconSlot({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return <AnimatePresence initial={false}>{visible ? <motion.span key="loading-icon" variants={ICON_VARIANTS} initial={reduce ? { opacity: 0 } : "initial"} animate={reduce ? { opacity: 1 } : "animate"} exit={reduce ? { opacity: 0 } : "exit"} transition={reduce ? { duration: 0.15 } : undefined} className="inline-grid shrink-0 place-items-center overflow-hidden" aria-hidden="true">{children}</motion.span> : null}</AnimatePresence>;
}

function ButtonTextSlot({ value, children }: { value: string; children: string }) {
  const reduce = useReducedMotion();
  const measureRef = useRef<HTMLSpanElement>(null);
  const visualRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();

  useLayoutEffect(() => {
    const measure = () => {
      const naturalWidth = measureRef.current?.getBoundingClientRect().width ?? 0;
      const visualWidth = visualRef.current?.getBoundingClientRect().width ?? 0;
      const measuredWidth = Math.max(naturalWidth, visualWidth);

      if (measuredWidth === 0) return;

      // Preserve fractional glyph widths and a device-pixel buffer so the
      // animated overflow mask never clips the label's final character.
      const nextWidth = Math.ceil(measuredWidth) + 1;
      setWidth((current) => current === nextWidth ? current : nextWidth);
    };

    measure();

    const measureElement = measureRef.current;
    const visualElement = visualRef.current;
    if (!measureElement || !visualElement || typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(measureElement);
    resizeObserver.observe(visualElement);

    return () => resizeObserver.disconnect();
  }, [children]);

  return <motion.span initial={false} animate={{ width }} transition={reduce ? { duration: 0 } : SPRING_SWAP} className="relative inline-block overflow-hidden whitespace-nowrap align-bottom">
    <span ref={measureRef} aria-hidden="true" className="invisible inline-block whitespace-nowrap">{children}</span>
    <span className="sr-only">{children}</span>
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span
        ref={visualRef}
        key={`text-${value}`}
        aria-hidden="true"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 3, filter: ROLL_BLUR }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3, filter: "blur(4px)" }}
        transition={{ duration: reduce ? 0.15 : 0.22, ease: EASE_OUT }}
        className="absolute left-0 top-0 inline-block whitespace-pre will-change-[opacity,filter,transform]"
      >
        {children}
      </motion.span>
    </AnimatePresence>
  </motion.span>;
}

const PRIMARY = "border border-(--action-primary-border) bg-[color-mix(in_srgb,var(--action-primary)_90%,var(--color-primary-800))] font-medium text-white shadow-[var(--shadow-inner-top),var(--shadow-inner-bottom)] hover:bg-(--action-primary) active:shadow-[inset_0_1px_0_rgba(255,255,255,.14),inset_0_-1px_0_rgba(58,52,128,.26)]";
const INK = "border border-transparent bg-(--surface-inverse) font-medium text-white hover:bg-[color-mix(in_srgb,var(--surface-inverse)_88%,white)] dark:bg-(--text-strong) dark:text-(--surface-card)";
const WHITE = "border border-(--color-stroke-3) bg-(--surface-card) font-medium text-(--text-strong) shadow-(--shadow-1) hover:bg-(--surface-hover) dark:border-(--border-default)";
const SECONDARY = "border border-transparent bg-(--paper-3) font-medium text-(--text-strong) hover:bg-[color-mix(in_srgb,var(--paper-3)_95%,var(--ink))] data-[popup-open]:bg-[color-mix(in_srgb,var(--paper-3)_95%,var(--ink))]";
const GHOST = "border border-transparent bg-transparent font-medium text-(--text-muted) hover:bg-(--accent) hover:text-(--text-strong) data-[popup-open]:bg-(--accent) data-[popup-open]:text-(--text-strong) aria-pressed:bg-(--accent) aria-pressed:text-(--text-strong)";
const DESTRUCTIVE = "border border-transparent bg-(--status-alarm-strong) font-medium text-white hover:bg-[color-mix(in_srgb,var(--status-alarm-strong)_90%,transparent)]";

const buttonVariants = cva(
  "group/btn relative inline-flex appearance-none cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full leading-none outline-none shrink-0 transition-[background-color,border-color,color,transform,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive active:translate-y-px active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      /* Novacore buttons (novacore-app-ux Button): every button is a pill. Blue is the one main action; secondary is
         a paper-3 fill; white is the hairline option; ghost is muted text; ink and lime are for dark surfaces and
         Restore. Press sinks 1px; nothing bounces. */
      variant: {
        default: PRIMARY,
        primary: PRIMARY,
        accent: INK,
        charcoal: INK,
        ink: INK,
        glow: INK,
        white: WHITE,
        outline: WHITE,
        raised: WHITE,
        glass: WHITE,
        secondary: SECONDARY,
        gray: SECONDARY,
        ghost: GHOST,
        quiet: GHOST,
        soft: GHOST,
        green: "border border-(--color-ns-green-light) bg-(--color-ns-green) font-medium text-[#292929] hover:bg-[color-mix(in_srgb,var(--color-ns-green)_90%,#292929)]",
        destructive: DESTRUCTIVE,
        danger: DESTRUCTIVE,
        link: "h-auto border-0 bg-transparent px-0 font-normal text-(--action-primary) underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-3 text-[14px]",
        md: "h-9 px-3.5 text-[14px]",
        lg: "h-10 px-6 text-[14px]",
        pill: "h-9 px-4 text-[14px]",
        sm: "h-8 px-3 text-[14px]",
        compact: "h-8 px-3 text-[13px]",
        xs: "h-7 px-2 text-[12px] [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-9 p-0",
        round: "size-9 p-0",
        "icon-sm": "size-8 p-0",
        "round-sm": "size-8 p-0",
        "icon-xs": "size-7 p-0 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
    loadingText?: string;
    /** Use the compact loading indicator variant inside buttons */
    minimalLoader?: boolean;
    /** A chevron that slides in from the right edge on hover. */
    chevron?: boolean;
  };

function getLoaderSize(
  size?: VariantProps<typeof buttonVariants>["size"],
): "xsmall" | "small" {
  switch (size) {
    case "xs":
    case "sm":
    case "icon":
    case "icon-sm":
    case "icon-xs":
    case "compact":
    case "round":
    case "round-sm":
      return "xsmall";
    case "lg":
    case "pill":
    case "default":
    default:
      return "small";
  }
}

function Button({
  className,
  variant = "default",
  size,
  loading = false,
  loadingText,
  minimalLoader = true,
  chevron = false,
  children,
  render,
  nativeButton,
  ...props
}: ButtonProps) {
  const loaderSize = getLoaderSize(size);
  const resolvedNativeButton = nativeButton
    ?? (render === undefined || (isValidElement(render) && render.type === "button"));

  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant ?? "default"}
      data-size={size ?? "default"}
      data-loading={loading ? "true" : undefined}
      className={cn(buttonVariants({ variant, size }), chevron && "hover:scale-[1.02]", className)}
      {...props}
      render={render}
      nativeButton={resolvedNativeButton}
      disabled={loading || props.disabled}
      aria-busy={loading || undefined}
    >
      <span aria-live="polite" className="relative inline-flex items-center justify-center gap-1.5 overflow-hidden">
        <ButtonIconSlot visible={loading}>
          <LoadingIndicator
            size={loaderSize}
            minimal={minimalLoader}
            inheritColor
            contained
          />
        </ButtonIconSlot>
        {loading && loadingText ? (
          <ButtonTextSlot value={`loading-${loadingText}`}>{loadingText}</ButtonTextSlot>
        ) : typeof children === "string" ? (
          <ButtonTextSlot value="idle">{children}</ButtonTextSlot>
        ) : (
          <span className="inline-flex items-center gap-2">{children}</span>
        )}
        {chevron ? (
          <span aria-hidden="true" className="-ml-1.5 inline-flex w-0 overflow-hidden opacity-0 transition-[width,opacity,margin] duration-300 ease-in-out group-hover/btn:ml-0 group-hover/btn:w-3.5 group-hover/btn:opacity-100 motion-reduce:transition-none">
            <ChevronRight className="size-3 shrink-0" strokeWidth={2} />
          </span>
        ) : null}
      </span>
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
