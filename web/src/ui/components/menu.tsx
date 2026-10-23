"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Hugeicons } from "./hugeicons";
const { ChevronRightIcon } = Hugeicons;
import * as React from "react";
import { useId } from "react";
import { cn } from "../utils";
import { POPUP_SURFACE_STYLES } from "./popup-surface";
import {
  TravelingHighlightScope,
  TravelingHighlightTarget,
} from "./traveling-highlight";

export const MenuCreateHandle: typeof MenuPrimitive.createHandle =
  MenuPrimitive.createHandle;

export const Menu: typeof MenuPrimitive.Root = MenuPrimitive.Root;

export const MenuPortal: typeof MenuPrimitive.Portal = MenuPrimitive.Portal;

export function MenuTrigger({
  className,
  children,
  ...props
}: MenuPrimitive.Trigger.Props): React.ReactElement {
  return (
    <MenuPrimitive.Trigger
      className={className}
      data-slot="menu-trigger"
      {...props}
    >
      {children}
    </MenuPrimitive.Trigger>
  );
}

export function MenuPopup({
  children,
  className,
  contentClassName,
  sideOffset = 4,
  align = "center",
  alignOffset,
  side = "bottom",
  anchor,
  portalProps,
  render,
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  side?: MenuPrimitive.Positioner.Props["side"];
  anchor?: MenuPrimitive.Positioner.Props["anchor"];
  portalProps?: MenuPrimitive.Portal.Props;
  contentClassName?: string;
}): React.ReactElement {
  return (
    <MenuPortal {...portalProps}>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50"
        data-slot="menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn(
            "relative flex not-[class*='w-']:min-w-32 overflow-hidden rounded-[14px] outline-none focus:outline-none",
            POPUP_SURFACE_STYLES.surface,
            POPUP_SURFACE_STYLES.menuShadow,
            !render && POPUP_SURFACE_STYLES.popupMotion,
            className,
          )}
          data-slot="menu-popup"
          render={render}
          {...props}
        >
          <TravelingHighlightScope
            className={cn(
              "max-h-(--available-height) w-full overflow-y-auto p-1",
              contentClassName,
            )}
          >
            {children}
          </TravelingHighlightScope>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPortal>
  );
}

export function MenuGroup(
  props: MenuPrimitive.Group.Props,
): React.ReactElement {
  return <MenuPrimitive.Group data-slot="menu-group" {...props} />;
}

export function MenuItem({
  className,
  children,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}): React.ReactElement {
  const highlightItemId = useId();

  return (
    <MenuPrimitive.Item
      className={cn(
        POPUP_SURFACE_STYLES.menuItem,
        POPUP_SURFACE_STYLES.menuDestructiveItem,
        className,
      )}
      data-inset={inset}
      data-traveling-highlight-id={highlightItemId}
      data-slot="menu-item"
      data-variant={variant}
      {...props}
    >
      <TravelingHighlightTarget
        className={
          variant === "destructive"
            ? POPUP_SURFACE_STYLES.destructiveHighlight
            : POPUP_SURFACE_STYLES.highlight
        }
        itemId={highlightItemId}
      />
      {children}
    </MenuPrimitive.Item>
  );
}

/**
 * The two-line body of a menu item: a title and a muted description, each with an explicit line height so the
 * description can never overlap the title. The item sizes to this content (give it `py-2`).
 */
export function MenuItemText({
  title,
  description,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <span className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-[0.8125rem] font-medium leading-5">{title}</span>
      {description ? (
        <span className="text-xs font-normal leading-4 text-(--text-muted)">
          {description}
        </span>
      ) : null}
    </span>
  );
}

export function MenuCheckboxItem({
  className,
  children,
  checked,
  variant = "default",
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  variant?: "default" | "switch";
}): React.ReactElement {
  const highlightItemId = useId();

  return (
    <MenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        "in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)]",
        POPUP_SURFACE_STYLES.menuChoiceItem,
        variant === "switch"
          ? "grid-cols-[1fr_auto] gap-4 ps-3 pe-2"
          : "grid-cols-[.75rem_1fr] ps-3 pe-4",
        className,
      )}
      data-traveling-highlight-id={highlightItemId}
      data-slot="menu-checkbox-item"
      {...props}
    >
      {variant === "switch" ? (
        <>
          <TravelingHighlightTarget
            className={POPUP_SURFACE_STYLES.highlight}
            itemId={highlightItemId}
          />
          <span className="col-start-1">{children}</span>
          <MenuPrimitive.CheckboxItemIndicator
            className="inset-shadow-[0_1px_--theme(--color-black/4%)] inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 items-center rounded-full p-px outline-none transition-[background-color,box-shadow] duration-200 [--thumb-size:--spacing(4)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input data-disabled:opacity-64 sm:[--thumb-size:--spacing(3)]"
            keepMounted
          >
            <span className="pointer-events-none block aspect-square h-full in-[[data-slot=menu-checkbox-item][data-checked]]:origin-[var(--thumb-size)_50%] origin-left in-[[data-slot=menu-checkbox-item][data-checked]]:translate-x-[calc(var(--thumb-size)-4px)] in-[[data-slot=menu-checkbox-item]:active]:not-data-disabled:scale-x-110 in-[[data-slot=menu-checkbox-item]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.10)] rounded-(--thumb-size) bg-background shadow-sm/5 will-change-transform [transition:translate_.15s,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s]" />
          </MenuPrimitive.CheckboxItemIndicator>
        </>
      ) : (
        <>
          <TravelingHighlightTarget
            className={POPUP_SURFACE_STYLES.highlight}
            itemId={highlightItemId}
          />
          <MenuPrimitive.CheckboxItemIndicator className="col-start-1 -ms-0.5">
            <svg
              aria-hidden="true"
              className="size-3"
              fill="none"
              height="24"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
            </svg>
          </MenuPrimitive.CheckboxItemIndicator>
          <span className="col-start-2">{children}</span>
        </>
      )}
    </MenuPrimitive.CheckboxItem>
  );
}

