"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, useReducedMotion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { PanelLeftIcon as HugePanelLeftIcon } from "@hugeicons/core-free-icons";
import * as React from "react";
import { useMediaQuery } from "../use-media-query";
import { cn } from "../utils";
import { Button } from "./button";
import { Input } from "./input";
import { ScrollArea } from "./scroll-area";
import { Separator } from "./separator";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "./sheet";
import { Skeleton } from "./skeleton";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "./tooltip";

const SIDEBAR_COOKIE_NAME: string = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE: number = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH: string = "16rem";
const SIDEBAR_WIDTH_MOBILE: string = "18rem";
const SIDEBAR_WIDTH_ICON: string = "4rem";
const SIDEBAR_KEYBOARD_SHORTCUT: string = "b";
const SIDEBAR_EXIT_DURATION_MS: number = 240;
const SIDEBAR_MIN_WIDTH: number = 192;
const SIDEBAR_MAX_WIDTH: number = 360;
const SIDEBAR_COLLAPSE_SLOP: number = 32;
const SIDEBAR_SPRING_MODERATE = {
  type: "spring" as const,
  duration: 0.16,
  bounce: 0,
};
const SIDEBAR_SPRING_MODERATE_EXIT = { duration: 0.12 };
const SIDEBAR_SPRING_SLOW = {
  type: "spring" as const,
  duration: 0.24,
  bounce: 0.12,
};
const SIDEBAR_SPRING_SLOW_EXIT = { duration: 0.16 };

export type SidebarCollapsible = "offcanvas" | "icon" | "none";

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-lg p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pe-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-8 text-sm",
        lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
        sm: "h-7 text-xs",
      },
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
      },
    },
  },
);

export type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean | ((open: boolean) => boolean)) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
  width: string;
  setWidth: (width: string) => void;
  minWidth: number;
  maxWidth: number;
  isResizing: boolean;
  setIsResizing: React.Dispatch<React.SetStateAction<boolean>>;
};

export const SidebarContext: React.Context<SidebarContextProps | null> =
  React.createContext<SidebarContextProps | null>(null);

export function useOptionalSidebar(): SidebarContextProps | null {
  return React.useContext(SidebarContext);
}

