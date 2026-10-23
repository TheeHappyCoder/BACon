"use client";

/* The ink surface: tooltips, floating action bars and the command palette. Ink #1a1a1c with #fcfcfc text, muted at 60%.
   Menus and select popups are white (popup-surface.tsx). */

const DARK_ACTION_SURFACE_COLOR = "[--dark-action-surface:#1a1a1c]";

export const DARK_ACTION_SURFACE_STYLES = {
  surface: `${DARK_ACTION_SURFACE_COLOR} border border-white/8 bg-[#1a1a1c] text-[#fcfcfc] before:hidden`,
  tooltipContext:
    "[--foreground:#fcfcfc] [--muted-foreground:rgba(252,252,252,0.6)]",
  tooltipMotion:
    "origin-(--transform-origin) transition-[width,height,scale,opacity] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-98 data-ending-style:opacity-0 data-ending-style:duration-100 data-instant:duration-0 motion-reduce:transition-none",
  tooltipShadow:
    "shadow-(--shadow-2)",
  dialogShadow:
    "shadow-(--shadow-2)",
  contextualBarShadow:
    "shadow-(--shadow-2)",
  highlight: "bg-white/10",
  destructiveHighlight: "bg-[#ffb9a2]/15",
  separator: "bg-white/8",
  groupLabel: "text-white/60",
  primaryText: "text-white/92",
  secondaryText: "text-white/60",
  icon:
    "flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60 [&_svg]:size-4",
  contextualAction:
    "text-white/60 hover:text-white/90 focus-visible:text-white/90 disabled:text-white/25",
  contextualDestructiveAction:
    "text-[#ffb9a2] hover:text-[#ffe3d9] focus-visible:text-[#ffe3d9] disabled:text-[#ffb9a2]/35",
} as const;
