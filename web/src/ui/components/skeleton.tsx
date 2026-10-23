import type React from "react";
import { cn } from "../utils";

/** A quiet placeholder sized to the content it replaces. */
export function SkeletonBar({ className }: { className?: string }): React.ReactElement {
  return <span aria-hidden="true" className={cn("block rounded bg-muted-foreground/15", className)} />;
}

export function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "animate-skeleton rounded-sm [--skeleton-highlight:--alpha(var(--color-white)/64%)] [background:linear-gradient(120deg,transparent_40%,var(--skeleton-highlight),transparent_60%)_var(--color-muted)_0_0/200%_100%_fixed] dark:[--skeleton-highlight:--alpha(var(--color-white)/4%)]",
        className,
      )}
      data-slot="skeleton"
      {...props}
    />
  );
}