export function useSidebar(): SidebarContextProps {
  const context = useOptionalSidebar();
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

export function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  openMobile: openMobileProp,
  onOpenMobileChange: setOpenMobileProp,
  mobileQuery = "max-md",
  collapsible = "offcanvas",
  keyboardShortcut = true,
  defaultWidth = SIDEBAR_WIDTH,
  width: widthProp,
  onWidthChange: setWidthProp,
  minWidth = SIDEBAR_MIN_WIDTH,
  maxWidth = SIDEBAR_MAX_WIDTH,
  persist = true,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  openMobile?: boolean;
  onOpenMobileChange?: (open: boolean) => void;
  mobileQuery?: Parameters<typeof useMediaQuery>[0];
  collapsible?: SidebarCollapsible;
  keyboardShortcut?: boolean;
  defaultWidth?: string;
  width?: string;
  onWidthChange?: (width: string) => void;
  minWidth?: number;
  maxWidth?: number;
  persist?: boolean;
}): React.ReactElement {
  const isMobile = useMediaQuery(mobileQuery);
  const [_openMobile, _setOpenMobile] = React.useState(false);
  const openMobile = openMobileProp ?? _openMobile;
  const openMobileRef = React.useRef(openMobile);
  const [_width, _setWidth] = React.useState(defaultWidth);
  const width = widthProp ?? _width;
  const [isResizing, setIsResizing] = React.useState(false);

  React.useLayoutEffect(() => {
    openMobileRef.current = openMobile;
  }, [openMobile]);

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const presentedOpen = isMobile ? openMobile : open;
  const [state, setState] = React.useState<"expanded" | "collapsed">(
    presentedOpen ? "expanded" : "collapsed",
  );

  React.useLayoutEffect(() => {
    const shouldDelayCollapse = isMobile || collapsible === "offcanvas";

    if (presentedOpen || !shouldDelayCollapse) {
      setState(presentedOpen ? "expanded" : "collapsed");
      return;
    }

    // Keep expanded markup mounted until the fading surface is fully hidden.
    // This prevents compact icons and active indicators flashing during exit.
    const timeout = window.setTimeout(() => {
      setState("collapsed");
    }, SIDEBAR_EXIT_DURATION_MS);

    return () => window.clearTimeout(timeout);
  }, [collapsible, isMobile, presentedOpen]);

  const setOpen = React.useCallback(
    async (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }

      if (persist) {
        await cookieStore.set({
          expires: Date.now() + SIDEBAR_COOKIE_MAX_AGE * 1000,
          name: SIDEBAR_COOKIE_NAME,
          path: "/",
          value: String(openState),
        });
      }
    },
    [persist, setOpenProp, open],
  );

  const setOpenMobile = React.useCallback(
    (value: boolean | ((open: boolean) => boolean)) => {
      const nextOpen = typeof value === "function" ? value(openMobileRef.current) : value;
      if (setOpenMobileProp) {
        setOpenMobileProp(nextOpen);
      } else {
        _setOpenMobile(nextOpen);
      }
    },
    [setOpenMobileProp],
  );

  const setWidth = React.useCallback(
    (nextWidth: string) => {
      setWidthProp?.(nextWidth);
      if (widthProp === undefined) _setWidth(nextWidth);
    },
    [setWidthProp, widthProp],
  );

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open);
  }, [isMobile, setOpen, setOpenMobile]);

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    if (!keyboardShortcut) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keyboardShortcut, toggleSidebar]);

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      isMobile,
      open,
      openMobile,
      setOpen,
      setOpenMobile,
      state,
      toggleSidebar,
      width,
      setWidth,
      minWidth,
      maxWidth,
      isResizing,
      setIsResizing,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar, width, setWidth, minWidth, maxWidth, isResizing],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
          className,
        )}
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": width,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  contained = false,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: SidebarCollapsible;
  contained?: boolean;
}): React.ReactElement {
  const { isMobile, open, openMobile, setOpenMobile, width, isResizing } = useSidebar();
  const state = open ? "expanded" : "collapsed";
  const reduceMotion = useReducedMotion() ?? false;
  const [dragFlip, setDragFlip] = React.useState(false);
  const previousOpenRef = React.useRef(open);
  const openFlipped = previousOpenRef.current !== open;

  React.useEffect(() => {
    const flipped = previousOpenRef.current !== open;
    previousOpenRef.current = open;

    if (!isResizing) {
      setDragFlip(false);
      return;
    }
    if (!flipped) return;

    setDragFlip(true);
    const timeout = window.setTimeout(
      () => setDragFlip(false),
      SIDEBAR_SPRING_MODERATE.duration * 1000 + 100,
    );
    return () => window.clearTimeout(timeout);
  }, [isResizing, open]);

  const offcanvasTransition = reduceMotion
    ? { duration: 0 }
    : isResizing
      ? openFlipped || dragFlip
        ? open
          ? SIDEBAR_SPRING_MODERATE
          : SIDEBAR_SPRING_MODERATE_EXIT
        : { duration: 0 }
      : open
        ? SIDEBAR_SPRING_SLOW
        : SIDEBAR_SPRING_SLOW_EXIT;
  const fluidOffcanvas = collapsible === "offcanvas";

  if (collapsible === "none") {
    return (
      <div
        className={cn(
          "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
          className,
        )}
        data-slot="sidebar"
        {...props}
      >
        {children}
      </div>
    );
  }

  if (isMobile) {
    return (
      <Sheet onOpenChange={setOpenMobile} open={openMobile} {...props}>
        <SheetPopup
          backdropClassName="duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
          className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground transition-opacity duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:translate-x-0 data-starting-style:translate-x-0 data-ending-style:duration-200 motion-reduce:transition-none [&>button]:hidden"
          data-mobile="true"
          data-sidebar="sidebar"
          data-slot="sidebar"
          side={side}
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetPopup>
      </Sheet>
    );
  }

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-side={side}
      data-slot="sidebar"
      data-state={state}
      data-variant={variant}
      {...props}
    >
      {/* This is what handles the sidebar gap on desktop */}
      <motion.div
        className={cn(
          "relative bg-transparent",
          !fluidOffcanvas && "w-(--sidebar-width) transition-[width] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+1rem)]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
        )}
        initial={false}
        animate={fluidOffcanvas ? { width: open ? width : "0rem" } : undefined}
        transition={fluidOffcanvas ? offcanvasTransition : undefined}
        data-slot="sidebar-gap"
      />
      <motion.div
        aria-hidden={
          state === "collapsed" && collapsible === "offcanvas"
            ? true
            : undefined
        }
        className={cn(
          contained
            ? "absolute inset-y-0 z-10 hidden h-full w-(--sidebar-width) md:flex"
            : "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) md:flex",
          !fluidOffcanvas && "transition-[width,opacity,transform] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          side === "left" ? "left-0" : "right-0",
          fluidOffcanvas && !open && "pointer-events-none",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+1rem)]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className,
        )}
        initial={false}
        animate={fluidOffcanvas ? { x: open ? "0%" : side === "left" ? "-100%" : "100%" } : undefined}
        transition={fluidOffcanvas ? offcanvasTransition : undefined}
        data-slot="sidebar-container"
        inert={
          state === "collapsed" && collapsible === "offcanvas"
            ? true
            : undefined
        }
      >
        <div
          className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm/5"
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
        >
          {children}
        </div>
      </motion.div>
    </div>
  );
}

