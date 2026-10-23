"use client";

/* Menus and select popups (novacore-app-ux): a white popover on an ink-8% hairline with the popover shadow, 32px
   rows at 9px radius like the sidebar, 13px ink labels, faint 15px icons, the sidebar's 5% ink hover. Destructive
   rows keep ink text on a coral tint: never coloured text on a tint. Tooltips and floating bars use dark-action-surface. */
const POPUP_SURFACE_COLOR = "[--popup-surface:var(--surface-card)]";

export const POPUP_SURFACE_STYLES = {
  surfaceColor: POPUP_SURFACE_COLOR,
  surface: `${POPUP_SURFACE_COLOR} border border-(--border-subtle) bg-(--surface-card) text-(--text-strong) before:hidden`,
  menuShadow: "shadow-(--shadow-popover)",
  popupMotion:
    "origin-(--transform-origin) transition-[scale,opacity,translate,filter] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform data-starting-style:-translate-y-1 data-starting-style:scale-98 data-starting-style:opacity-0 data-starting-style:blur-[2px] data-ending-style:-translate-y-0.5 data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-100 data-[side=top]:data-starting-style:translate-y-1 data-[side=top]:data-ending-style:translate-y-0.5 data-instant:transition-none motion-reduce:transition-none motion-reduce:data-starting-style:translate-y-0 motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:translate-y-0 motion-reduce:data-ending-style:scale-100",
  /* Items are `isolate`, so -z-10 keeps the solid highlight behind the label and icon, inside the item. */
  highlight: "-z-10 bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]",
  destructiveHighlight: "-z-10 bg-(--status-alarm-bg)",
  menuSeparator: "mx-2 my-1 bg-(--border-subtle)",
  menuGroupLabel: "px-2.5 pb-1 pt-1.5 text-[11px] font-normal text-(--text-faint)",
  menuItem:
    "relative isolate flex min-h-8 cursor-pointer select-none items-center gap-2.5 rounded-[9px] px-2.5 py-1 text-[13px] font-normal leading-5 text-(--text-strong) outline-none data-disabled:pointer-events-none data-inset:ps-8 data-highlighted:bg-transparent data-disabled:opacity-60 [&>svg:not([class*='size-'])]:size-[15px] [&>svg]:pointer-events-none [&>svg]:shrink-0 [&>svg]:text-(--text-faint) data-highlighted:[&>svg]:text-(--text-strong)",
  menuChoiceItem:
    "relative isolate grid h-8 min-h-8 cursor-pointer select-none items-center gap-2 rounded-[9px] py-0 text-[13px] font-normal text-(--text-strong) outline-none data-disabled:pointer-events-none data-highlighted:bg-transparent data-checked:bg-(--surface-card-muted) data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-(--text-muted)",
  selectItem:
    "relative isolate grid min-h-8 cursor-pointer grid-cols-[1rem_1fr] items-center gap-2 rounded-[9px] py-1 ps-2.5 pe-2.5 text-[13px] font-normal text-(--text-strong) outline-none data-disabled:pointer-events-none data-highlighted:bg-transparent data-selected:bg-(--surface-card-muted) data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-(--text-muted)",
  selectScrollArrow:
    "z-50 flex h-6 w-full cursor-default items-center justify-center text-(--text-muted) before:pointer-events-none before:absolute before:inset-x-px before:h-[200%] before:from-50% before:from-(--popup-surface)",
  menuDestructiveItem:
    "data-[variant=destructive]:data-highlighted:bg-transparent data-[variant=destructive]:[&>svg]:text-(--status-alarm-strong)",
  shortcut: "text-(--text-muted)",
} as const;
