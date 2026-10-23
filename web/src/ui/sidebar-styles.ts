// Shared visual vocabulary for every Nova application sidebar.
// Selected is raised (Level 2), not grey: surface, tiny shadow, top highlight and ink ring come from the elevation tokens.
const ACTIVE_SURFACE = "elevation-raised";

export const NOVA_SIDEBAR_STYLES = {
  hover: "transition-colors duration-150 hover:bg-accent hover:text-foreground hover:transition-none",
  animatedHover: "transition-colors duration-150 hover:text-foreground",
  focus: "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
  row: "group relative flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left",
  collapsedRow: "group relative flex size-8 cursor-pointer items-center justify-center rounded-lg",
  backRow: "group relative flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-muted-foreground",
  activeSurface: ACTIVE_SURFACE,
  activeIndicator: `pointer-events-none absolute inset-0 rounded-lg ${ACTIVE_SURFACE}`,
  hoverIndicator: "bg-accent",
  leadingSlot: "relative z-10 flex size-6 shrink-0 items-center justify-center",
  icon: "relative z-10 size-4 shrink-0 text-muted-foreground transition-colors",
  itemLabel: "relative z-10 min-w-0 flex-1 truncate text-[0.8125rem] font-normal",
  /** A tree branch's disclosure chevron; add `rotate-90` while open. */
  chevron: "size-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none",
  /** A count or short note at the end of a row. */
  meta: "relative z-10 shrink-0 text-xs tabular-nums text-muted-foreground",
  /** A number at the end of a row, on its own small recessed chip so it reads as a count, not stray text. */
  count: "relative z-10 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-foreground/[0.055] px-1.5 text-[0.6875rem] font-medium leading-none tabular-nums text-muted-foreground shadow-[inset_0_0_0_1px_rgb(0_0_0/0.03)] transition-colors group-hover:bg-foreground/[0.08] group-hover:text-foreground/80 dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]",
  /** A one-line note inside a list or tree with nothing to show. */
  note: "px-3 py-1.5 text-xs text-muted-foreground",
  sectionLabel: "text-xs font-normal leading-5 text-muted-foreground",
  sections: "flex flex-col gap-3",
  section: "flex flex-col gap-1",
  items: "flex flex-col gap-0.5",
  collapsedSeparator: "h-px w-4 bg-border",
  content: "overflow-x-clip px-2.5 pb-3 pt-0",
  footerItems: "flex flex-col gap-0.5 px-2.5",
} as const;