export function MenuRadioGroup(
  props: MenuPrimitive.RadioGroup.Props,
): React.ReactElement {
  return <MenuPrimitive.RadioGroup data-slot="menu-radio-group" {...props} />;
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: MenuPrimitive.RadioItem.Props): React.ReactElement {
  const highlightItemId = useId();

  return (
    <MenuPrimitive.RadioItem
      className={cn(
        "in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] grid-cols-[.75rem_1fr] ps-3 pe-4",
        POPUP_SURFACE_STYLES.menuChoiceItem,
        className,
      )}
      data-traveling-highlight-id={highlightItemId}
      data-slot="menu-radio-item"
      {...props}
    >
      <TravelingHighlightTarget
        className={POPUP_SURFACE_STYLES.highlight}
        itemId={highlightItemId}
      />
      <MenuPrimitive.RadioItemIndicator className="col-start-1 -ms-0.5">
        <svg
          aria-hidden="true"
          className="size-3"
          fill="none"
          height="24"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
        </svg>
      </MenuPrimitive.RadioItemIndicator>
      <span className="col-start-2">{children}</span>
    </MenuPrimitive.RadioItem>
  );
}

export function MenuGroupLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean;
}): React.ReactElement {
  return (
    <MenuPrimitive.GroupLabel
      className={cn(
        POPUP_SURFACE_STYLES.menuGroupLabel,
        "data-inset:ps-9 sm:data-inset:ps-8",
        className,
      )}
      data-inset={inset}
      data-slot="menu-label"
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props): React.ReactElement {
  return (
    <MenuPrimitive.Separator
      className={cn(
        "h-px",
        POPUP_SURFACE_STYLES.menuSeparator,
        className,
      )}
      data-slot="menu-separator"
      {...props}
    />
  );
}

export function MenuShortcut({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn(
        "ms-auto font-sans text-[0.625rem] font-normal tracking-tight",
        POPUP_SURFACE_STYLES.shortcut,
        className,
      )}
      data-slot="menu-shortcut"
      {...props}
    />
  );
}

export function MenuSub(
  props: MenuPrimitive.SubmenuRoot.Props,
): React.ReactElement {
  return <MenuPrimitive.SubmenuRoot data-slot="menu-sub" {...props} />;
}

export function MenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
}): React.ReactElement {
  const highlightItemId = useId();

  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(
        POPUP_SURFACE_STYLES.menuItem,
        "data-popup-open:bg-(--surface-card-muted) [&>svg:not(:last-child)]:-mx-0.5",
        className,
      )}
      data-inset={inset}
      data-traveling-highlight-id={highlightItemId}
      data-slot="menu-sub-trigger"
      {...props}
    >
      <TravelingHighlightTarget
        className={POPUP_SURFACE_STYLES.highlight}
        itemId={highlightItemId}
      />
      {children}
      <ChevronRightIcon className="ms-auto -me-0.5 text-(--text-muted)" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

export function MenuSubPopup({
  className,
  sideOffset = 0,
  alignOffset,
  align = "start",
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
}): React.ReactElement {
  const defaultAlignOffset = align !== "center" ? -5 : undefined;

  return (
    <MenuPopup
      align={align}
      alignOffset={alignOffset ?? defaultAlignOffset}
      className={className}
      data-slot="menu-sub-content"
      side="inline-end"
      sideOffset={sideOffset}
      {...props}
    />
  );
}

export {
  MenuPrimitive,
  MenuCreateHandle as DropdownMenuCreateHandle,
  Menu as DropdownMenu,
  MenuPortal as DropdownMenuPortal,
  MenuTrigger as DropdownMenuTrigger,
  MenuPopup as DropdownMenuContent,
  MenuGroup as DropdownMenuGroup,
  MenuItem as DropdownMenuItem,
  MenuCheckboxItem as DropdownMenuCheckboxItem,
  MenuRadioGroup as DropdownMenuRadioGroup,
  MenuRadioItem as DropdownMenuRadioItem,
  MenuGroupLabel as DropdownMenuLabel,
  MenuSeparator as DropdownMenuSeparator,
  MenuShortcut as DropdownMenuShortcut,
  MenuSub as DropdownMenuSub,
  MenuSubTrigger as DropdownMenuSubTrigger,
  MenuSubPopup as DropdownMenuSubContent,
};
