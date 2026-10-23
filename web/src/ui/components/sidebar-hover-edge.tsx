'use client';

import { cn } from '../utils';

type SidebarHoverEdgeProps = {
 enabled: boolean;
 onHover: () => void;
 side?: 'left' | 'right';
 className?: string;
};

export function SidebarHoverEdge({
 enabled,
 onHover,
 side = 'left',
 className,
}: SidebarHoverEdgeProps) {
 if (!enabled) {
 return null;
 }

 return (
 <div
 aria-hidden="true"
 onMouseEnter={onHover}
 className={cn(
 'fixed inset-y-0 z-30 hidden w-3 md:block',
 side === 'left' ? 'left-0' : 'right-0',
 className,
 )}
 />
 );
}
