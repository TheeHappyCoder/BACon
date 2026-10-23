'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../utils';

type RightSidebarRegistration = {
  id: string;
  label: string;
};

type RightSidebarContextValue = {
  activeId: string | null;
  hasContent: boolean;
  label: string;
  mountNode: HTMLDivElement | null;
  open: boolean;
  register: (registration: RightSidebarRegistration) => void;
  setMountNode: (node: HTMLDivElement | null) => void;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  unregister: (id: string) => void;
};

const RightSidebarContext = React.createContext<RightSidebarContextValue | null>(null);

export function RightSidebarProvider({
  children,
  defaultOpen = true,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [registrations, setRegistrations] = React.useState<RightSidebarRegistration[]>([]);
  const [mountNode, setMountNode] = React.useState<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(defaultOpen);

  const register = React.useCallback((registration: RightSidebarRegistration) => {
    setRegistrations((current) => [
      ...current.filter((entry) => entry.id !== registration.id),
      registration,
    ]);
  }, []);

  const unregister = React.useCallback((id: string) => {
    setRegistrations((current) => {
      if (!current.some((entry) => entry.id === id)) return current;
      return current.filter((entry) => entry.id !== id);
    });
  }, []);

  const activeRegistration = registrations.at(-1) ?? null;
  const value = React.useMemo<RightSidebarContextValue>(() => ({
    activeId: activeRegistration?.id ?? null,
    hasContent: activeRegistration !== null,
    label: activeRegistration?.label ?? 'tools',
    mountNode,
    open,
    register,
    setMountNode,
    setOpen,
    unregister,
  }), [activeRegistration, mountNode, open, register, unregister]);

  return (
    <RightSidebarContext.Provider value={value}>
      {children}
    </RightSidebarContext.Provider>
  );
}

export function useRightSidebar() {
  const context = React.useContext(RightSidebarContext);
  if (!context) throw new Error('useRightSidebar must be used inside RightSidebarProvider');
  return context;
}

export function RightSidebar({
  children,
  label = 'tools',
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const id = React.useId();
  const { activeId, mountNode, register, unregister } = useRightSidebar();

  React.useEffect(() => {
    register({ id, label });
    return () => unregister(id);
  }, [id, label, register, unregister]);

  return activeId === id && mountNode ? createPortal(children, mountNode) : null;
}

export function RightSidebarViewport({
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'ref'>) {
  const { setMountNode } = useRightSidebar();

  return (
    <div
      ref={setMountNode}
      className={cn('flex h-full min-h-0 w-full flex-col overflow-hidden', className)}
      data-slot="right-sidebar-viewport"
      {...props}
    />
  );
}
