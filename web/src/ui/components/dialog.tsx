"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { Hugeicons } from "./hugeicons";
const { XIcon } = Hugeicons;
import type React from "react";

import { cn } from "../utils";
import { Button } from "./button";
import { Card, CardFrame, CardFrameFooter, CardFrameHeader } from "./card";

export const DialogCreateHandle: typeof DialogPrimitive.createHandle = DialogPrimitive.createHandle;

export const Dialog: typeof DialogPrimitive.Root = DialogPrimitive.Root;

export const DialogPortal: typeof DialogPrimitive.Portal = DialogPrimitive.Portal;

export function DialogTrigger(props: DialogPrimitive.Trigger.Props): React.ReactElement {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export function DialogClose(
  props: DialogPrimitive.Close.Props & { size?: string },
): React.ReactElement {
  const { size: _size, ...closeProps } = props;
  return <DialogPrimitive.Close data-slot="dialog-close" {...closeProps} />;
}

export function DialogBackdrop({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props): React.ReactElement {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-[#1a1a1c]/40 transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      data-slot="dialog-backdrop"
      {...props}
    />
  );
}

export function DialogViewport({
  className,
  ...props
}: DialogPrimitive.Viewport.Props): React.ReactElement {
  return (
    <DialogPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-50 grid grid-rows-[1fr_auto_3fr] justify-items-center p-4",
        className,
      )}
      data-slot="dialog-viewport"
      {...props}
    />
  );
}

export function DialogPopup({
  className,
  children,
  showCloseButton = true,
  bottomStickOnMobile = true,
  closeProps,
  portalProps,
  size: _size,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  bottomStickOnMobile?: boolean;
  closeProps?: DialogPrimitive.Close.Props;
  portalProps?: DialogPrimitive.Portal.Props;
  size?: string;
}): React.ReactElement {
  return (
    <DialogPortal {...portalProps}>
      <DialogBackdrop />
      <DialogViewport
        className={cn(
          bottomStickOnMobile && "max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12",
        )}
      >
        <DialogPrimitive.Popup
          className={cn(
            "relative row-start-2 flex w-full min-w-0 max-w-lg origin-center flex-col opacity-100 outline-none transition-[scale,opacity,translate] duration-200 ease-in-out will-change-transform data-ending-style:opacity-0 data-starting-style:opacity-0 sm:scale-[calc(1-0.1*var(--nested-dialogs))] sm:data-ending-style:scale-98 sm:data-starting-style:scale-98",
            "max-h-[calc(100vh-4rem)]",
            bottomStickOnMobile &&
              "max-sm:max-w-none max-sm:origin-bottom max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4 max-sm:max-h-[calc(100vh-3rem)]",
            className,
          )}
          data-slot="dialog-popup"
          {...props}
        >
          <CardFrame className="max-h-full min-h-0 overflow-hidden shadow-(--shadow-2) max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0 max-sm:before:rounded-none">
            {children}
            {showCloseButton ? (
              <DialogPrimitive.Close
                aria-label="Close"
                className="absolute end-4 top-4 z-20 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-(--surface-card-muted) text-(--text-muted) transition-colors duration-200 hover:bg-(--surface-track) hover:text-(--text-strong) focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40"
                render={<Button size="icon" variant="ghost" />}
                {...closeProps}
              >
                <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </DialogPrimitive.Close>
            ) : null}
          </CardFrame>
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  );
}

export function DialogHeader({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "relative z-10 flex shrink-0 flex-col gap-0 px-5 py-4 pr-14",
      className,
    ),
    "data-slot": "dialog-header",
  };

  return <CardFrameHeader render={render} {...mergeProps<"div">(defaultProps, props)} />;
}

export function DialogFooter({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  variant?: "default" | "bare";
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      "relative z-10 flex shrink-0 flex-col-reverse gap-2 px-5 sm:flex-row sm:justify-end sm:rounded-b-[calc(var(--radius-2xl)-1px)]",
      variant === "default" && "py-3",
      variant === "bare" && "pt-3 pb-5",
      className,
    ),
    "data-slot": "dialog-footer",
  };

  return <CardFrameFooter render={render} {...mergeProps<"div">(defaultProps, props)} />;
}

export function DialogTitle({
  className,
  ...props
}: DialogPrimitive.Title.Props): React.ReactElement {
  return (
    <DialogPrimitive.Title
      className={cn("text-card-title", className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props): React.ReactElement {
  return (
    <DialogPrimitive.Description
      className={cn(
        "mt-1 text-[0.6875rem] font-normal leading-4 text-zinc-500 dark:text-zinc-400",
        className,
      )}
      data-slot="dialog-description"
      {...props}
    />
  );
}

export function DialogPanel({
  className,
  scrollFade: _scrollFade = true,
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  scrollFade?: boolean;
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      "min-h-0 flex-1 overflow-y-auto rounded-xl border-t border-b border-l-0 border-r-0 p-5 shadow-none before:hidden",
      className,
    ),
    "data-slot": "dialog-panel",
  };

  return <Card render={render} {...mergeProps<"div">(defaultProps, props)} />;
}

export { DialogPrimitive };
