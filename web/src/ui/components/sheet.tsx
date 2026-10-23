"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { Hugeicons } from "./hugeicons";
const { XIcon } = Hugeicons;
import { AnimatePresence, motion } from "framer-motion";
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "../utils";
import { Button } from "./button";
import { ScrollArea } from "./scroll-area";

export const Sheet: typeof SheetPrimitive.Root = SheetPrimitive.Root;

export const SheetPortal: typeof SheetPrimitive.Portal = SheetPrimitive.Portal;

export function SheetTrigger(
  props: SheetPrimitive.Trigger.Props,
): React.ReactElement {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

export function SheetClose(
  props: SheetPrimitive.Close.Props,
): React.ReactElement {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

export function SheetBackdrop({
  className,
  ...props
}: SheetPrimitive.Backdrop.Props): React.ReactElement {
  return (
    <SheetPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-(--backdrop) backdrop-blur-[4px] transition-all duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:backdrop-blur-none data-starting-style:backdrop-blur-none",
        className,
      )}
      data-slot="sheet-backdrop"
      {...props}
    />
  );
}

export function SheetViewport({
  className,
  side,
  variant = "default",
  ...props
}: SheetPrimitive.Viewport.Props & {
  side?: "right" | "left" | "top" | "bottom";
  variant?: "default" | "inset";
}): React.ReactElement {
  return (
    <SheetPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-50 grid",
        side === "bottom" && "grid grid-rows-[1fr_auto] pt-12",
        side === "top" && "grid grid-rows-[auto_1fr] pb-12",
        side === "left" && "flex justify-start",
        side === "right" && "flex justify-end",
        /* Side sheets float 12px from the window's edges. */
        (variant === "inset" || side === "right" || side === "left") && "sm:p-3",
        className,
      )}
      data-slot="sheet-viewport"
      {...props}
    />
  );
}

