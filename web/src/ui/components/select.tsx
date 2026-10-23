"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { Hugeicons } from "./hugeicons";
const { ChevronDoubleCloseIcon, ChevronDownIcon, ChevronUpIcon } = Hugeicons;
import * as React from "react";
import { cn } from "../utils";
import { POPUP_SURFACE_STYLES } from "./popup-surface";
import {
  TravelingHighlightScope,
  TravelingHighlightTarget,
} from "./traveling-highlight";

type SelectRootProps<
  Value,
  Multiple extends boolean | undefined = false,
> = SelectPrimitive.Root.Props<Value, Multiple>;

type SelectValueType<
  Value,
  Multiple extends boolean | undefined = false,
> = Multiple extends true ? Value[] : Value;

export type SelectProps<
  Value,
  Multiple extends boolean | undefined = false,
> = Omit<SelectRootProps<Value, Multiple>, "onValueChange"> & {
  onValueChange?: (
    value: SelectValueType<Value, Multiple>,
    eventDetails: SelectPrimitive.Root.ChangeEventDetails,
  ) => void;
};

export function Select<
  Value = string,
  Multiple extends boolean | undefined = false,
>({
  children,
  items,
  onValueChange,
  ...props
}: SelectProps<Value, Multiple>): React.ReactElement {
  const handleValueChange: SelectRootProps<Value, Multiple>["onValueChange"] =
    onValueChange
      ? (value, eventDetails) => {
          if (value === null) return;
          onValueChange(value as SelectValueType<Value, Multiple>, eventDetails);
        }
      : undefined;
  const resolvedItems =
    items ?? inferSelectItemsFromChildren(children);

  return (
    <SelectPrimitive.Root
      {...props}
      items={resolvedItems}
      onValueChange={handleValueChange}
    >
      {children}
    </SelectPrimitive.Root>
  );
}

function inferSelectItemsFromChildren(
  children: React.ReactNode,
): SelectRootProps<unknown>["items"] {
  const items: Array<{ label: React.ReactNode; value: unknown }> = [];

  function walk(node: React.ReactNode): void {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;

      const childProps = child.props as {
        children?: React.ReactNode;
        value?: unknown;
      };

      if (Object.prototype.hasOwnProperty.call(childProps, "value")) {
        items.push({
          label: childProps.children,
          value: childProps.value,
        });
      }

      walk(childProps.children);
    });
  }

  walk(children);
  return items.length > 0 ? items : undefined;
}

export const selectTriggerVariants = cva(
  "relative inline-flex h-8 w-full min-w-36 select-none items-center justify-between gap-2 rounded-[12px] border border-(--border-default) bg-(--surface-input) pl-[11px] pr-2.5 text-left text-[14px] text-(--text-strong) shadow-[0_1px_2px_rgba(0,0,0,.05)] outline-none transition-[border-color,box-shadow] duration-150 hover:border-(--border-strong) pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 focus-visible:border-ring focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-popup-open:border-ring aria-invalid:border-[color-mix(in_srgb,var(--status-alarm-strong)_36%,transparent)] data-disabled:pointer-events-none data-disabled:opacity-64 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-(--text-muted)",
  {
    defaultVariants: {
      size: "default",
    },
    variants: {
      size: {
        default: "",
        lg: "h-9",
        sm: "h-7 gap-1.5 pl-[9px] pr-2",
      },
    },
  },
);

export const selectTriggerIconClassName = "-me-1 size-4";

export interface SelectButtonProps extends useRender.ComponentProps<"button"> {
  size?: VariantProps<typeof selectTriggerVariants>["size"];
}