export function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>): React.ReactElement {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      className={cn("size-7", className)}
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      size="icon"
      variant="ghost"
      {...props}
    >
      <HugeiconsIcon icon={HugePanelLeftIcon} size={16} strokeWidth={1.5} />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

export function SidebarRail({
  className,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  style,
  ...props
}: React.ComponentProps<"button">): React.ReactElement {
  const {
    open,
    setOpen,
    toggleSidebar,
    setWidth,
    minWidth,
    maxWidth,
    setIsResizing,
  } = useSidebar();
  const dragRef = React.useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    side: "left" | "right";
    moved: boolean;
    collapsed: boolean;
  } | null>(null);
  const suppressClickRef = React.useRef(false);

  const finishResize = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    setIsResizing(false);
  }, [setIsResizing]);

  const cancelResize = React.useCallback(() => {
    dragRef.current = null;
    suppressClickRef.current = false;
    setIsResizing(false);
  }, [setIsResizing]);

  return (
    <button
      aria-label="Resize or collapse sidebar"
      className={cn(
        "absolute inset-y-0 z-20 hidden w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:w-px after:bg-transparent after:transition-colors after:duration-80 hover:after:bg-foreground/25 sm:flex",
        "group-data-[side=left]:right-0 group-data-[side=left]:after:right-0 group-data-[side=right]:left-0 group-data-[side=right]:after:left-0",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        className,
      )}
      data-sidebar="rail"
      data-slot="sidebar-rail"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        toggleSidebar();
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (event.defaultPrevented || event.button !== 0 || !open) return;

        const sidebar = event.currentTarget.closest<HTMLElement>("[data-slot='sidebar-container']");
        const side = event.currentTarget.closest<HTMLElement>("[data-side]")?.dataset.side === "right"
          ? "right"
          : "left";
        const startWidth = sidebar?.getBoundingClientRect().width ?? minWidth;
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth,
          side,
          moved: false,
          collapsed: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        onPointerMove?.(event);
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;

        const dx = event.clientX - drag.startX;
        if (!drag.moved && Math.abs(dx) < 4) return;
        if (!drag.moved) {
          drag.moved = true;
          setIsResizing(true);
        }

        const direction = drag.side === "left" ? 1 : -1;
        const rawWidth = drag.startWidth + dx * direction;

        if (rawWidth < minWidth - SIDEBAR_COLLAPSE_SLOP) {
          if (!drag.collapsed) {
            drag.collapsed = true;
            setWidth(`${minWidth}px`);
            void setOpen(false);
          }
          return;
        }

        if (drag.collapsed) {
          drag.collapsed = false;
          void setOpen(true);
        }

        setWidth(`${Math.min(maxWidth, Math.max(minWidth, rawWidth))}px`);
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event);
        finishResize(event);
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        cancelResize();
      }}
      style={{ touchAction: "none", ...style }}
      title="Resize or collapse sidebar"
      type="button"
      {...props}
    />
  );
}

