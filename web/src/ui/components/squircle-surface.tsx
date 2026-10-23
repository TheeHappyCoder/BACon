import * as React from "react";

import { cn } from "../utils";

const CARD_CLIP_PATH =
  "shape(from var(--card-clip-radius) 0px, line to calc(100% - var(--card-clip-radius)) 0px, curve to 100% var(--card-clip-radius) with calc(100% - var(--card-clip-handle)) 0px / 100% var(--card-clip-handle), line to 100% calc(100% - var(--card-clip-radius)), curve to calc(100% - var(--card-clip-radius)) 100% with 100% calc(100% - var(--card-clip-handle)) / calc(100% - var(--card-clip-handle)) 100%, line to var(--card-clip-radius) 100%, curve to 0px calc(100% - var(--card-clip-radius)) with var(--card-clip-handle) 100% / 0px calc(100% - var(--card-clip-handle)), line to 0px var(--card-clip-radius), curve to var(--card-clip-radius) 0px with 0px var(--card-clip-handle) / var(--card-clip-handle) 0px, close)";

type SquircleStyle = React.CSSProperties & {
  "--card-clip-handle"?: string;
  "--card-clip-path"?: string;
  "--card-clip-radius"?: string;
};

export function SquircleSurface({
  className,
  style,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="squircle-surface"
      className={cn(
        "relative flex min-w-0 flex-col rounded-[26px] bg-card text-card-foreground",
        "[--card-clip-handle:2.25px] [--card-clip-radius:14px] [clip-path:var(--card-clip-path)] [corner-shape:squircle]",
        "sm:rounded-[50px] sm:[--card-clip-handle:3px] sm:[--card-clip-radius:20px]",
        className,
      )}
      style={{ "--card-clip-path": CARD_CLIP_PATH, ...style } as SquircleStyle}
      {...props}
    >
      {children}
    </div>
  );
}
