"use client";

import React from "react";

import { cn } from "./utils";

const lineOpacities = [0.17, 0.25, 0.33, 0.42, 0.5, 0.58, 0.66, 0.75, 0.83, 1, 0.92, 0.08];

function RotatingLines({ size }: { size: number }) {
  return (
    <>
      <style>{`@keyframes novacore-rotating-lines { to { transform: rotate(360deg); } }`}</style>
      <svg
        aria-hidden="true"
        className="block size-full"
        viewBox="0 0 48 48"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        style={{ animation: "novacore-rotating-lines .75s steps(12, end) infinite" }}
      >
        {lineOpacities.map((opacity, index) => (
          <polyline
            key={index}
            points="24,12 24,4"
            strokeLinecap="round"
            strokeWidth="3"
            strokeOpacity={opacity}
            transform={`rotate(${index * 30}, 24, 24)`}
          />
        ))}
      </svg>
    </>
  );
}

type SizeOption = "xsmall" | "small" | "medium" | "large";
type Variant = "light" | "dark";

type LoadingIndicatorProps = {
  visible?: boolean;
  size?: SizeOption;
  contained?: boolean;
  variant?: Variant;
  minimal?: boolean;
  loadingText?: React.ReactNode;
  textPosition?: "left" | "right" | "top" | "bottom";
  textClassName?: string;
  className?: string;
  /** Use currentColor instead of the default muted tone - useful inside buttons */
  inheritColor?: boolean;
  children?: React.ReactNode;
};

const sizeMap: Record<SizeOption, number> = {
  xsmall: 20,
  small: 32,
  medium: 44,
  large: 56,
};

const minimalSizeMap: Record<SizeOption, number> = {
  xsmall: 14,
  small: 20,
  medium: 28,
  large: 36,
};

function resolveSize(size: keyof typeof sizeMap, minimal: boolean) {
  return minimal ? minimalSizeMap[size] : sizeMap[size];
}

function resolveTone({
  contained,
  variant,
  inheritColor,
}: {
  contained: boolean;
  variant: Variant;
  inheritColor: boolean;
}) {
  if (inheritColor) return undefined;
  if (contained) return "text-foreground";
  return variant === "dark" ? "text-white/80" : "text-muted-foreground";
}

const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  visible = true,
  size = "medium",
  contained = false,
  variant = "light",
  minimal = false,
  loadingText,
  textPosition = "right",
  textClassName,
  className,
  inheritColor = false,
  children,
}) => {
  if (!visible) return null;

  const resolvedLoadingText = loadingText ?? children;
  const spinnerSize = resolveSize(size, minimal);
  const spinnerTone = resolveTone({ contained, variant, inheritColor });

  const overlayBackground =
    variant === "dark" ? "rgba(10, 10, 10, 0.9)" : "rgba(255, 255, 255, 0.8)";

  const flexDirection =
    textPosition === "top"
      ? ("column-reverse" as const)
      : textPosition === "bottom"
        ? ("column" as const)
        : textPosition === "left"
          ? ("row-reverse" as const)
          : ("row" as const);

  const spinner = (
    <span
      data-slot="button-loading-indicator"
      className={cn("inline-flex shrink-0", spinnerTone)}
      style={{ width: spinnerSize, height: spinnerSize }}
    >
      <RotatingLines size={spinnerSize} />
    </span>
  );

  const content = (
    <div
      className="inline-flex items-center justify-center"
      style={{
        flexDirection,
        gap: resolvedLoadingText ? "0.5rem" : undefined,
      }}
    >
      {spinner}
      {resolvedLoadingText && <span className={textClassName}>{resolvedLoadingText}</span>}
    </div>
  );

  if (contained) {
    return (
      <div className={cn("inline-flex items-center justify-center", className)}>
        {content}
      </div>
    );
  }

  return (
    <div
      className={cn("fixed inset-0 flex items-center justify-center", className)}
      style={{
        backgroundColor: overlayBackground,
        zIndex: 9999,
      }}
    >
      {content}
    </div>
  );
};

export default LoadingIndicator;