export function SidebarInset({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "relative flex w-full flex-1 flex-col bg-background",
        "md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-2 md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ms-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm/5",
        className,
      )}
      data-slot="sidebar-inset"
      {...props}
    />
  );
}

export function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>): React.ReactElement {
  return (
    <Input
      className={cn("h-8 w-full bg-background shadow-none", className)}
      data-sidebar="input"
      data-slot="sidebar-input"
      {...props}
    />
  );
}

export function SidebarHeader({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="header"
      data-slot="sidebar-header"
      {...props}
    />
  );
}

export function SidebarFooter({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="footer"
      data-slot="sidebar-footer"
      {...props}
    />
  );
}

export function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>): React.ReactElement {
  return (
    <Separator
      className={cn("mx-2 w-auto bg-sidebar-border", className)}
      data-sidebar="separator"
      data-slot="sidebar-separator"
      {...props}
    />
  );
}

export function SidebarContent({
  className,
  verticalScrollbarClassName,
  ...props
}: React.ComponentProps<"div"> & {
  verticalScrollbarClassName?: string;
}): React.ReactElement {
  return (
    <ScrollArea
      className="min-h-0 flex-1 [&_[data-slot=scroll-area-content]]:min-h-full"
      scrollFade
      verticalScrollbarClassName={verticalScrollbarClassName}
    >
      <div
        className={cn(
          "flex min-h-full flex-col gap-2 group-data-[collapsible=icon]:overflow-hidden",
          className,
        )}
        data-sidebar="content"
        data-slot="sidebar-content"
        {...props}
      />
    </ScrollArea>
  );
}

export function SidebarGroup({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      data-sidebar="group"
      data-slot="sidebar-group"
      {...props}
    />
  );
}

export function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex h-8 shrink-0 items-center rounded-lg px-2 font-medium text-sidebar-foreground text-xs outline-hidden ring-sidebar-ring transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
      "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
      className,
    ),
    "data-sidebar": "group-label",
    "data-slot": "sidebar-group-label",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps(defaultProps, props),
    render,
  });
}

export function SidebarGroupAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<"button">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-lg p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
      // Increases the hit area of the button on mobile.
      "after:absolute after:-inset-2 md:after:hidden",
      "group-data-[collapsible=icon]:hidden",
      className,
    ),
    "data-sidebar": "group-action",
    "data-slot": "sidebar-group-action",
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps(defaultProps, props),
    render,
  });
}

export function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("w-full text-sm", className)}
      data-sidebar="group-content"
      data-slot="sidebar-group-content"
      {...props}
    />
  );
}

export function SidebarMenu({
  className,
  ...props
}: React.ComponentProps<"ul">): React.ReactElement {
  return (
    <ul
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      data-sidebar="menu"
      data-slot="sidebar-menu"
      {...props}
    />
  );
}

