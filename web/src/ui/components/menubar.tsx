"use client";

import * as React from "react";
import { Hugeicons } from "./hugeicons";
const { CheckIcon, ChevronRightIcon, CircleIcon } = Hugeicons;
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { cn } from "../utils";

function Menubar({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive>) {
  return (
    <MenubarPrimitive
      data-slot="menubar"
      className={cn(
        "flex h-9 items-center gap-1 rounded-xl border border-zinc-200/70 bg-white/[0.78] p-1 text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_1px_2px_rgba(0,0,0,0.04)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-zinc-300 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.24)]",
        className,
      )}
      {...props}
    />
  );
}

function MenubarMenu({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root data-slot="menubar-menu" {...props} />;
}

function MenubarGroup({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Group>) {
  return <MenuPrimitive.Group data-slot="menubar-group" {...props} />;
}

function MenubarPortal({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Portal>) {
  return <MenuPrimitive.Portal data-slot="menubar-portal" {...props} />;
}

function MenubarRadioGroup({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.RadioGroup>) {
  return (
    <MenuPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />
  );
}

function MenubarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Trigger>) {
  return (
    <MenuPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        "flex items-center rounded-lg px-2.5 py-1.5 text-[0.8125rem] font-normal tracking-[-0.01em] outline-hidden select-none text-zinc-700 focus:bg-zinc-100/80 focus:text-zinc-900 data-[state=open]:bg-zinc-100/80 data-[state=open]:text-zinc-900 dark:text-zinc-300 dark:focus:bg-white/[0.06] dark:focus:text-zinc-100 dark:data-[state=open]:bg-white/[0.06] dark:data-[state=open]:text-zinc-100",
        className,
      )}
      {...props}
    />
  );
}

function MenubarContent({
  className,
  children,
  align = "start",
  alignOffset = -4,
  side = "bottom",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> & {
  align?: React.ComponentProps<typeof MenuPrimitive.Positioner>["align"];
  alignOffset?: React.ComponentProps<typeof MenuPrimitive.Positioner>["alignOffset"];
  side?: React.ComponentProps<typeof MenuPrimitive.Positioner>["side"];
  sideOffset?: React.ComponentProps<typeof MenuPrimitive.Positioner>["sideOffset"];
}) {
  return (
    <MenubarPortal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="z-50"
        data-slot="menubar-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="menubar-content"
          className={cn(
            "relative flex min-w-[12rem] origin-(--transform-origin) overflow-hidden rounded-xl border border-zinc-200/80 bg-white/96 text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_16px_40px_-24px_rgba(0,0,0,0.35)] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 dark:border-white/[0.08] dark:bg-zinc-950 dark:text-zinc-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_16px_40px_-24px_rgba(0,0,0,0.8)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            className,
          )}
          {...props}
        >
          <div className="max-h-(--available-height) w-full overflow-y-auto p-1">
            {children}
          </div>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenubarPortal>
  );
}

function MenubarItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      data-slot="menubar-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-[0.8125rem] font-normal tracking-[-0.01em] text-zinc-700 outline-hidden select-none focus:bg-zinc-100/80 focus:text-zinc-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:text-zinc-300 dark:focus:bg-white/[0.06] dark:focus:text-zinc-100 dark:data-[variant=destructive]:focus:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-zinc-400 dark:[&_svg:not([class*='text-'])]:text-zinc-500 data-[variant=destructive]:*:[svg]:text-destructive!",
        className,
      )}
      {...props}
    />
  );
}

function MenubarCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="menubar-checkbox-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-lg py-2 pr-2.5 pl-8 text-[0.8125rem] font-normal tracking-[-0.01em] text-zinc-700 outline-hidden select-none focus:bg-zinc-100/80 focus:text-zinc-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:text-zinc-300 dark:focus:bg-white/[0.06] dark:focus:text-zinc-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-4" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

function MenubarRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="menubar-radio-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-lg py-2 pr-2.5 pl-8 text-[0.8125rem] font-normal tracking-[-0.01em] text-zinc-700 outline-hidden select-none focus:bg-zinc-100/80 focus:text-zinc-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:text-zinc-300 dark:focus:bg-white/[0.06] dark:focus:text-zinc-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

function MenubarLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.GroupLabel> & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="menubar-label"
      data-inset={inset}
      className={cn(
        "px-2.5 py-1.5 text-[0.6875rem] font-normal leading-4 text-zinc-500 data-[inset]:pl-8 dark:text-zinc-400",
        className,
      )}
      {...props}
    />
  );
}

function MenubarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="menubar-separator"
      className={cn("-mx-1 my-1 h-px bg-zinc-200/70 dark:bg-white/[0.08]", className)}
      {...props}
    />
  );
}

function MenubarShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="menubar-shortcut"
      className={cn(
        "ml-auto  text-[0.625rem] tabular-nums tracking-normal text-zinc-400 dark:text-zinc-500",
        className,
      )}
      {...props}
    />
  );
}

function MenubarSub({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.SubmenuRoot>) {
  return <MenuPrimitive.SubmenuRoot data-slot="menubar-sub" {...props} />;
}

function MenubarSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.SubmenuTrigger> & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="menubar-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-[0.8125rem] font-normal tracking-[-0.01em] text-zinc-700 outline-none select-none focus:bg-zinc-100/80 focus:text-zinc-900 data-[inset]:pl-8 data-[state=open]:bg-zinc-100/80 data-[state=open]:text-zinc-900 dark:text-zinc-300 dark:focus:bg-white/[0.06] dark:focus:text-zinc-100 dark:data-[state=open]:bg-white/[0.06] dark:data-[state=open]:text-zinc-100",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto h-4 w-4" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

function MenubarSubContent({
  className,
  children,
  align = "start",
  alignOffset,
  sideOffset = 0,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> & {
  align?: React.ComponentProps<typeof MenuPrimitive.Positioner>["align"];
  alignOffset?: React.ComponentProps<typeof MenuPrimitive.Positioner>["alignOffset"];
  sideOffset?: React.ComponentProps<typeof MenuPrimitive.Positioner>["sideOffset"];
}) {
  const defaultAlignOffset = align !== "center" ? -5 : undefined;

  return (
    <MenubarPortal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset ?? defaultAlignOffset}
        className="z-50"
        data-slot="menubar-sub-positioner"
        side="inline-end"
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="menubar-sub-content"
          className={cn(
            "relative flex min-w-[10rem] origin-(--transform-origin) overflow-hidden rounded-xl border border-zinc-200/80 bg-white/96 text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_16px_40px_-24px_rgba(0,0,0,0.35)] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 dark:border-white/[0.08] dark:bg-zinc-950 dark:text-zinc-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_16px_40px_-24px_rgba(0,0,0,0.8)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            className,
          )}
          {...props}
        >
          <div className="max-h-(--available-height) w-full overflow-y-auto p-1">
            {children}
          </div>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenubarPortal>
  );
}

export {
  Menubar,
  MenubarPortal,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarGroup,
  MenubarSeparator,
  MenubarLabel,
  MenubarItem,
  MenubarShortcut,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
};
