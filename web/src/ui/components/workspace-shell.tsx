import * as React from "react";

import { cn } from "../utils";

export function WorkspaceShell({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "isolate flex h-svh min-h-0 w-full flex-col overflow-hidden bg-background text-foreground",
        className,
      )}
      data-slot="workspace-shell"
      {...props}
    />
  );
}

export function WorkspaceShellHeader({
  className,
  ...props
}: React.ComponentProps<"header">): React.ReactElement {
  return (
    <header
      className={cn(
        "relative z-30 flex h-12 shrink-0 items-center bg-background px-2.5",
        className,
      )}
      data-slot="workspace-shell-header"
      {...props}
    />
  );
}

export function WorkspaceShellBody({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("relative flex min-h-0 flex-1 overflow-hidden", className)}
      data-slot="workspace-shell-body"
      {...props}
    />
  );
}

export function WorkspaceShellFooter({
  className,
  ...props
}: React.ComponentProps<"footer">): React.ReactElement {
  return (
    <footer
      className={cn(
        "relative z-30 flex h-10 shrink-0 items-center bg-background px-2.5",
        className,
      )}
      data-slot="workspace-shell-footer"
      {...props}
    />
  );
}

export function WorkspaceShellFooterGroup({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("flex h-full min-w-0 items-center gap-0.5", className)}
      data-slot="workspace-shell-footer-group"
      {...props}
    />
  );
}

export function WorkspaceShellMain({
  className,
  ...props
}: React.ComponentProps<"main">): React.ReactElement {
  return (
    <main
      className={cn(
        "relative flex min-w-0 flex-1 flex-col overflow-hidden bg-background",
        className,
      )}
      data-slot="workspace-shell-main"
      {...props}
    />
  );
}
