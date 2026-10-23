"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type React from "react";
import { Banner, type BannerProps } from "./banner";
import { Sheet, SheetPopup } from "./sheet";
import { cn } from "../utils";

export function Card({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "relative flex flex-col rounded-[20px] bg-(--surface-card) text-card-foreground",
      className,
    ),
    "data-slot": "card",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function CardFrame({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "relative flex flex-col rounded-[20px] bg-(--surface-card) text-card-foreground has-data-[slot=table-container]:overflow-hidden *:data-[slot=card]:rounded-none *:data-[slot=card]:bg-transparent *:not-first:data-[slot=card]:border-t *:not-first:data-[slot=card]:border-(--border-subtle)",
      className,
    ),
    "data-slot": "card-frame",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function CardFrameHeader({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "relative flex grid auto-rows-min grid-rows-[auto_auto] flex-col items-start gap-x-4 px-6 pt-6 pb-5 has-data-[slot=card-frame-action]:grid-cols-[1fr_auto]",
      className,
    ),
    "data-slot": "card-frame-header",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function CardFrameTitle({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn("self-center text-[20px] font-normal leading-[1.4] text-(--text-strong)", className),
    "data-slot": "card-frame-title",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function CardFrameDescription({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn("self-center text-(--text-muted) text-[14px]", className),
    "data-slot": "card-frame-description",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function CardFrameAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "col-start-2 nth-3:row-span-2 nth-3:row-start-1 inline-flex self-center justify-self-end",
      className,
    ),
    "data-slot": "card-frame-action",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function CardFrameFooter({
  animated = false,
  banner = false,
  bannerVariant,
  className,
  pinned = false,
  render,
  children,
  ...props
}: useRender.ComponentProps<"div"> & {
  animated?: boolean;
  banner?: boolean;
  bannerVariant?: BannerProps["variant"];
  pinned?: boolean;
}): React.ReactElement {
  const content =
    banner && children ? (
      <Banner
        variant={bannerVariant}
        className="min-h-[52px] min-w-0 rounded-none border-x-0 border-b-0 px-5 py-3"
      >
        {children}
      </Banner>
    ) : (
      children
    );

  const defaultProps = {
    className: cn(
      banner ? "p-0" : "px-6 py-4",
      className,
      animated &&
        !pinned &&
        !banner &&
        "relative z-10 flex shrink-0 items-center max-h-0 overflow-hidden opacity-0 py-0 transition-all duration-300 ease-out group-hover:max-h-[52px] group-hover:opacity-100 group-hover:py-3",
      animated &&
        pinned &&
        !banner &&
        "relative z-10 flex max-h-[52px] shrink-0 items-center overflow-hidden opacity-100 py-3 transition-all duration-300 ease-out",
      animated &&
        !pinned &&
        banner &&
        "relative z-10 flex shrink-0 items-stretch max-h-0 overflow-hidden opacity-0 transition-all duration-300 ease-out group-hover:max-h-[52px] group-hover:opacity-100",
      animated &&
        pinned &&
        banner &&
        "relative z-10 flex max-h-[52px] shrink-0 items-stretch overflow-hidden opacity-100 transition-all duration-300 ease-out",
    ),
    "data-slot": "card-frame-footer",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">({ ...defaultProps, children: content }, props),
    render,
  });
}

export function CardFooterBanner({
  bannerVariant = "neutral",
  children,
  className,
  open,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  bannerVariant?: BannerProps["variant"];
  open: boolean;
}): React.ReactElement {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-20 translate-y-[calc(100%+1px)] transition-[translate] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none data-[state=open]:pointer-events-auto data-[state=open]:translate-y-0",
        className,
      )}
      data-slot="card-footer-banner"
      data-state={open ? "open" : "closed"}
      inert={!open}
      {...props}
    >
      <Banner
        variant={bannerVariant}
        className={cn(
          "min-h-[52px] min-w-0 rounded-none border-x-0 border-b-0 bg-none px-5 py-3 backdrop-blur-none shadow-[0_-10px_28px_-24px_rgba(15,23,42,0.65)]",
          bannerVariant === "success"
            ? "bg-emerald-50 dark:bg-emerald-950"
            : "bg-background",
        )}
      >
        {children}
      </Banner>
    </div>
  );
}

export function CardHeader({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 p-6 in-[[data-slot=card]:has(>[data-slot=card-panel])]:pb-4 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
      className,
    ),
    "data-slot": "card-header",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function CardTitle({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn("text-[20px] font-normal leading-[1.4] text-(--text-strong)", className),
    "data-slot": "card-title",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function CardDescription({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn("text-(--text-muted) text-[14px]", className),
    "data-slot": "card-description",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function CardAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "col-start-2 row-span-2 row-start-1 inline-flex self-start justify-self-end",
      className,
    ),
    "data-slot": "card-action",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function CardPanel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex-1 p-6 in-[[data-slot=card]:has(>[data-slot=card-header]:not(.border-b))]:pt-0 in-[[data-slot=card]:has(>[data-slot=card-footer]:not(.border-t))]:pb-0",
      className,
    ),
    "data-slot": "card-panel",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function CardSheet({
  children,
  className,
  container,
  onOpenChange,
  open,
  ...props
}: Omit<React.ComponentProps<typeof SheetPopup>, "portalProps"> & {
  container: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}): React.ReactElement {
  if (!container) return <></>;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup
        portalProps={{ container }}
        backdropClassName="absolute z-20"
        viewportClassName="absolute z-30 overflow-hidden"
        className={cn("h-full max-w-lg", className)}
        {...props}
      >
        {children}
      </SheetPopup>
    </Sheet>
  );
}

export function CardFooter({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex items-center p-6 in-[[data-slot=card]:has(>[data-slot=card-panel])]:pt-4",
      className,
    ),
    "data-slot": "card-footer",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export { CardPanel as CardContent };