export function SheetPopup({
  className,
  backdropClassName,
  children,
  showBackdrop = true,
  showCloseButton = true,
  side = "right",
  stackOpen = false,
  stackRole,
  variant = "default",
  closeProps,
  portalProps,
  viewportClassName,
  ...props
}: SheetPrimitive.Popup.Props & {
  backdropClassName?: string;
  showBackdrop?: boolean;
  showCloseButton?: boolean;
  side?: "right" | "left" | "top" | "bottom";
  stackOpen?: boolean;
  stackRole?: "parent" | "child";
  variant?: "default" | "inset";
  closeProps?: SheetPrimitive.Close.Props;
  portalProps?: SheetPrimitive.Portal.Props;
  viewportClassName?: string;
}): React.ReactElement {
  return (
    <SheetPortal {...portalProps}>
      {showBackdrop ? <SheetBackdrop className={backdropClassName} /> : null}
      <SheetViewport side={side} variant={variant} className={viewportClassName}>
        <SheetPrimitive.Popup
          className={cn(
            "relative flex max-h-full min-h-0 w-full min-w-0 flex-col bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-(--shadow-2) transition-[opacity,translate] duration-200 ease-in-out before:pointer-events-none before:absolute before:inset-0 before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:opacity-0 data-starting-style:opacity-0 max-sm:before:hidden dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            side === "bottom" &&
              "row-start-2 border-t data-ending-style:translate-y-8 data-starting-style:translate-y-8",
            side === "top" &&
              "border-b data-ending-style:-translate-y-8 data-starting-style:-translate-y-8",
            side === "left" &&
              "w-[calc(100%-(--spacing(12)))] max-w-[460px] border-e data-ending-style:-translate-x-10 data-starting-style:-translate-x-10",
            side === "right" &&
              "col-start-2 w-[calc(100%-(--spacing(12)))] max-w-[460px] border-s data-ending-style:translate-x-10 data-starting-style:translate-x-10",
            /* The novacore side sheet: 18px radius on a hairline, the deep shadow, and a blur-fade in from the side. */
            (side === "right" || side === "left") &&
              "transition-[opacity,translate,filter] duration-500 ease-[cubic-bezier(.25,.46,.45,.94)] data-ending-style:duration-200 data-ending-style:blur-[6px] data-starting-style:blur-[10px] sm:border sm:border-(--border-subtle) sm:shadow-(--shadow-side-sheet)",
            (variant === "inset" || side === "right" || side === "left") &&
              "before:hidden sm:rounded-[18px] sm:**:data-[slot=sheet-footer]:rounded-b-[17px]",
            stackRole &&
              "transition-[opacity,translate,scale,border-radius,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
            stackRole === "parent" &&
              "[--sheet-stack-offset:28rem] lg:data-[stack-open=true]:-translate-x-[var(--sheet-stack-offset)] lg:data-[stack-open=true]:rounded-e-none lg:data-[stack-open=true]:border-e-0 lg:data-[stack-open=true]:shadow-none",
            stackRole === "child" &&
              "origin-right data-ending-style:translate-x-24 data-ending-style:scale-[0.99] data-starting-style:translate-x-24 data-starting-style:scale-[0.985] lg:rounded-s-none lg:border-s lg:shadow-none",
            className,
          )}
          data-stack-open={stackOpen ? "true" : undefined}
          data-stack-role={stackRole}
          data-slot="sheet-popup"
          {...props}
        >
          {children}
          {showCloseButton && (
            <SheetPrimitive.Close
              aria-label="Close"
              className="absolute end-4 top-4 rounded-full"
              render={<Button size="icon-sm" variant="secondary" />}
              {...closeProps}
            >
              <XIcon />
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Popup>
      </SheetViewport>
    </SheetPortal>
  );
}

export function SheetHeader({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex flex-col gap-2 p-6 in-[[data-slot=sheet-popup]:has([data-slot=sheet-panel])]:pb-3 max-sm:pb-4",
      className,
    ),
    "data-slot": "sheet-header",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function SheetFooter({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  variant?: "default" | "bare";
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex flex-col-reverse gap-2 px-6 sm:flex-row sm:justify-end",
      variant === "default" && "border-t border-(--border-divider) py-3.5",
      variant === "bare" &&
        "in-[[data-slot=sheet-popup]:has([data-slot=sheet-panel])]:pt-3 pt-4 pb-6",
      className,
    ),
    "data-slot": "sheet-footer",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function SheetTitle({
  className,
  ...props
}: SheetPrimitive.Title.Props): React.ReactElement {
  return (
    <SheetPrimitive.Title
      className={cn(
        "font-heading text-[17px] font-medium leading-tight tracking-[-0.01em]",
        className,
      )}
      data-slot="sheet-title"
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props): React.ReactElement {
  return (
    <SheetPrimitive.Description
      className={cn("text-[13px] text-muted-foreground", className)}
      data-slot="sheet-description"
      {...props}
    />
  );
}

export function SheetPanel({
  className,
  scrollFade = true,
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  scrollFade?: boolean;
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      "p-6 in-[[data-slot=sheet-popup]:has([data-slot=sheet-header])]:pt-1 in-[[data-slot=sheet-popup]:has([data-slot=sheet-footer]:not(.border-t))]:pb-1",
      className,
    ),
    "data-slot": "sheet-panel",
  };

  return (
    <ScrollArea scrollFade={scrollFade}>
      {useRender({
        defaultTagName: "div",
        props: mergeProps<"div">(defaultProps, props),
        render,
      })}
    </ScrollArea>
  );
}

export { SheetPrimitive };

type AnimatedSheetProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  locked?: boolean;
  className?: string;
  side?: "right" | "left" | "bottom";
  width?: string;
  height?: string;
  minHeight?: string;
};

export function AnimatedSheet({
  open,
  onClose,
  children,
  locked = false,
  className,
  side = "right",
  width = "25vw",
  height = "48vh",
  minHeight,
}: AnimatedSheetProps): React.ReactElement {
  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open || locked) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [locked, onClose, open]);

  const bottom = side === "bottom";
  const slideFrom = side === "right" ? "100%" : "-100%";
  const content = (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-background/80 backdrop-blur-md"
            onClick={() => {
              if (!locked) onClose();
            }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={bottom ? { y: "100%" } : { x: slideFrom }}
            animate={bottom ? { y: 0 } : { x: 0 }}
            exit={bottom ? { y: "100%" } : { x: slideFrom }}
            transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "relative flex flex-col overflow-hidden bg-background",
              bottom
                ? "mx-auto mt-auto w-[98vw] rounded-t-2xl shadow-(--shadow-2)"
                : cn("h-full shadow-(--shadow-2)", side === "right" ? "ml-auto" : "mr-auto"),
              className,
            )}
            style={bottom ? { height, ...(minHeight ? { minHeight } : {}) } : { width }}
          >
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );

  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

export function AnimatedSheetHeader({
  children,
  onClose,
  hideClose = false,
  disabled = false,
  className,
}: {
  children: React.ReactNode;
  onClose?: () => void;
  hideClose?: boolean;
  disabled?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn("flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      {!hideClose && onClose ? (
        <button
          type="button"
          onClick={onClose}
          disabled={disabled}
          aria-label="Close"
          className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <XIcon className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

export function AnimatedSheetBody({ children, className }: { children: React.ReactNode; className?: string }): React.ReactElement {
  return <div className={cn("flex-1 overflow-y-auto", className)}>{children}</div>;
}

export function AnimatedSheetFooter({ children, className }: { children: React.ReactNode; className?: string }): React.ReactElement {
  return <div className={cn("flex shrink-0 items-center justify-between gap-4 border-t border-border bg-muted/30 px-5 py-3", className)}>{children}</div>;
}