export function SidebarMenuItem({
  className,
  ...props
}: React.ComponentProps<"li">): React.ReactElement {
  return (
    <li
      className={cn("group/menu-item relative", className)}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
      {...props}
    />
  );
}

export function SidebarMenuButton({
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & {
  isActive?: boolean;
  tooltip?: string | React.ComponentProps<typeof TooltipPopup>;
} & VariantProps<typeof sidebarMenuButtonVariants>): React.ReactElement {
  const { isMobile, state } = useSidebar();

  const defaultProps = {
    className: cn(sidebarMenuButtonVariants({ size, variant }), className),
    "data-active": isActive,
    "data-sidebar": "menu-button",
    "data-size": size,
    "data-slot": "sidebar-menu-button",
  };

  const buttonProps = mergeProps<"button">(defaultProps, props);

  const buttonElement = useRender({
    defaultTagName: "button",
    props: buttonProps,
    render,
  });

  if (!tooltip) {
    return buttonElement;
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    };
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={buttonElement as React.ReactElement<Record<string, unknown>>}
      />
      <TooltipPopup
        align="center"
        hidden={state !== "collapsed" || isMobile}
        side="right"
        {...tooltip}
      />
    </Tooltip>
  );
}

export function SidebarMenuAction({
  className,
  showOnHover = false,
  render,
  ...props
}: useRender.ComponentProps<"button"> & {
  showOnHover?: boolean;
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      "absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-lg p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 peer-hover/menu-button:text-sidebar-accent-foreground [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
      // Increases the hit area of the button on mobile.
      "after:absolute after:-inset-2 md:after:hidden",
      "peer-data-[size=sm]/menu-button:top-1",
      "peer-data-[size=default]/menu-button:top-1.5",
      "peer-data-[size=lg]/menu-button:top-2.5",
      "group-data-[collapsible=icon]:hidden",
      showOnHover &&
        "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground md:opacity-0",
      className,
    ),
    "data-sidebar": "menu-action",
    "data-slot": "sidebar-menu-action",
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "pointer-events-none absolute right-1 flex h-5 min-w-5 select-none items-center justify-center rounded-lg px-1 font-medium text-sidebar-foreground text-xs tabular-nums",
        "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      data-sidebar="menu-badge"
      data-slot="sidebar-menu-badge"
      {...props}
    />
  );
}

export function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean;
}): React.ReactElement {
  // Random width between 50 to 90%.
  const width = React.useMemo(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`;
  }, []);

  return (
    <div
      className={cn("flex h-8 items-center gap-2 rounded-lg px-2", className)}
      data-sidebar="menu-skeleton"
      data-slot="sidebar-menu-skeleton"
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-lg"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  );
}

export function SidebarMenuSub({
  className,
  ...props
}: React.ComponentProps<"ul">): React.ReactElement {
  return (
    <ul
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-sidebar-border border-l px-2.5 py-0.5",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      data-sidebar="menu-sub"
      data-slot="sidebar-menu-sub"
      {...props}
    />
  );
}

export function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">): React.ReactElement {
  return (
    <li
      className={cn("group/menu-sub-item relative", className)}
      data-sidebar="menu-sub-item"
      data-slot="sidebar-menu-sub-item"
      {...props}
    />
  );
}

export function SidebarMenuSubButton({
  size = "md",
  isActive = false,
  className,
  render,
  ...props
}: useRender.ComponentProps<"a"> & {
  size?: "sm" | "md";
  isActive?: boolean;
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex h-8 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-lg px-2 text-sidebar-foreground outline-hidden ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:h-7 [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
      "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
      size === "sm" && "text-xs",
      size === "md" && "text-sm",
      "group-data-[collapsible=icon]:hidden",
      className,
    ),
    "data-active": isActive,
    "data-sidebar": "menu-sub-button",
    "data-size": size,
    "data-slot": "sidebar-menu-sub-button",
  };

  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(defaultProps, props),
    render,
  });
}