export function SelectButton({
  className,
  size,
  render,
  children,
  ...props
}: SelectButtonProps): React.ReactElement {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
    render ? undefined : "button";

  const defaultProps = {
    children: (
      <>
        <span className="flex-1 truncate in-data-placeholder:text-muted-foreground/72">
          {children}
        </span>
        <ChevronDoubleCloseIcon
          aria-hidden="true"
          className={cn(selectTriggerIconClassName, "rotate-90")}
        />
      </>
    ),
    className: cn(selectTriggerVariants({ size }), "min-w-0", className),
    "data-slot": "select-button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props &
  VariantProps<typeof selectTriggerVariants>): React.ReactElement {
  return (
    <SelectPrimitive.Trigger
      className={cn(selectTriggerVariants({ size }), className)}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon data-slot="select-icon">
        <ChevronDoubleCloseIcon
          aria-hidden="true"
          className={cn(selectTriggerIconClassName, "rotate-90")}
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectValue({
  className,
  ...props
}: SelectPrimitive.Value.Props): React.ReactElement {
  return (
    <SelectPrimitive.Value
      className={cn(
        "flex-1 truncate data-placeholder:text-muted-foreground",
        className,
      )}
      data-slot="select-value"
      {...props}
    />
  );
}

export function SelectPopup({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = true,
  anchor,
  portalProps,
  ...props
}: SelectPrimitive.Popup.Props & {
  portalProps?: SelectPrimitive.Portal.Props;
  side?: SelectPrimitive.Positioner.Props["side"];
  sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
  align?: SelectPrimitive.Positioner.Props["align"];
  alignOffset?: SelectPrimitive.Positioner.Props["alignOffset"];
  alignItemWithTrigger?: SelectPrimitive.Positioner.Props["alignItemWithTrigger"];
  anchor?: SelectPrimitive.Positioner.Props["anchor"];
}): React.ReactElement {
  return (
    <SelectPrimitive.Portal {...portalProps}>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-[1100] select-none"
        data-slot="select-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          className={cn(
            "nova-select-motion origin-(--transform-origin) text-(--text-strong) outline-none",
            POPUP_SURFACE_STYLES.surfaceColor,
          )}
          data-slot="select-popup"
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow
            className={cn(
              "top-0 before:top-px before:rounded-t-[calc(var(--radius-2xl)-1px)] before:bg-linear-to-b",
              POPUP_SURFACE_STYLES.selectScrollArrow,
            )}
            data-slot="select-scroll-up-arrow"
          >
            <ChevronUpIcon
              aria-hidden="true"
              className="relative size-4.5 sm:size-4"
            />
          </SelectPrimitive.ScrollUpArrow>
          <div
            className={cn(
              "relative h-full min-w-(--anchor-width) overflow-hidden rounded-2xl",
              POPUP_SURFACE_STYLES.surface,
              POPUP_SURFACE_STYLES.menuShadow,
            )}
            data-slot="select-surface"
          >
            <TravelingHighlightScope>
              <SelectPrimitive.List
                className={cn(
                  "max-h-(--available-height) overflow-y-auto p-1.5",
                  className,
                )}
                data-slot="select-list"
              >
                {children}
              </SelectPrimitive.List>
            </TravelingHighlightScope>
          </div>
          <SelectPrimitive.ScrollDownArrow
            className={cn(
              "bottom-0 before:bottom-px before:rounded-b-[calc(var(--radius-2xl)-1px)] before:bg-linear-to-t",
              POPUP_SURFACE_STYLES.selectScrollArrow,
            )}
            data-slot="select-scroll-down-arrow"
          >
            <ChevronDownIcon
              aria-hidden="true"
              className="relative size-4.5 sm:size-4"
            />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props): React.ReactElement {
  const highlightItemId = React.useId();

  return (
    <SelectPrimitive.Item
      className={cn(
        "in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
        POPUP_SURFACE_STYLES.selectItem,
        className,
      )}
      data-traveling-highlight-id={highlightItemId}
      data-slot="select-item"
      {...props}
    >
      <TravelingHighlightTarget
        className={POPUP_SURFACE_STYLES.highlight}
        itemId={highlightItemId}
      />
      <SelectPrimitive.ItemIndicator className="col-start-1">
        <svg
          aria-hidden="true"
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
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText className="col-start-2 min-w-0">
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props): React.ReactElement {
  return (
    <SelectPrimitive.Separator
      className={cn(
        "h-px",
        POPUP_SURFACE_STYLES.menuSeparator,
        className,
      )}
      data-slot="select-separator"
      {...props}
    />
  );
}

export function SelectGroup(
  props: SelectPrimitive.Group.Props,
): React.ReactElement {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

export function SelectLabel({
  className,
  ...props
}: SelectPrimitive.Label.Props): React.ReactElement {
  return (
    <SelectPrimitive.Label
      className={cn(
        "not-in-data-[slot=field]:mb-2 inline-flex cursor-default items-center gap-2 font-medium text-base/4.5 text-foreground sm:text-sm/4",
        className,
      )}
      data-slot="select-label"
      {...props}
    />
  );
}

export function SelectGroupLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props): React.ReactElement {
  return (
    <SelectPrimitive.GroupLabel
      className={cn(POPUP_SURFACE_STYLES.menuGroupLabel, className)}
      data-slot="select-group-label"
      {...props}
    />
  );
}

export { SelectPrimitive };
